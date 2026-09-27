import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";
import NavBarClient from "./NavBarClient";
import ChatFab from "./ChatFab";
import { Toast } from "@/app/components/Toast";

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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <NavBarClient userEmail={user.email ?? ""} />
      {needsCvReconfirmation && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900">
          <div className="px-4 sm:px-6 py-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="text-amber-800 dark:text-amber-300">
              We upgraded how CV files are handled — please re-upload your CV or regenerate it to keep auto-applying.
            </span>
            <Link
              href="/dashboard/my-cv"
              className="font-medium text-amber-900 dark:text-amber-200 underline underline-offset-2 hover:no-underline"
            >
              Update your CV →
            </Link>
          </div>
        </div>
      )}
      <main className="px-4 py-4 sm:px-6 sm:py-6">{children}</main>
      <Toast />
      <ChatFab />
    </div>
  );
}
