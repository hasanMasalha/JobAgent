// chrome-extension/background.js, Greenhouse applications (1.6.0). Every
// application the site hands over was charged an auto-apply, so every way it
// can end must report back — "manual" refunds it:
//   - the form has to be on greenhouse.io, or nothing is opened;
//   - without access to Greenhouse's pages it asks (grant.html), and a refusal
//     hands the application back;
//   - closing the tab hands it back;
//   - only the application's own tab can report its result;
//   - one at a time: a second one is refused, and the site refunds it.

import { attachmentDisposition } from "@/lib/content-disposition";

type Listener = (...args: unknown[]) => unknown;

interface Call {
  url: string;
  init?: { method?: string; body?: string; headers?: Record<string, string> };
}

function setup({
  permission = true,
  formUrl = "https://job-boards.greenhouse.io/acme/jobs/1",
  ats = "greenhouse",
  cvDisposition = 'attachment; filename="Dana_CV.pdf"',
} = {}) {
  const store: Record<string, unknown> = { extensionToken: "tok", serverUrl: "https://jobagent.uk" };
  const listeners = { message: [] as Listener[], external: [] as Listener[], updated: [] as Listener[], removed: [] as Listener[] };
  const tabs = new Map<number, { id: number; url: string; status: string }>();
  let nextTab = 10;
  const calls: Call[] = [];

  const area = (data: Record<string, unknown>) => ({
    get: async (keys: string[] | string) => {
      const out: Record<string, unknown> = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) if (k in data) out[k] = data[k];
      return out;
    },
    set: async (obj: Record<string, unknown>) => void Object.assign(data, obj),
    remove: async (keys: string[] | string) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    },
  });

  const chrome = {
    runtime: {
      getManifest: () => ({ version: "1.6.1" }),
      getURL: (p: string) => `chrome-extension://ext/${p}`,
      onMessage: { addListener: (l: Listener) => listeners.message.push(l) },
      onMessageExternal: { addListener: (l: Listener) => listeners.external.push(l) },
    },
    storage: { local: area(store), session: area({}) },
    tabs: {
      create: jest.fn(async ({ url }: { url: string }) => {
        const tab = { id: nextTab++, url, status: "loading" };
        tabs.set(tab.id, tab);
        return tab;
      }),
      update: jest.fn(async (id: number, { url }: { url?: string }) => {
        const tab = tabs.get(id);
        if (!tab) throw new Error("no tab");
        if (url) Object.assign(tab, { url, status: "loading" });
        return tab;
      }),
      get: jest.fn(async (id: number) => {
        const tab = tabs.get(id);
        if (!tab) throw new Error("no tab");
        return tab;
      }),
      remove: jest.fn(),
      onUpdated: { addListener: (l: Listener) => listeners.updated.push(l) },
      onRemoved: { addListener: (l: Listener) => listeners.removed.push(l) },
    },
    permissions: { contains: jest.fn(async () => permission) },
    scripting: { executeScript: jest.fn(async () => []) },
    notifications: { create: jest.fn() },
  };

  const fetchMock = jest.fn(async (url: string, init?: Call["init"]) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const json = (body: unknown, ok = true) => ({
      ok, status: ok ? 200 : 404, json: async () => body, text: async () => JSON.stringify(body),
      headers: { get: () => null },
    });
    if (path === "/api/apply/ats-package/app-1") return json({ ats, form_url: formUrl });
    if (path === "/api/apply/ats-package/app-1/cv") {
      return {
        ok: true, status: 200,
        headers: { get: (h: string) => (h === "Content-Type" ? "application/pdf" : cvDisposition) },
        arrayBuffer: async () => new TextEncoder().encode("%PDF").buffer,
      };
    }
    if (path === "/api/apply/form-answers/app-1") return json({ supported: true, questions: [], answers: [], missing: [] });
    return json({ success: true });
  });

  Object.assign(globalThis, { chrome, fetch: fetchMock });
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../../chrome-extension/background.js");
  });

  const flush = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const respond = (ls: Listener[], message: unknown, sender: unknown) =>
    new Promise<unknown>((resolve) => {
      let answered = false;
      for (const l of ls) {
        const keep = l(message, sender, (r: unknown) => {
          answered = true;
          resolve(r);
        });
        if (answered) return;
        if (keep === true) return;
      }
      resolve(undefined);
    });

  return {
    store, tabs, calls, chrome, flush,
    external: (message: unknown) => respond(listeners.external, message, { url: "https://jobagent.uk/dashboard/matches" }),
    fromTab: (tabId: number, message: unknown) => respond(listeners.message, message, { tab: { id: tabId } }),
    loaded: async (tabId: number) => {
      const tab = tabs.get(tabId)!;
      tab.status = "complete";
      for (const l of listeners.updated) await l(tabId, { status: "complete" }, tab);
      await flush();
    },
    closed: async (tabId: number) => {
      tabs.delete(tabId);
      for (const l of listeners.removed) await l(tabId);
      await flush();
    },
    statusReports: () =>
      calls
        .filter((c) => c.url.endsWith("/api/applications/update-status"))
        .map((c) => JSON.parse(c.init!.body!)),
  };
}

describe("background.js — Greenhouse applications", () => {
  it("opens the Greenhouse form and starts greenhouse.js on it", async () => {
    const t = setup();
    expect(await t.external({ type: "START_ATS_APPLY", applicationId: "app-1" })).toEqual({ success: true });
    await t.flush();
    const tab = Array.from(t.tabs.values())[0];
    expect(tab.url).toBe("https://job-boards.greenhouse.io/acme/jobs/1");
    await t.loaded(tab.id);
    expect(t.chrome.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: tab.id }, files: ["greenhouse.js"] });
    expect(await t.fromTab(tab.id, { type: "ATS_GET_STATE" })).toMatchObject({ applicationId: "app-1", phase: "filling" });
    expect(t.statusReports()).toEqual([]);
  });

  it("opens nothing for a form that isn't on greenhouse.io, and hands the application back", async () => {
    const t = setup({ formUrl: "https://careers.acme.com/jobs/1?gh_jid=1" });
    await t.external({ type: "START_ATS_APPLY", applicationId: "app-1" });
    await t.flush();
    expect(t.tabs.size).toBe(0);
    expect(t.statusReports()).toEqual([
      { applicationId: "app-1", status: "manual", reason: "form_not_found", detail: "package ats=greenhouse form_url=https://careers.acme.com/jobs/1?gh_jid=1" },
    ]);
  });

  it("asks for access to Greenhouse first; a refusal hands the application back", async () => {
    const t = setup({ permission: false });
    await t.external({ type: "START_ATS_APPLY", applicationId: "app-1" });
    await t.flush();
    const grant = Array.from(t.tabs.values())[0];
    expect(grant.url).toBe("chrome-extension://ext/grant.html");
    // Not from the grant tab: ignored.
    expect(await t.fromTab(999, { type: "ATS_PERMISSION_RESULT", granted: true })).toEqual({ ok: false });
    await t.fromTab(grant.id, { type: "ATS_PERMISSION_RESULT", granted: false });
    await t.flush();
    expect(t.statusReports()).toEqual([{ applicationId: "app-1", status: "manual", reason: "permission_denied" }]);
    expect(t.store.atsApply).toBeUndefined();
  });

  it("opens the form in the grant tab once access is given", async () => {
    const t = setup({ permission: false });
    await t.external({ type: "START_ATS_APPLY", applicationId: "app-1" });
    await t.flush();
    const grant = Array.from(t.tabs.values())[0];
    await t.fromTab(grant.id, { type: "ATS_PERMISSION_RESULT", granted: true });
    await t.flush();
    expect(t.tabs.get(grant.id)!.url).toBe("https://job-boards.greenhouse.io/acme/jobs/1");
    expect(t.statusReports()).toEqual([]);
  });

  it("hands the application back when its tab is closed", async () => {
    const t = setup();
    await t.external({ type: "START_ATS_APPLY", applicationId: "app-1" });
    await t.flush();
    await t.closed(Array.from(t.tabs.keys())[0]);
    expect(t.statusReports()).toEqual([{ applicationId: "app-1", status: "manual", reason: "tab_closed" }]);
  });

  it("takes one at a time", async () => {
    const t = setup();
    await t.external({ type: "START_ATS_APPLY", applicationId: "app-1" });
    await t.flush();
    expect(await t.external({ type: "START_ATS_APPLY", applicationId: "app-2" })).toEqual({ success: false });
  });

  it("takes a result only from the application's own tab, with the questions to ask", async () => {
    const t = setup();
    await t.external({ type: "START_ATS_APPLY", applicationId: "app-1" });
    await t.flush();
    const tabId = Array.from(t.tabs.keys())[0];
    expect(await t.fromTab(tabId + 1, { type: "ATS_RESULT", status: "applied" })).toBeNull();
    expect(await t.fromTab(tabId + 1, { type: "ATS_GET_DATA" })).toBeNull();
    await t.fromTab(tabId, {
      type: "ATS_RESULT", status: "manual", reason: "missing_answers", detail: "Current employer",
      missingQuestions: [{ question: "Current employer", options: [] }],
    });
    await t.flush();
    // The reason and its detail are kept with the application.
    expect(t.statusReports()).toEqual([
      {
        applicationId: "app-1", status: "manual", reason: "missing_answers", detail: "Current employer",
        missingQuestions: [{ question: "Current employer", options: [] }],
      },
    ]);
  });

  it("gives greenhouse.js the answers and the CV file", async () => {
    const t = setup();
    await t.external({ type: "START_ATS_APPLY", applicationId: "app-1" });
    await t.flush();
    const data = await t.fromTab(Array.from(t.tabs.keys())[0], { type: "ATS_GET_DATA" });
    expect(data).toMatchObject({
      ok: true,
      cv: { filename: "Dana_CV.pdf", mimeType: "application/pdf", base64: Buffer.from("%PDF").toString("base64") },
    });
    // Every call carries the extension token and version.
    for (const c of t.calls) {
      expect(c.init?.headers).toMatchObject({ Authorization: "Bearer tok", "X-JobAgent-Extension-Version": "1.6.1" });
    }
  });

  it("keeps the CV's own file name, letters and Hebrew included", async () => {
    // The real header the CV route sends.
    for (const name of ["Hasan.Masalha resume.docx", "קורות חיים.pdf"]) {
      const t = setup({ cvDisposition: attachmentDisposition(name) });
      await t.external({ type: "START_ATS_APPLY", applicationId: "app-1" });
      await t.flush();
      const data = await t.fromTab(Array.from(t.tabs.keys())[0], { type: "ATS_GET_DATA" });
      expect(data).toMatchObject({ cv: { filename: name } });
    }
  });

  it("reports a submission that leaves greenhouse.io as unconfirmed", async () => {
    const t = setup();
    await t.external({ type: "START_ATS_APPLY", applicationId: "app-1" });
    await t.flush();
    const tabId = Array.from(t.tabs.keys())[0];
    await t.fromTab(tabId, { type: "ATS_SUBMITTING", textBefore: "form" });
    t.tabs.get(tabId)!.url = "https://careers.acme.com/thanks";
    await t.loaded(tabId);
    expect(t.statusReports()).toEqual([{ applicationId: "app-1", status: "manual", reason: "submit_unconfirmed" }]);
  });
});
