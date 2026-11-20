"""Real OpenAI generator for print-ready school annexes + deterministic CI fake."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Any, Literal, Protocol

import requests
from pydantic import BaseModel, ConfigDict, Field, field_validator

DEFAULT_OPENAI_MODEL = "gpt-6-luna"
DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"
MAX_RESPONSE_BYTES = 131_072
REQUEST_TIMEOUT = (5, 45)

ANNEX_SYSTEM_INSTRUCTIONS = (
    "Eres un asistente especializado en crear anexos escolares imprimibles "
    "(hojas de trabajo, ejercicios, lecturas con preguntas o listas de cotejo) "
    "listos para imprimirse en blanco y negro en hoja tamaño Carta. "
    "Responde únicamente con el JSON estructurado solicitado. "
    "REGLAS ESTRICTAS DE FORMATO: "
    "1) Texto limpio y directo para el alumno: SIN saludos, SIN despedidas, SIN comentarios de chat. "
    "2) NUNCA uses sintaxis markdown (prohibido **, __, #, ```, ni enlaces). "
    "3) Redacta consignas claras y apropiadas para el grado escolar solicitado. "
    "4) Usa el idioma solicitado (por defecto español de México). "
    "5) Para preguntas o ejercicios donde el alumno escribe, asigna answer_lines entre 2 y 5; "
    "para lecturas o listas de cotejo usa answer_lines = 0. "
    "6) No inventes citas oficiales ni afirmaciones de validación curricular."
)


class AnnexGeneratorError(Exception):
    def __init__(self, code: str, status: int = 502):
        super().__init__(code)
        self.code = code
        self.status = status


def sanitize_print_text(value: str) -> str:
    """Strip common chat/markdown artifacts so printed worksheets stay crisp."""
    text = value.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    text = re.sub(r"```[a-zA-Z0-9_-]*\n?", "", text)
    text = text.replace("```", "")
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"__(.+?)__", r"\1", text)
    text = re.sub(r"(?m)^\s{0,3}#{1,6}\s+", "", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


class AnnexItemData(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["question", "exercise", "reading", "checklist"]
    text: str = Field(min_length=1, max_length=1500)
    answer_lines: int = Field(ge=0, le=10)

    @field_validator("text")
    @classmethod
    def clean_text(cls, value: str) -> str:
        cleaned = sanitize_print_text(value)
        if not cleaned:
            raise ValueError("empty_text")
        return cleaned


class AnnexSectionData(BaseModel):
    model_config = ConfigDict(extra="forbid")
    heading: str = Field(min_length=1, max_length=160)
    prompt: str = Field(default="", max_length=600)
    items: list[AnnexItemData] = Field(min_length=1, max_length=15)

    @field_validator("heading", "prompt")
    @classmethod
    def clean_fields(cls, value: str) -> str:
        return sanitize_print_text(value)


class AnnexContentData(BaseModel):
    model_config = ConfigDict(extra="forbid")
    subtitle: str = Field(default="", max_length=200)
    student_header_fields: list[str] = Field(
        default_factory=lambda: ["Nombre", "Fecha", "Grupo"],
        min_length=1,
        max_length=5,
    )
    sections: list[AnnexSectionData] = Field(min_length=1, max_length=8)
    footer_note: str = Field(default="", max_length=240)

    @field_validator("subtitle", "footer_note")
    @classmethod
    def clean_optional(cls, value: str) -> str:
        return sanitize_print_text(value)

    @field_validator("student_header_fields")
    @classmethod
    def clean_headers(cls, values: list[str]) -> list[str]:
        cleaned = [
            sanitize_print_text(v)[:40] for v in values if sanitize_print_text(v)
        ]
        if not cleaned:
            raise ValueError("empty_header_fields")
        return cleaned


class GeneratedAnnexPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=200)
    instructions: str = Field(min_length=1, max_length=800)
    content: AnnexContentData

    @field_validator("title", "instructions")
    @classmethod
    def clean_required(cls, value: str) -> str:
        cleaned = sanitize_print_text(value)
        if not cleaned:
            raise ValueError("empty_text")
        return cleaned


def _strict_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Ensure every object node has required + additionalProperties=false for OpenAI strict JSON schema."""
    node = json.loads(json.dumps(schema))

    def visit(obj: Any) -> None:
        if isinstance(obj, dict):
            if obj.get("type") == "object" and "properties" in obj:
                obj["additionalProperties"] = False
                obj["required"] = list(obj["properties"].keys())
            for val in obj.values():
                visit(val)
        elif isinstance(obj, list):
            for item in obj:
                visit(item)

    visit(node)
    return node


ANNEX_OUTPUT_SCHEMA = _strict_schema(GeneratedAnnexPayload.model_json_schema())


@dataclass(frozen=True)
class AnnexGenerationSpec:
    subject: str
    grade: str
    topic: str
    annex_type: str = "hoja-de-trabajo"
    language: str = "es"
    extra_instructions: str = ""


@dataclass(frozen=True)
class AnnexGenerationResult:
    payload: GeneratedAnnexPayload
    provenance: Literal["openai-annex-v1", "fake-annex-v1"]
    model: str


class AnnexGenerator(Protocol):
    @property
    def is_configured(self) -> bool: ...

    @property
    def model_name(self) -> str: ...

    def generate(self, spec: AnnexGenerationSpec) -> AnnexGenerationResult: ...


def _extract_response_text(body: dict[str, Any]) -> str:
    output_text = body.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text
    items = body.get("output")
    if isinstance(items, list):
        for item in items:
            if not isinstance(item, dict) or item.get("type") != "message":
                continue
            for part in item.get("content", []):
                if not isinstance(part, dict):
                    continue
                if part.get("type") == "refusal":
                    raise AnnexGeneratorError("openai_refusal", status=422)
                if part.get("type") == "output_text" and isinstance(
                    part.get("text"), str
                ):
                    return part["text"]
    raise AnnexGeneratorError("openai_invalid_response", status=502)


class OpenAIAnnexGenerator:
    """Calls OpenAI Responses API directly using structured JSON output."""

    def __init__(
        self,
        *,
        api_key: str,
        model: str = DEFAULT_OPENAI_MODEL,
        base_url: str = DEFAULT_OPENAI_BASE_URL,
        transport=None,
    ):
        self._api_key = api_key.strip()
        self._model = model.strip() or DEFAULT_OPENAI_MODEL
        self._base_url = base_url.rstrip("/")
        self._transport = transport

    @property
    def is_configured(self) -> bool:
        return bool(self._api_key)

    @property
    def model_name(self) -> str:
        return self._model

    def build_payload(self, spec: AnnexGenerationSpec) -> dict[str, Any]:
        user_request = {
            "asignatura": spec.subject,
            "grado": spec.grade,
            "tema": spec.topic,
            "tipo_de_anexo": spec.annex_type,
            "idioma": "español" if spec.language == "es" else "inglés",
            "indicaciones_del_docente": spec.extra_instructions or "Ninguna adicional.",
        }
        payload: dict[str, Any] = {
            "model": self._model,
            "instructions": ANNEX_SYSTEM_INSTRUCTIONS,
            "input": json.dumps(user_request, ensure_ascii=False),
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "printable_annex",
                    "strict": True,
                    "schema": ANNEX_OUTPUT_SCHEMA,
                }
            },
            "max_output_tokens": 2048,
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
            raise AnnexGeneratorError("openai_timeout", status=504) from None
        except requests.RequestException:
            raise AnnexGeneratorError("openai_transport_error", status=502) from None

    def generate(self, spec: AnnexGenerationSpec) -> AnnexGenerationResult:
        if not self._api_key:
            raise AnnexGeneratorError("openai_not_configured", status=503)
        payload = self.build_payload(spec)
        status, raw = self._post(payload)
        if status in (401, 403):
            raise AnnexGeneratorError("openai_authentication_error", status=502)
        if status == 429:
            raise AnnexGeneratorError("openai_rate_limited", status=429)
        if status != 200:
            raise AnnexGeneratorError("openai_http_error", status=502)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise AnnexGeneratorError("openai_response_too_large", status=502)
        try:
            body = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeError):
            raise AnnexGeneratorError("openai_invalid_json", status=502) from None
        if body.get("status") != "completed":
            raise AnnexGeneratorError("openai_incomplete", status=502)
        text = _extract_response_text(body)
        try:
            parsed = GeneratedAnnexPayload.model_validate_json(text)
        except Exception:
            raise AnnexGeneratorError("openai_schema_mismatch", status=502) from None
        returned_model = body.get("model")
        model_label = (
            returned_model
            if isinstance(returned_model, str) and returned_model.strip()
            else self._model
        )
        return AnnexGenerationResult(
            payload=parsed,
            provenance="openai-annex-v1",
            model=model_label[:128],
        )


class UnconfiguredAnnexGenerator:
    """Explicit fail-closed runtime generator when OPENAI_API_KEY is unset."""

    def __init__(self, model: str = DEFAULT_OPENAI_MODEL):
        self._model = model

    @property
    def is_configured(self) -> bool:
        return False

    @property
    def model_name(self) -> str:
        return self._model

    def generate(self, spec: AnnexGenerationSpec) -> AnnexGenerationResult:
        raise AnnexGeneratorError("openai_not_configured", status=503)


class DeterministicFakeAnnexGenerator:
    """Deterministic generator exclusively for pytest / CI without external calls."""

    def __init__(self, model: str = "fake-annex-model"):
        self._model = model
        self.calls: list[AnnexGenerationSpec] = []

    @property
    def is_configured(self) -> bool:
        return True

    @property
    def model_name(self) -> str:
        return self._model

    def generate(self, spec: AnnexGenerationSpec) -> AnnexGenerationResult:
        self.calls.append(spec)
        title = f"Anexo: {spec.topic}"
        instructions = f"Lee con atención cada actividad sobre {spec.topic} y responde con letra clara."
        content = AnnexContentData(
            subtitle=f"{spec.subject} · {spec.grade}",
            student_header_fields=["Nombre", "Fecha", "Grupo"],
            sections=[
                AnnexSectionData(
                    heading="1. Lectura breve",
                    prompt="Lee el texto antes de contestar.",
                    items=[
                        AnnexItemData(
                            kind="reading",
                            text=(
                                f"En {spec.subject} ({spec.grade}) estudiamos {spec.topic} "
                                "para comprender cómo se aplica en nuestra vida diaria."
                            ),
                            answer_lines=0,
                        )
                    ],
                ),
                AnnexSectionData(
                    heading="2. Actividades de comprensión",
                    prompt="Responde en las líneas.",
                    items=[
                        AnnexItemData(
                            kind="question",
                            text=f"¿Por qué es importante conocer sobre {spec.topic}?",
                            answer_lines=3,
                        ),
                        AnnexItemData(
                            kind="exercise",
                            text=f"Escribe dos ejemplos relacionados con {spec.topic} que observes en tu entorno.",
                            answer_lines=4,
                        ),
                    ],
                ),
                AnnexSectionData(
                    heading="3. Autoevaluación",
                    prompt="Marca lo que lograste hoy.",
                    items=[
                        AnnexItemData(
                            kind="checklist",
                            text="Leí todas las indicaciones antes de responder.",
                            answer_lines=0,
                        ),
                        AnnexItemData(
                            kind="checklist",
                            text="Revisé mi ortografía y limpieza al terminar.",
                            answer_lines=0,
                        ),
                    ],
                ),
            ],
            footer_note="Material escolar imprimible · AulaLista",
        )
        return AnnexGenerationResult(
            payload=GeneratedAnnexPayload(
                title=title,
                instructions=instructions,
                content=content,
            ),
            provenance="fake-annex-v1",
            model=self._model,
        )


def load_annex_generator_from_env() -> AnnexGenerator:
    model = (
        os.environ.get("OPENAI_MODEL", DEFAULT_OPENAI_MODEL).strip()
        or DEFAULT_OPENAI_MODEL
    )
    if (
        os.environ.get("AULALISTA_OPENAI_ANNEXES_ENABLED", "false").strip().lower()
        != "true"
    ):
        return UnconfiguredAnnexGenerator(model=model)
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    base_url = (
        os.environ.get("OPENAI_BASE_URL", DEFAULT_OPENAI_BASE_URL).strip()
        or DEFAULT_OPENAI_BASE_URL
    )
    if not api_key:
        return UnconfiguredAnnexGenerator(model=model)
    return OpenAIAnnexGenerator(api_key=api_key, model=model, base_url=base_url)
