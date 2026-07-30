import type { ReactNode } from "react";

export function LegalHeader({ title, lastUpdated }: { title: string; lastUpdated: string }) {
  return (
    <div className="mb-10">
      <h1 className="text-3xl font-semibold text-gray-900 dark:text-white">{title}</h1>
      <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">Last updated: {lastUpdated}</p>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold text-[#1a2e5e] dark:text-blue-400 mb-3">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
        {children}
      </div>
    </section>
  );
}

export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc list-inside space-y-1.5 marker:text-gray-400 dark:marker:text-gray-500">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
