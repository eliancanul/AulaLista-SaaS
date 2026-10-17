"""Fixture visual sintético de Acenta; no interpreta documentos."""

FIXTURE_CONTEXT = "water-observation-v1"
FIXTURE_SOURCE = (
    "Acenta synthetic water-observation-v1\n"
    "Agua que cambia. Primaria. 4.º A. Ciencias.\n"
    "Activar 10, Explorar 25, Cerrar 10 minutos.\n"
    "Materiales: vaso transparente, agua y ficha de observación.\n"
    "Observa el vaso. Describe lo que ves.\n"
    "¿Qué observaste? ¿Qué cambió?\n"
).encode("utf-8")
FIXTURE_REVISION = (
    FIXTURE_SOURCE
    + "Nota sintética de revisión: observar nuevamente al finalizar.\n".encode("utf-8")
)
FIXTURE_OTHER = (
    FIXTURE_SOURCE
    + "Archivo sintético independiente para otra sesión de observación.\n".encode(
        "utf-8"
    )
)
SUPPORTED_SOURCES = (FIXTURE_SOURCE, FIXTURE_REVISION, FIXTURE_OTHER)

SUPPORTED_PROMPT = (
    "Hoy tengo 30 minutos. Ajusta los tiempos sin cambiar mis materiales."
)


def generate(prompt: str, source: bytes) -> dict:
    if prompt != SUPPORTED_PROMPT or source not in SUPPORTED_SOURCES:
        raise ValueError("unsupported_fixture")
    return {
        "provenance": "synthetic-fixture-v1",
        "title": "Agua que cambia",
        "notice": "Resultado simulado; sin interpretación documental ni validación curricular.",
        "context": {"level": "Primaria", "group": "4.º A", "subject": "Ciencias"},
        "materials": ["Vaso transparente", "Agua", "Ficha de observación"],
        "activities": [
            {
                "key": "activate",
                "title": "Activar",
                "statement": "Observar el vaso y compartir lo que se ve.",
                "previous_minutes": 10,
                "minutes": 5,
            },
            {
                "key": "explore",
                "title": "Explorar",
                "statement": "Observar el agua y completar la ficha de observación.",
                "previous_minutes": 25,
                "minutes": 18,
            },
            {
                "key": "close",
                "title": "Cerrar",
                "statement": "Compartir qué se observó y qué cambió.",
                "previous_minutes": 10,
                "minutes": 7,
            },
        ],
        "resources": [
            {
                "key": "observation-sheet",
                "title": "Ficha de observación",
                "audience": "students",
                "elements": [
                    {
                        "key": "instruction",
                        "kind": "statement",
                        "text": "Observa el vaso. Describe lo que ves.",
                        "editable": True,
                    },
                    {
                        "key": "question",
                        "kind": "question",
                        "text": "¿Qué observaste? ¿Qué cambió?",
                        "lines": 2,
                        "editable": False,
                    },
                ],
            }
        ],
    }
