jest.mock("@/lib/python-service", () => ({ pythonFetch: jest.fn() }));
jest.mock("@/lib/generate-cv", () => ({ generateCVDocx: jest.fn(async () => Buffer.from("docx")) }));

import { renderCvFile } from "@/lib/cv-file";
import { pythonFetch } from "@/lib/python-service";

const fetchMock = pythonFetch as jest.Mock;

describe("renderCvFile", () => {
  beforeEach(() => fetchMock.mockReset());

  it("returns the PDF the AI service renders", async () => {
    fetchMock.mockResolvedValue(new Response(Buffer.from("%PDF"), { status: 200 }));
    const file = await renderCvFile("Dana\nd@x.com\n", "pdf");
    expect(file.extension).toBe("pdf");
  });

  it("falls back to Word when the PDF can't set the CV's script", async () => {
    // A CV in a script neither PDF font has (e.g. Arabic) — Word picks a font that has it.
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ detail: "unsupported_script" }), { status: 422 }));
    const file = await renderCvFile("اسم\nd@x.com\n", "pdf");
    expect(file.extension).toBe("docx");
  });

  it("still fails on any other error", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ detail: [] }), { status: 422 }));
    await expect(renderCvFile("Dana\n", "pdf")).rejects.toThrow("CV PDF render failed (422)");
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    await expect(renderCvFile("Dana\n", "pdf")).rejects.toThrow("CV PDF render failed (500)");
  });
});
