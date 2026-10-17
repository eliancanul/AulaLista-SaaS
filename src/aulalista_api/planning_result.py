"""Existing Acenta Result contract; validates structure, never curricular truth."""

from typing import Annotated, Literal, NotRequired, TypedDict

from pydantic import ConfigDict, Field, TypeAdapter


class ResultObject(TypedDict):
    __pydantic_config__ = ConfigDict(strict=True, extra="forbid")


class Activity(ResultObject):
    statement: str
    minutes: Annotated[int, Field(ge=0)]
    key: NotRequired[str]
    title: NotRequired[str]
    previous_minutes: NotRequired[int]


class Context(ResultObject):
    level: str
    group: str
    subject: str


class Element(ResultObject):
    key: str
    kind: Literal["statement", "question"]
    text: str
    editable: bool
    lines: NotRequired[Annotated[int, Field(ge=0)]]


class Resource(ResultObject):
    key: str
    title: str
    audience: Literal["students"]
    elements: list[Element]


class PlanningResult(ResultObject):
    provenance: Literal["synthetic-fixture-v1"]
    title: str
    notice: str
    activities: list[Activity]
    context: NotRequired[Context]
    materials: NotRequired[list[str]]
    resources: NotRequired[list[Resource]]


RESULT_ADAPTER = TypeAdapter(PlanningResult)
