"""Traceable SEP/NEM curricular catalog and per-school/subject teacher profiles."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
    select,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Mapped, Session, mapped_column

from aulalista_api.database import Base
from aulalista_api.materials import authorize

NEM_EJES_ARTICULADORES: list[str] = [
    "Inclusión",
    "Pensamiento crítico",
    "Interculturalidad crítica",
    "Igualdad de género",
    "Vida saludable",
    "Apropiación de las culturas a través de la lectura y la escritura",
    "Artes y experiencias estéticas",
]

NEM_CAMPOS_FORMATIVOS: list[dict] = [
    {
        "id": "lenguajes",
        "name": "Lenguajes",
        "subjects": ["Español", "Inglés", "Artes", "Lectura"],
    },
    {
        "id": "saberes",
        "name": "Saberes y Pensamiento Científico",
        "subjects": [
            "Matemáticas",
            "Ciencias Naturales",
            "Física",
            "Biología",
            "Química",
        ],
    },
    {
        "id": "etica",
        "name": "Ética, Naturaleza y Sociedades",
        "subjects": [
            "Historia",
            "Geografía",
            "Formación Cívica y Ética",
            "Conocimiento del Medio",
        ],
    },
    {
        "id": "humano",
        "name": "De lo Humano y lo Comunitario",
        "subjects": [
            "Educación Socioemocional",
            "Educación Física",
            "Vida Saludable",
            "Tecnología",
        ],
    },
]

NEM_PHASES: list[dict] = [
    {"id": "Fase 3", "grades": ["1.º de primaria", "2.º de primaria"]},
    {"id": "Fase 4", "grades": ["3.º de primaria", "4.º de primaria"]},
    {"id": "Fase 5", "grades": ["5.º de primaria", "6.º de primaria"]},
    {
        "id": "Fase 6",
        "grades": ["1.º de secundaria", "2.º de secundaria", "3.º de secundaria"],
    },
]

NEM_PDA_CATALOG: list[dict] = [
    {
        "id": "nem-f3-len-01",
        "code": "F3-LEN-01",
        "phase": "Fase 3",
        "campo_formativo": "Lenguajes",
        "title": "Lectura compartida y comprensión de cuentos breves",
        "description": "Identifica personajes, lugares y secuencia de hechos en narraciones cortas.",
    },
    {
        "id": "nem-f3-sab-01",
        "code": "F3-SAB-01",
        "phase": "Fase 3",
        "campo_formativo": "Saberes y Pensamiento Científico",
        "title": "Construcción de la noción de suma y resta",
        "description": "Resuelve situaciones cotidianas de agrupar, agregar y quitar hasta centenas.",
    },
    {
        "id": "nem-f4-sab-01",
        "code": "F4-SAB-01",
        "phase": "Fase 4",
        "campo_formativo": "Saberes y Pensamiento Científico",
        "title": "Fracciones equivalentes y comparación en contextos reales",
        "description": "Representa e interpreta fracciones (medios, cuartos, octavos, tercios, sextos) con material gráfico y problemas cotidianos.",
    },
    {
        "id": "nem-f4-sab-02",
        "code": "F4-SAB-02",
        "phase": "Fase 4",
        "campo_formativo": "Saberes y Pensamiento Científico",
        "title": "Estados físicos y ciclo del agua",
        "description": "Describe y representa los cambios de estado del agua y su relación con el entorno comunitario.",
    },
    {
        "id": "nem-f4-len-01",
        "code": "F4-LEN-01",
        "phase": "Fase 4",
        "campo_formativo": "Lenguajes",
        "title": "Comprensión y producción de textos instructivos y expositivos",
        "description": "Analiza la estructura de textos informativos y produce borradores revisando claridad y ortografía.",
    },
    {
        "id": "nem-f4-eti-01",
        "code": "F4-ETI-01",
        "phase": "Fase 4",
        "campo_formativo": "Ética, Naturaleza y Sociedades",
        "title": "Pueblos originarios y vida cotidiana en el México antiguo",
        "description": "Reconoce aportes culturales, organización social y relación con la naturaleza de culturas mesoamericanas.",
    },
    {
        "id": "nem-f4-hum-01",
        "code": "F4-HUM-01",
        "phase": "Fase 4",
        "campo_formativo": "De lo Humano y lo Comunitario",
        "title": "Convivencia escolar y acuerdos comunitarios",
        "description": "Propone acuerdos de colaboración, respeto y resolución pacífica de conflictos en el aula.",
    },
    {
        "id": "nem-f5-sab-01",
        "code": "F5-SAB-01",
        "phase": "Fase 5",
        "campo_formativo": "Saberes y Pensamiento Científico",
        "title": "Proporcionalidad, porcentajes y gráficas de datos",
        "description": "Resuelve problemas de proporcionalidad directa y porcentajes interpretando tablas y gráficas.",
    },
    {
        "id": "nem-f5-len-01",
        "code": "F5-LEN-01",
        "phase": "Fase 5",
        "campo_formativo": "Lenguajes",
        "title": "Textos argumentativos y debate informado",
        "description": "Formula argumentos sustentados en fuentes confiables distinguiendo hechos de opiniones.",
    },
    {
        "id": "nem-f6-sab-01",
        "code": "F6-SAB-01",
        "phase": "Fase 6",
        "campo_formativo": "Saberes y Pensamiento Científico",
        "title": "Ecuaciones lineales y modelación algebraica",
        "description": "Plantea y resuelve ecuaciones de primer grado modelando situaciones de cambio y variación.",
    },
    {
        "id": "nem-f6-eti-01",
        "code": "F6-ETI-01",
        "phase": "Fase 6",
        "campo_formativo": "Ética, Naturaleza y Sociedades",
        "title": "Derechos humanos, ciudadanía democrática y memoria histórica",
        "description": "Analiza procesos históricos y mecanismos de participación ciudadana en la comunidad.",
    },
]


class CurricularProfile(Base):
    __tablename__ = "curricular_profile"
    __table_args__ = (
        UniqueConstraint(
            "scope_id",
            "school_id",
            "subject_id",
            name="uq_curricular_profile_scope_school_subject",
        ),
        Index("ix_curricular_profile_scope", "scope_id", "school_id"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    scope_id: Mapped[UUID] = mapped_column(ForeignKey("personal_scope.id"))
    school_id: Mapped[str] = mapped_column(String(80))
    subject_id: Mapped[str] = mapped_column(String(80))
    grade: Mapped[str] = mapped_column(String(60), default="")
    phase: Mapped[str] = mapped_column(String(32), default="")
    campo_formativo: Mapped[str] = mapped_column(String(100), default="")
    pdas: Mapped[list] = mapped_column(JSONB, default=list)
    ejes_articuladores: Mapped[list] = mapped_column(JSONB, default=list)
    notes: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class PdaItemModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=64)
    code: str = Field(default="", max_length=32)
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=500)


class CurricularProfileUpsertRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    grade: str = Field(default="", max_length=60)
    phase: str = Field(default="", max_length=32)
    campo_formativo: str = Field(default="", max_length=100)
    pdas: list[PdaItemModel] = Field(default_factory=list, max_length=12)
    ejes_articuladores: list[str] = Field(default_factory=list, max_length=7)
    notes: str = Field(default="", max_length=2000)


def profile_document(row: CurricularProfile) -> dict:
    return {
        "id": str(row.id),
        "scope_id": str(row.scope_id),
        "school_id": row.school_id,
        "subject_id": row.subject_id,
        "grade": row.grade,
        "phase": row.phase,
        "campo_formativo": row.campo_formativo,
        "pdas": list(row.pdas or []),
        "ejes_articuladores": list(row.ejes_articuladores or []),
        "notes": row.notes,
        "updated_at": row.updated_at.astimezone(UTC).isoformat(),
    }


def resolve_curricular_context_text(
    db: Session,
    scope_id: UUID,
    school_id: str,
    subject_id: str | None = None,
) -> str:
    """Build a compact traceable SEP/NEM curricular summary for prompt injection."""
    keys = [subject_id, "__school__"] if subject_id else ["__school__"]
    rows = db.scalars(
        select(CurricularProfile).where(
            CurricularProfile.scope_id == scope_id,
            CurricularProfile.school_id == school_id,
            CurricularProfile.subject_id.in_(keys),
        )
    ).all()
    by_sub = {r.subject_id: r for r in rows}
    chosen = by_sub.get(subject_id or "__school__") or by_sub.get("__school__")
    if chosen is None:
        return ""
    parts: list[str] = []
    meta = " · ".join(
        p for p in [chosen.phase, chosen.grade, chosen.campo_formativo] if p
    )
    if meta:
        parts.append(f"Contexto curricular SEP/NEM: {meta}")
    if chosen.ejes_articuladores:
        parts.append("Ejes articuladores: " + ", ".join(chosen.ejes_articuladores[:7]))
    if chosen.pdas:
        pda_lines = [
            f"- [{p.get('code') or p.get('id')}] {p.get('title', '')}"
            for p in chosen.pdas[:6]
            if isinstance(p, dict) and p.get("title")
        ]
        if pda_lines:
            parts.append("PDA seleccionados:\n" + "\n".join(pda_lines))
    if chosen.notes.strip():
        parts.append(f"Notas curriculares: {chosen.notes.strip()[:400]}")
    return "\n".join(parts)


class CurriculumService:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def catalog(self, actor, scope_id: UUID) -> dict:
        with Session(self.engine) as db:
            authorize(db, actor, scope_id)
        return {
            "phases": NEM_PHASES,
            "campos_formativos": NEM_CAMPOS_FORMATIVOS,
            "ejes_articuladores": NEM_EJES_ARTICULADORES,
            "pdas": NEM_PDA_CATALOG,
        }

    def list_profiles(self, actor, scope_id: UUID) -> dict:
        with Session(self.engine) as db:
            authorize(db, actor, scope_id)
            rows = db.scalars(
                select(CurricularProfile)
                .where(CurricularProfile.scope_id == scope_id)
                .order_by(
                    CurricularProfile.school_id.asc(),
                    CurricularProfile.subject_id.asc(),
                )
            ).all()
            return {
                "scope_id": str(scope_id),
                "items": [profile_document(r) for r in rows],
            }

    def upsert_profile(
        self,
        actor,
        scope_id: UUID,
        school_id: str,
        subject_id: str,
        req: CurricularProfileUpsertRequest,
    ) -> dict:
        now = datetime.now(UTC)
        cleaned_school = school_id.strip()[:80]
        cleaned_subject = subject_id.strip()[:80] or "__school__"
        cleaned_ejes = [e.strip()[:100] for e in req.ejes_articuladores if e.strip()]
        pdas_data = [p.model_dump() for p in req.pdas]

        with Session(self.engine) as db:
            authorize(db, actor, scope_id)
            row = db.scalar(
                select(CurricularProfile)
                .where(
                    CurricularProfile.scope_id == scope_id,
                    CurricularProfile.school_id == cleaned_school,
                    CurricularProfile.subject_id == cleaned_subject,
                )
                .with_for_update()
            )
            if row is None:
                row = CurricularProfile(
                    id=uuid4(),
                    scope_id=scope_id,
                    school_id=cleaned_school,
                    subject_id=cleaned_subject,
                    grade=req.grade.strip(),
                    phase=req.phase.strip(),
                    campo_formativo=req.campo_formativo.strip(),
                    pdas=pdas_data,
                    ejes_articuladores=cleaned_ejes,
                    notes=req.notes.strip(),
                    updated_at=now,
                )
                db.add(row)
            else:
                row.grade = req.grade.strip()
                row.phase = req.phase.strip()
                row.campo_formativo = req.campo_formativo.strip()
                row.pdas = pdas_data
                row.ejes_articuladores = cleaned_ejes
                row.notes = req.notes.strip()
                row.updated_at = now
            db.commit()
            db.refresh(row)
            return profile_document(row)
