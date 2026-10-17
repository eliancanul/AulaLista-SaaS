import { describe, expect, it, vi } from "vitest";
import { AuthApi, AuthController, parseSession } from "../src/acenta/auth";
import { ApiError, type Transport } from "../src/acenta/api";
import { FixtureServer, session as identity } from "./acenta-fixtures";
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
});
