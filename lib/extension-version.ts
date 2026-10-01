import type { NextRequest } from "next/server";

// Extension versions below this answered Easy Apply screening questions with
// values nobody entered: "2" years of experience, salary "1", "Tel Aviv",
// Yes to any yes/no question it didn't recognise, the first option of any
// dropdown. Those versions can't be fixed from the server — the fallbacks are
// in the extension — so the server refuses to hand them an application.
//
// 1.5.0 is the first version that leaves a question blank and stops instead.
// It is also the first that sends this header at all, so a request without it
// is an older version.
export const MIN_EXTENSION_VERSION = "1.5.0";
export const EXTENSION_VERSION_HEADER = "x-jobagent-extension-version";

function parts(version: string): number[] | null {
  if (!/^\d+(\.\d+){0,3}$/.test(version)) return null;
  return version.split(".").map(Number);
}

/** True when `version` is a dotted number at or above `min`. */
export function isVersionAtLeast(version: string | null | undefined, min = MIN_EXTENSION_VERSION): boolean {
  const v = version ? parts(version.trim()) : null;
  const m = parts(min);
  if (!v || !m) return false;
  for (let i = 0; i < Math.max(v.length, m.length); i++) {
    const a = v[i] ?? 0;
    const b = m[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

export function extensionVersionOk(req: NextRequest): boolean {
  return isVersionAtLeast(req.headers.get(EXTENSION_VERSION_HEADER));
}
