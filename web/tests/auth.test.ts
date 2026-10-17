import { describe, expect, it, vi } from "vitest";
import { AuthApi, AuthController, parseSession } from "../src/acenta/auth";
import { ApiError, type Transport } from "../src/acenta/api";
import { FixtureServer, planning, session as identity } from "./acenta-fixtures";
import { EditorExitGuard } from "../src/acenta/editor-exit";
import { waterSource } from "../src/acenta/contracts";
const session = {
  principal_id: identity.actorId,
  scope_id: identity.scopeId,
  csrf_token: "session-csrf",
};
const bootstrap = {
  csrf_token: "pre-csrf",
  google_nonce: "nonce",
  google_client_id: "test-client",
  email_available: true,
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function setup() {
  let active: typeof session | null = null;
  const privateServer = new FixtureServer();
  const transport = vi.fn<Transport>(async (input, init) => {
    switch (String(input)) {
      case "/auth/session":
        return active ? json(active) : json({ detail: "unauthorized" }, 401);
      case "/auth/bootstrap":
        return json(bootstrap);
      case "/auth/email/request":
        return json(
          {
            challenge_id: "challenge",
            message:
              "Si el correo puede recibir mensajes, recibirás un código.",
          },
          202,
        );
      case "/auth/email/verify":
      case "/auth/google":
        active = session;
        return json(active);
      case "/auth/logout":
        active = null;
        return new Response(null, { status: 204 });
      default:
        return privateServer.transport(input, init);
    }
  });
  const auth = new AuthController(new AuthApi(transport));
  return {
    auth,
    transport,
    privateServer,
    setSession: (value: typeof session | null) => {
      active = value;
    },
  };
}
describe("real session boundary", () => {
  it("rejects malformed identity and absent CSRF", () => {
    for (const value of [
      null,
      {},
      { ...session, csrf_token: "" },
      { ...session, principal_id: "admin" },
    ])
      expect(() => parseSession(value)).toThrow(ApiError);
  });
  it("bootstraps anonymously after 401, never creating a workspace", async () => {
    const s = setup();
    await s.auth.start();
    expect(s.transport.mock.calls.map(([path]) => path)).toEqual([
      "/auth/session",
      "/auth/bootstrap",
    ]);
    expect(s.auth.snapshot()).toMatchObject({
      phase: "access",
      bootstrap,
      controller: null,
    });
  });
  it("recovers a valid session on reload without a pre-session", async () => {
    const s = setup();
    s.setSession(session);
    await s.auth.start();
    expect(s.transport).toHaveBeenCalledTimes(1);
    expect(s.auth.snapshot()).toMatchObject({
      phase: "ready",
      bootstrap: null,
    });
    expect(s.auth.snapshot().controller!.api.session).toEqual(identity);
  });
  it("reports service failure without claiming a login or OTP delivery", async () => {
    const s = setup();
    s.transport.mockImplementation(async () =>
      json({ detail: "unavailable" }, 503),
    );
    await s.auth.start();
    expect(s.auth.snapshot()).toMatchObject({
      phase: "access",
      controller: null,
      bootstrap: null,
      busy: false,
    });
    expect(s.auth.snapshot().error).toContain("no está disponible");
  });
  it("keeps runtime methods unavailable when bootstrap says so", async () => {
    const s = setup();
    s.transport.mockImplementation(async (input) =>
      String(input).endsWith("session")
        ? json({}, 401)
        : json({
            ...bootstrap,
            email_available: false,
            google_client_id: null,
          }),
    );
    await s.auth.start();
    await s.auth.requestCode("a@example.test");
    await s.auth.login("google", "credential");
    expect(s.transport).toHaveBeenCalledTimes(2);
    expect(s.auth.snapshot().controller).toBeNull();
  });
  it("uses pre-CSRF for OTP and session-CSRF only for private writes/logout", async () => {
    const s = setup();
    await s.auth.start();
    await s.auth.requestCode("teacher@example.test");
    await s.auth.login("code", "12345678");
    const controller = s.auth.snapshot().controller!;
    await controller.api.createSource(waterSource, crypto.randomUUID());
    await controller.api.list();
    await s.auth.logout();
    const requests = s.transport.mock.calls;
    for (const [, init] of requests) {
      expect(init?.credentials).toBe("same-origin");
      expect(init?.cache).toBe("no-store");
    }
    expect(
      new Headers(
        requests.find(([p]) => p === "/auth/email/request")![1]?.headers,
      ).get("X-CSRF-Token"),
    ).toBe("pre-csrf");
    expect(
      new Headers(
        requests.find(([p]) => p === "/auth/email/verify")![1]?.headers,
      ).get("X-CSRF-Token"),
    ).toBe("pre-csrf");
    expect(
      new Headers(
        requests.find(([p]) => String(p).endsWith("/sources"))![1]?.headers,
      ).get("X-CSRF-Token"),
    ).toBe("session-csrf");
    expect(
      new Headers(
        requests.find(([p]) => p === "/auth/logout")![1]?.headers,
      ).get("X-CSRF-Token"),
    ).toBe("session-csrf");
    expect(
      requests
        .filter(([, i]) => i?.method === "GET")
        .every(([, i]) => !new Headers(i?.headers).has("X-CSRF-Token")),
    ).toBe(true);
    expect(controller.snapshot()).toMatchObject({
      closed: true,
      prompt: "",
      editor: null,
      items: [],
      drafts: [],
    });
  });
  it("submits Google credentials only to the same-origin auth endpoint", async () => {
    const s = setup();
    await s.auth.start();
    await s.auth.login("google", "opaque-test-token");
    const call = s.transport.mock.calls.find(
      ([path]) => path === "/auth/google",
    )!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      credential: "opaque-test-token",
    });
    expect(s.auth.snapshot().phase).toBe("ready");
  });
  it("rejects invalid OTP without constructing a controller", async () => {
    const s = setup();
    await s.auth.start();
    await s.auth.requestCode("teacher@example.test");
    s.transport.mockResolvedValueOnce(json({ detail: "invalid_code" }, 400));
    await s.auth.login("code", "00000000");
    expect(s.auth.snapshot().error).toContain("no es válido");
    expect(s.auth.snapshot().controller).toBeNull();
    expect(s.auth.snapshot().challenge).not.toBeNull();
  });
  it("suppresses duplicate submissions while requesting a code", async () => {
    const s = setup();
    await s.auth.start();
    let resolve!: (r: Response) => void;
    s.transport.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = s.auth.requestCode("teacher@example.test");
    await s.auth.requestCode("teacher@example.test");
    expect(s.transport).toHaveBeenCalledTimes(3);
    resolve(json({ challenge_id: "challenge", message: "generic" }, 202));
    await pending;
  });
  it("clears old challenges when resending fails", async () => {
    const s = setup();
    await s.auth.start();
    await s.auth.requestCode("teacher@example.test");
    s.transport.mockResolvedValueOnce(json({ detail: "rate_limited" }, 429));
    await s.auth.requestCode("teacher@example.test");
    expect(s.auth.snapshot().challenge).toBeNull();
    expect(s.auth.snapshot().error).toContain("Demasiados intentos");
  });
  it("discards stale login replies after a newer bootstrap", async () => {
    const s = setup();
    await s.auth.start();
    let resolve!: (r: Response) => void;
    s.transport.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = s.auth.login("google", "opaque");
    await s.auth.start();
    resolve(json(session));
    await pending;
    expect(s.auth.snapshot().phase).toBe("access");
    expect(s.auth.snapshot().controller).toBeNull();
  });
  it("removes private state immediately when logout cannot be confirmed, then allows retry", async () => {
    const s = setup();
    s.setSession(session);
    await s.auth.start();
    const previous = s.auth.snapshot().controller!;
    previous.useExample();
    s.transport.mockRejectedValueOnce(new Error("network"));
    await s.auth.logout();
    expect(previous.snapshot()).toMatchObject({
      closed: true,
      prompt: "",
      editor: null,
    });
    expect(s.auth.snapshot()).toMatchObject({
      phase: "logout-error",
      controller: null,
      bootstrap: null,
    });
    await s.auth.logout();
    expect(s.auth.snapshot().phase).toBe("access");
  });
  it("treats logout 401 as already ended", async () => {
    const s = setup();
    s.setSession(session);
    await s.auth.start();
    s.transport.mockResolvedValueOnce(json({ detail: "unauthorized" }, 401));
    await s.auth.logout();
    expect(s.auth.snapshot().phase).toBe("access");
  });
  it("clears private state on session expiry and blocks an old controller's requests", async () => {
    const s = setup();
    s.setSession(session);
    await s.auth.start();
    const previous = s.auth.snapshot().controller!;
    previous.useExample();
    s.setSession(null);
    await s.auth.revalidate();
    expect(previous.snapshot()).toMatchObject({
      closed: true,
      prompt: "",
      items: [],
      drafts: [],
    });
    expect(s.auth.snapshot()).toMatchObject({
      phase: "access",
      controller: null,
    });
    const count = s.transport.mock.calls.length;
    await expect(previous.api.list()).rejects.toThrow();
    expect(s.transport).toHaveBeenCalledTimes(count);
  });
  it("replaces an account's entire controller after a cross-tab account switch", async () => {
    const s = setup();
    s.setSession(session);
    await s.auth.start();
    const previous = s.auth.snapshot().controller!;
    previous.useExample();
    const next = {
      principal_id: crypto.randomUUID(),
      scope_id: crypto.randomUUID(),
      csrf_token: "new-csrf",
    };
    s.setSession(next);
    await s.auth.revalidate();
    expect(previous.snapshot().closed).toBe(true);
    expect(s.auth.snapshot().controller!.api.session.actorId).toBe(
      next.principal_id,
    );
    expect(s.auth.snapshot().controller!.snapshot()).toMatchObject({
      prompt: "",
      editor: null,
      items: [],
      drafts: [],
    });
  });
  it("a private 401 removes stale state before its operation can present a result", async () => {
    const s = setup();
    s.setSession(session);
    await s.auth.start();
    const previous = s.auth.snapshot().controller!;
    s.transport.mockResolvedValueOnce(json({ detail: "unauthorized" }, 401));
    await previous.loadResources();
    expect(previous.snapshot().closed).toBe(true);
    expect(s.auth.snapshot().controller).toBeNull();
  });
  it("renews an expired pre-session after a rejected email request", async () => {
    const s = setup();
    await s.auth.start();
    s.transport.mockResolvedValueOnce(json({ detail: "csrf_failed" }, 403));
    await s.auth.requestCode("teacher@example.test");
    expect(s.transport.mock.calls.at(-1)![0]).toBe("/auth/bootstrap");
    expect(s.auth.snapshot()).toMatchObject({
      bootstrap,
      challenge: null,
      busy: false,
    });
  });
  it("reconciles a lost login response using the actual server session", async () => {
    const s = setup();
    await s.auth.start();
    s.transport.mockImplementationOnce(async () => {
      s.setSession(session);
      throw new Error("lost response");
    });
    await s.auth.login("google", "opaque");
    expect(s.transport.mock.calls.at(-1)![0]).toBe("/auth/session");
    expect(s.auth.snapshot().phase).toBe("ready");
  });
  it("a late cross-tab session check cannot reopen private UI during logout", async () => {
    const s = setup();
    s.setSession(session);
    await s.auth.start();
    const previous = s.auth.snapshot().controller!;
    let resolve!: (r: Response) => void;
    s.transport.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const check = s.auth.revalidate();
    s.transport.mockRejectedValueOnce(new Error("offline"));
    await s.auth.logout();
    resolve(json({ ...session, csrf_token: "rotated" }));
    await check;
    expect(s.auth.snapshot()).toMatchObject({
      phase: "logout-error",
      controller: null,
    });
    const calls = s.transport.mock.calls.length;
    await expect(previous.api.list()).rejects.toThrow();
    await s.auth.start();
    expect(s.transport).toHaveBeenCalledTimes(calls);
  });
  for (const failure of ["network", "503", "malformed"] as const) {
    it(`preserves an unsaved editor through ${failure} session uncertainty and resumes only after confirmation`, async () => {
      const s = setup();
      s.setSession(session);
      await s.auth.start();
      const controller = s.auth.snapshot().controller!;
      controller.useExample();
      await controller.attach(waterSource);
      await controller.submit();
      controller.openEditor();
      controller.edit("Texto privado aún sin guardar");
      const before = controller.snapshot();
      if (failure === "network")
        s.transport.mockRejectedValueOnce(new Error("offline"));
      else
        s.transport.mockResolvedValueOnce(
          failure === "503"
            ? json({ detail: "unavailable" }, 503)
            : json({ invalid: true }),
        );
      await s.auth.revalidate();
      expect(s.auth.snapshot()).toMatchObject({
        phase: "suspended",
        controller,
      });
      expect(controller.snapshot()).toBe(before);
      const count = s.transport.mock.calls.length;
      await expect(
        controller.api.createSource(waterSource, crypto.randomUUID()),
      ).rejects.toThrow();
      expect(s.transport).toHaveBeenCalledTimes(count);
      await s.auth.revalidate();
      expect(s.auth.snapshot()).toMatchObject({ phase: "ready", controller });
      expect(controller.snapshot().editor!.text).toBe(
        "Texto privado aún sin guardar",
      );
    });
  }
  it("clears a suspended private buffer when the server confirms expiry", async () => {
    const s = setup();
    s.setSession(session);
    await s.auth.start();
    const controller = s.auth.snapshot().controller!;
    controller.useExample();
    s.transport.mockRejectedValueOnce(new Error("offline"));
    await s.auth.revalidate();
    s.setSession(null);
    await s.auth.revalidate();
    expect(s.auth.snapshot()).toMatchObject({
      phase: "access",
      controller: null,
    });
    expect(controller.snapshot()).toMatchObject({
      closed: true,
      prompt: "",
      editor: null,
    });
  });
  it("never restores a suspended buffer into a newly confirmed account", async () => {
    const s = setup();
    s.setSession(session);
    await s.auth.start();
    const controller = s.auth.snapshot().controller!;
    controller.useExample();
    s.transport.mockRejectedValueOnce(new Error("offline"));
    await s.auth.revalidate();
    const next = {
      principal_id: crypto.randomUUID(),
      scope_id: crypto.randomUUID(),
      csrf_token: "next",
    };
    s.setSession(next);
    await s.auth.revalidate();
    expect(controller.snapshot()).toMatchObject({
      closed: true,
      prompt: "",
      editor: null,
    });
    expect(s.auth.snapshot().controller!.api.session.actorId).toBe(
      next.principal_id,
    );
    expect(s.auth.snapshot().controller!.snapshot()).toMatchObject({
      prompt: "",
      editor: null,
    });
  });
  it("a confirmed draft remains recoverable when the subsequent logout fails", async () => {
    const s = setup(); s.setSession(session); await s.auth.start();
    const controller = s.auth.snapshot().controller!, document = planning();
    s.privateServer.put(document); controller.openEditor(document); controller.edit("Borrador antes de salir");
    let logout: Promise<void> | undefined;
    const guard = new EditorExitGuard(controller, () => {
      s.transport.mockRejectedValueOnce(new Error("logout offline"));
      logout = s.auth.logout();
    });
    guard.request(); await guard.preserve(); await logout;
    expect(s.auth.snapshot()).toMatchObject({ phase: "logout-error", controller: null });
    expect(controller.snapshot().closed).toBe(true);
    const draft = [...s.privateServer.drafts.values()][0];
    expect(draft.request.text).toBe("Borrador antes de salir");
    expect(draft.receipt.planning_id).toBe(document.receipt.planning_id);
    expect(s.privateServer.docs.get(document.receipt.planning_id)).toEqual(document);
    const paths = s.transport.mock.calls.map(([path]) => String(path));
    expect(paths.findIndex((path) => path.includes("/drafts/"))).toBeLessThan(paths.indexOf("/auth/logout"));
    await s.auth.logout(); expect(s.auth.snapshot().phase).toBe("access");
    await s.auth.login("google", "synthetic");
    const next = s.auth.snapshot().controller!;
    await next.openDraft(draft.receipt.draft_id);
    expect(next.snapshot().editor!.text).toBe("Borrador antes de salir");
  });
  it("a late draft confirmation from account A cannot log out account B", async () => {
    const s = setup(); s.setSession(session); await s.auth.start();
    const previous = s.auth.snapshot().controller!, document = planning();
    s.privateServer.put(document); previous.openEditor(document); previous.edit("Borrador de A");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    s.privateServer.before = async () => { await gate; };
    const exit = vi.fn(() => { void s.auth.logout(); });
    const guard = new EditorExitGuard(previous, exit);
    guard.request(); const saving = guard.preserve();
    const other = { principal_id: crypto.randomUUID(), scope_id: crypto.randomUUID(), csrf_token: "csrf-b" };
    s.setSession(other); await s.auth.revalidate(); guard.dispose();
    release(); await saving;
    expect(exit).not.toHaveBeenCalled();
    expect(s.auth.snapshot().phase).toBe("ready");
    expect(s.auth.snapshot().controller!.api.session.actorId).toBe(other.principal_id);
    expect(s.transport.mock.calls.some(([path]) => path === "/auth/logout")).toBe(false);
  });

});


it("parses optional recovery context without granting it authority", () => {
 expect(parseSession(session).recovery_context_id).toBeNull();
 expect(parseSession({...session,recovery_context_id:null}).recovery_context_id).toBeNull();
 const id=crypto.randomUUID(); expect(parseSession({...session,recovery_context_id:id}).recovery_context_id).toBe(id);
 expect(()=>parseSession({...session,recovery_context_id:"token"})).toThrow();
});
it("hidden invalidates an old check and its finally cannot reopen or unlock the new check", async () => {
 const s=setup(); s.setSession(session); await s.auth.start();
 let old!: (value:Response)=>void, current!: (value:Response)=>void;
 s.transport.mockImplementationOnce(()=>new Promise(r=>old=r));
 const oldCheck=s.auth.revalidate(); s.auth.suspend();
 expect(s.auth.snapshot().phase).toBe("suspended");
 s.transport.mockImplementationOnce(()=>new Promise(r=>current=r));
 const newCheck=s.auth.revalidate();
 old(json(session)); await oldCheck; expect(s.auth.snapshot().phase).toBe("suspended");
 const count=s.transport.mock.calls.length; void s.auth.revalidate(); expect(s.transport).toHaveBeenCalledTimes(count);
 current(json(session)); await newCheck; expect(s.auth.snapshot().phase).toBe("ready");
});


it("periodic observational checks keep the workspace mounted while same-session authority is checked",async()=>{
 const s=setup();s.setSession(session);await s.auth.start();const c=s.auth.snapshot().controller!;
 let release!:(r:Response)=>void;s.transport.mockImplementationOnce(()=>new Promise(r=>release=r));
 const states:string[]=[];const unsubscribe=s.auth.subscribe(()=>states.push(s.auth.snapshot().phase));
 const checking=s.auth.revalidate();expect(s.auth.snapshot().phase).toBe("ready");
 expect(s.auth.snapshot().controller).toBe(c);release(json(session));await checking;
 expect(states).not.toContain("suspended");unsubscribe();
});

for (const method of ["google", "code"] as const) {
  for (const activatedBeforeReply of [false, true]) {
    it(`${method} login crossing pagehide requires a fresh session check ${activatedBeforeReply ? "after" : "before"} activation`, async () => {
      const s = setup();
      await s.auth.start();
      if (method === "code") await s.auth.requestCode("fixture@example.test");
      const access = s.auth.snapshot();
      let release!: (response: Response) => void;
      s.transport.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
      const login = s.auth.login(method, "synthetic");
      s.auth.suspend();
      expect(s.auth.snapshot()).toMatchObject({ phase: "access", busy: true, bootstrap: access.bootstrap, challenge: access.challenge });
      if (activatedBeforeReply) await s.auth.revalidate(true);
      const checks = () => s.transport.mock.calls.filter(([path]) => path === "/auth/session").length;
      expect(checks()).toBe(1);
      const phases: string[] = [];
      const unsubscribe = s.auth.subscribe(() => phases.push(s.auth.snapshot().phase));
      s.setSession(session); release(json(session)); await login;
      if (!activatedBeforeReply) {
        expect(s.auth.snapshot()).toMatchObject({ phase: "suspended", controller: null });
        expect(checks()).toBe(1);
        await s.auth.revalidate(true);
      }
      expect(phases).toContain("suspended");
      expect(s.auth.snapshot().phase).toBe("ready");
      expect(s.auth.snapshot().controller).not.toBeNull();
      expect(checks()).toBe(2);
      expect(s.transport.mock.calls.filter(([path]) => path === (method === "code" ? "/auth/email/verify" : "/auth/google"))).toHaveLength(1);
      unsubscribe();
    });
  }
}
it("hiding access preserves a pending email challenge without rechecking an anonymous session", async () => {
  const s = setup(); await s.auth.start();
  let release!: (response: Response) => void;
  s.transport.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  const requesting = s.auth.requestCode("fixture@example.test"); s.auth.suspend();
  release(json({ challenge_id: "pending-challenge", message: "Mensaje sintético" }, 202)); await requesting;
  expect(s.auth.snapshot()).toMatchObject({ phase: "access", busy: false, bootstrap, challenge: { challenge_id: "pending-challenge" } });
  await s.auth.revalidate(true);
  expect(s.auth.snapshot().challenge!.challenge_id).toBe("pending-challenge");
  expect(s.transport.mock.calls.filter(([path]) => path === "/auth/session")).toHaveLength(1);
});
for (const activatedBeforeReply of [false, true]) {
  it(`a reconciled lost login response crossing hidden still rechecks on activation (${activatedBeforeReply})`, async () => {
    const s = setup(); await s.auth.start();
    let reject!: (error: Error) => void;
    s.transport.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const login = s.auth.login("google", "synthetic"); s.auth.suspend();
    if (activatedBeforeReply) await s.auth.revalidate(true);
    s.setSession(session); reject(new Error("lost response")); await login;
    if (!activatedBeforeReply) {
      expect(s.auth.snapshot()).toMatchObject({ phase: "suspended", controller: null });
      await s.auth.revalidate(true);
    }
    expect(s.auth.snapshot().phase).toBe("ready");
    expect(s.transport.mock.calls.filter(([path]) => path === "/auth/session")).toHaveLength(3);
    expect(s.transport.mock.calls.filter(([path]) => path === "/auth/google")).toHaveLength(1);
  });
}
