"use client";

import { useEffect, useState } from "react";
import {
  Button,
  Checkbox,
  Notice,
  PageHero,
  RemovableTag,
  Spinner,
  StatePanel,
  chipStyles,
  inputStyles,
} from "@/app/components/ui";
import { cn } from "@/lib/cn";
import { useRouter } from "next/navigation";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PersonalInfo {
  fullName: string;
  title: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  portfolio: string;
}

interface Experience {
  jobTitle: string;
  company: string;
  startMonth: string;
  startYear: string;
  endMonth: string;
  endYear: string;
  current: boolean;
  description: string;
}

interface Education {
  degree: string;
  field: string;
  institution: string;
  year: string;
  achievement: string;
}

interface Project {
  name: string;
  description: string;
  tech: string[];
  link: string;
}

interface SkillsInfo {
  skills: string[];
  languages: string[];
  projects: Project[];
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const YEARS = Array.from({ length: 30 }, (_, i) => String(new Date().getFullYear() - i));
const DEGREE_TYPES = ["Bachelor's","Master's","PhD","Associate's","Bootcamp","Diploma","Other"];
const SKILL_SUGGESTIONS = ["JavaScript","TypeScript","React","Node.js","Python","SQL","PostgreSQL","AWS","Docker","Git","Java","C#","Go","Rust","Vue","Next.js"];

const emptyExperience = (): Experience => ({
  jobTitle: "", company: "", startMonth: "", startYear: "",
  endMonth: "", endYear: "", current: false, description: "",
});

const emptyEducation = (): Education => ({
  degree: "", field: "", institution: "", year: "", achievement: "",
});

const emptyProject = (): Project => ({ name: "", description: "", tech: [], link: "" });

// ── Tag input component ───────────────────────────────────────────────────────

function TagInput({ tags, onChange, placeholder, suggestions }: {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
}) {
  const [input, setInput] = useState("");

  function add(val: string) {
    const v = val.trim();
    if (v && !tags.includes(v)) onChange([...tags, v]);
    setInput("");
  }

  return (
    <div>
      {tags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <RemovableTag key={t} label={t} onRemove={() => onChange(tags.filter((x) => x !== t))} />
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(input); } }}
          placeholder={placeholder}
          aria-label={placeholder ? `Add: ${placeholder}` : "Add"}
          className={cn(inputStyles(), "h-10 flex-1")}
        />
        <Button type="button" variant="secondary" onClick={() => add(input)}>Add</Button>
      </div>
      {suggestions && suggestions.filter((s) => !tags.includes(s)).length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {suggestions.filter((s) => !tags.includes(s)).slice(0, 10).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange([...tags, s])}
              className="rounded-full border border-dashed border-line-strong px-2.5 py-0.5 text-caption text-ink-muted transition-colors hover:border-brand/60 hover:bg-brand-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CVBuilderPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const TOTAL_STEPS = 4;

  const [personal, setPersonal] = useState<PersonalInfo>({
    fullName: "", title: "", email: "", phone: "", location: "", linkedin: "", portfolio: "",
  });
  const [experiences, setExperiences] = useState<Experience[]>([emptyExperience()]);
  const [educations, setEducations] = useState<Education[]>([emptyEducation()]);
  const [skillsInfo, setSkillsInfo] = useState<SkillsInfo>({ skills: [], languages: [], projects: [] });
  const [_projectTechInput, setProjectTechInput] = useState<string[]>(["", "", ""]);

  const [skipExperience, setSkipExperience] = useState(false);
  // Set when the user already has a CV — generating replaces it (and, for an
  // upload, deletes the original file), so step 4 says so before Generate.
  const [existingCvDate, setExistingCvDate] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  // Restore draft from sessionStorage on mount
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("cv_builder_draft");
      if (saved) {
        const draft = JSON.parse(saved);
        if (draft.personal) setPersonal(draft.personal);
        if (draft.experiences) setExperiences(draft.experiences);
        if (draft.educations) setEducations(draft.educations);
        if (draft.skillsInfo) setSkillsInfo(draft.skillsInfo);
        if (draft.skipExperience != null) setSkipExperience(draft.skipExperience);
      }
    } catch {/* ignore corrupt draft */}
  }, []);

  // Save draft to sessionStorage whenever form data changes
  useEffect(() => {
    try {
      sessionStorage.setItem(
        "cv_builder_draft",
        JSON.stringify({ personal, experiences, educations, skillsInfo, skipExperience })
      );
    } catch {/* ignore quota errors */}
  }, [personal, experiences, educations, skillsInfo, skipExperience]);

  // Pre-fill email from auth
  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d) => {
        if (d.email) setPersonal((p) => ({ ...p, email: d.email }));
        if (d.cv?.updated_at) {
          setExistingCvDate(new Date(d.cv.updated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }));
        }
      })
      .catch(() => {});
  }, []);

  // ── Experience helpers ──────────────────────────────────────────────────────
  function updateExp(i: number, field: keyof Experience, val: string | boolean) {
    setExperiences((prev) => prev.map((e, idx) => idx === i ? { ...e, [field]: val } : e));
  }
  function addExp() { setExperiences((p) => [...p, emptyExperience()]); }
  function removeExp(i: number) { setExperiences((p) => p.filter((_, idx) => idx !== i)); }

  // ── Education helpers ───────────────────────────────────────────────────────
  function updateEdu(i: number, field: keyof Education, val: string) {
    setEducations((prev) => prev.map((e, idx) => idx === i ? { ...e, [field]: val } : e));
  }
  function addEdu() { setEducations((p) => [...p, emptyEducation()]); }
  function removeEdu(i: number) { setEducations((p) => p.filter((_, idx) => idx !== i)); }

  // ── Project helpers ─────────────────────────────────────────────────────────
  function updateProject(i: number, field: keyof Project, val: string | string[]) {
    setSkillsInfo((p) => ({ ...p, projects: p.projects.map((pr, idx) => idx === i ? { ...pr, [field]: val } : pr) }));
  }
  function addProject() {
    if (skillsInfo.projects.length < 3) {
      setSkillsInfo((p) => ({ ...p, projects: [...p.projects, emptyProject()] }));
      setProjectTechInput((p) => [...p, ""]);
    }
  }
  function removeProject(i: number) {
    setSkillsInfo((p) => ({ ...p, projects: p.projects.filter((_, idx) => idx !== i) }));
    setProjectTechInput((p) => p.filter((_, idx) => idx !== i));
  }

  // ── Validation ──────────────────────────────────────────────────────────────
  function canProceed(): boolean {
    if (step === 1) return !!(personal.fullName.trim() && personal.title.trim() && personal.email.trim());
    if (step === 2) return skipExperience || experiences.every((e) => e.jobTitle.trim() && e.company.trim());
    if (step === 3) return educations.every((e) => e.institution.trim());
    return true;
  }

  // ── Generate ────────────────────────────────────────────────────────────────
  async function handleGenerate() {
    setGenerating(true);
    setError("");
    try {
      const res = await fetch("/api/cv/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personal, experiences: skipExperience ? [] : experiences, educations, skillsInfo }),
        signal: AbortSignal.timeout(120_000),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed");

      router.push(`/dashboard/cv-builder/preview?cv_id=${data.cv_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
      setGenerating(false);
    }
  }

  // ── Input class ─────────────────────────────────────────────────────────────
  const inp = cn(inputStyles(), "mt-1.5 py-2");
  const label = "block text-body-sm font-medium text-ink";
  const entryCard = "relative space-y-4 rounded-card border border-line bg-surface p-4 sm:p-5";
  const removeBtn = "absolute right-3 top-3 rounded-control px-2 py-1 text-caption font-semibold text-ink-subtle transition-colors hover:bg-danger-soft hover:text-danger-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const addLink = "rounded-sm text-body-sm font-semibold text-brand-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const stepHeading = "font-serif text-feature-sm text-ink";
  const cardCls = "rounded-[1.375rem] bg-surface-raised p-5 shadow-dossier ring-1 ring-line/60 sm:p-8";
  const STEP_NAMES = ["About you", "Work experience", "Education", "Skills and projects"];

  const hero = (
    <PageHero
      title="Build your CV with AI"
      subtitle={generating ? undefined : "Answer in your own words — Claude writes the CV."}
      meta={!generating && <span className="text-body-sm text-on-hero-muted">Step {step} of {TOTAL_STEPS} · {STEP_NAMES[step - 1]}</span>}
    >
      {!generating && (
        <div className="flex gap-1.5" aria-hidden="true">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <div key={i} className={cn("h-1 flex-1 rounded-full transition-colors duration-500", i < step ? "bg-on-hero" : "bg-white/15")} />
          ))}
        </div>
      )}
    </PageHero>
  );

  if (generating) {
    return (
      <div className="w-full">
        {hero}
        <div className="relative mx-auto -mt-14 max-w-2xl sm:-mt-16">
          <StatePanel role="status" title="Claude is writing your CV">
            <span className="inline-flex flex-col items-center gap-3">
              <Spinner size="lg" decorative />
              This takes about 15–20 seconds. Keep this page open.
            </span>
          </StatePanel>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {hero}
      <div className="relative mx-auto -mt-14 max-w-2xl pb-24 sm:-mt-16 sm:pb-10">
      <section className={cardCls} aria-label={STEP_NAMES[step - 1]}>

      {/* ── Step 1: Personal info ───────────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">
          <h2 className={stepHeading}>About you</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className={label}>Full name <span className="text-danger-text" aria-hidden="true">*</span><span className="sr-only">(required)</span>
              <input className={inp} value={personal.fullName} onChange={(e) => setPersonal((p) => ({ ...p, fullName: e.target.value }))} placeholder="e.g. Yossi Cohen" />
            </label>
            <label className={label}>Professional title <span className="text-danger-text" aria-hidden="true">*</span><span className="sr-only">(required)</span>
              <input className={inp} value={personal.title} onChange={(e) => setPersonal((p) => ({ ...p, title: e.target.value }))} placeholder="e.g. Senior Backend Engineer" />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className={label}>Email <span className="text-danger-text" aria-hidden="true">*</span><span className="sr-only">(required)</span>
              <input className={inp} type="email" value={personal.email} onChange={(e) => setPersonal((p) => ({ ...p, email: e.target.value }))} placeholder="you@example.com" />
            </label>
            <label className={label}>Phone
              <input className={inp} type="tel" value={personal.phone} onChange={(e) => setPersonal((p) => ({ ...p, phone: e.target.value }))} placeholder="+972 50 000 0000" />
            </label>
          </div>

          <label className={label}>Location
            <input className={inp} value={personal.location} onChange={(e) => setPersonal((p) => ({ ...p, location: e.target.value }))} placeholder="Tel Aviv, Israel" />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className={label}>LinkedIn URL <span className="font-normal text-ink-subtle">(optional)</span>
              <input className={inp} value={personal.linkedin} onChange={(e) => setPersonal((p) => ({ ...p, linkedin: e.target.value }))} placeholder="linkedin.com/in/yourname" />
            </label>
            <label className={label}>GitHub / Portfolio <span className="font-normal text-ink-subtle">(optional)</span>
              <input className={inp} value={personal.portfolio} onChange={(e) => setPersonal((p) => ({ ...p, portfolio: e.target.value }))} placeholder="github.com/yourname" />
            </label>
          </div>
        </div>
      )}

      {/* ── Step 2: Work experience ─────────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className={stepHeading}>Work experience</h2>
            <button
              type="button"
              aria-pressed={skipExperience}
              onClick={() => setSkipExperience((v) => !v)}
              className={chipStyles({ selected: skipExperience })}
            >
              {skipExperience ? "✓ No experience" : "Skip — no experience"}
            </button>
          </div>

          {skipExperience && (
            <Notice tone="info">
              No work experience will be included in your CV. Claude will focus on your education, skills and projects.
            </Notice>
          )}

          {!skipExperience && (<>
          {experiences.map((exp, i) => (
            <div key={i} className={entryCard}>
              {experiences.length > 1 && (
                <button type="button" onClick={() => removeExp(i)} className={removeBtn}>
                  Remove
                </button>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className={label}>Job title <span className="text-danger-text" aria-hidden="true">*</span><span className="sr-only">(required)</span>
                  <input className={inp} value={exp.jobTitle} onChange={(e) => updateExp(i, "jobTitle", e.target.value)} placeholder="e.g. Software Engineer" />
                </label>
                <label className={label}>Company <span className="text-danger-text" aria-hidden="true">*</span><span className="sr-only">(required)</span>
                  <input className={inp} value={exp.company} onChange={(e) => updateExp(i, "company", e.target.value)} placeholder="e.g. Google" />
                </label>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                <label className={label}>Start<span className="sr-only"> month</span>
                  <select className={inp} value={exp.startMonth} onChange={(e) => updateExp(i, "startMonth", e.target.value)}>
                    <option value="">Month</option>
                    {MONTHS.map((m) => <option key={m}>{m}</option>)}
                  </select>
                </label>
                <label className={label}><span aria-hidden="true">&nbsp;</span><span className="sr-only">Start year</span>
                  <select className={inp} value={exp.startYear} onChange={(e) => updateExp(i, "startYear", e.target.value)}>
                    <option value="">Year</option>
                    {YEARS.map((y) => <option key={y}>{y}</option>)}
                  </select>
                </label>
                {!exp.current && (
                  <>
                    <label className={label}>End<span className="sr-only"> month</span>
                      <select className={inp} value={exp.endMonth} onChange={(e) => updateExp(i, "endMonth", e.target.value)}>
                        <option value="">Month</option>
                        {MONTHS.map((m) => <option key={m}>{m}</option>)}
                      </select>
                    </label>
                    <label className={label}><span aria-hidden="true">&nbsp;</span><span className="sr-only">End year</span>
                      <select className={inp} value={exp.endYear} onChange={(e) => updateExp(i, "endYear", e.target.value)}>
                        <option value="">Year</option>
                        {YEARS.map((y) => <option key={y}>{y}</option>)}
                      </select>
                    </label>
                  </>
                )}
                {exp.current && <div className="col-span-2" />}
              </div>

              <Checkbox label="I currently work here" checked={exp.current} onChange={(e) => updateExp(i, "current", e.target.checked)} />

              <label className={label}>What did you do?
                <textarea
                  className={`${inp} resize-none`}
                  rows={4}
                  value={exp.description}
                  onChange={(e) => updateExp(i, "description", e.target.value)}
                  placeholder="Describe what you worked on, what you built, what technologies you used. Don't worry about wording — Claude will polish it."
                />
              </label>
            </div>
          ))}

          <button type="button" onClick={addExp} className={addLink}>
            + Add another role
          </button>
          </>)}
        </div>
      )}

      {/* ── Step 3: Education ───────────────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-6">
          <h2 className={stepHeading}>Education</h2>

          {educations.map((edu, i) => (
            <div key={i} className={entryCard}>
              {educations.length > 1 && (
                <button type="button" onClick={() => removeEdu(i)} className={removeBtn}>
                  Remove
                </button>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className={label}>Degree type
                  <select className={inp} value={edu.degree} onChange={(e) => updateEdu(i, "degree", e.target.value)}>
                    <option value="">Select…</option>
                    {DEGREE_TYPES.map((d) => <option key={d}>{d}</option>)}
                  </select>
                </label>
                <label className={label}>Field of study
                  <input className={inp} value={edu.field} onChange={(e) => updateEdu(i, "field", e.target.value)} placeholder="e.g. Computer Science" />
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className={label}>Institution <span className="text-danger-text" aria-hidden="true">*</span><span className="sr-only">(required)</span>
                  <input className={inp} value={edu.institution} onChange={(e) => updateEdu(i, "institution", e.target.value)} placeholder="e.g. Tel Aviv University" />
                </label>
                <label className={label}>Graduation year
                  <select className={inp} value={edu.year} onChange={(e) => updateEdu(i, "year", e.target.value)}>
                    <option value="">Year</option>
                    {YEARS.map((y) => <option key={y}>{y}</option>)}
                  </select>
                </label>
              </div>

              <label className={label}>Notable achievement <span className="font-normal text-ink-subtle">(optional)</span>
                <input className={inp} value={edu.achievement} onChange={(e) => updateEdu(i, "achievement", e.target.value)} placeholder="e.g. Graduated with honors, GPA 3.9, thesis on ML" />
              </label>
            </div>
          ))}

          <button type="button" onClick={addEdu} className={addLink}>
            + Add another
          </button>
        </div>
      )}

      {/* ── Step 4: Skills + projects ───────────────────────────────────────── */}
      {step === 4 && (
        <div className="space-y-6">
          <div>
            <h2 className={cn(stepHeading, "mb-4")}>Skills</h2>
            <TagInput
              tags={skillsInfo.skills}
              onChange={(tags) => setSkillsInfo((p) => ({ ...p, skills: tags }))}
              placeholder="e.g. React, Python…"
              suggestions={SKILL_SUGGESTIONS}
            />
          </div>

          <div>
            <h3 className="text-title-card text-ink">Languages</h3>
            <p className="mb-3 mt-0.5 text-body-sm text-ink-muted">With your level, e.g. English (fluent)</p>
            <TagInput
              tags={skillsInfo.languages}
              onChange={(tags) => setSkillsInfo((p) => ({ ...p, languages: tags }))}
              placeholder="e.g. Hebrew (native)"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-title-card text-ink">Projects <span className="text-body-sm font-normal text-ink-subtle">(optional, up to 3)</span></h3>
              </div>
              {skillsInfo.projects.length < 3 && (
                <button type="button" onClick={addProject} className={addLink}>+ Add project</button>
              )}
            </div>

            {skillsInfo.projects.length === 0 && (
              <p className="text-body-sm italic text-ink-subtle">No projects added.</p>
            )}

            <div className="space-y-3">
            {skillsInfo.projects.map((proj, i) => (
              <div key={i} className={entryCard}>
                <button type="button" onClick={() => removeProject(i)} className={removeBtn}>
                  Remove
                </button>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className={label}>Project name
                    <input className={inp} value={proj.name} onChange={(e) => updateProject(i, "name", e.target.value)} placeholder="e.g. JobAgent" />
                  </label>
                  <label className={label}>Link <span className="font-normal text-ink-subtle">(optional)</span>
                    <input className={inp} value={proj.link} onChange={(e) => updateProject(i, "link", e.target.value)} placeholder="github.com/…" />
                  </label>
                </div>
                <label className={label}>One-line description
                  <input className={inp} value={proj.description} onChange={(e) => updateProject(i, "description", e.target.value)} placeholder="e.g. AI-powered job search assistant" />
                </label>
                <div>
                  <label className={label}>Technologies used</label>
                  <TagInput
                    tags={proj.tech}
                    onChange={(tags) => updateProject(i, "tech", tags)}
                    placeholder="e.g. React"
                  />
                </div>
              </div>
            ))}
            </div>
          </div>

          {existingCvDate && (
            <Notice tone="attention" title="This replaces your current CV">
              Generating a new CV replaces the one on file (last updated {existingCvDate}). If you uploaded that one, the original file is removed too — download it from My CV first if you want to keep it.
            </Notice>
          )}
        </div>
      )}

      {error && <Notice tone="danger" className="mt-5">{error}</Notice>}

      {/* Navigation */}
      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row">
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="sm:flex-1"
          onClick={() => step === 1 ? router.push("/dashboard/onboarding") : setStep((s) => s - 1)}
        >
          {step === 1 ? "Cancel" : "Back"}
        </Button>

        {step < TOTAL_STEPS ? (
          <Button type="button" size="lg" className="sm:flex-1" disabled={!canProceed()} onClick={() => setStep((s) => s + 1)}>
            Next
          </Button>
        ) : (
          <Button type="button" variant="accent" size="lg" className="sm:flex-1" disabled={generating} onClick={handleGenerate}>
            Generate my CV
          </Button>
        )}
      </div>
      </section>
      </div>
    </div>
  );
}
