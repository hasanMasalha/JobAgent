// The only way Next.js should call the AI service. It requires
// `X-Internal-Key: <INTERNAL_API_KEY>` on every route except /health (see
// ai-service/internal_auth.py), so a bare fetch() to PYTHON_SERVICE_URL
// would just get 401.

let warnedMissingKey = false;

export function pythonServiceUrl(path: string): string {
  return `${process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000"}${path}`;
}

export function pythonFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const key = process.env.INTERNAL_API_KEY;
  if (!key && !warnedMissingKey) {
    warnedMissingKey = true;
    console.error("[python-service] INTERNAL_API_KEY is not set — the AI service will refuse every request");
  }
  const headers = new Headers(init.headers);
  headers.set("X-Internal-Key", key ?? "");
  return fetch(pythonServiceUrl(path), { ...init, headers });
}
