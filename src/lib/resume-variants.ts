import { z } from "zod";

// Resume variants (this fork): reusable ways to position one master resume,
// e.g. "GCP Senior Data Engineer" or "Azure Senior Data Engineer". A variant
// only sets emphasis — the skills to lead with and what to stress — and the
// tailored resume still takes every fact from the profile. For each posting
// the best fit is recommended by which of its focus skills the posting names.

export const MAX_VARIANTS = 10;

export const variantInputSchema = z.object({
  name: z.string().trim().min(1, "Give the variant a name.").max(80),
  positioning: z.string().trim().max(500),
  focusSkills: z.array(z.string().trim().min(1).max(100)).max(20),
});
export type VariantInput = z.infer<typeof variantInputSchema>;

export type ResumeVariant = VariantInput & { id: string };

/** The focus skills column, read back; anything else reads as none. */
export function focusSkillsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (text: string, term: string) => term.trim().length > 0 && new RegExp(`(?<![\\p{L}\\p{N}])${escape(term.trim())}(?![\\p{L}\\p{N}+#])`, "iu").test(text);

export type VariantRecommendation = { variant: ResumeVariant; matched: string[]; reason: string };

/**
 * The variant whose focus skills the posting names most, with why; null when
 * there are none or the posting names none of any variant's skills (then no
 * variant is better than another, and none is used). Ties go to the variant
 * listed first.
 */
export function recommendVariant(variants: readonly ResumeVariant[], posting: string): VariantRecommendation | null {
  let best: VariantRecommendation | null = null;
  let bestScore = 0;
  for (const variant of variants) {
    const matched = variant.focusSkills.filter((skill) => mentions(posting, skill));
    if (matched.length === 0) continue;
    // A focus skill counts twice a word of the variant's name ("Azure" in "Azure Senior Data Engineer").
    const nameWords = variant.name.split(/\s+/).filter((word) => word.length > 2 && mentions(posting, word)).length;
    const score = matched.length * 2 + nameWords;
    if (score > bestScore) {
      best = { variant, matched, reason: `The posting names ${matched.length} of its focus skills: ${matched.join(", ")}` };
      bestScore = score;
    }
  }
  return best;
}

/** What the tailoring prompt is told about the variant: emphasis only, the profile's own skills only. */
export function variantForPrompt(variant: Pick<ResumeVariant, "name" | "positioning" | "focusSkills">, profileSkills: readonly string[]): string {
  const own = variant.focusSkills.filter((skill) => profileSkills.some((name) => name.toLowerCase() === skill.toLowerCase()));
  return [
    `Resume variant: ${variant.name}. It sets emphasis only; every fact still comes from the profile, and nothing it names may be claimed unless the profile backs it.`,
    variant.positioning ? `Positioning: ${variant.positioning}` : "",
    own.length > 0 ? `Where the profile backs them, lead with: ${own.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
