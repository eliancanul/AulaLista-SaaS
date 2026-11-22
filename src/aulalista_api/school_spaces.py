"""Teacher school and subject workspace persistence per personal scope."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Mapped, Session, mapped_column

from aulalista_api.database import Base
from aulalista_api.materials import authorize


class TeacherSchoolSpaces(Base):
    __tablename__ = "teacher_school_spaces"

    scope_id: Mapped[UUID] = mapped_column(
        ForeignKey("personal_scope.id"), primary_key=True
    )
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class SubjectSpaceModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=60)
    activeTopic: str | None = Field(default=None, max_length=120)

    @field_validator("id", "name")
    @classmethod
    def strip_required(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("blank_value")
        return cleaned


class SchoolSpaceModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=80)
    shortName: str = Field(min_length=1, max_length=60)
    grade: str = Field(min_length=1, max_length=24)
    gradeLong: str = Field(min_length=1, max_length=60)
    shift: str = Field(min_length=1, max_length=24)
    color: str = Field(min_length=4, max_length=16)
    initials: str = Field(min_length=1, max_length=4)
    lastSubjectId: str = Field(min_length=1, max_length=80)
    subjects: list[SubjectSpaceModel] = Field(min_length=1, max_length=30)

    @field_validator("id", "shortName", "grade", "gradeLong", "shift", "initials")
    @classmethod
    def strip_required(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("blank_value")
        return cleaned

    @model_validator(mode="after")
    def validate_subjects(self) -> SchoolSpaceModel:
        subject_ids = [s.id for s in self.subjects]
        if len(set(subject_ids)) != len(subject_ids):
            raise ValueError("duplicate_subject_id")
        if self.lastSubjectId not in subject_ids:
            self.lastSubjectId = subject_ids[0]
        return self


class SchoolSpacesUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schools: list[SchoolSpaceModel] = Field(min_length=1, max_length=20)
    activeSchoolId: str = Field(min_length=1, max_length=80)
    activeSubjectId: str = Field(min_length=1, max_length=80)

    @model_validator(mode="after")
    def validate_active_ids(self) -> SchoolSpacesUpdate:
        school_ids = [sc.id for sc in self.schools]
        if len(set(school_ids)) != len(school_ids):
            raise ValueError("duplicate_school_id")
        active_school = next(
            (sc for sc in self.schools if sc.id == self.activeSchoolId),
            self.schools[0],
        )
        self.activeSchoolId = active_school.id
        subject_ids = [sub.id for sub in active_school.subjects]
        if self.activeSubjectId not in subject_ids:
            self.activeSubjectId = active_school.lastSubjectId
        return self


def default_school_spaces_payload() -> dict:
    return {
        "schools": [
            {
                "id": "benito",
                "shortName": "Benito Juárez",
                "grade": "4.º A",
                "gradeLong": "4.º de primaria",
                "shift": "Matutino",
                "color": "#964e3b",
                "initials": "BJ",
                "lastSubjectId": "benito-mat",
                "subjects": [
                    {"id": "benito-mat", "name": "Matemáticas"},
                    {"id": "benito-esp", "name": "Español"},
                    {"id": "benito-cie", "name": "Ciencias Naturales"},
                    {"id": "benito-his", "name": "Historia"},
                ],
            },
            {
                "id": "hidalgo",
                "shortName": "Miguel Hidalgo",
                "grade": "3.º B",
                "gradeLong": "3.º de primaria",
                "shift": "Vespertino",
                "color": "#3d6b59",
                "initials": "MH",
                "lastSubjectId": "hidalgo-mat",
                "subjects": [
                    {"id": "hidalgo-mat", "name": "Matemáticas"},
                    {"id": "hidalgo-esp", "name": "Español"},
                    {"id": "hidalgo-con", "name": "Conocimiento del Medio"},
                ],
            },
        ],
        "activeSchoolId": "benito",
        "activeSubjectId": "benito-mat",
    }


def school_spaces_document(scope_id: UUID, row: TeacherSchoolSpaces | None) -> dict:
    data = row.payload if row is not None else default_school_spaces_payload()
    return {
        "scope_id": str(scope_id),
        "schools": data["schools"],
        "activeSchoolId": data["activeSchoolId"],
        "activeSubjectId": data["activeSubjectId"],
        "updated_at": row.updated_at.isoformat() if row is not None else None,
    }


class SchoolSpacesService:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def get(self, actor: UUID, scope_id: UUID) -> dict:
        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
            row = session.get(TeacherSchoolSpaces, scope_id)
            return school_spaces_document(scope_id, row)

    def update(self, actor: UUID, scope_id: UUID, payload: SchoolSpacesUpdate) -> dict:
        serialized = payload.model_dump(exclude_none=True)
        now = datetime.now(UTC)
        with Session(self.engine) as session:
            authorize(session, actor, scope_id)
            row = session.get(TeacherSchoolSpaces, scope_id)
            if row is None:
                row = TeacherSchoolSpaces(
                    scope_id=scope_id,
                    payload=serialized,
                    updated_at=now,
                )
                session.add(row)
            else:
                row.payload = serialized
                row.updated_at = now
            session.commit()
            session.refresh(row)
            return school_spaces_document(scope_id, row)
