import { isRtlCv, parseCv } from "@/lib/cv-text";

// The Word file and the on-screen preview read a CV with this parser; the PDF
// (ai-service/utils/cv_pdf.py) reads it the same way — these mirror
// ai-service/tests/test_cv_pdf.py's Hebrew tests.

const HEBREW_CV = `דנה לוי
מפתחת Backend בכירה
dana@example.com | 050-123-4567 | תל אביב

כישורים
שפות תכנות: Python, Go, SQL

ניסיון תעסוקתי
מפתחת Backend בכירה, Wix | 03/2021 - היום
תל אביב
- הובלתי מעבר לענן.

שירות צבאי
- מפתחת תוכנה ביחידה טכנולוגית

תקציר
מפתחת Backend עם שמונה שנות ניסיון.
`;

describe("parseCv with Hebrew", () => {
  it("recognises Hebrew headings, keeps their text and puts them in canonical order", () => {
    const cv = parseCv(HEBREW_CV);
    expect(cv.sections.map((s) => s.label)).toEqual(["תקציר", "ניסיון תעסוקתי", "כישורים", "שירות צבאי"]);
    expect(cv.sections[0].entries[0].lines[0]).toEqual({ kind: "summary", text: "מפתחת Backend עם שמונה שנות ניסיון." });
  });

  it("reads Hebrew dates, and the location under a role is not a heading", () => {
    const role = parseCv(HEBREW_CV).sections[1].entries[0];
    expect(role.header).toEqual({ title: "מפתחת Backend בכירה, Wix", date: "03/2021 - היום" });
    expect(role.lines.map((l) => l.kind)).toEqual(["secondary", "bullet"]);
  });

  it("reads Hebrew month names and a Hebrew 'Label:' line", () => {
    const cv = parseCv("דנה\nd@x.com\n\nניסיון\nמפתחת, Check Point | ינואר 2017 - פברואר 2021\n\nכישורים\nתשתיות: AWS, Kafka\n");
    expect(cv.sections[0].entries[0].header?.date).toBe("ינואר 2017 - פברואר 2021");
    expect(cv.sections[1].entries[0].lines[0]).toEqual({ kind: "text", text: "תשתיות: AWS, Kafka" });
  });

  it("a location under a role isn't a heading in English either", () => {
    const cv = parseCv("Dana\nd@x.com\n\nExperience\nEngineer, Acme | 2020 - 2022\nTel Aviv\n- Built it\n");
    expect(cv.sections.map((s) => s.label)).toEqual(["Experience"]);
  });

  it("calls a CV right-to-left only when most of its letters are Hebrew", () => {
    expect(isRtlCv(HEBREW_CV)).toBe(true);
    expect(isRtlCv("Dana Levi\nB.Sc. Computer Science, האוניברסיטה העברית | 2016\n")).toBe(false);
  });
});
