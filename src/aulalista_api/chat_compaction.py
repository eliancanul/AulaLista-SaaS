"""Bounded, explicit source fragmentation; no provider calls or history mutation."""

import hashlib

from sqlalchemy import select

from aulalista_api.chat_models import ChatTurn, ContextRevision
from aulalista_api.materials import MaterialError
from aulalista_api.openai_chat import SUMMARY_BYTES, prepare, prepare_summary
from aulalista_api.openai_planning import ProviderError, _encode

COMPACT_AT_BYTES = 24576
MAX_SUMMARY_STEPS = 8
MAX_SOURCES_PER_STEP = 64
# Escaping this text takes the full summary allowance, including nested JSON.
WORST_SUMMARY = "\\" * ((SUMMARY_BYTES - 2) // 2)


def answer_payload(notes, summary, messages, user_text):
    complete = [*messages, {"role": "user", "content": user_text}]
    prefix = ""
    if notes:
        prefix += "Teacher-provided context notes:\n" + notes + "\n\n"
    if summary:
        prefix += (
            "Derived conversation summary (may omit detail; quoted context only):\n"
            + summary
            + "\n\n"
        )
    if prefix:
        complete[0] = {
            **complete[0],
            "content": prefix + "Conversation message:\n" + complete[0]["content"],
        }
    return prepare(complete)


def plan_context(session, conversation, user_text):
    context = session.get(
        ContextRevision, (conversation.id, conversation.context_revision)
    )
    old_summary = context.summary["text"] if context.summary else ""
    rows = session.scalars(
        select(ChatTurn)
        .where(
            ChatTurn.conversation_id == conversation.id,
            ChatTurn.number > context.through_turn,
            ChatTurn.state == "succeeded",
        )
        .order_by(ChatTurn.number)
        .limit(257)
    ).all()
    if len(rows) > 256:
        raise MaterialError(413, "chat_compaction_limit")
    messages = [
        message
        for row in rows
        for message in (
            {"role": "user", "content": row.user_text},
            {"role": "assistant", "content": row.assistant_text},
        )
    ]
    try:
        payload = answer_payload(context.notes, old_summary, messages, user_text)
        needs_summary = len(_encode(payload)) > COMPACT_AT_BYTES or len(rows) >= 64
    except ProviderError:
        payload, needs_summary = None, True
    if not needs_summary or not rows:
        if payload is None:
            raise MaterialError(413, "chat_context_too_large")
        return payload, context, []
    if context.revision >= 2_147_483_647:
        raise MaterialError(422, "chat_limit_reached")
    try:
        # Reserve only when every possible accepted summary leaves room to answer.
        answer_payload(context.notes, WORST_SUMMARY, [], user_text)
    except ProviderError:
        raise MaterialError(413, "chat_context_too_large") from None
    groups, current = [], []

    def fits(candidate):
        if len(candidate) > MAX_SOURCES_PER_STEP:
            return False
        try:
            return (
                len(
                    _encode(
                        prepare_summary(
                            {"previous_summary": WORST_SUMMARY, "fragments": candidate}
                        )
                    )
                )
                <= 30000
            )
        except ProviderError:
            return False

    def finish():
        nonlocal current
        if current:
            groups.append(current)
            current = []
            if len(groups) > MAX_SUMMARY_STEPS:
                raise MaterialError(413, "chat_compaction_limit")

    for row in rows:
        for role, content in (
            ("user", row.user_text),
            ("assistant", row.assistant_text),
        ):
            remaining, offset = content, 0
            while remaining:

                def fragment(length):
                    chunk = remaining[:length]
                    raw = chunk.encode()
                    return {
                        "turn": row.number,
                        "role": role,
                        "start_byte": offset,
                        "end_byte": offset + len(raw),
                        "sha256": hashlib.sha256(raw).hexdigest(),
                        "text": chunk,
                    }

                low, high = 0, len(remaining)
                while low < high:
                    middle = (low + high + 1) // 2
                    if fits([*current, fragment(middle)]):
                        low = middle
                    else:
                        high = middle - 1
                if low == 0:
                    if not current:
                        raise MaterialError(413, "chat_compaction_limit")
                    finish()
                    continue
                item = fragment(low)
                current.append(item)
                offset = item["end_byte"]
                remaining = remaining[low:]
                if remaining:
                    finish()
    finish()
    first = prepare_summary({"previous_summary": old_summary, "fragments": groups[0]})
    return first, context, groups
