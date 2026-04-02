"use client";

import { usePathname, useRouter } from "next/navigation";

export default function ChatFab() {
  const router = useRouter();
  const pathname = usePathname();
  if (pathname === "/dashboard/chat") return null;
  return (
    <button
      onClick={() => router.push("/dashboard/chat")}
      title="Chat with AI"
      className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-full shadow-lg flex items-center justify-center transition-all"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
        <path fillRule="evenodd" d="M4.848 2.771A49.144 49.144 0 0 1 12 2.25c2.43 0 4.817.178 7.152.52 1.978.292 3.348 2.024 3.348 3.97v6.02c0 1.946-1.37 3.678-3.348 3.97a48.901 48.901 0 0 1-3.476.383.39.39 0 0 0-.297.155L9.18 21.53A.75.75 0 0 1 8 21v-3.545a48.166 48.166 0 0 1-3.152-.385c-1.978-.292-3.348-2.024-3.348-3.97V6.741c0-1.946 1.37-3.678 3.348-3.97Z" clipRule="evenodd" />
      </svg>
    </button>
  );
}
