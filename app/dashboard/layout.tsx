import { redirect } from "next/navigation";
import { headers } from "next/headers";
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

  if (!isOnboarding) {
    const cvRows = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM "CV" WHERE user_id = ${user.id} LIMIT 1
    `;
    if (cvRows.length === 0) {
      redirect("/dashboard/onboarding");
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <NavBarClient userEmail={user.email ?? ""} />
      <main className="px-4 py-4 sm:px-6 sm:py-6">{children}</main>
      <Toast />
      <ChatFab />
    </div>
  );
}
