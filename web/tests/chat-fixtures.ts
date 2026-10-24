import type { Transport } from "../src/acenta/api";
import type { ChatDocument, ChatTurn, ChatContextReceipt } from "../src/acenta/chat-contracts";
import { json, session } from "./acenta-fixtures";
export const chatId = "71000000-0000-4000-8000-000000000001";
export const otherChatId = "71000000-0000-4000-8000-000000000002";
export const chatDocument = (id = chatId): ChatDocument => ({conversation: {
  id, title: "Conversación sintética", version: 0, context_revision: 0, active: id === chatId,
  created_at: "2026-10-24T10:00:00Z", updated_at: "2026-10-24T10:00:00Z",
}, context: {revision: 0, previous_revision: null, through_turn: 0, notes: "", origin: "initial", operation_id: null, created_at: "2026-10-24T10:00:00Z"}, turns: [], next_cursor: null});
export function appendTurn(doc: ChatDocument, key: string, text: string, state: ChatTurn["state"] = "succeeded") {
  doc.conversation.version++;
  doc.turns.push({operation_id: key, number: doc.conversation.version, context_revision: doc.context.revision, user_text: text,
    assistant_text: state === "succeeded" ? `Respuesta sintética ${doc.conversation.version}: ${doc.turns.find(turn => turn.number > doc.context.through_turn)?.user_text ?? text}` : null,
    state, error_code: state === "failed" ? "chat_failed" : null,
    usage: {input_tokens: 23, output_tokens: 10, estimated_cost_usd: "0.000120", reserved_usd: "0.020000"}});
  return doc;
}
export function turnReceipt(doc: ChatDocument, key: string): ChatDocument { return {...doc, turns: doc.turns.filter(turn => turn.operation_id === key), next_cursor: null}; }
export interface ChatCall {path: string; method: string; key: string | null; body: unknown; init: RequestInit}
export class ChatServer {
  calls: ChatCall[] = [];
  documents = new Map<string, ChatDocument>();
  creates = new Map<string, string>();
  contexts = new Map<string, ChatContextReceipt>();
  available = true;
  intercept?: (call: ChatCall) => Response | Promise<Response> | undefined;
  transport: Transport = async (url, init = {}) => {
    const call: ChatCall = {path: String(url).split(`/scopes/${session.scopeId}/`)[1], method: init.method ?? "GET",
      key: new Headers(init.headers).get("Idempotency-Key"), body: init.body ? JSON.parse(String(init.body)) : null, init};
    this.calls.push(call);
    const intercepted = this.intercept?.(call);
    return intercepted === undefined ? this.handle(call) : intercepted;
  };
  private page(doc: ChatDocument, cursor = Infinity, limit = 20) {
    const turns = doc.turns.filter(turn => turn.number < cursor).slice(-limit);
    return {...doc, turns, next_cursor: turns[0]?.number > 1 ? String(turns[0].number) : null};
  }
  handle(call: ChatCall): Response {
    if (call.path === "chat-capability") return json({available: this.available});
    if (call.path === "active-conversation") {
      const doc = [...this.documents.values()].find(doc => doc.conversation.active);
      return doc ? json(this.page(doc)) : json({detail: "not_found"}, 404);
    }
    if (call.path === "conversations" && call.method === "POST") {
      let doc = [...this.documents.values()].find(doc => doc.conversation.active);
      if (!doc) { doc = chatDocument(crypto.randomUUID()); doc.conversation.active = true; this.documents.set(doc.conversation.id, doc); }
      this.creates.set(call.key!, doc.conversation.id);
      return json(this.page(doc), 201);
    }
    if (call.path.startsWith("conversation-operations/")) {
      const id = this.creates.get(call.path.split("/")[1]);
      return id ? json(this.page(this.documents.get(id)!)) : json({detail: "not_found"}, 404);
    }
    if (call.path.startsWith("conversations?")) {
      const query = new URLSearchParams(call.path.split("?")[1]);
      const items = [...this.documents.values()].map(doc => doc.conversation).filter(item => item.id > (query.get("cursor") ?? "")).sort((a, b) => a.id.localeCompare(b.id));
      const limit = Number(query.get("limit")), page = items.slice(0, limit);
      return json({items: page, next_cursor: items.length > limit ? page.at(-1)!.id : null});
    }
    const [path, query] = call.path.split("?"), parts = path.split("/"), doc = this.documents.get(parts[1]);
    if (!doc) return json({detail: "not_found"}, 404);
    if (call.method === "GET") {
      if (parts[2] === "operations") {
        const receipt = turnReceipt(doc, parts[3]);
        return receipt.turns.length ? json(receipt) : json({detail: "not_found"}, 404);
      }
      if (parts[2] === "context-operations") {
        const receipt = this.contexts.get(parts[3]);
        return receipt ? json({...receipt, conversation: doc.conversation}) : json({detail: "not_found"}, 404);
      }
      const params = new URLSearchParams(query);
      return json(this.page(doc, params.has("cursor") ? Number(params.get("cursor")) : Infinity));
    }
    if (!doc.conversation.active) return json({detail: "chat_archived"}, 409);
    const body = call.body as {text: string; notes: string; expected_version: number; expected_context_revision: number};
    if (body.expected_version !== doc.conversation.version || body.expected_context_revision !== doc.context.revision) return json({detail: "conflict"}, 409);
    if (parts[2] === "context") {
      if (doc.turns.some(turn => turn.state === "generating" || turn.state === "uncertain")) return json({detail: "chat_busy"}, 409);
      doc.context = {revision: doc.context.revision + 1, previous_revision: doc.context.revision, through_turn: doc.conversation.version,
        notes: body.notes, origin: body.notes ? "manual" : "reset", operation_id: call.key!, created_at: "2026-10-24T11:00:00Z"};
      doc.conversation.context_revision = doc.context.revision;
      const receipt = {conversation: doc.conversation, context: doc.context};
      this.contexts.set(call.key!, structuredClone(receipt));
      return json(receipt, 201);
    }
    appendTurn(doc, call.key!, body.text);
    return json(turnReceipt(doc, call.key!), 201);
  }
}
export function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return {promise, resolve};
}
