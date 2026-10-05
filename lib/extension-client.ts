// Browser-side checks on the JobAgent Chrome extension, shared by the apply
// page and batch apply on Matches. Both must know the extension is there and
// new enough BEFORE anything is marked pending or charged an auto-apply.

import { isVersionAtLeast } from "@/lib/extension-version";

export const EXTENSION_ID = process.env.NEXT_PUBLIC_EXTENSION_ID ?? "";

/** The extension's Chrome Web Store page. Linked only after the LinkedIn
 *  automation notice has been accepted (/dashboard/linkedin-extension). */
export const EXTENSION_STORE_URL =
  "https://chromewebstore.google.com/detail/jobagent-%E2%80%94-ai-job-assista/cjcfjidmlmclbemjoobdipjlcdbkldda";

/**
 * The installed extension's version: null if it doesn't answer, "0" if it
 * answers without one (versions before 1.5.0 didn't report it). Asked twice,
 * because the first message can find its service worker still waking up.
 */
export function extensionVersion(): Promise<string | null> {
  const ask = () =>
    new Promise<string | null>((resolve) => {
      if (!EXTENSION_ID || typeof chrome === "undefined" || !chrome?.runtime?.sendMessage) return resolve(null);
      const timer = setTimeout(() => resolve(null), 1500);
      try {
        chrome.runtime.sendMessage(EXTENSION_ID, { type: "PING" }, (response) => {
          clearTimeout(timer);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if ((chrome.runtime as any).lastError) return resolve(null);
          resolve(typeof response?.version === "string" ? response.version : "0");
        });
      } catch {
        clearTimeout(timer);
        resolve(null);
      }
    });
  return ask().then((v) => v ?? ask());
}

/** "ok", or why the extension can't be handed an application. */
export async function extensionReadiness(): Promise<"ok" | "missing" | "outdated"> {
  const version = await extensionVersion();
  if (isVersionAtLeast(version)) return "ok";
  return version ? "outdated" : "missing";
}
