import { describe, expect, it } from "vitest";
import { AcentaApi } from "../src/acenta/api";
import { chatTextError, parseChatDocument } from "../src/acenta/chat-contracts";
import { appendTurn, chatDocument, chatId, ChatServer, otherChatId } from "./chat-fixtures";
import { json, session } from "./acenta-fixtures";

describe("private chat contract", () => {
  it("uses scoped same-origin no-store requests and exact operation/CAS bodies", async () => {
    const server = new ChatServer(), api = new AcentaApi(session, server.transport), createKey = crypto.randomUUID(), turnKey = crypto.randomUUID();
    expect(await api.chatAvailable()).toBe(true);
    const doc = await api.createConversation(createKey);
    await api.sendChatTurn(doc.conversation.id, "  Texto propio  ", 0, turnKey, 0);
    await api.chatTurnOperation(doc.conversation.id, turnKey, "  Texto propio  ", 0);
    await api.conversationOperation(createKey);
    expect(server.calls[1]).toMatchObject({method: "POST", key: createKey, body: {}});
    expect(server.calls[2]).toMatchObject({method: "POST", key: turnKey, body: {text: "  Texto propio  ", expected_version: 0, expected_context_revision: 0}});
    expect(server.calls.every(call => call.init.credentials === "same-origin" && call.init.cache === "no-store")).toBe(true);
    expect(server.calls.slice(3).every(call => call.method === "GET" && !call.key && call.body === null)).toBe(true);
  });
  it("enforces both Unicode character and encoded text limits without network", async () => {
    const server = new ChatServer(), api = new AcentaApi(session, server.transport);
    expect(chatTextError("x".repeat(4096))).toBe("");
    expect(chatTextError("😀".repeat(2048))).toBe("");
    for (const text of ["x".repeat(4097), "😀".repeat(2049), "\ud800", "\u0000", " "])
      await expect(api.sendChatTurn(chatId, text, 0, crypto.randomUUID(), 0)).rejects.toMatchObject({status: 422});
    expect(server.calls).toHaveLength(0);
  });
  it("allows a bounded escaped JSON request whose decoded text fits", async () => {
    const server = new ChatServer(), api = new AcentaApi(session, server.transport);
    server.documents.set(chatId, chatDocument());
    await api.sendChatTurn(chatId, "a" + "\u0001".repeat(4095), 0, crypto.randomUUID(), 0);
    expect(server.calls).toHaveLength(1);
  });
  it.each(["conversation", "operation", "text", "number"])("rejects a substituted %s receipt", async field => {
    const key = crypto.randomUUID(), doc = appendTurn(chatDocument(), key, "Mi texto");
    if (field === "conversation") doc.conversation.id = otherChatId;
    if (field === "operation") doc.turns[0].operation_id = crypto.randomUUID();
    if (field === "text") doc.turns[0].user_text = "Otro texto";
    if (field === "number") { doc.conversation.version = 2; doc.turns[0].number = 2; }
    const api = new AcentaApi(session, async () => json(doc));
    await expect(api.sendChatTurn(chatId, "Mi texto", 0, key, 0)).rejects.toMatchObject({code: "invalid_response"});
  });
  it.each(["negative usage", "unknown cost", "missing turn", "duplicate operation", "oversized assistant", "unconfirmed assistant"])("rejects malformed history: %s", kind => {
    const doc = appendTurn(chatDocument(), crypto.randomUUID(), "Mensaje");
    if (kind === "negative usage") doc.turns[0].usage.input_tokens = -1;
    if (kind === "unknown cost") doc.turns[0].usage.estimated_cost_usd = "NaN";
    if (kind === "missing turn") doc.turns[0].number = 2;
    if (kind === "duplicate operation") appendTurn(doc, doc.turns[0].operation_id, "Otro");
    if (kind === "oversized assistant") doc.turns[0].assistant_text = "a".repeat(32769);
    if (kind === "unconfirmed assistant") doc.turns[0].state = "uncertain";
    expect(() => parseChatDocument(doc)).toThrow();
  });
  it("preserves unknown usage as null", () => {
    const doc = appendTurn(chatDocument(), crypto.randomUUID(), "Mensaje", "uncertain");
    doc.turns[0].usage = {input_tokens: null, output_tokens: null, estimated_cost_usd: null, reserved_usd: "0.02"};
    expect(parseChatDocument(doc).turns[0].usage.input_tokens).toBeNull();
  });
  it("validates cursor order and pagination boundaries", async () => {
    const docs = [chatDocument(), chatDocument(otherChatId)], server = new ChatServer(), api = new AcentaApi(session, server.transport);
    docs.forEach(doc => server.documents.set(doc.conversation.id, doc));
    const first = await api.listConversations(undefined, 1);
    expect(first.next_cursor).toBe(chatId);
    expect((await api.listConversations(first.next_cursor!, 1)).items[0].id).toBe(otherChatId);
    expect(server.calls[1].path).toContain(`cursor=${chatId}`);
    server.intercept = () => json({items: [docs[1].conversation, docs[0].conversation], next_cursor: null});
    await expect(api.listConversations()).rejects.toMatchObject({code: "invalid_response"});
    server.intercept = () => json({items: [docs[0].conversation], next_cursor: otherChatId});
    await expect(api.listConversations()).rejects.toMatchObject({code: "invalid_response"});
  });
});
