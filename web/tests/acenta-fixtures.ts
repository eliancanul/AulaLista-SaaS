/** Test-only in-memory HTTP fixtures. Never imported by the production entrypoint. */
import {
  waterContext,
  waterPrompt,
  waterSource,
  type PlanningDocument,
  type PlanningRequest,
  type DraftDocument,
  type SourceReceipt,
  type EditRequest,
  type CopyRequest,
  type DraftRequest,
} from "../src/acenta/contracts";
import golden from "./acenta-contract-examples.json" with { type: "json" };
import type { Transport } from "../src/acenta/api";
export const session = {
  actorId: "10000000-0000-4000-8000-000000000001",
  scopeId: "20000000-0000-4000-8000-000000000002",
};
export const workspaceId = "30000000-0000-4000-8000-000000000003";
const now = "2026-10-16T12:00:00+00:00";
export const source: SourceReceipt = {
  source_id: "40000000-0000-4000-8000-000000000004",
  version_id: "50000000-0000-4000-8000-000000000005",
  scope_id: session.scopeId,
  number: 1,
  sha256: golden.source.sha256,
  size: new TextEncoder().encode(waterSource).length,
  actor_id: session.actorId,
  operation_id: "60000000-0000-4000-8000-000000000006",
  created_at: now,
};
export const request: PlanningRequest = {
  contract_version: 1,
  fixture_context: "water-observation-v1",
  prompt: waterPrompt,
  source_id: source.source_id,
  expected_source_version: 1,
};
export function planning(key: string = crypto.randomUUID()): PlanningDocument {
  return {
    receipt: {
      contract_version: 1,
      namespace: "planning-v1",
      planning_id: crypto.randomUUID(),
      revision_id: crypto.randomUUID(),
      revision: 1,
      scope_id: session.scopeId,
      actor_id: session.actorId,
      operation_id: key,
      created_at: now,
      source_id: source.source_id,
      source_version_id: source.version_id,
      source_version: 1,
      source_sha256: source.sha256,
    },
    request: { ...request },
    result: structuredClone(golden.create.result) as PlanningDocument["result"],
  };
}
export function revised(
  base: PlanningDocument,
  text: string,
  key: string = crypto.randomUUID(),
  copy = false,
): PlanningDocument {
  const doc = structuredClone(base);
  doc.receipt = {
    ...doc.receipt,
    revision_id: crypto.randomUUID(),
    operation_id: key,
    revision: copy ? 1 : base.receipt.revision + 1,
    planning_id: copy ? crypto.randomUUID() : base.receipt.planning_id,
  };
  doc.result.resources![0].elements[0].text = text;
  const common = {
    contract_version: 1 as const,
    resource_key: "observation-sheet",
    element_key: "instruction",
    text,
  };
  doc.request = copy
    ? { ...common, kind: "copy", base_revision: base.receipt.revision }
    : { ...common, kind: "edit", expected_revision: base.receipt.revision };
  doc.initial_request =
    base.initial_request ?? ("prompt" in base.request ? base.request : request);
  if (copy)
    doc.origin = {
      planning_id: base.receipt.planning_id,
      revision_id: base.receipt.revision_id,
      revision: base.receipt.revision,
    };
  return doc;
}
export const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
export interface Call {
  path: string;
  method: string;
  key: string | null;
  body: string | undefined;
}
export class FixtureServer {
  docs = new Map<string, PlanningDocument>();
  history = new Map<string, PlanningDocument>();
  operations = new Map<string, PlanningDocument>();
  sources = new Map<string, SourceReceipt>();
  drafts = new Map<string, DraftDocument>();
  draftOperations = new Map<string, DraftDocument>();
  calls: Call[] = [];
  before: ((call: Call) => Promise<Response | void>) | null = null;
  after: ((call: Call, response: Response) => Promise<Response>) | null = null;
  put(doc: PlanningDocument) {
    this.docs.set(doc.receipt.planning_id, doc);
    this.history.set(`${doc.receipt.planning_id}/${doc.receipt.revision}`, doc);
    this.operations.set(doc.receipt.operation_id, doc);
    return doc;
  }
  transport: Transport = async (input, init = {}) => {
    const path = String(input).split(`/scopes/${session.scopeId}/`)[1];
    const headers = new Headers(init.headers);
    const call: Call = {
      path,
      method: init.method ?? "GET",
      key: headers.get("Idempotency-Key"),
      body: init.body?.toString(),
    };
    this.calls.push(call);
    const intercepted = await this.before?.(call);
    if (intercepted) return intercepted;
    const response = this.handle(call);
    return this.after ? this.after(call, response) : response;
  };
  private handle(c: Call): Response {
    const { path, method, key } = c;
    const body = c.body && path !== "sources" ? JSON.parse(c.body) : null;
    const missing = () => json({ detail: "not_found" }, 404);
    if (path === "sources" && method === "POST") {
      if (c.body !== waterSource)
        return json({ detail: "unsupported_fixture" }, 422);
      const receipt = this.sources.get(key!) ?? {
        ...source,
        operation_id: key!,
      };
      this.sources.set(key!, receipt);
      return json(receipt, 201);
    }
    if (path.startsWith("operations/"))
      return this.sources.has(path.split("/")[1])
        ? json(this.sources.get(path.split("/")[1]))
        : missing();
    if ((path === "sources" || path.startsWith("sources?")) && method === "GET") {
      const query = new URLSearchParams(path.split("?")[1]);
      const after = query.get("after") ?? "";
      const limit = Number(query.get("limit") ?? 50);
      const current = new Map<string, SourceReceipt>();
      for (const receipt of this.sources.values()) {
        const previous = current.get(receipt.source_id);
        if (!previous || receipt.number > previous.number)
          current.set(receipt.source_id, receipt);
      }
      const all = [...current.values()].filter((r) => r.source_id > after)
        .sort((a, b) => a.source_id.localeCompare(b.source_id));
      const items = all.slice(0, limit);
      return json({ items, next_cursor: all.length > limit ? items.at(-1)!.source_id : null });
    }
    if (path.startsWith("planning-operations/"))
      return this.operations.has(path.split("/")[1])
        ? json(this.operations.get(path.split("/")[1]))
        : missing();
    if (path.startsWith("planning-draft-operations/"))
      return this.draftOperations.has(path.split("/")[1])
        ? json(this.draftOperations.get(path.split("/")[1]))
        : missing();
    if (path === "plannings" && method === "POST") {
      const old = this.operations.get(key!);
      if (old) return json(old, 201);
      if (body.prompt !== waterPrompt)
        return json({ detail: "unsupported_fixture" }, 422);
      const d = planning(key!);
      d.request = body;
      return json(this.put(d), 201);
    }
    if (path === "plannings" || path.startsWith("plannings?"))
      return json({ items: [...this.docs.values()], next_cursor: null });
    if (path === "planning-drafts" || path.startsWith("planning-drafts?"))
      return json({ items: [...this.drafts.values()], next_cursor: null });
    if (path.startsWith("planning-drafts/"))
      return this.drafts.has(path.split("/")[1])
        ? json(this.drafts.get(path.split("/")[1]))
        : missing();
    const [, id, action, num] = path.split("/");
    const doc = this.docs.get(id);
    if (!doc) return missing();
    if (method === "GET")
      return action === "revisions"
        ? this.history.has(`${id}/${num}`)
          ? json(this.history.get(`${id}/${num}`))
          : missing()
        : json(doc);
    if (action === "drafts") {
      const old = this.draftOperations.get(key!);
      if (old) return json(old, 201);
      const q = body as DraftRequest;
      const prior = this.drafts.get(num);
      if ((prior?.receipt.draft_revision ?? 0) !== q.expected_draft_revision)
        return json({ detail: "conflict" }, 409);
      const base = this.history.get(`${id}/${q.base_revision}`);
      if (!base) return missing();
      const result = structuredClone(base.result);
      result.resources![0].elements[0].text = q.text;
      const d: DraftDocument = {
        receipt: {
          contract_version: 1,
          namespace: "planning-draft-v1",
          draft_id: num,
          revision_id: crypto.randomUUID(),
          draft_revision: q.expected_draft_revision + 1,
          planning_id: id,
          base_revision: q.base_revision,
          base_revision_id: base.receipt.revision_id,
          scope_id: session.scopeId,
          actor_id: session.actorId,
          operation_id: key!,
          created_at: now,
        },
        request: q,
        result,
      };
      this.drafts.set(num, d);
      this.draftOperations.set(key!, d);
      return json(d, 201);
    }
    const old = this.operations.get(key!);
    if (old) return json(old, 201);
    if (action === "revisions") {
      const q = body as EditRequest;
      if (q.expected_revision !== doc.receipt.revision)
        return json({ detail: "conflict" }, 409);
      return json(this.put(revised(doc, q.text, key!)), 201);
    }
    if (action === "copies") {
      const q = body as CopyRequest;
      const base = this.history.get(`${id}/${q.base_revision}`);
      return base
        ? json(this.put(revised(base, q.text, key!, true)), 201)
        : missing();
    }
    return missing();
  }
}
