import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { AcentaApi, ApiError } from "../src/acenta/api";
import { AcentaController } from "../src/acenta/controller";
import {
  sourceSamples,
  waterSource,
  type SourceReceipt,
} from "../src/acenta/contracts";
import { session, source, json } from "./acenta-fixtures";
const sha = (text: string | Uint8Array) =>
  createHash("sha256").update(text).digest("hex");
function original(
  text: string | Uint8Array<ArrayBuffer> = waterSource,
  headers = {},
) {
  return new Response(text, {
    headers: {
      "X-Source-Id": source.source_id,
      "X-Version": "1",
      "X-Content-SHA256": sha(text),
      "X-Content-Size": String(
        typeof text === "string"
          ? new TextEncoder().encode(text).length
          : text.length,
      ),
      "X-Actor-Id": session.actorId,
      ...headers,
    },
  });
}
function sourceApi() {
  const receipts = new Map<string, SourceReceipt>();
  const transport = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (init?.method !== "POST")
        return receipts.has(path.split("/").at(-1)!)
          ? json(receipts.get(path.split("/").at(-1)!))
          : json({}, 404);
      const bytes = String(init.body);
      const revision = path.includes("/versions?");
      const receipt: SourceReceipt = {
        ...source,
        operation_id: new Headers(init.headers).get("Idempotency-Key")!,
        source_id: revision
          ? path.split("/sources/")[1].split("/")[0]
          : crypto.randomUUID(),
        version_id: crypto.randomUUID(),
        number: revision ? Number(path.split("=")[1]) + 1 : 1,
        sha256: sha(bytes),
        size: new TextEncoder().encode(bytes).length,
      };
      receipts.set(receipt.operation_id, receipt);
      return json(receipt, 201);
    },
  );
  return { api: new AcentaApi(session, transport), transport, receipts };
}
describe("verified original", () => {
  it("reads the exact source/version and UTF-8 bytes with private cache settings", async () => {
    const transport = vi.fn(async () => original());
    const api = new AcentaApi(session, transport);
    expect(await api.original(source)).toEqual({
      text: waterSource,
      size: source.size,
      sha256: source.sha256,
    });
    expect(transport.mock.calls[0]).toEqual([
      `/scopes/${session.scopeId}/sources/${source.source_id}/versions/1`,
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
      }),
    ]);
  });
  it.each([
    { "X-Version": "2" },
    { "X-Source-Id": crypto.randomUUID() },
    { "X-Content-Size": "1" },
    { "X-Content-SHA256": "0".repeat(64) },
    { "X-Actor-Id": crypto.randomUUID() },
  ])("rejects mismatched metadata %j", async (headers) => {
    await expect(
      new AcentaApi(session, async () =>
        original(waterSource, headers),
      ).original(source),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("checks the body digest and does not render substituted content", async () => {
    await expect(
      new AcentaApi(session, async () =>
        original("x".repeat(source.size), {
          "X-Content-SHA256": source.sha256,
        }),
      ).original(source),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("distinguishes verified bytes which cannot be decoded", async () => {
    const bytes = new Uint8Array([255]);
    await expect(
      new AcentaApi(session, async () => original(bytes)).original({
        ...source,
        size: 1,
        sha256: sha(bytes),
      }),
    ).rejects.toMatchObject({ code: "original_view_failed" });
  });
  it.each([
    [404, "unavailable"],
    [503, "error"],
    [401, "error"],
  ])("uses honest state for HTTP %s", async (status, state) => {
    const controller = new AcentaController(
      new AcentaApi(session, async () => json({}, Number(status))),
    );
    await controller.openOriginal(source);
    expect(controller.state.original?.status).toBe(state);
    expect(controller.state.original?.content).toBeUndefined();
  });
  it("closing ignores a late response; retry recovers without changing selection", async () => {
    let resolve!: (r: Response) => void;
    const transport = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Response>((r) => (resolve = r)))
      .mockImplementation(async () => original());
    const c = new AcentaController(new AcentaApi(session, transport));
    c.setPrompt("texto pendiente");
    const pending = c.openOriginal(source);
    c.closeOriginal();
    resolve(original());
    await pending;
    expect(c.state.original).toBeNull();
    await c.openOriginal(source);
    expect(c.state.original?.status).toBe("ready");
    expect(c.state.prompt).toBe("texto pendiente");
    expect(c.state.source).toBeNull();
  });
});
describe("fixed sample replacement", () => {
  it("creates a new identity for another file and a CAS version for a revision; reselection is read-only", async () => {
    const { api, transport } = sourceApi();
    const c = new AcentaController(api);
    await c.attach(sourceSamples[0].bytes);
    const first = c.state.source!;
    await c.attach(sourceSamples[1].bytes);
    const revised = c.state.source!;
    expect(revised.source_id).toBe(first.source_id);
    expect(revised.number).toBe(2);
    await c.attach(sourceSamples[2].bytes);
    expect(c.state.source!.source_id).not.toBe(first.source_id);
    const calls = transport.mock.calls.length;
    await c.attach(sourceSamples[1].bytes);
    expect(c.state.source).toEqual(revised);
    expect(transport.mock.calls.length).toBe(calls);
    expect(
      transport.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(3);
  });
  it("uncertain revision preserves its key/base and selected source until receipt recovery", async () => {
    const { api, receipts } = sourceApi();
    const c = new AcentaController(api);
    await c.attach(waterSource);
    const first = c.state.source;
    const write = api.reviseSource.bind(api);
    vi.spyOn(api, "reviseSource").mockImplementationOnce(async (...args) => {
      await write(...args);
      throw new ApiError(0, "unconfirmed");
    });
    await c.attach(sourceSamples[1].bytes);
    expect(c.state.source).toEqual(first);
    expect(c.state.sourcePending).toBe(true);
    expect(await c.attach(sourceSamples[2].bytes)).toBe(false);
    await c.recoverAttachment();
    expect(c.state.source?.number).toBe(2);
    expect(receipts.size).toBe(2);
    expect(api.reviseSource).toHaveBeenCalledTimes(1);
  });
  it("restores an uncertain revision with its exact base and recovers once", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => {
        values.set(k, v);
      },
      removeItem: (k: string) => {
        values.delete(k);
      },
    };
    const { api, receipts } = sourceApi();
    const workspace = crypto.randomUUID();
    const c = new AcentaController(api, storage, workspace);
    await c.attach(waterSource);
    const write = api.reviseSource.bind(api);
    vi.spyOn(api, "reviseSource").mockImplementationOnce(async (...args) => {
      await write(...args);
      throw new ApiError(0, "unconfirmed");
    });
    await c.attach(sourceSamples[1].bytes);
    const restored = new AcentaController(api, storage, workspace);
    expect(restored.state.sourcePending).toBe(true);
    await restored.recoverAttachment();
    expect(restored.state.source?.number).toBe(2);
    expect(receipts.size).toBe(2);
    await restored.attach(sourceSamples[1].bytes);
    expect(receipts.size).toBe(2);
  });
  it("CAS conflict leaves the valid selection and prompt intact", async () => {
    const { api } = sourceApi();
    const c = new AcentaController(api);
    await c.attach(waterSource);
    const initial = c.state.source;
    c.setPrompt("trabajo pendiente");
    vi.spyOn(api, "reviseSource").mockRejectedValue(
      new ApiError(409, "version_conflict"),
    );
    expect(await c.attach(sourceSamples[1].bytes)).toBe(false);
    expect(c.state.source).toEqual(initial);
    expect(c.state.prompt).toBe("trabajo pendiente");
    expect(c.state.sourcePending).toBe(false);
  });
  it("cancelled late attachment never replaces the confirmed selection", async () => {
    const { api } = sourceApi();
    const c = new AcentaController(api);
    await c.attach(waterSource);
    const initial = c.state.source;
    const write = api.reviseSource.bind(api);
    let release!: () => void;
    vi.spyOn(api, "reviseSource").mockImplementationOnce(async (...args) => {
      await new Promise<void>((r) => (release = r));
      return write(...args);
    });
    const pending = c.attach(sourceSamples[1].bytes);
    await vi.waitFor(() => expect(release).toBeDefined());
    c.cancelAttachment();
    release();
    await pending;
    expect(c.state.source).toEqual(initial);
    await c.attach(sourceSamples[1].bytes);
    expect(c.state.source?.number).toBe(2);
    expect(api.reviseSource).toHaveBeenCalledTimes(1);
  });
  it("rejects arbitrary bytes without retaining or transmitting them", async () => {
    const { api, transport } = sourceApi();
    const c = new AcentaController(api);
    expect(await c.attach("private document")).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });
});
