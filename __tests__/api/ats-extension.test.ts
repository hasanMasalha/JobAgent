import { NextRequest } from "next/server";

// The routes the extension calls to fill an ATS form itself. They pass on
// only the user id this request authenticated, never one from the caller.

const getUserId = jest.fn();
jest.mock("@/lib/extension-token", () => ({ getSessionOrExtensionUserId: (...a: unknown[]) => getUserId(...a) }));
const pythonFetch = jest.fn();
jest.mock("@/lib/python-service", () => ({ pythonFetch: (...a: unknown[]) => pythonFetch(...a) }));

import { POST as resolveAnswers } from "@/app/api/apply/resolve-answers/route";
import { GET as atsPackage } from "@/app/api/apply/ats-package/[applicationId]/route";
import { GET as atsCv } from "@/app/api/apply/ats-package/[applicationId]/cv/route";

const json = (data: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }));
const sent = () => JSON.parse(pythonFetch.mock.calls[0][1].body);
const resolveReq = (body: unknown) =>
  new NextRequest("http://localhost/api/apply/resolve-answers", { method: "POST", body: JSON.stringify(body) });
const getReq = (path: string) => new NextRequest(`http://localhost${path}`);
const params = { params: { applicationId: "app-1" } };

beforeEach(() => {
  jest.clearAllMocks();
  getUserId.mockResolvedValue("user-1");
});

describe("POST /api/apply/resolve-answers", () => {
  it("needs a session or extension token", async () => {
    getUserId.mockResolvedValue(null);
    expect((await resolveAnswers(resolveReq({ applicationId: "app-1", questions: [] }))).status).toBe(401);
    expect(pythonFetch).not.toHaveBeenCalled();
  });

  it("needs an application and questions", async () => {
    expect((await resolveAnswers(resolveReq({ questions: [] }))).status).toBe(400);
    expect((await resolveAnswers(resolveReq({ applicationId: "app-1" }))).status).toBe(400);
  });

  it("sends the authenticated user, not one from the body", async () => {
    pythonFetch.mockReturnValue(json({ answers: [], missing: [] }));
    const questions = [{ id: "q1", label: "Full name", kind: "text" }];
    const res = await resolveAnswers(resolveReq({ applicationId: "app-1", questions, user_id: "someone-else", userId: "x" }));

    expect(res.status).toBe(200);
    expect(pythonFetch.mock.calls[0][0]).toBe("/resolve-answers");
    expect(sent()).toEqual({ application_id: "app-1", questions, user_id: "user-1" });
  });

  it.each([
    ["not_found", 404],
    ["not_open", 409],
  ])("maps %s to %i", async (error, status) => {
    pythonFetch.mockReturnValue(json({ error }));
    expect((await resolveAnswers(resolveReq({ applicationId: "app-1", questions: [] }))).status).toBe(status);
  });

  it("reports the AI service being down as 502", async () => {
    pythonFetch.mockReturnValue(json({ detail: "boom" }, 500));
    expect((await resolveAnswers(resolveReq({ applicationId: "app-1", questions: [] }))).status).toBe(502);
  });
});

describe("GET /api/apply/ats-package/[applicationId]", () => {
  it("returns the package for the authenticated user's application", async () => {
    pythonFetch.mockReturnValue(json({ application_id: "app-1", ats: "greenhouse", form_url: "https://x" }));
    const res = await atsPackage(getReq("/api/apply/ats-package/app-1"), params);

    expect(res.status).toBe(200);
    expect((await res.json()).ats).toBe("greenhouse");
    expect(sent()).toEqual({ application_id: "app-1", user_id: "user-1" });
  });

  it("needs auth", async () => {
    getUserId.mockResolvedValue(null);
    expect((await atsPackage(getReq("/api/apply/ats-package/app-1"), params)).status).toBe(401);
  });
});

describe("GET /api/apply/ats-package/[applicationId]/cv", () => {
  it("returns the file with its type and a safe filename", async () => {
    pythonFetch.mockReturnValue(
      json({ filename: 'Dana "L"_cv.pdf', mime_type: "application/pdf", base64: Buffer.from("%PDF-1").toString("base64") }),
    );
    const res = await atsCv(getReq("/api/apply/ats-package/app-1/cv"), params);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="Dana _L__cv.pdf"');
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("%PDF-1");
  });

  it("says when the CV can't be used", async () => {
    pythonFetch.mockReturnValue(json({ error: "cv_unavailable" }));
    expect((await atsCv(getReq("/api/apply/ats-package/app-1/cv"), params)).status).toBe(409);
  });
});
