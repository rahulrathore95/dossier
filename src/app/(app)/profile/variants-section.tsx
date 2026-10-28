"use client";

import { useId, useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toast, toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import type { ProfileData } from "@/lib/profile";
import { MAX_VARIANTS, type ResumeVariant } from "@/lib/resume-variants";

import { addVariant, removeVariant, saveVariant } from "./actions";

/**
 * Resume variants (this fork): a name, how to pitch it, and the profile's
 * skills to lead with. Saved with "Save"; removed at once.
 */
export function VariantsSection({
  profile,
  variants,
  setVariants,
}: {
  profile: ProfileData;
  variants: readonly ResumeVariant[];
  setVariants: (change: (variants: readonly ResumeVariant[]) => readonly ResumeVariant[]) => void;
}) {
  const track = useTrackSave();

  const add = async () => {
    const result = toastResult(await track(addVariant({ name: `Variant ${variants.length + 1}`, positioning: "", focusSkills: [] })));
    if (result.ok) setVariants((current) => [...current, result.data]);
  };

  return (
    <div className="flex flex-col gap-4">
      {variants.map((variant) => (
        <VariantCard
          key={variant.id}
          variant={variant}
          skills={profile.skills.map((skill) => skill.name)}
          onSaved={(saved) => setVariants((current) => current.map((entry) => (entry.id === saved.id ? saved : entry)))}
          onRemoved={() => setVariants((current) => current.filter((entry) => entry.id !== variant.id))}
        />
      ))}
      {variants.length < MAX_VARIANTS && (
        <Button variant="secondary" className="self-start" onClick={() => void add()}>
          + Add a variant
        </Button>
      )}
    </div>
  );
}

function VariantCard({
  variant,
  skills,
  onSaved,
  onRemoved,
}: {
  variant: ResumeVariant;
  skills: readonly string[];
  onSaved: (variant: ResumeVariant) => void;
  onRemoved: () => void;
}) {
  const track = useTrackSave();
  const [draft, setDraft] = useState(variant);
  const changed = JSON.stringify(draft) !== JSON.stringify(variant);
  const skillsLabel = useId();

  const toggle = (skill: string) =>
    setDraft((current) => ({
      ...current,
      focusSkills: current.focusSkills.includes(skill) ? current.focusSkills.filter((entry) => entry !== skill) : [...current.focusSkills, skill],
    }));

  const save = async () => {
    const result = toastResult(await track(saveVariant(draft)));
    if (result.ok) onSaved(result.data);
  };

  const remove = async () => {
    const result = await track(removeVariant({ id: variant.id }));
    if (!result.ok) return void toast(result.error);
    onRemoved();
    toast(`Removed the “${variant.name}” variant. Applications written from it keep their resumes.`);
  };

  return (
    <Card className="flex flex-col gap-4 px-7 py-6">
      <Input label="Name" value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
      <Textarea
        label="Positioning"
        hint="How to pitch you for this kind of job, in a sentence or two. It guides emphasis only."
        rows={2}
        maxLength={500}
        placeholder="e.g. A data platform engineer who builds GCP-native pipelines on BigQuery and Dataflow."
        value={draft.positioning}
        onChange={(event) => setDraft({ ...draft, positioning: event.target.value })}
      />
      <div className="flex flex-col gap-2">
        <span id={skillsLabel} className="text-label text-muted">
          Skills to lead with
        </span>
        {skills.length === 0 ? (
          <p className="text-meta text-muted">Add skills to your profile first: a variant can only lead with skills you have.</p>
        ) : (
          <ul aria-labelledby={skillsLabel} className="flex flex-wrap gap-2">
            {skills.map((skill) => {
              const on = draft.focusSkills.includes(skill);
              return (
                <li key={skill}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(skill)}
                    className={cn("rounded-full border px-3 py-1 text-sm", on ? "border-primary bg-selected text-ink" : "border-line-card text-muted hover:text-ink")}
                  >
                    {skill}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-meta text-muted">An application uses the variant whose skills its posting names most.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" aria-disabled={!changed || undefined} onClick={changed ? () => void save() : undefined}>
          Save
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void remove()}>
          Remove
        </Button>
      </div>
    </Card>
  );
}
