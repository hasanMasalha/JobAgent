import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@/lib/supabase.server";
import LogoutButton from "./LogoutButton";
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

  return (
    <div className="min-h-screen">
      <nav className="bg-white border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="font-semibold text-sm">JobAgent</span>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/dashboard" className="text-gray-600 hover:text-gray-900 transition-colors">Jobs</Link>
            <Link href="/dashboard/applications" className="text-gray-600 hover:text-gray-900 transition-colors">Applications</Link>
            <Link href="/dashboard/chat" className="text-gray-600 hover:text-gray-900 transition-colors">Chat</Link>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">{user.email}</span>
          <LogoutButton />
        </div>
      </nav>
      <main className="p-6">{children}</main>
      <Toast />
    </div>
  );
}
