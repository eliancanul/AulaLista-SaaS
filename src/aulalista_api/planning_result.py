"""Existing Acenta Result contract; validates structure, never curricular truth."""

from typing import Annotated, Literal, NotRequired, TypedDict

from pydantic import AfterValidator, ConfigDict, Field, TypeAdapter


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


def useful_text(value: str) -> str:
    if not value.strip() or "\0" in value:
        raise ValueError("empty_or_invalid_text")
    value.encode("utf-8")
    return value


UsefulText = Annotated[str, Field(min_length=1), AfterValidator(useful_text)]


class GuidedActivity(ResultObject):
    key: Literal["introduction", "exploration", "closure"]
    title: UsefulText
    statement: UsefulText
    minutes: Annotated[int, Field(ge=1, le=180)]


class GuidedPlanningResult(ResultObject):
    kind: Literal["guided-planning-v1"]
    provenance: Literal["synthetic-fixture-v1", "openai-guided-v1"]
    title: UsefulText
    notice: UsefulText
    purpose: UsefulText
    formative_assessment: UsefulText
    duration_minutes: Annotated[int, Field(ge=3, le=540)]
    activities: Annotated[list[GuidedActivity], Field(min_length=3, max_length=3)]
    materials: Annotated[list[UsefulText], Field(min_length=1)]


def coherent_guided_result(result: GuidedPlanningResult) -> GuidedPlanningResult:
    if [a["key"] for a in result["activities"]] != [
        "introduction",
        "exploration",
        "closure",
    ] or sum(a["minutes"] for a in result["activities"]) != result["duration_minutes"]:
        raise ValueError("incoherent_activities")
    return result


RESULT_ADAPTER = TypeAdapter(
    PlanningResult
    | Annotated[GuidedPlanningResult, AfterValidator(coherent_guided_result)]
)


class GeneratedActivity(ResultObject):
    key: Literal["introduction", "exploration", "closure"]
    title: Annotated[UsefulText, Field(max_length=200)]
    statement: Annotated[UsefulText, Field(max_length=1600)]
    minutes: Annotated[int, Field(ge=1, le=180)]


class GeneratedOutput(ResultObject):
    title: Annotated[UsefulText, Field(max_length=200)]
    purpose: Annotated[UsefulText, Field(max_length=1200)]
    formative_assessment: Annotated[UsefulText, Field(max_length=1200)]
    duration_minutes: Annotated[int, Field(ge=15, le=180)]
    activities: Annotated[list[GeneratedActivity], Field(min_length=3, max_length=3)]
    materials: Annotated[
        list[Annotated[UsefulText, Field(max_length=200)]],
        Field(min_length=1, max_length=10),
    ]


OUTPUT_ADAPTER = TypeAdapter(GeneratedOutput)
OUTPUT_SCHEMA = OUTPUT_ADAPTER.json_schema()
GENERATED_NOTICE = (
    "Planeación generada automáticamente a partir de información manual. "
    "Revisa su pertinencia antes de usarla: no acredita validez curricular ni "
    "un diagnóstico de un grupo real. La referencia adjunta, si existe, "
    "se conserva sin interpretar."
)


def validate_generated_output(output: dict, duration_minutes: int) -> dict:
    validated = OUTPUT_ADAPTER.validate_python(output)
    if validated["duration_minutes"] != duration_minutes:
        raise ValueError("wrong_duration")
    return RESULT_ADAPTER.validate_python(
        {
            **validated,
            "kind": "guided-planning-v1",
            "provenance": "openai-guided-v1",
            "notice": GENERATED_NOTICE,
        }
    )
