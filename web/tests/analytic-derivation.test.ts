import { describe, expect, it } from "vitest";
import { AcentaApi, type Transport } from "../src/acenta/api";
import { AnalyticDerivationController } from "../src/acenta/analytic-derivation";
import { prefillAnalyticPlanning } from "../src/acenta/analytic-sections";
import type { PlanningDocument } from "../src/acenta/contracts";
import { json, session } from "./acenta-fixtures";
import { explorerSection } from "./analytic-explorer-fixtures";
import { guidedPlanning } from "./guided-fixtures";

const origin = () => explorerSection(1, "El cuidado del agua en la comunidad");
const classData = () => ({ contract_version: 1 as const, subject: "Ciencias naturales", duration_minutes: 50, method: "active-learning" });
function result(key: string) {
  const section = origin();
  const { contract_version: _, ...data } = classData();
  return { ...guidedPlanning(key, { ...prefillAnalyticPlanning(section), ...data }), analytic_origin: section };
}
function setup(reply: Transport) {
  const c = new AnalyticDerivationController(new AcentaApi(session, reply));
  c.choose(origin());
  c.setData(classData());
  return c;
}

describe("derivation from an exact manual revision", () => {
  it("only creates on explicit submit, retaining immutable origin and exact class fields", async () => {
    const calls: { path: string; key: string | null; body: unknown }[] = [];
    const c = setup(async (input, init) => {
      const key = new Headers(init?.headers).get("Idempotency-Key");
      calls.push({ path: String(input), key, body: JSON.parse(String(init?.body)) });
      return json(result(key!), 201);
    });
    expect(calls).toHaveLength(0);
    expect(c.hasUnsavedChanges()).toBe(true);
    const confirmed = await c.submit();
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toContain(`/analytic-sections/${origin().receipt.section_id}/revisions/1/plannings`);
    expect(calls[0].body).toEqual(classData());
    expect(confirmed?.analytic_origin).toEqual(origin());
    expect(c.snapshot()).toMatchObject({ status: "saved", pending: null });
    expect(c.hasUnsavedChanges()).toBe(false);
    expect(await c.submit()).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("preserves class values when explicitly choosing another origin and never mutates the manual editor", () => {
    const c = setup(async () => { throw Error("No HTTP expected"); });
    c.setData({ ...classData(), duration_minutes: 45 });
    const second = explorerSection(2);
    expect(c.choose(second)).toBe(true);
    second.data.entries[0].pda = "Changed outside";
    expect(c.snapshot().origin?.data.entries[0].pda).toBe(" Primer PDA manual. ");
    expect(c.snapshot().data.duration_minutes).toBe(45);
    expect(Object.isFrozen(c.snapshot().origin!.data)).toBe(true);
  });

  it("locks uncertain work, ignores double submit, and recovers by operation lookup", async () => {
    let resolve!: () => void;
    const gate = new Promise<void>(done => { resolve = done; });
    let confirmed: PlanningDocument;
    const calls: string[] = [];
    const c = setup(async (input, init) => {
      calls.push(init?.method ?? "GET");
      if (init?.method === "POST") {
        confirmed = result(new Headers(init.headers).get("Idempotency-Key")!);
        await gate;
        throw Error("response lost");
      }
      return json(confirmed);
    });
    const submitted = c.submit();
    expect(await c.submit()).toBeNull();
    expect(c.cancel()).toBe(false);
    expect(c.choose(explorerSection(2))).toBe(false);
    expect(c.setData({ ...classData(), duration_minutes: 40 })).toBe(false);
    resolve();
    expect(await submitted).toBeNull();
    expect(c.snapshot().status).toBe("unknown");
    expect((await c.recover())?.analytic_origin).toEqual(origin());
    expect(calls).toEqual(["POST", "GET"]);
  });

  it("replays the same origin, key and request only after operation absence", async () => {
    const calls: { path: string; body: string | null; key: string | null }[] = [];
    const c = setup(async (input, init) => {
      calls.push({ path: String(input), body: init?.body ? String(init.body) : null, key: new Headers(init?.headers).get("Idempotency-Key") });
      if (calls.length === 1) throw Error("request lost");
      if (init?.method !== "POST") return json({ detail: "not_found" }, 404);
      return json(result(calls.at(-1)!.key!), 201);
    });
    await c.submit();
    const intent = c.snapshot().pending;
    expect(Object.isFrozen(intent?.data)).toBe(true);
    expect(await c.recover()).not.toBeNull();
    expect(calls[2]).toEqual(calls[0]);
  });

  it("keeps the attempt uncertain when a lookup returns a different valid origin", async () => {
    let key = "";
    const c = setup(async (_input, init) => {
      if (init?.method === "POST") { key = new Headers(init.headers).get("Idempotency-Key")!; throw Error("lost"); }
      const wrong = result(key);
      wrong.analytic_origin.receipt.revision_id = "71000000-0000-4000-8000-000000000005";
      return json(wrong);
    });
    await c.submit();
    expect(await c.recover()).toBeNull();
    expect(c.snapshot()).toMatchObject({ status: "unknown", pending: { key } });
  });

  it.each([404, 413, 422, 409])("retains editable preparation after a certain %i rejection", async status => {
    const c = setup(async () => json({ detail: status === 422 ? "unsupported_fixture" : "unavailable" }, status));
    expect(await c.submit()).toBeNull();
    expect(c.snapshot()).toMatchObject({ status: "error", pending: null, origin: origin(), data: classData() });
    expect(c.setData({ ...classData(), duration_minutes: 45 })).toBe(true);
    expect(c.cancel()).toBe(true);
    expect(c.snapshot().origin).toBeNull();
  });

  it.each(["suspend", "close"] as const)("rejects late confirmed data after %s", async action => {
    let resolve!: (response: Response) => void;
    let key = "";
    const gate = new Promise<Response>(done => { resolve = done; });
    const c = setup(async (_input, init) => {
      if (init?.method === "POST") { key = new Headers(init.headers).get("Idempotency-Key")!; return gate; }
      return json(result(key));
    });
    const pending = c.submit();
    c[action]();
    resolve(json(result(key), 201));
    expect(await pending).toBeNull();
    expect(c.snapshot().document).toBeNull();
    expect(await c.submit()).toBeNull();
    c.resume();
    if (action === "suspend") expect(await c.recover()).not.toBeNull();
    else { expect(c.snapshot().origin).toBeNull(); expect(await c.recover()).toBeNull(); }
  });

  it("validates class data before transport and does not echo invalid text", async () => {
    let calls = 0;
    const c = setup(async () => { calls++; throw Error("unexpected"); });
    c.setData({ ...classData(), subject: "x".repeat(121), duration_minutes: 14 });
    expect(await c.submit()).toBeNull();
    expect(calls).toBe(0);
    expect(c.snapshot().error).not.toContain("xxx");
  });
});

describe("derivation boundary validation and lookup correlation", () => {
  it.each([
    { subject: "" }, { subject: " \n " }, { subject: "x".repeat(121) }, { subject: "bad\u0000" }, { subject: "bad\ud800" },
    { method: "" }, { method: "x".repeat(81) }, { method: "bad\udfff" },
    { duration_minutes: 14 }, { duration_minutes: 181 }, { duration_minutes: 15.5 }, { duration_minutes: NaN },
  ])("rejects invalid class input before transport: %j", async invalid => {
    let calls = 0;
    const c = setup(async () => { calls++; throw Error("unexpected"); });
    c.setData({ ...classData(), ...invalid });
    expect(await c.submit()).toBeNull();
    expect(calls).toBe(0);
    expect(c.snapshot().pending).toBeNull();
  });
  it.each(["subject", "duration_minutes", "method"] as const)("does not accept a valid lookup for another %s", async field => {
    let key = "";
    const c = setup(async (_input, init) => {
      if (init?.method === "POST") { key = new Headers(init.headers).get("Idempotency-Key")!; throw Error("lost"); }
      const wrong = result(key);
      if (wrong.request.contract_version !== 2) throw Error("fixture");
      if (field === "duration_minutes") wrong.request.duration_minutes = 45;
      else wrong.request[field] = "Different valid value";
      return json(wrong);
    });
    await c.submit();
    expect(await c.recover()).toBeNull();
    expect(c.snapshot()).toMatchObject({ status: "unknown", pending: { key } });
  });
  it("does not free an uncertain operation after a hidden or revoked source on replay", async () => {
    let calls = 0;
    const c = setup(async () => {
      if (++calls === 1) throw Error("unknown initial commit");
      return json({ detail: "not_found" }, 404);
    });
    await c.submit();
    const pending = c.snapshot().pending;
    await c.recover();
    expect(c.snapshot().pending).toEqual(pending);
    expect(c.cancel()).toBe(false);
    expect(calls).toBe(3);
  });
});
