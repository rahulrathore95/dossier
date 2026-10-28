"use client";

import { useId } from "react";

import { Card } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { Tone } from "@/generated/prisma/enums";
import type { ResumeVariant, VariantRecommendation } from "@/lib/resume-variants";
import { TONES } from "@/lib/tones";

const TONE_OPTIONS = Object.values(Tone).map((tone) => ({ value: tone, label: TONES[tone].label }));

/** "Tailoring" (E7-5, NEW-6): the resume variant (this fork), the cover letter's tone, and a note for the AI. */
export function TailoringCard({
  tone,
  note,
  onTone,
  onNote,
  variants = [],
  variant = "auto",
  recommended = null,
  onVariant,
}: {
  tone: Tone;
  note: string;
  onTone: (tone: Tone) => void;
  onNote: (note: string) => void;
  variants?: readonly ResumeVariant[];
  /** "auto", "none" or a variant's id. */
  variant?: string;
  recommended?: VariantRecommendation | null;
  onVariant?: (variant: string) => void;
}) {
  const labelId = useId();
  const descriptionId = useId();
  return (
    <Card className="flex flex-col gap-5 py-6">
      <h2 className="text-[15px] font-medium">Tailoring</h2>
      {variants.length > 0 && (
        <label className="flex flex-col gap-[9px]">
          <span className="text-label text-muted">Resume variant</span>
          <select
            value={variant}
            onChange={(event) => onVariant?.(event.target.value)}
            className="w-fit rounded-control border border-line-card bg-card px-3 py-2 text-sm"
          >
            <option value="auto">{recommended ? `Best fit: ${recommended.variant.name}` : "Best fit (none matches this posting)"}</option>
            {variants.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
            <option value="none">No variant</option>
          </select>
          <span className="text-meta text-muted">
            {variant === "auto" && recommended ? `${recommended.reason}. ` : ""}A variant only changes emphasis: every fact still comes from your profile.
          </span>
        </label>
      )}
      <div className="flex flex-col gap-[9px]">
        <span id={labelId} className="text-label text-muted">
          Cover letter tone
        </span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <SegmentedControl
            aria-labelledby={labelId}
            aria-describedby={descriptionId}
            options={TONE_OPTIONS}
            value={tone}
            onValueChange={onTone}
          />
          <span id={descriptionId} className="text-meta text-muted">
            {TONES[tone].description}
          </span>
        </div>
      </div>
      <Textarea
        label="Anything I should know?"
        hint="Kept with the application as a fact for the AI. Change it later on its Job posting tab."
        rows={3}
        placeholder="e.g. I'm relocating to Amsterdam in January. Or: lean on my research work."
        value={note}
        onChange={(event) => onNote(event.target.value)}
      />
    </Card>
  );
}
