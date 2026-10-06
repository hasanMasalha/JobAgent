// The server side of ATS applying from the browser extension (stage 1 of
// moving ATS auto-apply out of the server, 2026-10-06). The AI service keeps
// every decision — answers, the form to open, the CV file — and the extension
// fills the page. See ai-service/routes/ats_extension.py.
import { NextResponse } from "next/server";
import { pythonFetch } from "@/lib/python-service";

const ERROR_STATUS: Record<string, number> = {
  not_found: 404,
  not_open: 409,
  cv_unavailable: 409,
};

/**
 * Calls the AI service for `userId`'s application. `userId` must be the one
 * this request authenticated (session or extension token) — never one from
 * the caller. Returns the AI service's JSON, or the response to send back.
 */
export async function callAtsExtension(
  path: "/resolve-answers" | "/ats-package" | "/ats-package/cv" | "/form-answers",
  userId: string,
  body: Record<string, unknown>,
): Promise<{ data: Record<string, unknown> } | { response: NextResponse }> {
  const res = await pythonFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, user_id: userId }),
  }).catch(() => null);
  if (!res || !res.ok) {
    return { response: NextResponse.json({ error: "service_unavailable" }, { status: 502 }) };
  }
  const data = (await res.json()) as Record<string, unknown>;
  const error = typeof data.error === "string" ? data.error : null;
  if (error) {
    return { response: NextResponse.json(data, { status: ERROR_STATUS[error] ?? 400 }) };
  }
  return { data };
}
