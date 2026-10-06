import { NextRequest, NextResponse } from "next/server";
import { getSessionOrExtensionUserId } from "@/lib/extension-token";
import { callAtsExtension } from "@/lib/ats-extension";

// The fill-and-review page: the real application form's questions (read
// without a browser — Greenhouse and Ashby so far) and JobAgent's answer to
// each, or the ones the user has to answer. The same answers, and the same
// cached Claude answers, as the extension gets (/api/apply/resolve-answers).
export async function GET(req: NextRequest, { params }: { params: { applicationId: string } }) {
  const userId = await getSessionOrExtensionUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await callAtsExtension("/form-answers", userId, { application_id: params.applicationId });
  return "response" in result ? result.response : NextResponse.json(result.data);
}
