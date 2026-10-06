/**
 * @jest-environment jsdom
 */
import { createElement } from "react";
import { act, render, screen } from "@testing-library/react";

// The fill-and-review section: every question on the real form, with
// JobAgent's answer or "You answer this one" — never a guessed fact.

jest.mock("@/app/components/Toast", () => ({ showToast: jest.fn() }));
import FormAnswers from "@/app/dashboard/apply/[jobId]/FormAnswers";

const respond = (data: unknown, ok = true) => {
  global.fetch = jest.fn().mockResolvedValue({ ok, json: async () => data }) as unknown as typeof fetch;
};

async function show() {
  await act(async () => {
    render(createElement(FormAnswers, { applicationId: "app-1" }));
  });
}

const FORM = {
  supported: true,
  form_url: "https://job-boards.greenhouse.io/embed/job_app?for=acme&token=1",
  questions: [
    { id: "first_name", label: "First Name", kind: "text", required: true, role: "first_name", eeo: false },
    { id: "resume", label: "Resume/CV", kind: "file", required: true, role: "resume", eeo: false },
    { id: "q1", label: "Why Acme?", kind: "long_text", required: true, role: null, eeo: false },
    { id: "q2", label: "Are you authorized to work in the UK?", kind: "select", required: true, role: null, eeo: false },
    { id: "q3", label: "Website", kind: "text", required: false, role: null, eeo: false },
  ],
  answers: [
    { id: "first_name", source: "profile", value: "Dana" },
    { id: "resume", source: "resume" },
    { id: "q1", source: "claude", value: "I build payment systems." },
  ],
  missing: [{ id: "q2", label: "Are you authorized to work in the UK?" }],
};

describe("FormAnswers", () => {
  it("asks for this application's answers", async () => {
    respond(FORM);
    await show();
    expect(global.fetch).toHaveBeenCalledWith("/api/apply/form-answers/app-1");
  });

  it("shows each answer with where it came from, and what the user must answer", async () => {
    respond(FORM);
    await show();

    expect(screen.getByText("Dana")).toBeTruthy();
    expect(screen.getByText("From your Profile")).toBeTruthy();
    expect(screen.getByText("I build payment systems.")).toBeTruthy();
    expect(screen.getByText(/Written by Claude from your CV/)).toBeTruthy();
    expect(screen.getByText(/Attach your tailored CV/)).toBeTruthy();
    expect(screen.getByText("You answer this one.")).toBeTruthy();
    expect(screen.getByText(/Optional/)).toBeTruthy();
    // The résumé counts as answered: the user attaches the tailored CV.
    const summary = document.body.textContent ?? "";
    expect(summary).toMatch(/3 of 5 questions answered/);
    expect(summary).toMatch(/1 required question needs your answer/);
    expect(screen.getAllByRole("button", { name: /Copy the answer to/ })).toHaveLength(2);
    expect(screen.getByRole("link", { name: /Open the application form/ }).getAttribute("href")).toBe(FORM.form_url);
  });

  it("renders nothing for a form it can't read", async () => {
    respond({ supported: false, ats: "lever", form_url: "https://jobs.lever.co/a/1/apply" });
    const { container } = render(createElement(FormAnswers, { applicationId: "app-1" }));
    await act(async () => {});
    expect(container.textContent).toBe("");
  });

  it("says so when the form couldn't be read", async () => {
    respond({ error: "service_unavailable" }, false);
    await show();
    expect(screen.getByText(/couldn.t read this job.s application form/)).toBeTruthy();
  });
});
