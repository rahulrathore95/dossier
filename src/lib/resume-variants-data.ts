import "server-only";

import { prisma } from "@/lib/prisma";

import { focusSkillsOf, MAX_VARIANTS, type ResumeVariant, type VariantInput } from "./resume-variants";
import { ActionError } from "./action";

// Resume variants in the database (this fork); see resume-variants.ts.

export async function loadVariants(): Promise<ResumeVariant[]> {
  const rows = await prisma.resumeVariant.findMany({ orderBy: [{ sort: "asc" }, { createdAt: "asc" }] });
  return rows.map((row) => ({ id: row.id, name: row.name, positioning: row.positioning, focusSkills: focusSkillsOf(row.focusSkills) }));
}

export async function createVariant(input: VariantInput): Promise<ResumeVariant> {
  if ((await prisma.resumeVariant.count()) >= MAX_VARIANTS) throw new ActionError(`You can keep up to ${MAX_VARIANTS} variants; remove one first.`);
  const sort = ((await prisma.resumeVariant.aggregate({ _max: { sort: true } }))._max.sort ?? -1) + 1;
  const row = await prisma.resumeVariant.create({ data: { ...input, focusSkills: [...new Set(input.focusSkills)], sort } });
  return { id: row.id, name: row.name, positioning: row.positioning, focusSkills: focusSkillsOf(row.focusSkills) };
}

export async function updateVariant(id: string, input: VariantInput): Promise<ResumeVariant> {
  const { count } = await prisma.resumeVariant.updateMany({ where: { id }, data: { ...input, focusSkills: [...new Set(input.focusSkills)] } });
  if (count === 0) throw new ActionError("That variant no longer exists.");
  return { id, ...input, focusSkills: [...new Set(input.focusSkills)] };
}

export async function deleteVariant(id: string): Promise<void> {
  await prisma.resumeVariant.deleteMany({ where: { id } });
}
