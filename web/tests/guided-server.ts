/** Test-only software fixture server. Real persistence is exercised separately. */
import { FixtureServer, json, type Call } from "./acenta-fixtures";
import { guidedPlanning, guidedRevised, guidedDraft } from "./guided-fixtures";
import { isGuided } from "../src/acenta/guided-planning";
export class GuidedServer extends FixtureServer {
  protected override handle(call: Call): Response {
    const { path, method, key } = call;
    const q = call.body && path !== "sources" ? JSON.parse(call.body) : null;
    if (path === "guided-plannings" && method === "POST") {
      const old = this.operations.get(key!);
      if (old) return json(old, 201);
      if (
        q.subject !== "Ciencias naturales" ||
        q.grade !== "3.º de primaria" ||
        q.topic !== "El cuidado del agua en la comunidad" ||
        q.method !== "active-learning" ||
        q.language !== "es"
      )
        return json({ detail: "unsupported_fixture" }, 422);
      return json(this.put(guidedPlanning(key!, q)), 201);
    }
    const [, id, action, draftId] = path.split("/");
    const doc = this.docs.get(id);
    if (
      (method !== "POST" && !(method === "PUT" && action === "drafts")) ||
      !doc ||
      !isGuided(doc.result)
    )
      return super.handle(call);
    if (action === "drafts") {
      const old = this.draftOperations.get(key!);
      if (old) return json(old, 201);
      const prior = this.drafts.get(draftId);
      if ((prior?.receipt.draft_revision ?? 0) !== q.expected_draft_revision)
        return json({ detail: "conflict" }, 409);
      const base = this.history.get(`${id}/${q.base_revision}`);
      if (!base) return json({ detail: "not_found" }, 404);
      const draft = guidedDraft(
        base,
        q.text,
        key!,
        draftId,
        q.resource_key,
        q.element_key,
      );
      draft.request = q;
      draft.receipt.draft_revision = q.expected_draft_revision + 1;
      this.drafts.set(draftId, draft);
      this.draftOperations.set(key!, draft);
      return json(draft, 201);
    }
    const old = this.operations.get(key!);
    if (old) return json(old, 201);
    if (action === "revisions") {
      if (q.expected_revision !== doc.receipt.revision)
        return json({ detail: "conflict" }, 409);
      if (
        q.element_key === "minutes" &&
        !/^(?:[1-9]|[1-9][0-9]|1[0-7][0-9]|180)$/.test(q.text)
      )
        return json({ detail: "unsupported_target" }, 422);
      return json(
        this.put(
          guidedRevised(
            doc,
            q.text,
            key!,
            false,
            q.resource_key,
            q.element_key,
          ),
        ),
        201,
      );
    }
    if (action === "copies") {
      const base = this.history.get(`${id}/${q.base_revision}`);
      return base
        ? json(
            this.put(
              guidedRevised(
                base,
                q.text,
                key!,
                true,
                q.resource_key,
                q.element_key,
              ),
            ),
            201,
          )
        : json({ detail: "not_found" }, 404);
    }
    return super.handle(call);
  }
}
