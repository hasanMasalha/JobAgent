"use client";

import { useEffect, useState } from "react";

export type ToastType = "success" | "error";

interface ToastState {
  message: string;
  type: ToastType;
  id: number;
}

let _counter = 0;
let _setToast: ((t: ToastState | null) => void) | null = null;

export function showToast(message: string, type: ToastType = "success") {
  _setToast?.({ message, type, id: ++_counter });
}

export function Toast() {
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    _setToast = setToast;
    return () => {
      _setToast = null;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!toast) return null;

  return (
    <div
      key={toast.id}
      role={toast.type === "error" ? "alert" : "status"}
      className={`fixed bottom-24 right-4 sm:right-5 z-[60] flex max-w-[calc(100vw-2rem)] items-center gap-3 px-4 py-3 rounded-card shadow-overlay font-sans text-sm font-medium text-surface motion-safe:animate-fade-in ${
        toast.type === "success" ? "bg-success-text" : "bg-danger-text"
      }`}
    >
      <span aria-hidden="true">{toast.type === "success" ? "✓" : "✕"}</span>
      {toast.message}
    </div>
  );
}
