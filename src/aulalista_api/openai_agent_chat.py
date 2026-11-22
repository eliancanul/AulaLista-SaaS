"""Multi-teacher OpenAI Responses provider for Orchestrator and Subject Agent chats.

Explicit opt-in via AULALISTA_OPENAI_CHAT_ENABLED=true + OPENAI_API_KEY.
When disabled, this module never reads OPENAI_API_KEY and remains fail-closed.
"""

from __future__ import annotations

import json
import os
import re
import unicodedata
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Literal, Protocol

import requests

DEFAULT_CHAT_MODEL = "gpt-6-luna"
DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"
DEFAULT_SCOPE_BUDGET_USD = Decimal("10")
MAX_RESPONSE_BYTES = 131_072
MAX_OUTPUT_TOKENS = 1536
REQUEST_TIMEOUT = (5, 45)


class AgentChatProviderError(Exception):
    def __init__(self, code: str, status: int = 502):
        super().__init__(code)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class SubjectDigest:
    subject_id: str
    subject_name: str
    turn_count: int
    summary_topic: str
    digest: str
    recent_annexes: tuple[str, ...] = ()


@dataclass(frozen=True)
class AgentPromptContext:
    agent_kind: Literal["orchestrator", "subject"]
    school_name: str
    grade: str
    shift: str
    subject_name: str | None = None
    context_notes: str = ""
    subject_digests: tuple[SubjectDigest, ...] = ()
    other_schools: tuple[str, ...] = ()
    orchestrator_brief: str = ""
    recent_subject_annexes: tuple[str, ...] = ()


@dataclass(frozen=True)
class AgentChatReply:
    text: str
    model: str
    input_tokens: int | None
    output_tokens: int | None
    estimated_cost_usd: Decimal | None


class AgentChatProvider(Protocol):
    @property
    def is_configured(self) -> bool: ...

    @property
    def model_name(self) -> str: ...

    @property
    def scope_budget_usd(self) -> Decimal: ...

    def generate(
        self,
        *,
        context: AgentPromptContext,
        messages: list[dict[str, str]],
    ) -> AgentChatReply: ...


def build_agent_instructions(context: AgentPromptContext) -> str:
    """Build clean, role-specific instructions that prevent cross-subject clutter."""
    if context.agent_kind == "orchestrator":
        lines = [
            (
                f"Eres Luna, la coordinadora general (orquestadora) del docente en Acenta "
                f"para la escuela {context.school_name} ({context.grade}, turno {context.shift})."
            ),
            (
                "Tu función es mantener la visión panorámica del grupo: organizar la semana, "
                "coordinar actividades entre asignaturas, priorizar pendientes y orientar al docente "
                "sin mezclar conversaciones largas de cada materia en este hilo."
            ),
            (
                "Sólo recibes resúmenes compactos de cada agente de materia (no sus conversaciones completas) "
                "para mantener tu contexto limpio y ágil."
            ),
            "Reglas estrictas:",
            "1) Responde en español claro, cercano y práctico para docentes de educación básica en México.",
            "2) Usa únicamente el contexto proporcionado; nunca afirmes haber leído archivos que no fueron compartidos ni inventes citas oficiales.",
            (
                "3) Si el docente pide trabajo profundo y específico de UNA sola materia "
                "(por ejemplo, redactar muchos ejercicios, una lectura completa o una secuencia detallada), "
                "da una orientación breve y clara y recomienda continuar en el agente especialista de esa materia "
                "para mantener el historial organizado."
            ),
            (
                "4) Si el docente pide planear la semana, cruzar dos o más materias, revisar el avance general "
                "del grupo o tomar decisiones de organización, resuélvelo directamente aquí."
            ),
        ]
        if context.subject_digests:
            lines.append("")
            lines.append(
                f"Estado compacto de los agentes de materia en {context.school_name} ({context.grade}):"
            )
            for item in context.subject_digests[:15]:
                if item.turn_count > 0 and item.digest:
                    summary_piece = f"{item.turn_count} turnos · {item.digest}"
                elif item.summary_topic:
                    summary_piece = f"Tema activo: {item.summary_topic}"
                else:
                    summary_piece = "Sin conversación reciente"
                annex_piece = (
                    f" · Anexos recientes: {', '.join(item.recent_annexes[:3])}"
                    if item.recent_annexes
                    else ""
                )
                lines.append(f"- {item.subject_name}: {summary_piece}{annex_piece}")
        if context.other_schools:
            lines.append("")
            lines.append(
                "Otras escuelas del docente (referencia breve): "
                + "; ".join(context.other_schools[:8])
            )
        return "\n".join(lines)

    subject_label = context.subject_name or "la asignatura"
    lines = [
        (
            f"Eres Luna, agente especialista en {subject_label} para {context.grade} "
            f"en la escuela {context.school_name} (turno {context.shift})."
        ),
        (
            f"Este hilo es exclusivo de {subject_label}: concéntrate únicamente en esta asignatura "
            "y este grado, entregando propuestas concretas y listas para usar en clase."
        ),
        "Reglas estrictas:",
        "1) Responde en español claro, ordenado y práctico para docentes de educación básica en México.",
        "2) No inventes citas oficiales ni afirmes haber leído documentos o archivos ausentes.",
        (
            "3) Cuando tenga sentido producir una hoja imprimible para el alumnado, puedes proponer "
            "el borrador aquí y recordar que se puede generar en formato Carta listo para imprimir en Anexos."
        ),
    ]
    if context.orchestrator_brief:
        lines.append("")
        lines.append(
            f"Nota breve de coordinación general ({context.school_name}): {context.orchestrator_brief}"
        )
    if context.recent_subject_annexes:
        lines.append("")
        lines.append(
            f"Anexos recientes de {subject_label}: "
            + ", ".join(context.recent_subject_annexes[:5])
        )
    return "\n".join(lines)


def _collapse_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def build_compact_digest(user_text: str, assistant_text: str) -> tuple[str, str]:
    """Produce a tiny, bounded (topic, digest) pair without an extra LLM call."""
    clean_user = _collapse_whitespace(user_text)
    topic = clean_user[:115].rstrip(" ,;:-")
    if len(clean_user) > 115:
        topic = topic + "…"

    # Pick the first meaningful sentence/line from Luna's answer for compact status.
    first_lines = [
        _collapse_whitespace(line.lstrip("-*•#0123456789. "))
        for line in assistant_text.splitlines()
        if line.strip()
    ]
    takeaway = first_lines[0] if first_lines else ""
    if len(takeaway) > 170:
        takeaway = takeaway[:167].rstrip(" ,;:-") + "…"

    if takeaway:
        digest = f"Tema: {topic} — {takeaway}"
    else:
        digest = f"Tema: {topic}"
    if len(digest) > 360:
        digest = digest[:357].rstrip(" ,;:-") + "…"
    return topic[:160], digest[:400]


def _fold(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", text.lower())
    return "".join(ch for ch in normalized if not unicodedata.combining(ch))


def detect_delegated_subject(
    user_text: str,
    assistant_text: str,
    subjects: list[tuple[str, str]],
) -> str | None:
    """When the orchestrator focuses on a single subject, return its subject_id for 1-click handoff."""
    if not subjects:
        return None
    combined = _fold(f"{user_text}\n{assistant_text}")
    matched: list[str] = []
    for subject_id, subject_name in subjects:
        folded_name = _fold(subject_name).strip()
        if not folded_name or len(folded_name) < 3:
            continue
        if re.search(rf"\b{re.escape(folded_name)}\b", combined):
            matched.append(subject_id)
    if len(matched) == 1:
        return matched[0]
    # If the user specifically mentioned one subject even if assistant referenced others:
    folded_user = _fold(user_text)
    user_matches = [
        sid
        for sid, sname in subjects
        if len(_fold(sname).strip()) >= 3
        and re.search(rf"\b{re.escape(_fold(sname).strip())}\b", folded_user)
    ]
    if len(user_matches) == 1:
        return user_matches[0]
    return None


def _estimate_cost(
    input_tokens: int | None, output_tokens: int | None
) -> Decimal | None:
    if input_tokens is None or output_tokens is None:
        return None
    if input_tokens < 0 or output_tokens < 0:
        return None
    input_rate, output_rate = (
        (Decimal("0.20"), Decimal("0.75"))
        if input_tokens > 272_000
        else (Decimal("0.10"), Decimal("0.50"))
    )
    return (
        Decimal(input_tokens) * input_rate + Decimal(output_tokens) * output_rate
    ) / Decimal(1_000_000)


def _extract_response_text(body: dict[str, Any]) -> str:
    output_text = body.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()
    items = body.get("output")
    if isinstance(items, list):
        chunks: list[str] = []
        for item in items:
            if not isinstance(item, dict) or item.get("type") != "message":
                continue
            for part in item.get("content", []):
                if not isinstance(part, dict):
                    continue
                if part.get("type") == "refusal":
                    raise AgentChatProviderError("chat_refusal", status=422)
                if part.get("type") == "output_text" and isinstance(
                    part.get("text"), str
                ):
                    text = part["text"].strip()
                    if text:
                        chunks.append(text)
        if chunks:
            return "\n\n".join(chunks)
    raise AgentChatProviderError("chat_invalid_response", status=502)


class OpenAIAgentChatProvider:
    """Calls OpenAI Responses API cleanly for multi-teacher Orchestrator/Subject chats."""

    def __init__(
        self,
        *,
        api_key: str,
        model: str = DEFAULT_CHAT_MODEL,
        base_url: str = DEFAULT_OPENAI_BASE_URL,
        scope_budget_usd: Decimal = DEFAULT_SCOPE_BUDGET_USD,
        transport=None,
    ):
        self._api_key = api_key.strip()
        self._model = model.strip() or DEFAULT_CHAT_MODEL
        self._base_url = base_url.rstrip("/")
        self._scope_budget_usd = scope_budget_usd
        self._transport = transport

    @property
    def is_configured(self) -> bool:
        return bool(self._api_key)

    @property
    def model_name(self) -> str:
        return self._model

    @property
    def scope_budget_usd(self) -> Decimal:
        return self._scope_budget_usd

    def build_payload(
        self,
        *,
        context: AgentPromptContext,
        messages: list[dict[str, str]],
    ) -> dict[str, Any]:
        prepared_messages = [dict(m) for m in messages]
        if context.context_notes.strip() and prepared_messages:
            prepared_messages[0] = {
                **prepared_messages[0],
                "content": (
                    "Notas de contexto del docente:\n"
                    + context.context_notes.strip()
                    + "\n\nMensaje:\n"
                    + prepared_messages[0]["content"]
                ),
            }
        payload: dict[str, Any] = {
            "model": self._model,
            "instructions": build_agent_instructions(context),
            "input": prepared_messages,
            "text": {"format": {"type": "text"}},
            "max_output_tokens": MAX_OUTPUT_TOKENS,
            "store": False,
        }
        if self._model.startswith(("gpt-5", "gpt-6")):
            payload["reasoning"] = {"effort": "none"}
        return payload

    def _post(self, payload: dict[str, Any]) -> tuple[int, bytes]:
        url = f"{self._base_url}/responses"
        if self._transport is not None:
            return self._transport(url, payload)
        try:
            response = requests.post(
                url,
                json=payload,
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                timeout=REQUEST_TIMEOUT,
            )
            return response.status_code, response.content[: MAX_RESPONSE_BYTES + 1]
        except requests.Timeout:
            raise AgentChatProviderError("chat_timeout", status=504) from None
        except requests.RequestException:
            raise AgentChatProviderError("chat_transport_error", status=502) from None

    def generate(
        self,
        *,
        context: AgentPromptContext,
        messages: list[dict[str, str]],
    ) -> AgentChatReply:
        if not self._api_key:
            raise AgentChatProviderError("chat_unavailable", status=503)
        payload = self.build_payload(context=context, messages=messages)
        status, raw = self._post(payload)
        if status in (401, 403):
            raise AgentChatProviderError("chat_authentication_error", status=502)
        if status == 429:
            raise AgentChatProviderError("chat_rate_limited", status=429)
        if status == 400:
            raise AgentChatProviderError("chat_rejected", status=502)
        if status != 200:
            raise AgentChatProviderError("chat_http_error", status=502)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise AgentChatProviderError("chat_response_too_large", status=502)
        try:
            body = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeError):
            raise AgentChatProviderError("chat_invalid_json", status=502) from None
        if not isinstance(body, dict) or body.get("status") != "completed":
            raise AgentChatProviderError("chat_incomplete", status=502)
        text = _extract_response_text(body)
        if "\x00" in text or len(text.encode("utf-8")) > 32768:
            text = text.replace("\x00", "")[:16000].strip()
            if not text:
                raise AgentChatProviderError("chat_invalid_response", status=502)
        usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}
        raw_in = usage.get("input_tokens")
        raw_out = usage.get("output_tokens")
        input_tokens = raw_in if type(raw_in) is int and raw_in >= 0 else None
        output_tokens = raw_out if type(raw_out) is int and raw_out >= 0 else None
        returned_model = body.get("model")
        model_label = (
            returned_model.strip()[:128]
            if isinstance(returned_model, str) and returned_model.strip()
            else self._model
        )
        return AgentChatReply(
            text=text,
            model=model_label,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            estimated_cost_usd=_estimate_cost(input_tokens, output_tokens),
        )


class UnconfiguredAgentChatProvider:
    """Explicit fail-closed runtime provider when AULALISTA_OPENAI_CHAT_ENABLED != true."""

    def __init__(
        self,
        model: str = DEFAULT_CHAT_MODEL,
        scope_budget_usd: Decimal = DEFAULT_SCOPE_BUDGET_USD,
    ):
        self._model = model
        self._scope_budget_usd = scope_budget_usd

    @property
    def is_configured(self) -> bool:
        return False

    @property
    def model_name(self) -> str:
        return self._model

    @property
    def scope_budget_usd(self) -> Decimal:
        return self._scope_budget_usd

    def generate(
        self,
        *,
        context: AgentPromptContext,
        messages: list[dict[str, str]],
    ) -> AgentChatReply:
        raise AgentChatProviderError("chat_unavailable", status=503)


class FakeAgentChatProvider:
    """Deterministic local/CI provider for multi-agent unit and E2E verification."""

    def __init__(
        self,
        *,
        model: str = "fake-luna-agent",
        scope_budget_usd: Decimal = DEFAULT_SCOPE_BUDGET_USD,
    ):
        self._model = model
        self._scope_budget_usd = scope_budget_usd
        self.calls: list[tuple[AgentPromptContext, list[dict[str, str]]]] = []

    @property
    def is_configured(self) -> bool:
        return True

    @property
    def model_name(self) -> str:
        return self._model

    @property
    def scope_budget_usd(self) -> Decimal:
        return self._scope_budget_usd

    def generate(
        self,
        *,
        context: AgentPromptContext,
        messages: list[dict[str, str]],
    ) -> AgentChatReply:
        self.calls.append((context, [dict(m) for m in messages]))
        last_user = messages[-1]["content"] if messages else ""
        if context.agent_kind == "orchestrator":
            active = [d.subject_name for d in context.subject_digests if d.turn_count > 0]
            digest_note = (
                f" Tengo el resumen compacto de: {', '.join(active)}."
                if active
                else " Aún no hay actividad en los agentes de materia."
            )
            reply = (
                f"[Orquestador · {context.school_name} {context.grade}] "
                f"Recibido: {last_user}.{digest_note}"
            )
        else:
            reply = (
                f"[Agente {context.subject_name} · {context.school_name} {context.grade}] "
                f"Propuesta enfocada en {context.subject_name} para: {last_user}."
            )
        return AgentChatReply(
            text=reply,
            model=self._model,
            input_tokens=120,
            output_tokens=64,
            estimated_cost_usd=Decimal("0.000044"),
        )


def _parse_budget(raw: str | None) -> Decimal:
    if not raw:
        return DEFAULT_SCOPE_BUDGET_USD
    try:
        value = Decimal(raw.strip())
    except InvalidOperation:
        return DEFAULT_SCOPE_BUDGET_USD
    if not value.is_finite() or value <= 0:
        return DEFAULT_SCOPE_BUDGET_USD
    return value


def load_agent_chat_provider_from_env() -> AgentChatProvider:
    """Opt-in multi-teacher OpenAI chat provider; never reads OPENAI_API_KEY unless enabled."""
    if (
        os.environ.get("AULALISTA_OPENAI_CHAT_ENABLED", "false").strip().lower()
        != "true"
    ):
        return UnconfiguredAgentChatProvider()
    model = (
        os.environ.get("AULALISTA_OPENAI_CHAT_MODEL", "").strip()
        or os.environ.get("OPENAI_MODEL", DEFAULT_CHAT_MODEL).strip()
        or DEFAULT_CHAT_MODEL
    )
    budget = _parse_budget(os.environ.get("AULALISTA_CHAT_SCOPE_BUDGET_USD"))
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        return UnconfiguredAgentChatProvider(model=model, scope_budget_usd=budget)
    base_url = (
        os.environ.get("OPENAI_BASE_URL", DEFAULT_OPENAI_BASE_URL).strip()
        or DEFAULT_OPENAI_BASE_URL
    )
    return OpenAIAgentChatProvider(
        api_key=api_key,
        model=model,
        base_url=base_url,
        scope_budget_usd=budget,
    )
