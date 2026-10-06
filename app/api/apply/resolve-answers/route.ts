import { NextRequest, NextResponse } from "next/server";
import { getSessionOrExtensionUserId } from "@/lib/extension-token";
import { callAtsExtension } from "@/lib/ats-extension";

// The answers for an application form the extension is filling: it sends the
// form's questions, the AI service answers each with the facts-only rules
// (ai-service/answer_resolver.py) or lists it as missing. A required missing
// answer means the extension doesn't submit.
//
// POST { applicationId, questions: [{ id, label, kind, required, options?, role?, eeo? }] }
// → { answers: [{ id, source, value? | option? | options? }], missing: [{ id, label }] }
export async function POST(req: NextRequest) {
  const userId = await getSessionOrExtensionUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const applicationId = typeof body?.applicationId === "string" ? body.applicationId : null;
  const questions = Array.isArray(body?.questions) ? body.questions : null;
  if (!applicationId || !questions) {
    return NextResponse.json({ error: "applicationId and questions are required" }, { status: 400 });
  }

  const result = await callAtsExtension("/resolve-answers", userId, {
    application_id: applicationId,
    questions: questions.slice(0, 200),
  });
  return "response" in result ? result.response : NextResponse.json(result.data);
}
