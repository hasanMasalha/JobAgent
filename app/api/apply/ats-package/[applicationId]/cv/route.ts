import { NextRequest, NextResponse } from "next/server";
import { getSessionOrExtensionUserId } from "@/lib/extension-token";
import { callAtsExtension } from "@/lib/ats-extension";

// The CV file the extension uploads to the form: the same file the server-
// side applier sends (tailored CV, else the user's own upload byte-for-byte,
// else the generated one). Only for the user's own open application.
export async function GET(req: NextRequest, { params }: { params: { applicationId: string } }) {
  const userId = await getSessionOrExtensionUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await callAtsExtension("/ats-package/cv", userId, { application_id: params.applicationId });
  if ("response" in result) return result.response;

  const { filename, mime_type, base64 } = result.data as { filename: string; mime_type: string; base64: string };
  return new NextResponse(Buffer.from(base64, "base64"), {
    headers: {
      "Content-Type": mime_type,
      "Content-Disposition": `attachment; filename="${filename.replace(/["\\r\n]/g, "_")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
