import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";
import LogoutButton from "./LogoutButton";
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
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="font-semibold text-sm">JobAgent</span>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/dashboard" className="text-gray-600 hover:text-gray-900 transition-colors">Jobs</Link>
            <Link href="/dashboard/applications" className="text-gray-600 hover:text-gray-900 transition-colors">Applications</Link>
            <Link href="/dashboard/saved" className="text-gray-600 hover:text-gray-900 transition-colors">Saved</Link>
            <Link href="/dashboard/onboarding" className="text-gray-600 hover:text-gray-900 transition-colors">Update profile</Link>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">
            {user.email?.split("@")[0]}
          </span>
          <LogoutButton />
        </div>
      </nav>
      <main className="p-6">{children}</main>
      <Toast />
      <ChatFab />
    </div>
  );
}
