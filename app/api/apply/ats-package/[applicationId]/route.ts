import { NextRequest, NextResponse } from "next/server";
import { getSessionOrExtensionUserId } from "@/lib/extension-token";
import { callAtsExtension } from "@/lib/ats-extension";

// What the extension opens and applies with, for an application that is the
// user's own and still draft or pending_extension: the ATS, the form URL
// (Greenhouse embedded on a company site resolved to Greenhouse's own form),
// the job and the cover letter. The CV file is at ./cv.
export async function GET(req: NextRequest, { params }: { params: { applicationId: string } }) {
  const userId = await getSessionOrExtensionUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await callAtsExtension("/ats-package", userId, { application_id: params.applicationId });
  return "response" in result ? result.response : NextResponse.json(result.data);
}
