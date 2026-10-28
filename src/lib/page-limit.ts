import "server-only";

import { DocumentKind, VersionCause } from "@/generated/prisma/enums";
import { extractedOf, trimmedSchema, unitsSchema, type Extracted, type Trimmed, type Unit } from "@/lib/application-data";
import { updateDocuments } from "@/lib/document-units";
import { saveVersion } from "@/lib/document-versions";
import { countPdfPages } from "@/lib/pdf/pages";
import { renderPdf } from "@/lib/pdf/render";
import { prisma } from "@/lib/prisma";
import type { ProfileData } from "@/lib/profile";
import { pagesInWords } from "@/lib/settings";
import { bulletLines, isPublicationUnit } from "@/lib/unit-text";
import { citationExcerpt } from "@/lib/citation";

// "Resume length" (E10-10, SET-9): a new tailored resume that runs over its
// page limit is cut, once, when the application is created (decided 28
// September 2026), measured in the real PDF. What's cut is kept on the
// document, so it can be put back.
//
// This fork cuts by relevance to the job, never by shrinking type, spacing
// or margins (the theme's density stays as chosen) and never by shortening a
// bullet: a one-page resume loses its summary first, then — one at a time —
// the bullet or project least relevant to the posting (jobTerms below), so
// every company stays in the history with its most relevant work, fully
// written. Only when every role is down to one bullet and no project is left
// does the least relevant whole role go (never the most recent one), and
// then publications from the bottom. Upstream cut the oldest roles first.

/** Enough for any resume: bullets, projects and roles run out long before. */
const MAX_CUTS = 60;

type Cut = { trimmed: Trimmed[number]; units: Unit[] };

/** What the posting asks for, weighted: the profile's own skills it names count most. */
export type JobTerms = readonly { term: string; weight: number }[];
export const NO_TERMS: JobTerms = [];

const STOPWORDS = new Set(
  "and the for with you your our are who will can have has from that this into able work working team teams role years year experience strong good great plus using use etc including such other more must should would about across within".split(" "),
);

/**
 * The terms a bullet is judged against, from the posting as read: each
 * requirement's skill and words, the role's title, and every profile skill
 * the posting's text names.
 */
export function jobTerms(extracted: Extracted | null, postingText: string, profile: Pick<ProfileData, "skills">): JobTerms {
  const weights = new Map<string, number>();
  const add = (term: string, weight: number) => {
    const key = term.trim().toLowerCase();
    if (key.length < 2) return;
    weights.set(key, Math.max(weights.get(key) ?? 0, weight));
  };
  const text = `${postingText}\n${extracted?.requirements.map((requirement) => requirement.text).join("\n") ?? ""}`;
  for (const skill of profile.skills) if (mentions(text, skill.name)) add(skill.name, 3);
  for (const requirement of extracted?.requirements ?? []) {
    if (requirement.skill) add(requirement.skill, 3);
    for (const word of words(requirement.text)) add(word, 1);
  }
  for (const word of words(`${extracted?.title ?? ""} ${extracted?.role ?? ""}`)) add(word, 1);
  return [...weights].map(([term, weight]) => ({ term, weight }));
}

const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}+#.]+/u).map((word) => word.replace(/\.+$/, "")).filter((word) => word.length >= 3 && !STOPWORDS.has(word));
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (text: string, term: string) => term.trim().length > 0 && new RegExp(`(?<![\\p{L}\\p{N}])${escape(term.trim())}(?![\\p{L}\\p{N}+#])`, "iu").test(text);

/** How relevant one bullet is to the posting: the weights of the terms it names. */
export function lineRelevance(line: string, terms: JobTerms): number {
  return terms.reduce((sum, { term, weight }) => sum + (mentions(line, term) ? weight : 0), 0);
}

const startOf = (entry: { startYear: number | null; startMonth: number | null }) => (entry.startYear ?? 0) * 12 + (entry.startMonth ?? 1);

const leaveOut = (units: Unit[], index: number): Cut => ({
  trimmed: { kind: "unit", unit: units[index], index },
  units: units.filter((_, position) => position !== index),
});

type Candidate =
  | { kind: "bullet"; unit: Unit; line: number; lines: string[]; relevance: number; start: number }
  | { kind: "project"; index: number; relevance: number; start: number };

/**
 * The next thing to leave out, or null when there's nothing left to cut:
 * the summary; else the least relevant bullet of a role with more than one,
 * or project (a project goes before a bullet as relevant, and older before
 * newer, the lower bullet before the higher); else the least relevant role
 * but the most recent; else the last publication.
 */
export function nextCut(units: Unit[], profile: ProfileData, terms: JobTerms = NO_TERMS): Cut | null {
  const summary = units.findIndex((unit) => unit.id === "summary" && unit.text.trim() !== "");
  if (summary >= 0) return leaveOut(units, summary);

  const roleStart = new Map(profile.experience.map((entry) => [`experience:${entry.id}`, startOf(entry)]));
  const projectStart = new Map(profile.projects.map((entry) => [`project:${entry.id}`, startOf(entry)]));
  const candidates: Candidate[] = [];
  units.forEach((unit, index) => {
    if (roleStart.has(unit.id)) {
      const lines = bulletLines(unit.text).split("\n").filter(Boolean);
      if (lines.length > 1) lines.forEach((line, position) => candidates.push({ kind: "bullet", unit, line: position, lines, relevance: lineRelevance(line, terms), start: roleStart.get(unit.id)! }));
    } else if (projectStart.has(unit.id)) {
      const lines = bulletLines(unit.text).split("\n").filter(Boolean);
      const relevance = Math.max(0, lineRelevance(unit.label, terms), ...lines.map((line) => lineRelevance(line, terms)));
      candidates.push({ kind: "project", index, relevance, start: projectStart.get(unit.id)! });
    }
  });
  const least = candidates.toSorted(
    (a, b) =>
      a.relevance - b.relevance ||
      Number(b.kind === "project") - Number(a.kind === "project") ||
      a.start - b.start ||
      (a.kind === "bullet" && b.kind === "bullet" ? b.line - a.line : 0),
  )[0];
  if (least?.kind === "project") return leaveOut(units, least.index);
  if (least?.kind === "bullet") {
    const kept = { ...least.unit, text: least.lines.filter((_, position) => position !== least.line).join("\n") };
    return {
      trimmed: { kind: "bullets", unitId: least.unit.id, label: least.unit.label, lines: [least.lines[least.line]] },
      units: units.map((entry) => (entry.id === least.unit.id ? kept : entry)),
    };
  }

  // Every role is down to one bullet: the least relevant whole role goes, never the most recent, the oldest first among equals.
  const roles = units.map((unit, index) => ({ unit, index })).filter(({ unit }) => roleStart.has(unit.id));
  if (roles.length > 1) {
    const newest = roles.toSorted((a, b) => roleStart.get(b.unit.id)! - roleStart.get(a.unit.id)!)[0];
    const role = roles
      .filter((entry) => entry !== newest)
      .toSorted((a, b) => lineRelevance(a.unit.text, terms) - lineRelevance(b.unit.text, terms) || roleStart.get(a.unit.id)! - roleStart.get(b.unit.id)!)[0];
    return leaveOut(units, role.index);
  }
  // Then the last publication (#218).
  const index = units.findLastIndex((unit) => isPublicationUnit(unit.id));
  return index >= 0 ? leaveOut(units, index) : null;
}

/** Bullets cut from the same role one at a time are kept together. */
function merge(list: Trimmed, cut: Trimmed[number]): Trimmed {
  if (cut.kind === "bullets") {
    const earlier = list.findIndex((entry) => entry.kind === "bullets" && entry.unitId === cut.unitId);
    if (earlier >= 0) {
      const entry = list[earlier] as Extract<Trimmed[number], { kind: "bullets" }>;
      return list.map((item, index) => (index === earlier ? { ...entry, lines: [...cut.lines, ...entry.lines] } : item));
    }
  }
  return [...list, cut];
}

/**
 * Cuts the application's tailored resume to `maxPages`, measured in the
 * rendered PDF after every cut. A one-page resume leaves its summary out
 * even when it would fit (this fork: one page leads with experience).
 * Returns what was cut, in order, and whether it fits now.
 */
export async function fitResumeToPages(
  applicationId: string,
  profile: ProfileData,
  maxPages: number,
  pages: (path: string) => Promise<number> = async (path) => countPdfPages(await renderPdf(path)),
): Promise<{ trimmed: Trimmed; fits: boolean }> {
  const fits = async () => (await pages(`/print/resume/${applicationId}`)) <= maxPages;
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    select: { extracted: true, postingText: true, title: true, company: true, role: true, location: true, mode: true, salary: true, language: true },
  });
  const terms = application ? jobTerms(extractedOf(application), application.postingText, profile) : NO_TERMS;
  let trimmed: Trimmed = [];

  const cutOnce = async (only?: (cut: Cut) => boolean) => {
    const cut = await updateDocuments(applicationId, async (documents) => {
      const units = documents[DocumentKind.RESUME];
      const next = units && nextCut(units, profile, terms);
      if (!units || !next || (only && !only(next))) return null;
      documents[DocumentKind.RESUME] = next.units;
      return next.trimmed;
    });
    if (!cut) return false;
    trimmed = merge(trimmed, cut);
    await prisma.document.updateMany({ where: { applicationId, kind: DocumentKind.RESUME }, data: { trimmed: trimmedSchema.parse(trimmed) } });
    return true;
  };

  if (maxPages === 1) await cutOnce((cut) => cut.trimmed.kind === "unit" && cut.trimmed.unit.id === "summary");
  if (await fits()) return saveTrimmed(applicationId, trimmed, true);
  for (let cuts = 0; cuts < MAX_CUTS; cuts++) {
    if (!(await cutOnce())) break;
    if (await fits()) return saveTrimmed(applicationId, trimmed, true);
  }
  return saveTrimmed(applicationId, trimmed, false);
}

/** Once trimming is done, the resume as it is now becomes a version (E8-10), so the untrimmed draft stays one click away. */
async function saveTrimmed(applicationId: string, trimmed: Trimmed, fits: boolean): Promise<{ trimmed: Trimmed; fits: boolean }> {
  if (trimmed.length > 0) {
    await prisma.$transaction(async (tx) => {
      const resume = await tx.document.findUnique({ where: { applicationId_kind: { applicationId, kind: DocumentKind.RESUME } } });
      if (resume) await saveVersion(tx, resume.id, unitsSchema.parse(resume.units), { cause: VersionCause.TRIMMED });
    });
  }
  return { trimmed, fits };
}

/** The opening message's lines about what was cut (E10-10): "Left out Studio Brik (2015–2018) to fit one page". */
export function describeTrim(trimmed: Trimmed, profile: ProfileData, fits: boolean, maxPages: number): string[] {
  const limit = pagesInWords(maxPages);
  const lines = trimmed.map((cut) => {
    if (cut.kind === "bullets") {
      const count = cut.lines.length;
      return `Left out ${count} less relevant ${count === 1 ? "bullet" : "bullets"} from the ${cut.label} to fit ${limit}`;
    }
    if (cut.unit.id === "summary") return maxPages === 1 ? "Left out the summary: a one-page resume leads with experience" : `Left out the summary to fit ${limit}`;
    const project = profile.projects.find((entry) => `project:${entry.id}` === cut.unit.id);
    if (project) return `Left out the ${project.name.trim() || "untitled"} project to fit ${limit}`;
    if (isPublicationUnit(cut.unit.id)) return `Left out the publication “${citationExcerpt(cut.unit.text)}” to fit ${limit}`;
    const entry = profile.experience.find((role) => `experience:${role.id}` === cut.unit.id);
    const name = entry?.company.trim() || entry?.role.trim() || cut.unit.label;
    const years = entry?.startYear ? ` (${entry.startYear}–${entry.current ? "now" : (entry.endYear ?? "")})` : "";
    return `Left out ${name}${years} to fit ${limit}`;
  });
  if (!fits && trimmed.length > 0) lines.push(`It still runs over ${limit}, so shorten it by hand if it has to fit`);
  return lines;
}
