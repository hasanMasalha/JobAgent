"use client";

import { useId, useState } from "react";
import { Button, Input, Select } from "@/app/components/ui";

// The user's answer to one application question, saved for that exact
// question (POST /api/apply/answers → EasyApplyAnswer). Every filler — the
// server's ATS fillers, the extension, fill-and-review — answers that
// question with it from then on. JobAgent never answers a factual question
// itself, so this is how a question it stopped on gets answered.
//
// `options`: the form's choices, when it has them — the saved answer has to
// be one of them to be used. Without options it's free text.

export interface QuestionToAnswer {
  question: string;
  options?: string[];
}

export default function SaveAnswer({
  question,
  options,
  initial = "",
  onSaved,
}: QuestionToAnswer & { initial?: string; onSaved?: (answer: string) => void }) {
  const id = useId();
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(initial !== "");
  const [error, setError] = useState<string | null>(null);
  const choices = (options ?? []).filter(Boolean);

  async function save() {
    const answer = value.trim();
    if (!answer) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/apply/answers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, answer }),
      });
      if (!res.ok) throw new Error();
      setSaved(true);
      onSaved?.(answer);
    } catch {
      setError("Couldn't save this answer. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2">
      <label htmlFor={id} className="sr-only">Your answer to: {question}</label>
      <div className="flex flex-wrap items-center gap-2">
        {choices.length > 0 ? (
          <Select
            id={id}
            value={value}
            onChange={(e) => { setValue(e.target.value); setSaved(false); }}
            className="min-w-0 flex-1"
          >
            <option value="" disabled>Choose your answer</option>
            {choices.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        ) : (
          <Input
            id={id}
            value={value}
            maxLength={2000}
            onChange={(e) => { setValue(e.target.value); setSaved(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
            placeholder="Your answer"
            className="min-w-0 flex-1"
          />
        )}
        <Button size="sm" variant={saved ? "ghost" : "secondary"} onClick={save} disabled={saving || !value.trim() || saved} loading={saving}>
          {saved ? "Saved" : "Save answer"}
        </Button>
      </div>
      {error && <p role="alert" className="mt-1 text-caption text-danger-text">{error}</p>}
    </div>
  );
}
