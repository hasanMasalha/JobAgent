// Content-Disposition for a file download, keeping the file's own name.
// A header value must be ASCII, so `filename` gets an ASCII stand-in (other
// characters, quotes, backslashes and control characters → "_") and
// `filename*` (RFC 6266 / 5987) carries the real name, UTF-8 encoded — a
// Hebrew CV name would otherwise make the response throw.
// Until 2026-10-12 the CV route stripped with /["\\r\n]/, which in a regex
// class is a backslash and the letter "r": "resume.docx" became "_esume.docx".
export function attachmentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
