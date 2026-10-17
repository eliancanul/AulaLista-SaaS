"""Ejemplo sintético reconocido; función pura, sin parser, persistencia ni red."""

from aulalista_api import water_fixture

FIXTURE_SOURCE = (
    b"AulaLista synthetic timing-example-v1\n"
    b"Clasificacion de figuras: apertura 10, clasificacion 30, cierre 10 minutos.\n"
)
SUPPORTED_PROMPT = "Ajusta el ejemplo a 40 minutos."


def generate(context: str, prompt: str, source: bytes) -> dict:
    if context == water_fixture.FIXTURE_CONTEXT:
        return water_fixture.generate(prompt, source)
    if (context, prompt, source) != (
        "timing-example-v1",
        SUPPORTED_PROMPT,
        FIXTURE_SOURCE,
    ):
        raise ValueError("unsupported_fixture")
    return {
        "provenance": "synthetic-fixture-v1",
        "title": "Clasificación de figuras · ejemplo de 40 minutos",
        "notice": "Resultado simulado; sin interpretación documental ni validación curricular.",
        "activities": [
            {
                "statement": "Presentar figuras y observar sus diferencias.",
                "minutes": 5,
            },
            {
                "statement": "Clasificar las figuras y explicar el criterio elegido.",
                "minutes": 25,
            },
            {
                "statement": "Comparar criterios y registrar una conclusión.",
                "minutes": 10,
            },
        ],
    }
