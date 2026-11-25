import { LABEL_RE, isRtlCv, parseCv } from "@/lib/cv-text";

// The generated CV on screen, read by the same parser as the Word file
// (lib/cv-text.ts) and laid out to the same rules as the PDF
// (ai-service/utils/cv_pdf.py): Public Sans, one accent for the role line
// and section labels, a 2pt rule under the header, dates on the title's
// line. Sizes are the document's points as px at roughly screen scale.
// Fixed colours, not theme tokens: this is a picture of a printed page,
// white in dark mode too.
const INK = "#15181D";
const BULLET_INK = "#22262C";
const CONTACT = "#4B5159";
const MUTED = "#6B727B";
const ACCENT = "#2C5F7C";

export default function CVPreview({ cvText }: { cvText: string }) {
  const cv = parseCv(cvText);
  // A Hebrew CV reads right to left, as the PDF lays it out.
  const rtl = isRtlCv(cvText);

  return (
    <article dir={rtl ? "rtl" : "ltr"} className="font-sans text-[13px] leading-[1.52]" style={{ color: INK }}>
      <header className="border-b-2 pb-4" style={{ borderColor: ACCENT }}>
        {cv.name && (
          <h2 className="text-[32px] font-bold leading-[1.05] tracking-[-0.025em]">{cv.name}</h2>
        )}
        {cv.role && <p className="mt-1.5 text-[16px] font-medium" style={{ color: ACCENT }}>{cv.role}</p>}
        {cv.contact.length > 0 && (
          <p className="mt-2 text-[11.5px]" style={{ color: CONTACT }}>
            {cv.contact.map((part, i) => (
              <span key={i}>
                {i > 0 && <span aria-hidden="true">{"  |  "}</span>}
                {part}
              </span>
            ))}
          </p>
        )}
      </header>

      {cv.sections.map((section, s) => (
        <section key={s} className="mt-8">
          {section.label && (
            <h3 className={`mb-2.5 text-[11px] font-bold uppercase ${rtl ? "" : "tracking-[0.18em]"}`} style={{ color: ACCENT }}>
              {section.label}
            </h3>
          )}
          {section.entries.map((entry, e) => (
            <div key={e} className={entry.header && e > 0 ? "mt-5" : undefined}>
              {entry.header && (
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4">
                  <span className="text-[15px] font-semibold tracking-[-0.01em]">{entry.header.title}</span>
                  {entry.header.date && <span className="text-[11.5px]" style={{ color: MUTED }}>{entry.header.date}</span>}
                </div>
              )}
              {entry.lines.map((line, l) => {
                if (line.kind === "bullet") {
                  return (
                    <p key={l} className="mb-1 ps-4 -indent-2" style={{ color: BULLET_INK }}>
                      {"• "}
                      <LabelText text={line.text} />
                    </p>
                  );
                }
                if (line.kind === "summary") return <p key={l} className="mb-1 text-[14px]">{line.text}</p>;
                if (line.kind === "secondary") return <p key={l} className="mb-1 text-[12.5px]" style={{ color: MUTED }}>{line.text}</p>;
                return <p key={l} className="mb-1"><LabelText text={line.text} /></p>;
              })}
            </div>
          ))}
        </section>
      ))}
    </article>
  );
}

// "Languages: Python, Go" with the label in semibold.
function LabelText({ text }: { text: string }) {
  const m = LABEL_RE.exec(text);
  if (!m) return <>{text}</>;
  return (
    <>
      <span className="font-semibold" style={{ color: INK }}>{m[1]}</span> {m[2]}
    </>
  );
}
