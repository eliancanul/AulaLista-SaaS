"""Versioned manual inputs and one deterministic software fixture, without a source."""

import json
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from aulalista_api.planning_result import RESULT_ADAPTER


def safe_text(value: str) -> str:
    if not value.strip() or "\0" in value:
        raise ValueError("invalid_request")
    try:
        value.encode("utf-8")
    except UnicodeError:
        raise ValueError("invalid_request") from None
    return value


Text = Annotated[str, Field(strict=True, min_length=1), AfterValidator(safe_text)]


class ManualContext(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: Annotated[Text, Field(max_length=1000)]
    hypothetical: Annotated[bool, Field(strict=True)]


class ExactReference(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_id: UUID
    source_version: Annotated[int, Field(strict=True, ge=1, le=2_147_483_646)]


class ManualPlanningInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    subject: Annotated[Text, Field(max_length=120)]
    grade: Annotated[Text, Field(max_length=80)]
    topic: Annotated[Text, Field(max_length=200)]
    duration_minutes: Annotated[int, Field(strict=True, ge=15, le=180)] = 50
    method: Annotated[Text, Field(max_length=80)] = "active-learning"
    language: Annotated[Text, Field(max_length=40)] = "es"
    context: ManualContext | None = None
    learning_objectives: Annotated[
        list[Annotated[Text, Field(max_length=200)]], Field(max_length=5)
    ] = Field(default_factory=list)
    formative_field: Annotated[Text, Field(max_length=120)] | None = None
    articulating_axes: Annotated[
        list[Annotated[Text, Field(max_length=80)]], Field(max_length=7)
    ] = Field(default_factory=list)
    reference: ExactReference | None = None

    def canonical(self) -> bytes:
        return json.dumps(
            self.model_dump(mode="json"),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode()


class GuidedPlanningRequest(ManualPlanningInput):
    contract_version: Annotated[int, Field(strict=True, ge=2, le=2)]
    fixture_context: Literal["guided-water-v1"]


class GeneratedPlanningRequest(ManualPlanningInput):
    contract_version: Annotated[int, Field(strict=True, ge=3, le=3)]


def generate_guided(request: GuidedPlanningRequest) -> dict:
    # shortcut: one recognized software fixture; general generation needs its own approval.
    if (
        request.subject,
        request.grade,
        request.topic,
        request.method,
        request.language,
    ) != (
        "Ciencias naturales",
        "3.º de primaria",
        "El cuidado del agua en la comunidad",
        "active-learning",
        "es",
    ):
        raise ValueError("unsupported_fixture")
    opening = request.duration_minutes // 5
    closing = request.duration_minutes // 5
    result = {
        "kind": "guided-planning-v1",
        "provenance": "synthetic-fixture-v1",
        "title": request.topic,
        "notice": (
            "Ejemplo sintético de software para Ciencias naturales, 3.º de primaria "
            "y cuidado del agua; sin generación libre ni validación curricular. "
            "El contexto, objetivos, campo y ejes manuales se conservan sin "
            "interpretarlos ni adaptar el ejemplo; la referencia adjunta, si existe, "
            "se conserva sin interpretar. No describe un diagnóstico de un grupo real."
        ),
        "purpose": (
            "Reconocer usos cotidianos del agua en la comunidad y proponer "
            "acciones concretas para cuidarla."
        ),
        "duration_minutes": request.duration_minutes,
        "activities": [
            {
                "key": "introduction",
                "title": "Inicio · Observar usos cotidianos",
                "statement": (
                    "Dibujar o nombrar usos del agua en una comunidad imaginaria. "
                    "Compartir cuáles son necesarios y dónde podría desperdiciarse."
                ),
                "minutes": opening,
            },
            {
                "key": "exploration",
                "title": "Desarrollo · Proponer acciones",
                "statement": (
                    "En equipos, comparar situaciones hipotéticas de uso del agua. "
                    "Elegir una y elaborar un cartel con una acción de cuidado y "
                    "una explicación de por qué ayudaría."
                ),
                "minutes": request.duration_minutes - opening - closing,
            },
            {
                "key": "closure",
                "title": "Cierre · Compartir y revisar",
                "statement": (
                    "Presentar los carteles, escuchar sugerencias y revisar una "
                    "acción. Escribir o dibujar una conclusión sobre el cuidado del agua."
                ),
                "minutes": closing,
            },
        ],
        "materials": ["Hojas reutilizadas o cuaderno", "Lápices y colores", "Pizarrón"],
        "formative_assessment": (
            "Observar si cada propuesta identifica un uso del agua, plantea una "
            "acción viable y explica cómo ayuda a cuidarla. Dar retroalimentación "
            "con una pregunta y permitir revisar el cartel o la conclusión."
        ),
    }
    return RESULT_ADAPTER.validate_python(result)
