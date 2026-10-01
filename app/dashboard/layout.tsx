import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";
import NavBarClient from "./NavBarClient";
import ChatFab from "./ChatFab";
import { Toast } from "@/app/components/Toast";
import { Notice, noticeLinkStyles } from "@/app/components/ui";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Redirect to onboarding if user has no CV (skip if already going there)
  const pathname = headers().get("x-pathname") ?? "";
  const isOnboarding = pathname.startsWith("/dashboard/onboarding");

  let needsCvReconfirmation = false;
  if (!isOnboarding) {
    const cvRows = await db.$queryRaw<{ id: string; source: string; hasOriginalFile: boolean }[]>`
      SELECT id, source, (original_file IS NOT NULL) AS "hasOriginalFile"
      FROM "CV" WHERE user_id = ${user.id} LIMIT 1
    `;
    if (cvRows.length === 0) {
      redirect("/dashboard/onboarding");
    }
    // Pre-migration CV rows default to source='uploaded' with no stored
    // original bytes — we can't tell if that text is really the user's own
    // upload or an old AI rewrite, so auto-apply refuses to guess (see
    // resolve_cv_file in ai-service/utils/cv_pdf.py). Surface that here
    // instead of only when an auto-apply silently can't produce a file.
    needsCvReconfirmation = cvRows[0].source === "uploaded" && !cvRows[0].hasOriginalFile;
  }

  return (
    <div className="min-h-screen bg-canvas font-sans text-ink">
      <NavBarClient userEmail={user.email ?? ""} />
      {needsCvReconfirmation && (
        <Notice
          tone="waiting"
          layout="bar"
          action={
            <Link href="/dashboard/my-cv" className={noticeLinkStyles()}>
              Update your CV
            </Link>
          }
        >
          We upgraded how CV files are handled — please re-upload your CV or regenerate it to keep auto-applying.
        </Notice>
      )}
      <main className="px-gutter pb-24 pt-6 sm:px-gutter-lg sm:pb-8 sm:pt-8">{children}</main>
      <Toast />
      <ChatFab />
    </div>
  );
}
