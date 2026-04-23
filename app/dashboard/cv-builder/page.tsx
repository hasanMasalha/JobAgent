"use client";

import { useEffect, useState } from "react";
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
      <div className="flex flex-wrap gap-1.5 mb-2">
        {tags.map((t) => (
          <span key={t} className="flex items-center gap-1 bg-black text-white text-xs px-2 py-1 rounded-full">
            {t}
            <button type="button" onClick={() => onChange(tags.filter((x) => x !== t))} className="hover:opacity-70 leading-none">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(input); } }}
          placeholder={placeholder}
          className="flex-1 border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
        />
        <button type="button" onClick={() => add(input)} className="px-3 py-1.5 bg-gray-100 rounded text-sm hover:bg-gray-200">Add</button>
      </div>
      {suggestions && suggestions.filter((s) => !tags.includes(s)).length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {suggestions.filter((s) => !tags.includes(s)).slice(0, 10).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange([...tags, s])}
              className="text-xs border border-dashed border-gray-300 px-2 py-0.5 rounded-full text-gray-500 hover:border-black hover:text-black transition-colors"
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
  const inp = "w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black";
  const label = "block text-sm font-medium mb-1 text-gray-700";

  if (generating) {
    return (
      <div className="max-w-xl mx-auto mt-24 text-center">
        <div className="inline-block w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mb-5" />
        <p className="text-lg font-semibold text-gray-900">Claude is writing your CV…</p>
        <p className="text-sm text-gray-500 mt-1">This takes about 15–20 seconds</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Build CV with AI</h1>
        <p className="text-sm text-gray-500 mt-0.5">Step {step} of {TOTAL_STEPS}</p>
      </div>

      {/* Progress bar */}
      <div className="flex gap-1.5 mb-8">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i < step ? "bg-purple-500" : "bg-gray-200"}`} />
        ))}
      </div>

      {/* ── Step 1: Personal info ───────────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-gray-800">Personal information</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={label}>Full name <span className="text-red-400">*</span></label>
              <input className={inp} value={personal.fullName} onChange={(e) => setPersonal((p) => ({ ...p, fullName: e.target.value }))} placeholder="e.g. Yossi Cohen" />
            </div>
            <div>
              <label className={label}>Professional title <span className="text-red-400">*</span></label>
              <input className={inp} value={personal.title} onChange={(e) => setPersonal((p) => ({ ...p, title: e.target.value }))} placeholder="e.g. Senior Backend Engineer" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={label}>Email <span className="text-red-400">*</span></label>
              <input className={inp} type="email" value={personal.email} onChange={(e) => setPersonal((p) => ({ ...p, email: e.target.value }))} placeholder="you@example.com" />
            </div>
            <div>
              <label className={label}>Phone</label>
              <input className={inp} type="tel" value={personal.phone} onChange={(e) => setPersonal((p) => ({ ...p, phone: e.target.value }))} placeholder="+972 50 000 0000" />
            </div>
          </div>

          <div>
            <label className={label}>Location</label>
            <input className={inp} value={personal.location} onChange={(e) => setPersonal((p) => ({ ...p, location: e.target.value }))} placeholder="Tel Aviv, Israel" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={label}>LinkedIn URL <span className="text-xs text-gray-400">(optional)</span></label>
              <input className={inp} value={personal.linkedin} onChange={(e) => setPersonal((p) => ({ ...p, linkedin: e.target.value }))} placeholder="linkedin.com/in/yourname" />
            </div>
            <div>
              <label className={label}>GitHub / Portfolio <span className="text-xs text-gray-400">(optional)</span></label>
              <input className={inp} value={personal.portfolio} onChange={(e) => setPersonal((p) => ({ ...p, portfolio: e.target.value }))} placeholder="github.com/yourname" />
            </div>
          </div>
        </div>
      )}

      {/* ── Step 2: Work experience ─────────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-800">Work experience</h2>
            <button
              type="button"
              onClick={() => setSkipExperience((v) => !v)}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                skipExperience
                  ? "bg-gray-900 text-white border-gray-900"
                  : "text-gray-500 border-gray-300 hover:border-gray-500"
              }`}
            >
              {skipExperience ? "✓ No experience" : "Skip — no experience"}
            </button>
          </div>

          {skipExperience && (
            <div className="bg-gray-50 border border-dashed rounded-xl p-5 text-center text-sm text-gray-500">
              No work experience will be included in your CV.
              <br />
              Claude will focus on your education, skills, and projects.
            </div>
          )}

          {!skipExperience && (<>
          {experiences.map((exp, i) => (
            <div key={i} className="border rounded-xl p-4 space-y-3 relative">
              {experiences.length > 1 && (
                <button type="button" onClick={() => removeExp(i)} className="absolute top-3 right-3 text-xs text-gray-400 hover:text-red-500">
                  Remove
                </button>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={label}>Job title <span className="text-red-400">*</span></label>
                  <input className={inp} value={exp.jobTitle} onChange={(e) => updateExp(i, "jobTitle", e.target.value)} placeholder="e.g. Software Engineer" />
                </div>
                <div>
                  <label className={label}>Company <span className="text-red-400">*</span></label>
                  <input className={inp} value={exp.company} onChange={(e) => updateExp(i, "company", e.target.value)} placeholder="e.g. Google" />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                <div>
                  <label className={label}>Start</label>
                  <select className={inp} value={exp.startMonth} onChange={(e) => updateExp(i, "startMonth", e.target.value)}>
                    <option value="">Month</option>
                    {MONTHS.map((m) => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label}>&nbsp;</label>
                  <select className={inp} value={exp.startYear} onChange={(e) => updateExp(i, "startYear", e.target.value)}>
                    <option value="">Year</option>
                    {YEARS.map((y) => <option key={y}>{y}</option>)}
                  </select>
                </div>
                {!exp.current && (
                  <>
                    <div>
                      <label className={label}>End</label>
                      <select className={inp} value={exp.endMonth} onChange={(e) => updateExp(i, "endMonth", e.target.value)}>
                        <option value="">Month</option>
                        {MONTHS.map((m) => <option key={m}>{m}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={label}>&nbsp;</label>
                      <select className={inp} value={exp.endYear} onChange={(e) => updateExp(i, "endYear", e.target.value)}>
                        <option value="">Year</option>
                        {YEARS.map((y) => <option key={y}>{y}</option>)}
                      </select>
                    </div>
                  </>
                )}
                {exp.current && <div className="col-span-2" />}
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input type="checkbox" checked={exp.current} onChange={(e) => updateExp(i, "current", e.target.checked)} />
                Currently working here
              </label>

              <div>
                <label className={label}>What did you do?</label>
                <textarea
                  className={`${inp} resize-none`}
                  rows={4}
                  value={exp.description}
                  onChange={(e) => updateExp(i, "description", e.target.value)}
                  placeholder="Describe what you worked on, what you built, what technologies you used. Don't worry about wording — Claude will polish it."
                />
              </div>
            </div>
          ))}

          <button type="button" onClick={addExp} className="text-sm text-purple-600 hover:underline font-medium">
            + Add another role
          </button>
          </>)}
        </div>
      )}

      {/* ── Step 3: Education ───────────────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-6">
          <h2 className="text-base font-semibold text-gray-800">Education</h2>

          {educations.map((edu, i) => (
            <div key={i} className="border rounded-xl p-4 space-y-3 relative">
              {educations.length > 1 && (
                <button type="button" onClick={() => removeEdu(i)} className="absolute top-3 right-3 text-xs text-gray-400 hover:text-red-500">
                  Remove
                </button>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={label}>Degree type</label>
                  <select className={inp} value={edu.degree} onChange={(e) => updateEdu(i, "degree", e.target.value)}>
                    <option value="">Select…</option>
                    {DEGREE_TYPES.map((d) => <option key={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label}>Field of study</label>
                  <input className={inp} value={edu.field} onChange={(e) => updateEdu(i, "field", e.target.value)} placeholder="e.g. Computer Science" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={label}>Institution <span className="text-red-400">*</span></label>
                  <input className={inp} value={edu.institution} onChange={(e) => updateEdu(i, "institution", e.target.value)} placeholder="e.g. Tel Aviv University" />
                </div>
                <div>
                  <label className={label}>Graduation year</label>
                  <select className={inp} value={edu.year} onChange={(e) => updateEdu(i, "year", e.target.value)}>
                    <option value="">Year</option>
                    {YEARS.map((y) => <option key={y}>{y}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className={label}>Notable achievement <span className="text-xs text-gray-400">(optional)</span></label>
                <input className={inp} value={edu.achievement} onChange={(e) => updateEdu(i, "achievement", e.target.value)} placeholder="e.g. Graduated with honors, GPA 3.9, thesis on ML" />
              </div>
            </div>
          ))}

          <button type="button" onClick={addEdu} className="text-sm text-purple-600 hover:underline font-medium">
            + Add another
          </button>
        </div>
      )}

      {/* ── Step 4: Skills + projects ───────────────────────────────────────── */}
      {step === 4 && (
        <div className="space-y-6">
          <div>
            <h2 className="text-base font-semibold text-gray-800 mb-3">Skills</h2>
            <TagInput
              tags={skillsInfo.skills}
              onChange={(tags) => setSkillsInfo((p) => ({ ...p, skills: tags }))}
              placeholder="e.g. React, Python…"
              suggestions={SKILL_SUGGESTIONS}
            />
          </div>

          <div>
            <h2 className="text-base font-semibold text-gray-800 mb-1">Languages</h2>
            <p className="text-xs text-gray-500 mb-3">e.g. Hebrew (native), English (fluent)</p>
            <TagInput
              tags={skillsInfo.languages}
              onChange={(tags) => setSkillsInfo((p) => ({ ...p, languages: tags }))}
              placeholder="e.g. Hebrew (native)"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-base font-semibold text-gray-800">Projects <span className="text-xs font-normal text-gray-400">(optional, up to 3)</span></h2>
              </div>
              {skillsInfo.projects.length < 3 && (
                <button type="button" onClick={addProject} className="text-sm text-purple-600 hover:underline font-medium">+ Add project</button>
              )}
            </div>

            {skillsInfo.projects.length === 0 && (
              <p className="text-sm text-gray-400 italic">No projects added.</p>
            )}

            {skillsInfo.projects.map((proj, i) => (
              <div key={i} className="border rounded-xl p-4 space-y-3 mb-3 relative">
                <button type="button" onClick={() => removeProject(i)} className="absolute top-3 right-3 text-xs text-gray-400 hover:text-red-500">
                  Remove
                </button>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={label}>Project name</label>
                    <input className={inp} value={proj.name} onChange={(e) => updateProject(i, "name", e.target.value)} placeholder="e.g. JobAgent" />
                  </div>
                  <div>
                    <label className={label}>Link <span className="text-xs text-gray-400">(optional)</span></label>
                    <input className={inp} value={proj.link} onChange={(e) => updateProject(i, "link", e.target.value)} placeholder="github.com/…" />
                  </div>
                </div>
                <div>
                  <label className={label}>One-line description</label>
                  <input className={inp} value={proj.description} onChange={(e) => updateProject(i, "description", e.target.value)} placeholder="e.g. AI-powered job search assistant" />
                </div>
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
      )}

      {error && <p className="text-sm text-red-600 mt-4">{error}</p>}

      {/* Navigation */}
      <div className="flex gap-3 mt-8 pb-8">
        <button
          type="button"
          onClick={() => step === 1 ? router.push("/dashboard/onboarding") : setStep((s) => s - 1)}
          className="flex-1 border py-2.5 rounded-lg text-sm hover:bg-gray-50"
        >
          {step === 1 ? "Cancel" : "← Back"}
        </button>

        {step < TOTAL_STEPS ? (
          <button
            type="button"
            disabled={!canProceed()}
            onClick={() => setStep((s) => s + 1)}
            className="flex-1 bg-black text-white py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-40"
          >
            Next →
          </button>
        ) : (
          <button
            type="button"
            disabled={generating}
            onClick={handleGenerate}
            className="flex-1 bg-purple-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
          >
            Generate my CV →
          </button>
        )}
      </div>
    </div>
  );
}
