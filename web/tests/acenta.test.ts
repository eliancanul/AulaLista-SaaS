import golden from "./acenta-contract-examples.json" with { type: "json" };
import { createHash } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import {
  AcentaApi,
  ApiError,
  parsePlanning,
  parseDraft,
} from "../src/acenta/api";
import { AcentaController, type BackupStore } from "../src/acenta/controller";
import { waterSource, waterPrompt } from "../src/acenta/contracts";
import {
  FixtureServer,
  session,
  workspaceId,
  planning,
  revised,
  json,
} from "./acenta-fixtures";
const memory = (): BackupStore => {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, v);
    },
    removeItem: (k) => {
      m.delete(k);
    },
  };
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const setup = (storage: BackupStore | null = null) => {
  const server = new FixtureServer();
  const api = new AcentaApi(session, server.transport);
  return {
    server,
    api,
    controller: new AcentaController(api, storage, workspaceId),
  };
};
async function ready(controller: AcentaController) {
  controller.useExample();
  await controller.attach(waterSource);
  await controller.submit();
  controller.openEditor();
}
describe("Acenta HTTP boundary", () => {
  it("calls the default browser fetch with its global receiver", async () => {
    const server = new FixtureServer();
    const receivers: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
        receivers.push(this);
        if (this !== globalThis) throw new TypeError("Illegal invocation");
        return server.transport(input, init);
      },
    );
    try {
      const api = new AcentaApi(session);
      const key = crypto.randomUUID();
      await expect(api.createSource(waterSource, key)).resolves.toMatchObject({
        operation_id: key,
      });
      await expect(api.list()).resolves.toEqual({
        items: [],
        next_cursor: null,
      });
      expect(receivers).toEqual([globalThis, globalThis]);
      expect(server.calls.map((call) => call.method)).toEqual(["POST", "GET"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("uses same-origin/no-store, exact source bytes and only idempotency/content headers", async () => {
    const s = setup();
    const spy = vi.fn(s.server.transport);
    const api = new AcentaApi(session, spy);
    await api.createSource(waterSource, crypto.randomUUID());
    const [path, init] = spy.mock.calls[0];
    expect(path).toBe(`/scopes/${session.scopeId}/sources`);
    expect(init?.credentials).toBe("same-origin");
    expect(init?.cache).toBe("no-store");
    expect(init?.body).toBe(waterSource);
    expect(Object.keys(init!.headers!)).toEqual([
      "Idempotency-Key",
      "Content-Type",
    ]);
  });
  it("accepts creation/edit/copy documents but rejects malformed or foreign payloads", async () => {
    const s = setup();
    const base = planning();
    expect(parsePlanning(base)).toEqual(base);
    expect(parsePlanning(revised(base, "Texto nuevo"))).toBeTruthy();
    expect(
      parsePlanning(revised(base, "Copia", crypto.randomUUID(), true)),
    ).toBeTruthy();
    expect(() => parsePlanning({ ...base, result: { title: "fake" } })).toThrow(
      ApiError,
    );
    base.receipt.actor_id = crypto.randomUUID();
    s.server.put(base);
    await expect(s.api.read(base.receipt.planning_id)).rejects.toThrow(
      "invalid_response",
    );
  });
  it("rejects wrong read identity and malformed sources", async () => {
    const d = planning();
    const api = new AcentaApi(session, async () => json(d));
    await expect(api.read(crypto.randomUUID())).rejects.toThrow(
      "invalid_response",
    );
    await expect(api.sourceOperation(crypto.randomUUID())).rejects.toThrow(
      "invalid_response",
    );
  });
  it.each([401, 404, 409, 413, 415, 422, 503])(
    "preserves status %i without trusting server HTML",
    async (status) => {
      const api = new AcentaApi(
        session,
        async () => new Response("<private sql>", { status }),
      );
      await expect(api.list()).rejects.toMatchObject({
        status,
        code: "invalid_response",
      });
    },
  );
  it("rejects malformed cursor, local injection IDs and oversized creation before transport", async () => {
    const spy = vi.fn(async () => json({ items: [], next_cursor: "bad" }));
    const api = new AcentaApi(session, spy);
    await expect(api.list()).rejects.toThrow();
    await expect(api.read("../other")).rejects.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
describe("Acenta operation state", () => {
  it("rejects arbitrary attachment bytes before retaining or sending them", async () => {
    const storage = memory();
    const { controller: c, server } = setup(storage);
    c.useExample();
    await c.attach("arbitrary private document");
    expect(server.calls).toHaveLength(0);
    expect(c.state.source).toBeNull();
    expect(c.state.error).toContain("ejemplo");
    const restored = new AcentaController(c.api, storage, workspaceId);
    expect(restored.state.backupError).toBe(false);
    expect(restored.state.prompt).toBe(waterPrompt);
  });
  it("cancelled attachment preserves the composer and ignores late selection", async () => {
    const { controller: c, server } = setup();
    c.useExample();
    const gate = deferred();
    server.before = async (call) => {
      if (call.path === "sources" && call.method === "POST") await gate.promise;
    };
    const pending = c.attach(waterSource);
    c.cancelAttachment();
    gate.resolve();
    expect(await pending).toBe(false);
    expect(c.state.source).toBeNull();
    expect(c.state.prompt).toBe(waterPrompt);
    expect(server.sources.size).toBe(1);
  });
  it("recovers an uncertain source after reload using its original receipt", async () => {
    const storage = memory();
    const { controller: c, api, server } = setup(storage);
    server.after = async (call, response) => {
      if (call.path === "sources" && call.method === "POST")
        throw Error("lost");
      return response;
    };
    await c.attach(waterSource);
    expect(c.state.sourcePending).toBe(true);
    const restored = new AcentaController(api, storage, workspaceId);
    expect(restored.state.sourcePending).toBe(true);
    server.after = null;
    await restored.attach(waterSource);
    expect(restored.state.sourcePending).toBe(false);
    expect(restored.state.source).toEqual([...server.sources.values()][0]);
    expect(server.calls.filter((x) => x.path === "sources")).toHaveLength(1);
  });
  it("reselecting the attached fixture does not create a new source", async () => {
    const { controller: c, server } = setup();
    await c.attach(waterSource);
    const original = c.state.source;
    await c.attach(waterSource);
    expect(c.state.source).toEqual(original);
    expect(server.calls.filter((x) => x.path === "sources")).toHaveLength(1);
  });
  it("invalid receipt metadata stays uncertain instead of selecting a different source", async () => {
    const { controller: c, server } = setup();
    server.after = async (call, response) => {
      if (call.path === "sources")
        return json(
          { ...(await response.json()), sha256: "0".repeat(64) },
          201,
        );
      return response;
    };
    await c.attach(waterSource);
    expect(c.state.source).toBeNull();
    expect(c.state.sourcePending).toBe(true);
    server.after = null;
    await c.attach(waterSource);
    expect(c.state.source).not.toBeNull();
    expect(server.calls.filter((x) => x.path === "sources")).toHaveLength(1);
  });
  it("a failed attachment cannot destroy the valid selection or composer", async () => {
    const { controller: c, server } = setup();
    c.useExample();
    await c.attach(waterSource);
    const previous = c.state.source;
    await c.attach("not a fixture");
    expect(c.state.source).toEqual(previous);
    expect(c.state.prompt).toBe(waterPrompt);
    expect(server.calls.filter((x) => x.path === "sources")).toHaveLength(1);
  });
  it("new composer text prevents a late result from replacing the active context", async () => {
    const { controller: c, server } = setup();
    c.useExample();
    await c.attach(waterSource);
    const gate = deferred();
    server.before = async (call) => {
      if (call.path === "plannings" && call.method === "POST")
        await gate.promise;
    };
    const pending = c.submit();
    c.setPrompt("Mi siguiente petición");
    gate.resolve();
    await pending;
    expect(c.state.view).toBe("home");
    expect(c.state.prompt).toBe("Mi siguiente petición");
    expect(c.state.result).toBeNull();
    expect(c.state.items).toHaveLength(1);
    expect(c.state.items[0].request).toMatchObject({ prompt: waterPrompt });
  });
  it("reload preserves the newer composer while an older creation is recovered", async () => {
    const storage = memory();
    const { controller: c, api, server } = setup(storage);
    c.useExample();
    await c.attach(waterSource);
    server.after = async (call, response) => {
      if (call.path === "plannings" && call.method === "POST")
        throw Error("lost");
      return response;
    };
    await c.submit();
    c.setPrompt("Nueva petición tras la pérdida de respuesta");
    const restored = new AcentaController(api, storage, workspaceId);
    server.after = null;
    await restored.recoverCreate();
    expect(restored.state.view).toBe("home");
    expect(restored.state.prompt).toBe(
      "Nueva petición tras la pérdida de respuesta",
    );
    expect(restored.state.result).toBeNull();
    expect(restored.state.items).toHaveLength(1);
  });
  it("removing the reference does not redirect a submitted operation", async () => {
    const { controller: c, server } = setup();
    c.useExample();
    await c.attach(waterSource);
    const original = c.state.source!;
    const gate = deferred();
    server.before = async (call) => {
      if (call.path === "plannings" && call.method === "POST")
        await gate.promise;
    };
    const pending = c.submit();
    c.removeSource();
    gate.resolve();
    await pending;
    expect(c.state.source).toBeNull();
    expect(c.state.view).toBe("home");
    expect(c.state.items[0].request).toMatchObject({
      source_id: original.source_id,
      expected_source_version: original.number,
    });
  });
  it("library retry clears stale failure and never confuses it with an empty result", async () => {
    const { controller: c, api } = setup();
    const list = vi
      .spyOn(api, "list")
      .mockRejectedValueOnce(new ApiError(503, "unavailable"));
    await c.loadResources();
    expect(c.state.listState).toBe("error");
    expect(c.state.error).not.toBe("");
    list.mockResolvedValue({ items: [], next_cursor: null });
    await c.loadResources();
    expect(c.state.listState).toBe("ready");
    expect(c.state.error).toBe("");
    expect(c.state.items).toEqual([]);
  });
  it("a server-only library reopens saved content after the local backup is gone", async () => {
    const { controller: c, api, server } = setup();
    await ready(c);
    c.edit("Guardado recuperable sin respaldo local");
    await c.save();
    const fresh = new AcentaController(api, null, crypto.randomUUID());
    await fresh.loadResources();
    await fresh.open(fresh.state.items[0].receipt.planning_id);
    expect(fresh.state.editor?.text).toBe(
      "Guardado recuperable sin respaldo local",
    );
    expect(fresh.state.result?.receipt.revision).toBe(2);
    expect(fresh.state.source).toBeNull();
    expect(server.docs.size).toBe(1);
  });
  it("attaches only the fixture and prevents duplicate submits while in flight", async () => {
    const { controller: c, server } = setup();
    c.useExample();
    await c.attach(waterSource);
    const gate = deferred();
    server.before = async (x) => {
      if (x.path === "plannings" && x.method === "POST") await gate.promise;
    };
    const first = c.submit();
    await c.submit();
    expect(
      server.calls.filter((x) => x.path === "plannings" && x.method === "POST"),
    ).toHaveLength(1);
    gate.resolve();
    await first;
    expect(
      c.state.result?.result.activities.reduce((n, a) => n + a.minutes, 0),
    ).toBe(30);
  });
  it("recovers a committed creation after a lost response with the original operation", async () => {
    const { controller: c, server } = setup();
    c.useExample();
    await c.attach(waterSource);
    server.after = async (call, r) => {
      if (call.path === "plannings" && call.method === "POST")
        throw Error("lost");
      return r;
    };
    await c.submit();
    const key = c.state.pending!.key;
    expect(c.state.submit).toBe("unknown");
    c.setPrompt("Another prompt");
    server.after = null;
    await c.recoverCreate();
    expect(c.state.view).toBe("home");
    expect(c.state.items[0].receipt.operation_id).toBe(key);
    expect(c.state.items[0].request).toMatchObject({ prompt: waterPrompt });
    expect(server.docs.size).toBe(1);
  });
  it("404 receipt replays the same key and exact payload rather than declaring failure", async () => {
    const { controller: c, server } = setup();
    c.useExample();
    await c.attach(waterSource);
    server.before = async (call) => {
      if (call.path === "plannings" && call.method === "POST")
        throw Error("offline");
    };
    await c.submit();
    const prior = c.state.pending!;
    c.setPrompt("More recent input");
    server.before = null;
    await c.recoverCreate();
    const writes = server.calls.filter(
      (x) => x.path === "plannings" && x.method === "POST",
    );
    expect(writes).toHaveLength(2);
    expect(writes[0].key).toBe(prior.key);
    expect(writes[1]).toEqual(writes[0]);
  });
  it("a stale creation response does not replace a newly opened resource", async () => {
    const { controller: c, server } = setup();
    const other = server.put(planning());
    c.useExample();
    await c.attach(waterSource);
    const gate = deferred();
    server.before = async (call) => {
      if (call.path === "plannings" && call.method === "POST")
        await gate.promise;
    };
    const pending = c.submit();
    await c.open(other.receipt.planning_id);
    gate.resolve();
    await pending;
    expect(c.state.result?.receipt.planning_id).toBe(other.receipt.planning_id);
  });
  it("rejects unsupported prompt without fake success", async () => {
    const { controller: c } = setup();
    await c.attach(waterSource);
    c.setPrompt("Genera cualquier clase");
    await c.submit();
    expect(c.state.pending).toBeNull();
    expect(c.state.result).toBeNull();
    expect(c.state.error).toContain("sólo admite");
  });
  it("preserves newer typing when save A confirms after edit B", async () => {
    const { controller: c, server } = setup();
    await ready(c);
    c.edit("Edición A");
    const gate = deferred();
    server.before = async (call) => {
      if (call.path.endsWith("/revisions") && call.method === "POST")
        await gate.promise;
    };
    const pending = c.save();
    c.edit("Edición B");
    gate.resolve();
    await pending;
    expect(c.state.editor).toMatchObject({
      baseline: "Edición A",
      text: "Edición B",
      save: "dirty",
    });
    expect(c.state.editor!.document.receipt.revision).toBe(2);
  });
  it("undo only changes the local buffer and is blocked during an uncertain write", async () => {
    const { controller: c, server } = setup();
    await ready(c);
    const baseline = c.state.editor!.baseline;
    c.edit("Texto nuevo");
    c.undo();
    expect(c.state.editor!.text).toBe(baseline);
    expect(server.docs.size).toBe(1);
    c.edit("Otro");
    server.before = async (call) => {
      if (call.method === "POST") throw Error("offline");
    };
    await c.save();
    c.undo();
    expect(c.state.editor!.text).toBe("Otro");
    expect(c.state.editor!.pending).toBeTruthy();
    expect(c.closeEditor()).toBe(false);
  });
  it("retains local text on conflict and creates a separate copy from the exact base", async () => {
    const { controller: c, server } = setup();
    await ready(c);
    const base = c.state.result!;
    server.put(revised(base, "Texto de otra pestaña"));
    c.edit("Texto local");
    await c.save();
    expect(c.state.editor).toMatchObject({
      save: "conflict",
      text: "Texto local",
    });
    await c.save(true);
    expect(
      server.docs.get(base.receipt.planning_id)!.result.resources![0]
        .elements[0].text,
    ).toBe("Texto de otra pestaña");
    expect(c.state.result!.receipt.planning_id).not.toBe(
      base.receipt.planning_id,
    );
    expect(c.state.result!.origin?.revision).toBe(1);
    expect(c.state.editor!.draftRevision).toBe(0);
  });
  it("a definitive conflict from exact recovery replay releases copy and draft actions", async () => {
    const { controller: c, server } = setup();
    await ready(c);
    const base = c.state.result!;
    c.edit("Mi texto sin confirmar");
    server.before = async (call) => {
      if (call.path.endsWith("/revisions") && call.method === "POST")
        throw Error("not committed");
    };
    await c.save();
    const key = c.state.editor!.pending!.key;
    server.before = null;
    server.put(revised(base, "Otra pestaña"));
    await c.recoverEditor();
    expect(c.state.editor).toMatchObject({
      save: "conflict",
      text: "Mi texto sin confirmar",
      pending: null,
    });
    expect(server.operations.has(key)).toBe(false);
    await c.preserveDraft();
    expect(c.state.editor!.draftSaved).toBe(true);
    await c.save(true);
    expect(c.state.editor!.save).toBe("saved");
    expect(server.docs.size).toBe(2);
    expect(
      server.docs.get(base.receipt.planning_id)!.result.resources![0]
        .elements[0].text,
    ).toBe("Otra pestaña");
  });
  it("a definitive unsupported fixture replay releases the composer without creating a new operation", async () => {
    const { controller: c, server } = setup();
    await c.attach(waterSource);
    c.setPrompt("Petición no admitida");
    server.before = async (call) => {
      if (call.path === "plannings" && call.method === "POST")
        throw Error("not committed");
    };
    await c.submit();
    const key = c.state.pending!.key;
    server.before = null;
    await c.recoverCreate();
    expect(c.state.pending).toBeNull();
    expect(c.state.submit).toBe("error");
    expect(c.state.prompt).toBe("Petición no admitida");
    const attempts = server.calls.filter(
      (call) => call.path === "plannings" && call.method === "POST",
    );
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toEqual(attempts[1]);
    expect(attempts[1].key).toBe(key);
    expect(server.docs.size).toBe(0);
    c.useExample();
    await c.submit();
    expect(server.docs.size).toBe(1);
  });
  it.each(["unsupported_target", "unchanged_text"])(
    "a terminal editor replay %s releases the key while preserving the buffer",
    async (code) => {
      const { controller: c, server } = setup();
      await ready(c);
      c.edit("Mi intento pendiente");
      server.before = async (call) => {
        if (call.path.endsWith("/revisions") && call.method === "POST")
          throw Error("not committed");
      };
      await c.save();
      server.before = async (call) =>
        call.path.endsWith("/revisions") && call.method === "POST"
          ? json({ detail: code }, 422)
          : undefined;
      await c.recoverEditor();
      expect(c.state.editor).toMatchObject({
        save: "error",
        pending: null,
        text: "Mi intento pendiente",
      });
    },
  );
  it.each([401, 404, 413, 415, 422, 503])(
    "a nonterminal source replay status %i retains its original uncertain key",
    async (status) => {
      const { controller: c, server } = setup();
      server.before = async (call) => {
        if (call.path === "sources") throw Error("not committed");
      };
      await c.attach(waterSource);
      const key = server.calls.find((call) => call.path === "sources")!.key;
      server.before = async (call) =>
        call.path === "sources"
          ? json({ detail: "invalid_request" }, status)
          : undefined;
      await c.attach(waterSource);
      expect(c.state.sourcePending).toBe(true);
      expect(
        server.calls
          .filter((call) => call.path === "sources")
          .every((call) => call.key === key),
      ).toBe(true);
    },
  );
  it("a terminal source replay conflict releases the pending selection without claiming it was saved", async () => {
    const { controller: c, server } = setup();
    server.before = async (call) => {
      if (call.path === "sources") throw Error("not committed");
    };
    await c.attach(waterSource);
    server.before = async (call) =>
      call.path === "sources" ? json({ detail: "conflict" }, 409) : undefined;
    await c.attach(waterSource);
    expect(c.state.sourcePending).toBe(false);
    expect(c.state.source).toBeNull();
  });
  it("a failed receipt lookup never releases the pending edit even if its status is409", async () => {
    const { controller: c, server } = setup();
    await ready(c);
    c.edit("Recibo sin comprobar");
    server.before = async (call) => {
      if (call.path.endsWith("/revisions")) throw Error("not committed");
    };
    await c.save();
    const key = c.state.editor!.pending!.key;
    server.before = async (call) =>
      call.path.startsWith("planning-operations/")
        ? json({ detail: "conflict" }, 409)
        : undefined;
    await c.recoverEditor();
    expect(c.state.editor!.pending!.key).toBe(key);
    expect(
      server.calls.filter((call) => call.path.endsWith("/revisions")),
    ).toHaveLength(1);
  });
  it("an oversized editor paste is rejected before producing an unrestorable backup", async () => {
    const storage = memory();
    const { controller: c, api } = setup(storage);
    await ready(c);
    c.edit("Mi borrador válido");
    c.edit("x".repeat(16001));
    expect(c.state.editor!.text).toBe("Mi borrador válido");
    expect(c.state.editor!.error).toContain("1000");
    const restored = new AcentaController(api, storage, workspaceId);
    expect(restored.state.backupError).toBe(false);
    expect(restored.state.editor?.text).toBe("Mi borrador válido");
  });
  it("an oversized composer paste cannot invalidate the entire workspace backup", async () => {
    const storage = memory();
    const { controller: c, api } = setup(storage);
    c.useExample();
    c.setPrompt("x".repeat(200001));
    expect(c.state.prompt).toBe(waterPrompt);
    expect(c.state.error).toContain("256");
    const restored = new AcentaController(api, storage, workspaceId);
    expect(restored.state.backupError).toBe(false);
    expect(restored.state.prompt).toBe(waterPrompt);
  });
  it.each(["edit", "copy", "draft"] as const)(
    "a contradictory %s receipt stays uncertain until the exact receipt is recovered",
    async (kind) => {
      const { controller: c, server } = setup();
      await ready(c);
      c.edit("Mi cambio exacto");
      server.after = async (call, response) => {
        if (call.method === "POST" || call.method === "PUT") {
          const value = await response.json();
          if (kind === "edit") value.receipt.source_sha256 = "0".repeat(64);
          if (kind === "copy") value.origin.revision = 77;
          if (kind === "draft")
            value.receipt.base_revision_id = crypto.randomUUID();
          return json(value, 201);
        }
        return response;
      };
      if (kind === "draft") await c.preserveDraft();
      else await c.save(kind === "copy");
      expect(c.state.editor!.save).toBe("unknown");
      expect(c.state.editor!.pending?.kind).toBe(kind);
      expect(c.state.editor!.text).toBe("Mi cambio exacto");
      server.after = null;
      await c.recoverEditor();
      expect(c.state.editor!.pending).toBeNull();
      expect(c.state.editor!.save).toBe(kind === "draft" ? "clean" : "saved");
    },
  );
  it.each(["yes", true])(
    "an inconsistent restored draftSaved=%s cannot authorize discarding a local buffer",
    async (flag) => {
      const storage = memory();
      const { controller: c, api } = setup(storage);
      await ready(c);
      c.edit("Borrador nunca guardado en servidor");
      const key = `acenta:work:v1:${session.actorId}:${session.scopeId}:${workspaceId}`;
      const saved = JSON.parse(storage.getItem(key)!);
      saved.editor.draftSaved = flag;
      const corrupt = JSON.stringify(saved);
      storage.setItem(key, corrupt);
      const restored = new AcentaController(api, storage, workspaceId);
      expect(restored.state.backupError).toBe(true);
      expect(restored.state.editor).toBeNull();
      restored.useExample();
      expect(storage.getItem(key)).toBe(corrupt);
    },
  );
  it("recovers a saved revision by exact receipt without creating another revision", async () => {
    const { controller: c, server } = setup();
    await ready(c);
    c.edit("Nueva instrucción");
    server.after = async (call, r) => {
      if (call.method === "POST") throw Error("lost");
      return r;
    };
    await c.save();
    const key = c.state.editor!.pending!.key;
    expect(c.state.editor!.save).toBe("unknown");
    server.after = null;
    await c.recoverEditor();
    expect(c.state.editor!.document.receipt.operation_id).toBe(key);
    expect(c.state.editor!.document.receipt.revision).toBe(2);
    expect(c.state.editor!.save).toBe("saved");
  });
  it("saves a private draft, reopens it and leaves confirmed revision unchanged", async () => {
    const { controller: c, server } = setup();
    await ready(c);
    const base = c.state.result!;
    c.edit("Borrador para después");
    await c.preserveDraft();
    expect(c.state.editor!.draftSaved).toBe(true);
    expect(c.closeEditor()).toBe(true);
    const draft = [...server.drafts.values()][0];
    expect(parseDraft(draft)).toBeTruthy();
    await c.openDraft(draft.receipt.draft_id);
    expect(c.state.editor!.text).toBe("Borrador para después");
    expect(server.docs.get(base.receipt.planning_id)!.receipt.revision).toBe(1);
  });
  it("does not overwrite a dirty unrelated editor when opening a draft", async () => {
    const { controller: c, server } = setup();
    await ready(c);
    c.edit("Draft");
    await c.preserveDraft();
    const id = c.state.editor!.draftId;
    c.closeEditor();
    const other = server.put(planning());
    c.openEditor(other);
    c.edit("UNSAVED OTHER");
    await c.openDraft(id);
    expect(c.state.editor!.text).toBe("UNSAVED OTHER");
    expect(c.state.editor!.document.receipt.planning_id).toBe(
      other.receipt.planning_id,
    );
  });
  it("preserves unsent newer text when a draft receipt confirms older text", async () => {
    const { controller: c, server } = setup();
    await ready(c);
    c.edit("Draft A");
    const gate = deferred();
    server.before = async (call) => {
      if (call.method === "PUT") await gate.promise;
    };
    const pending = c.preserveDraft();
    c.edit("Draft B");
    gate.resolve();
    await pending;
    expect(c.state.editor).toMatchObject({
      text: "Draft B",
      draftSaved: false,
      save: "dirty",
    });
    expect(c.closeEditor()).toBe(false);
  });
  it("local text validation matches backend limit and no whitespace creates revisions", async () => {
    const { controller: c, server } = setup();
    await ready(c);
    c.edit("x".repeat(1001));
    await c.save();
    expect(c.state.editor!.error).toContain("1000");
    c.edit("   ");
    await c.preserveDraft();
    expect(server.drafts.size).toBe(0);
  });
  it("restores pending identities and buffers after reload, scoped by account and workspace", async () => {
    const storage = memory();
    const { controller: c, api, server } = setup(storage);
    await ready(c);
    c.edit("Pendiente");
    server.before = async (call) => {
      if (call.method === "POST") throw Error("lost");
    };
    await c.save();
    const key = c.state.editor!.pending!.key;
    const restored = new AcentaController(api, storage, workspaceId);
    expect(restored.state.editor).toMatchObject({
      text: "Pendiente",
      save: "unknown",
      pending: { key },
    });
    const otherTab = new AcentaController(api, storage, crypto.randomUUID());
    expect(otherTab.state.editor).toBeNull();
    const otherAccount = new AcentaController(
      new AcentaApi(
        { ...session, actorId: crypto.randomUUID() },
        server.transport,
      ),
      storage,
      workspaceId,
    );
    expect(otherAccount.state.editor).toBeNull();
    server.before = null;
    await restored.recoverEditor();
    expect(restored.state.editor!.save).toBe("saved");
  });
  it("failed storage stays visible and corrupt backups are not replaced", async () => {
    const failing: BackupStore = {
      getItem: () => null,
      setItem: () => {
        throw Error("quota");
      },
      removeItem: () => {},
    };
    const { controller: c } = setup(failing);
    c.useExample();
    expect(c.state.backupError).toBe(true);
    const write = vi.fn();
    const corrupt = new AcentaController(
      new AcentaApi(session),
      { getItem: () => "{bad", setItem: write, removeItem: () => {} },
      workspaceId,
    );
    corrupt.useExample();
    expect(corrupt.state.backupError).toBe(true);
    expect(write).not.toHaveBeenCalled();
  });
  it("closing a session purges a legacy private browser backup", () => {
    const store = memory();
    const { controller, api } = setup(store);
    controller.useExample();
    controller.closeSession();
    const restored = new AcentaController(api, store, workspaceId);
    expect(restored.snapshot()).toMatchObject({ prompt: "", result: null, editor: null });
  });
  it("closing the session clears visible private state and ignores late responses", async () => {
    const { controller: c, server } = setup();
    c.useExample();
    await c.attach(waterSource);
    const gate = deferred();
    server.before = async (call) => {
      if (call.path === "plannings") await gate.promise;
    };
    const pending = c.submit();
    c.closeSession();
    gate.resolve();
    await pending;
    expect(c.state).toMatchObject({
      closed: true,
      result: null,
      editor: null,
      prompt: "",
    });
  });
  it("pagination does not refetch an exhausted collection", async () => {
    const { controller: c, api } = setup();
    const next = crypto.randomUUID();
    const list = vi
      .spyOn(api, "list")
      .mockResolvedValue({ items: [planning()], next_cursor: null });
    vi.spyOn(api, "listDrafts")
      .mockResolvedValueOnce({ items: [], next_cursor: next })
      .mockResolvedValueOnce({ items: [], next_cursor: null });
    await c.loadResources();
    await c.loadResources(true);
    expect(list).toHaveBeenCalledTimes(1);
    expect(c.state.items).toHaveLength(1);
  });
});

it("accepts actual HTTP documents exported from PostgreSQL tests and exact fixture bytes", () => {
  for (const d of [golden.create, golden.edit, golden.copy])
    expect(parsePlanning(d)).toEqual(d);
  expect(parseDraft(golden.draft)).toEqual(golden.draft);
  expect(createHash("sha256").update(waterSource).digest("hex")).toBe(
    golden.source.sha256,
  );
});

it("an expired session during recovery does not discard an uncertain operation", async () => {
  const { controller: c, server } = setup();
  await ready(c);
  c.edit("Respuesta incierta");
  server.after = async (call, r) => {
    if (call.method === "POST") throw Error("lost");
    return r;
  };
  await c.save();
  const key = c.state.editor!.pending!.key;
  server.after = null;
  server.before = async (call) =>
    call.path.startsWith("planning-operations/")
      ? json({ detail: "unauthorized" }, 401)
      : undefined;
  await c.recoverEditor();
  expect(c.state.editor!.pending!.key).toBe(key);
  expect(c.state.editor!.text).toBe("Respuesta incierta");
});
it("restored pending save remains recoverable even when current revision advanced", async () => {
  const storage = memory();
  const { controller: c, server, api } = setup(storage);
  await ready(c);
  c.edit("A");
  server.after = async (call, r) => {
    if (call.method === "POST") throw Error("lost");
    return r;
  };
  await c.save();
  server.after = null;
  const restored = new AcentaController(api, storage, workspaceId);
  await restored.init();
  expect(restored.state.editor!.save).toBe("unknown");
  await restored.recoverEditor();
  expect(restored.state.editor!.save).toBe("saved");
});
