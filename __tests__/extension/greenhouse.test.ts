/**
 * @jest-environment jsdom
 */
// chrome-extension/greenhouse.js fills real Greenhouse applications with the
// server's answers. It must put in only those answers — the exact option the
// server chose, never the first one or a near match — and stop before Submit
// when anything required is left: a question the user hasn't answered, a
// field the board API doesn't list, a city with several matches. And it may
// only report "applied" on Greenhouse's own confirmation.
import fs from "fs";
import path from "path";

// jsdom has no CSS.escape.
(globalThis as unknown as { CSS: { escape: (s: string) => string } }).CSS = {
  escape: (s: string) => s.replace(/["\\\]\[]/g, "\\$&"),
};

// Nor DataTransfer (how greenhouse.js puts a file in an input).
(globalThis as unknown as { DataTransfer: unknown }).DataTransfer = class {
  private list: File[] = [];
  items = { add: (f: File) => void this.list.push(f) };
  get files() {
    return this.list;
  }
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const gh = require("../../chrome-extension/greenhouse.js") as {
  GH_DRY_RUN: boolean;
  ghDomId: (id: string) => string;
  ghExactOption: (texts: string[], wanted: string) => number;
  ghLocationOption: (texts: string[], city: string) => number;
  ghIsConfirmation: (url: string, text: string, before: string) => boolean;
  ghRequiredEmpty: (doc: Document, skip: Set<string>) => { id: string; question: string }[];
  ghFill: (
    doc: Document,
    data: Record<string, unknown>,
    resolvePhoneCountry: (q: Record<string, unknown>) => Promise<Record<string, unknown> | null>,
  ) => Promise<{ filled: string[]; missing: { id: string; question: string; options: string[] }[]; userFill: string[]; failed: string[] }>;
  ghSetFile: (doc: Document, inputId: string, file: File, timeoutMs?: number) => Promise<boolean>;
  ghUploadDone: (doc: Document, inputId: string, filename: string) => boolean;
  ghFormErrors: (doc: Document) => string[];
};

jest.setTimeout(30000);

// A stand-in for Greenhouse's react-select: ArrowDown opens
// #react-select-<id>-listbox, typing filters it, clicking an option shows it
// in .select__single-value.
function combo(id: string, label: string, options: string[], required = false) {
  const wrap = document.createElement("div");
  wrap.innerHTML =
    `<label for="${id}">${label}${required ? "*" : ""}</label>` +
    `<div class="select__control"><div class="select__value-container"></div>` +
    `<input id="${id}" role="combobox" aria-required="${required}"></div>`;
  document.body.appendChild(wrap);
  const input = wrap.querySelector("input")!;
  const value = wrap.querySelector(".select__value-container")!;
  const close = () => document.getElementById(`react-select-${id}-listbox`)?.remove();
  const open = (filter = "") => {
    close();
    const lb = document.createElement("div");
    lb.id = `react-select-${id}-listbox`;
    for (const o of options.filter((t) => t.toLowerCase().includes(filter.toLowerCase()))) {
      const el = document.createElement("div");
      el.setAttribute("role", "option");
      el.textContent = o;
      el.addEventListener("click", () => {
        value.innerHTML = `<div class="select__single-value">${o}</div>`;
        close();
      });
      lb.appendChild(el);
    }
    document.body.appendChild(lb);
  };
  input.addEventListener("keydown", (e) => (e.key === "ArrowDown" ? open() : e.key === "Escape" ? close() : null));
  input.addEventListener("input", () => open(input.value));
}

function text(id: string, label: string, required = false) {
  document.body.insertAdjacentHTML(
    "beforeend",
    `<label for="${id}">${label}${required ? "*" : ""}</label><input id="${id}" type="text" aria-required="${required}">`,
  );
}

// A stand-in for Greenhouse's uploader, as seen on job-boards: attaching
// replaces the input with a progress bar while the file goes to its storage,
// then with .file-upload__filename. `ms: null` = the upload never finishes.
function upload(id: string, label: string, { required = true, ms = 300 as number | null } = {}) {
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div role="group" aria-labelledby="upload-label-${id}" class="file-upload">` +
      `<div id="upload-label-${id}" class="label upload-label">${label}${required ? '<span class="required">*</span>' : ""}</div>` +
      `<div class="file-upload__wrapper"><input id="${id}" type="file"></div></div>`,
  );
  const input = document.getElementById(id) as HTMLInputElement;
  Object.defineProperty(input, "files", { writable: true, value: [] });
  const wrapper = input.parentElement!;
  input.addEventListener("change", () => {
    const name = (input.files as unknown as File[])[0].name;
    wrapper.innerHTML = `<div role="progressbar" aria-valuenow="0" class="file-upload__progressbar"></div>`;
    if (ms !== null) {
      setTimeout(() => {
        wrapper.outerHTML = `<div class="file-upload__filename"><p class="body body__secondary">${name}</p>` +
          `<button type="button" aria-label="Remove file"></button></div>`;
      }, ms);
    }
  });
}

const chosen = (id: string) =>
  document.getElementById(id)!.closest(".select__control")!.querySelector(".select__single-value")?.textContent ?? null;

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("greenhouse.js", () => {
  it("doesn't ship with the dry run on", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../chrome-extension/greenhouse.js"), "utf8");
    expect(src).toMatch(/^const GH_DRY_RUN = false$/m);
    expect(gh.GH_DRY_RUN).toBe(false);
  });

  it("finds fields by the board API's names", () => {
    expect(gh.ghDomId("question_1")).toBe("question_1");
    expect(gh.ghDomId("question_1[]")).toBe("question_1");
    expect(gh.ghDomId("location")).toBe("candidate-location");
    expect(gh.ghDomId("demographic_4001")).toBe("4001");
  });

  it("matches an option exactly, never a near one", () => {
    expect(gh.ghExactOption(["Yes", "No"], "no")).toBe(1);
    expect(gh.ghExactOption(["No, I do not require sponsorship", "Yes"], "No")).toBe(-1);
    expect(gh.ghExactOption(["Yes", "No"], "")).toBe(-1);
  });

  it("takes a city only when one suggestion is that place", () => {
    expect(gh.ghLocationOption(["Haifa, Israel"], "Haifa")).toBe(0);
    expect(gh.ghLocationOption(["London, England, United Kingdom", "London, Ontario, Canada"], "London")).toBe(-1);
    expect(gh.ghLocationOption(["Tel Aviv-Yafo, Tel Aviv District, Israel"], "Tel Aviv")).toBe(-1);
  });

  it("counts only Greenhouse's own confirmation", () => {
    expect(gh.ghIsConfirmation("https://job-boards.greenhouse.io/acme/jobs/1/confirmation", "", "")).toBe(true);
    expect(gh.ghIsConfirmation("https://job-boards.greenhouse.io/acme/jobs/1", "Thank you for applying to Acme!", "Apply")).toBe(true);
    // Already on the page before Submit (a job description can say it).
    expect(gh.ghIsConfirmation("https://job-boards.greenhouse.io/acme/jobs/1", "Thank you for applying", "Thank you for applying")).toBe(false);
    expect(gh.ghIsConfirmation("https://job-boards.greenhouse.io/acme/jobs/1", "Submit application", "")).toBe(false);
  });

  it("lists required fields left empty, by their label", () => {
    text("first_name", "First Name", true);
    text("school--0", "School", true);
    combo("question_2", "Have you worked here before?", ["Yes", "No"], true);
    (document.getElementById("first_name") as HTMLInputElement).value = "Dana";
    document.body.insertAdjacentHTML(
      "beforeend",
      `<fieldset aria-required="true"><legend>Please review*</legend>` +
        `<input type="checkbox" id="question_3[]_1" name="question_3[]"><label for="question_3[]_1">I acknowledge</label></fieldset>`,
    );
    const empty = gh.ghRequiredEmpty(document, new Set());
    expect(empty.map((e) => e.question)).toEqual(["School", "Have you worked here before?", "Please review"]);
    expect(gh.ghRequiredEmpty(document, new Set(["school--0", "question_2", "question_3[]"]))).toEqual([]);
  });

  it("fills the server's answers and stops on everything else", async () => {
    text("first_name", "First Name", true);
    text("question_1", "Current employer", true);
    combo("question_2", "Will you require sponsorship?", ["Yes", "No"], true);
    combo("question_4", "Gender", ["Male", "Female", "Decline to Self Identify"]);
    combo("question_5", "Country of residence", ["Israel", "Other"], true);
    combo("candidate-location", "Location (City)", ["London, England, United Kingdom", "London, Ontario, Canada"], true);
    text("school--0", "School", true);
    document.body.insertAdjacentHTML(
      "beforeend",
      `<fieldset aria-required="true"><legend>Please review*</legend>` +
        `<input type="checkbox" id="question_3[]_1" name="question_3[]"><label for="question_3[]_1">I acknowledge the privacy notice</label>` +
        `<input type="checkbox" id="question_3[]_2" name="question_3[]"><label for="question_3[]_2">Send me marketing</label></fieldset>`,
    );

    const result = await gh.ghFill(
      document,
      {
        questions: [
          { id: "first_name", label: "First Name", kind: "text", required: true, role: "first_name" },
          { id: "question_1", label: "Current employer", kind: "text", required: true },
          { id: "question_2", label: "Will you require sponsorship?", kind: "select", required: true, options: ["Yes", "No"] },
          { id: "question_3[]", label: "Please review", kind: "multi_select", required: true, options: ["I acknowledge the privacy notice", "Send me marketing"] },
          { id: "question_4", label: "Gender", kind: "select", required: false, eeo: true },
          { id: "question_5", label: "Country of residence", kind: "select", required: true, options: ["Israel", "Other"] },
          { id: "location", label: "Location (City)", kind: "location", required: true },
        ],
        answers: [
          { id: "first_name", source: "profile", value: "Dana" },
          { id: "question_2", source: "profile", option: "No" },
          { id: "question_3[]", source: "consent", options: ["I acknowledge the privacy notice"] },
          // Not one of the page's options: left alone, not "the closest".
          { id: "question_5", source: "saved", option: "Isr" },
          { id: "location", source: "profile", value: "London" },
        ],
        missing: [{ id: "question_1", label: "Current employer" }],
      },
      async () => null,
    );

    expect((document.getElementById("first_name") as HTMLInputElement).value).toBe("Dana");
    expect(chosen("question_2")).toBe("No");
    expect((document.getElementById("question_3[]_1") as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById("question_3[]_2") as HTMLInputElement).checked).toBe(false);
    expect(chosen("question_4")).toBeNull();
    expect(chosen("question_5")).toBeNull();
    expect(chosen("candidate-location")).toBeNull();

    // The server's missing question is the one the user can save an answer to.
    expect(result.missing).toEqual([{ id: "question_1", question: "Current employer", options: [] }]);
    // Several Londons, and School that the board API doesn't list: the user's to fill.
    expect(result.userFill).toEqual(["Location (City)", "School"]);
    expect(result.failed).toEqual(["Country of residence"]);
    expect(result.filled).toEqual(["first_name", "question_2", "question_3"]);
  });

  it("chooses the phone country the server picked from the page's own list, then types the national number", async () => {
    combo("country", "Country", ["United States +1", "Guernsey +44", "United Kingdom +44"], true);
    document.body.insertAdjacentHTML("beforeend", `<label for="phone">Phone*</label><input id="phone" type="tel" aria-required="true">`);
    const asked: Record<string, unknown>[] = [];
    const result = await gh.ghFill(
      document,
      {
        questions: [{ id: "phone", label: "Phone", kind: "text", required: true, role: "phone" }],
        answers: [{ id: "phone", source: "profile", value: "+44 7400 123456" }],
        missing: [],
      },
      async (q) => {
        asked.push(q);
        return { id: "country", source: "phone_country", option: "United Kingdom +44", value: "07400123456" };
      },
    );
    expect(asked[0]).toMatchObject({ kind: "phone_country", required: true, options: ["United States +1", "Guernsey +44", "United Kingdom +44"] });
    expect(chosen("country")).toBe("United Kingdom +44");
    expect((document.getElementById("phone") as HTMLInputElement).value).toBe("07400123456");
    expect(result).toMatchObject({ missing: [], userFill: [], failed: [] });
  });

  it("stops when a required phone country can't be placed", async () => {
    combo("country", "Country", ["United States +1"], true);
    document.body.insertAdjacentHTML("beforeend", `<input id="phone" type="tel" aria-required="true">`);
    const result = await gh.ghFill(
      document,
      {
        questions: [{ id: "phone", label: "Phone", kind: "text", required: true, role: "phone" }],
        answers: [{ id: "phone", source: "profile", value: "0740 0123456" }],
        missing: [],
      },
      async () => null,
    );
    expect(chosen("country")).toBeNull();
    expect(result.userFill).toEqual(["Phone country"]);
  });

  it("waits for Greenhouse to finish uploading a file, not just to take it", async () => {
    upload("resume", "Resume/CV");
    const attaching = gh.ghSetFile(document, "resume", new File(["%PDF"], "Hasan.Masalha resume.docx"));
    // The input is gone and the progress bar is up: not attached yet. Submit
    // here is what Greenhouse refused with "Resume/CV is required."
    await new Promise((r) => setTimeout(r, 100));
    expect(document.getElementById("resume")).toBeNull();
    expect(gh.ghUploadDone(document, "resume", "Hasan.Masalha resume.docx")).toBe(false);
    expect(gh.ghRequiredEmpty(document, new Set()).map((e) => e.question)).toEqual(["Resume/CV"]);
    expect(await attaching).toBe(true);
    expect(gh.ghUploadDone(document, "resume", "Hasan.Masalha resume.docx")).toBe(true);
    expect(gh.ghRequiredEmpty(document, new Set())).toEqual([]);
  });

  it("counts a file whose upload never finishes as not filled", async () => {
    upload("resume", "Resume/CV", { ms: null });
    expect(await gh.ghSetFile(document, "resume", new File(["%PDF"], "CV.pdf"), 800)).toBe(false);
    const result = await gh.ghFill(
      document,
      {
        questions: [{ id: "resume", label: "Resume/CV", kind: "file", required: true, role: "resume" }],
        answers: [{ id: "resume", source: "resume" }],
        missing: [],
        cv: null,
      },
      async () => null,
    );
    expect(result.failed).toEqual(["Resume/CV"]);
  });

  it("recognises Greenhouse's errors under the fields, the résumé's included", () => {
    text("first_name", "First Name", true);
    document.getElementById("first_name")!.setAttribute("aria-invalid", "true");
    document.body.insertAdjacentHTML(
      "beforeend",
      `<p id="first_name-error" class="helper-text helper-text--error">First Name is required.</p>` +
        // The résumé's error: no aria-invalid anywhere.
        `<div class="file-upload"><p id="resume-error" class="helper-text helper-text--error">Resume/CV is required.</p></div>` +
        `<label for="email">Email</label><input id="email" aria-invalid="true">` +
        `<p class="helper-text">Accepted file types: pdf</p>`,
    );
    expect(gh.ghFormErrors(document)).toEqual(["First Name is required.", "Resume/CV is required.", "Email"]);
    document.body.innerHTML = "";
    text("first_name", "First Name", true);
    expect(gh.ghFormErrors(document)).toEqual([]);
  });
});
