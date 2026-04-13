"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function PreferencesContent() {
  const searchParams = useSearchParams();
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [unsubscribed, setUnsubscribed] = useState(false);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d) => {
        if (typeof d.email_notifications === "boolean") {
          setEmailNotifications(d.email_notifications);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  // Auto-unsubscribe when ?unsubscribe=true is in URL
  useEffect(() => {
    if (searchParams.get("unsubscribe") === "true" && !loading) {
      handleToggle(false);
      setUnsubscribed(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  async function handleToggle(value: boolean) {
    setEmailNotifications(value);
    setSaving(true);
    try {
      await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email_notifications: value }),
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-lg mx-auto mt-20 text-center">
        <div className="inline-block w-6 h-6 border-4 border-black border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-xl font-semibold text-gray-900 mb-6">Preferences</h1>

      {unsubscribed && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-800">
          You&apos;ve been unsubscribed from daily emails.
        </div>
      )}

      <div className="bg-white border rounded-xl divide-y">
        {/* Email notifications toggle */}
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <p className="text-sm font-medium text-gray-900">Daily match emails</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Get an email when new jobs are found
            </p>
          </div>
          <button
            onClick={() => handleToggle(!emailNotifications)}
            disabled={saving}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none disabled:opacity-60 ${
              emailNotifications ? "bg-black" : "bg-gray-200"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                emailNotifications ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      </div>

      <p className="mt-4 text-xs text-gray-400 text-center">
        {emailNotifications
          ? "You will receive an email each morning when new job matches are found."
          : "You will not receive daily match emails."}
      </p>
    </div>
  );
}

export default function PreferencesPage() {
  return (
    <Suspense fallback={
      <div className="max-w-lg mx-auto mt-20 text-center">
        <div className="inline-block w-6 h-6 border-4 border-black border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <PreferencesContent />
    </Suspense>
  );
}
