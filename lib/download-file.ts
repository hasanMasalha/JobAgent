// Browser-side: fetch a file from one of our download routes and save it
// under the name the server gave it (Content-Disposition), so a CV comes down
// as .pdf, .docx or the user's own upload without the page guessing.
// Throws with the route's error message when it refuses.
export async function downloadFile(url: string, fallbackName: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filenameFrom(res.headers.get("Content-Disposition")) ?? fallbackName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

// filename* (UTF-8, RFC 5987) when present, else the ASCII filename.
export function filenameFrom(disposition: string | null): string | null {
  if (!disposition) return null;
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // fall through to the ASCII name
    }
  }
  return disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? null;
}
