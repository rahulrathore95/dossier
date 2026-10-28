import "server-only";

import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";

import { scoreRelevance, yearsOfExperience, type Relevance, type RelevanceProfile } from "./relevance";
import { countryCodeFor } from "./countries";
import { latestRole, type FoundPosting, type SearchQuery } from "./search";

// What relevance (relevance.ts) is measured against, read from the profile —
// the master resume — and Settings → Job search.

/** The profile's skills, roles and years, with the search's own keywords as a role too. */
export async function loadRelevanceProfile(query?: Pick<SearchQuery, "keywords" | "country"> | null): Promise<RelevanceProfile> {
  const [skills, experience, settings, country] = await Promise.all([
    prisma.skill.findMany({ select: { name: true }, orderBy: { sort: "asc" } }),
    prisma.experience.findMany({ select: { role: true, current: true, startYear: true, startMonth: true, endYear: true, endMonth: true } }),
    // The settings themselves, not the job search configuration: no keys are needed here.
    loadSettings(),
    prisma.profileField.findUnique({ where: { key: "country" }, select: { value: true } }),
  ]);
  const roles = [...settings.targetRoles, query?.keywords ?? "", latestRole(experience)].map((role) => role.trim()).filter(Boolean);
  return {
    skills: skills.map((skill) => skill.name),
    roles: [...new Set(roles)],
    years: yearsOfExperience(experience),
    salaryFloorLpa: settings.salaryFloorLpa,
    requireIndia: settings.requireIndia,
    // India applies when the profile lives there or the search is there; a profile with no country counts as India (this fork is for a job search from India).
    inIndia: query?.country === "in" || !country?.value.trim() || countryCodeFor(country.value) === "in",
  };
}

/** Each posting with its relevance, against one profile read once. */
export async function withRelevance<T extends FoundPosting>(postings: readonly T[], query?: Pick<SearchQuery, "keywords" | "country"> | null): Promise<(T & { relevance: Relevance })[]> {
  if (postings.length === 0) return [];
  const profile = await loadRelevanceProfile(query);
  const now = new Date();
  return postings.map((posting) => ({ ...posting, relevance: scoreRelevance(posting, profile, now) }));
}
