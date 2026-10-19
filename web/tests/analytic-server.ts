/** Test-only HTTP fixture. PostgreSQL persistence is covered by integration tests. */
import {
  isAnalyticSectionData,
  type AnalyticSectionData,
  type AnalyticSectionDocument,
} from "../src/acenta/analytic-sections";
import { json, session, type Call } from "./acenta-fixtures";
import { GuidedServer } from "./guided-server";

export class AnalyticServer extends GuidedServer {
  sections = new Map<string, AnalyticSectionDocument>();
  sectionHistory = new Map<string, AnalyticSectionDocument>();
  sectionOperations = new Map<string, AnalyticSectionDocument>();

  putSection(doc: AnalyticSectionDocument) {
    const saved = structuredClone(doc);
    this.sections.set(saved.receipt.section_id, saved);
    this.sectionHistory.set(`${saved.receipt.section_id}/${saved.receipt.revision}`, saved);
    this.sectionOperations.set(saved.receipt.operation_id, saved);
    return saved;
  }

  section(data: AnalyticSectionData, key: string = crypto.randomUUID(), base?: AnalyticSectionDocument) {
    const reference = data.reference && [...this.sources.values()].find(
      source => source.source_id === data.reference!.source_id && source.number === data.reference!.source_version,
    );
    const doc: AnalyticSectionDocument = {
      receipt: {
        contract_version: 1,
        namespace: "analytic-section-v1",
        section_id: base?.receipt.section_id ?? crypto.randomUUID(),
        revision_id: crypto.randomUUID(),
        revision: (base?.receipt.revision ?? 0) + 1,
        scope_id: session.scopeId,
        actor_id: session.actorId,
        operation_id: key,
        created_at: "2026-10-18T21:00:00+00:00",
        source_id: reference?.source_id ?? null,
        source_version_id: reference?.version_id ?? null,
        source_version: reference?.number ?? null,
        source_sha256: reference?.sha256 ?? null,
      },
      data: structuredClone(data),
      provenance: "manual-v1",
    };
    return this.putSection(doc);
  }

  protected override handle(call: Call): Response {
    const { path, method, key } = call;
    const missing = () => json({ detail: "not_found" }, 404);
    if (path.startsWith("analytic-section-operations/") && method === "GET")
      return this.sectionOperations.has(path.split("/")[1])
        ? json(this.sectionOperations.get(path.split("/")[1])) : missing();
    if ((path === "analytic-sections" || path.startsWith("analytic-sections?")) && method === "GET") {
      const query = new URLSearchParams(path.split("?")[1]);
      const after = query.get("after") ?? "", limit = Number(query.get("limit") ?? 50);
      const all = [...this.sections.values()]
        .filter(doc => doc.receipt.section_id > after)
        .sort((a, b) => a.receipt.section_id.localeCompare(b.receipt.section_id));
      const items = all.slice(0, limit);
      return json({ items, next_cursor: all.length > limit ? items.at(-1)!.receipt.section_id : null });
    }
    if (!path.startsWith("analytic-sections")) return super.handle(call);
    const [, id, action, revision] = path.split("/");
    const doc = this.sections.get(id);
    if (method === "GET")
      return action === "revisions"
        ? this.sectionHistory.has(`${id}/${revision}`)
          ? json(this.sectionHistory.get(`${id}/${revision}`)) : missing()
        : doc ? json(doc) : missing();
    if (method !== "POST" || (id && action !== "revisions")) return missing();
    const request = JSON.parse(call.body ?? "null");
    const data = id ? request?.data : request;
    if (!key || !isAnalyticSectionData(data)) return json({ detail: "invalid_request" }, 422);
    const prior = this.sectionOperations.get(key);
    if (prior) return json(prior, 201);
    if (id && !doc) return missing();
    if (doc && request.expected_revision !== doc.receipt.revision)
      return json({ detail: "conflict" }, 409);
    if (data.reference && ![...this.sources.values()].some(source =>
      source.source_id === data.reference!.source_id && source.number === data.reference!.source_version))
      return missing();
    return json(this.section(data, key, doc), 201);
  }
}
