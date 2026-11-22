"""Deterministic, printable, and projectable didactic tool generators (#86-#96)."""

from __future__ import annotations

import hashlib
import random
import re
import unicodedata
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from aulalista_api.openai_annex import (
    AnnexContentData,
    AnnexItemData,
    AnnexSectionData,
    AnnexTableData,
)

ToolId = Literal[
    "comprension-lectora",
    "adaptar-material",
    "tarjetas-repaso",
    "bingo-tematico",
    "proyecto-aula",
    "diagnostico-breve",
    "rubrica-cotejo",
    "memorama",
    "sopa-de-letras",
    "adivina-pistas",
    "quiz-proyectar",
]

AdaptationMode = Literal[
    "lectura_facil",
    "bajar_nivel",
    "subir_reto",
    "apoyo_visual",
    "resumen_esquema",
]

DIDACTIC_TOOLS_CATALOG: list[dict[str, Any]] = [
    {
        "id": "proyecto-aula",
        "label": "Proyecto de aula",
        "category": "Planear",
        "description": "Guía por fases NEM con cronograma editable, roles y productos.",
        "supports_projection": False,
        "supports_seed": False,
    },
    {
        "id": "comprension-lectora",
        "label": "Preguntas sobre un texto",
        "category": "Materiales",
        "description": "Lectura guiada con preguntas literales, inferenciales y clave docente.",
        "supports_projection": False,
        "supports_seed": False,
    },
    {
        "id": "adaptar-material",
        "label": "Adaptar material",
        "category": "Materiales",
        "description": "Adapta una ficha o texto sin modificar el recurso original.",
        "supports_projection": False,
        "supports_seed": False,
    },
    {
        "id": "tarjetas-repaso",
        "label": "Tarjetas de repaso",
        "category": "Materiales",
        "description": "Tarjetas recortables (frente y reverso) listas para imprimir.",
        "supports_projection": False,
        "supports_seed": False,
    },
    {
        "id": "diagnostico-breve",
        "label": "Diagnóstico breve",
        "category": "Evaluar",
        "description": "Evaluación rápida por niveles de desempeño con clave docente.",
        "supports_projection": False,
        "supports_seed": False,
    },
    {
        "id": "rubrica-cotejo",
        "label": "Rúbrica y lista de cotejo",
        "category": "Evaluar",
        "description": "Matriz editable de criterios + lista de cotejo en formato Carta.",
        "supports_projection": False,
        "supports_seed": False,
    },
    {
        "id": "bingo-tematico",
        "label": "Bingo temático",
        "category": "Juegos y repaso",
        "description": "Tableros únicos reproducibles por semilla + tarjetas para cantar.",
        "supports_projection": False,
        "supports_seed": True,
    },
    {
        "id": "memorama",
        "label": "Memorama",
        "category": "Juegos y repaso",
        "description": "Pares recortables concepto-definición listos para imprimir.",
        "supports_projection": False,
        "supports_seed": True,
    },
    {
        "id": "sopa-de-letras",
        "label": "Sopa de letras",
        "category": "Juegos y repaso",
        "description": "Cuadrícula reproducible con palabras clave y hoja de solución aparte.",
        "supports_projection": False,
        "supports_seed": True,
    },
    {
        "id": "adivina-pistas",
        "label": "Adivina con pistas",
        "category": "Juegos y repaso",
        "description": "Tarjetas con 3 pistas progresivas y clave de respuestas.",
        "supports_projection": False,
        "supports_seed": True,
    },
    {
        "id": "quiz-proyectar",
        "label": "Quiz para proyectar",
        "category": "Juegos y repaso",
        "description": "Modo proyector interactivo en pantalla completa + respaldo impreso.",
        "supports_projection": True,
        "supports_seed": True,
    },
]


class DidacticToolGenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tool_id: ToolId
    subject: str = Field(min_length=1, max_length=120)
    grade: str = Field(min_length=1, max_length=80)
    topic: str = Field(min_length=1, max_length=240)
    source_text: str = Field(default="", max_length=6000)
    terms: list[str] = Field(default_factory=list, max_length=32)
    seed: int | None = Field(default=None, ge=1, le=2_147_483_646)
    board_count: int = Field(default=6, ge=2, le=24)
    adaptation_mode: AdaptationMode = "lectura_facil"
    school_id: str | None = Field(default=None, max_length=80)
    subject_id: str | None = Field(default=None, max_length=80)


class AdaptAnnexRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    adaptation_mode: AdaptationMode = "lectura_facil"
    target_grade: str | None = Field(default=None, max_length=80)
    extra_instructions: str = Field(default="", max_length=1000)


@dataclass(frozen=True)
class GeneratedDidacticResource:
    title: str
    instructions: str
    content: AnnexContentData


def _stable_seed(topic: str, explicit_seed: int | None) -> int:
    if explicit_seed is not None:
        return explicit_seed
    digest = hashlib.sha256(topic.strip().lower().encode("utf-8")).digest()
    return (int.from_bytes(digest[:4], "big") % 999_999) + 1


def _normalize_word(raw: str) -> str:
    folded = unicodedata.normalize("NFKD", raw.upper())
    letters = "".join(ch for ch in folded if "A" <= ch <= "Z")
    return letters


def _extract_terms(topic: str, subject: str, raw_terms: list[str], count: int) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for item in raw_terms:
        val = item.strip()
        if val and val.lower() not in seen:
            seen.add(val.lower())
            cleaned.append(val)

    # Extract meaningful keywords from topic & subject
    tokens = [
        tok.strip(".,;:¡!¿?()[]{}")
        for tok in re.split(r"[\s,/]+", f"{topic} {subject}")
        if len(tok.strip(".,;:¡!¿?()[]{}")) >= 4
    ]
    defaults = [
        "Concepto",
        "Ejemplo",
        "Proceso",
        "Análisis",
        "Práctica",
        "Síntesis",
        "Evidencia",
        "Pregunta",
        "Resultado",
        "Hipótesis",
        "Comunidad",
        "Reflexión",
        "Diálogo",
        "Proyecto",
        "Memoria",
        "Patrón",
        "Contexto",
        "Solución",
    ]
    for candidate in [*tokens, *defaults]:
        if len(cleaned) >= count:
            break
        if candidate.lower() not in seen:
            seen.add(candidate.lower())
            cleaned.append(candidate.capitalize())
    return cleaned[:count]


def _build_wordsearch(
    words_input: list[str], *, seed: int, size: int = 12
) -> dict[str, Any]:
    rng = random.Random(seed)
    normalized: list[tuple[str, str]] = []
    seen: set[str] = set()
    for raw in words_input:
        norm = _normalize_word(raw)
        if 3 <= len(norm) <= size and norm not in seen:
            seen.add(norm)
            normalized.append((raw.strip().upper(), norm))
    normalized = normalized[:10]
    grid: list[list[str]] = [["" for _ in range(size)] for _ in range(size)]
    placements: list[dict[str, Any]] = []
    directions = [(0, 1), (1, 0), (1, 1)]  # right, down, diag-down-right

    for display_word, word in normalized:
        placed = False
        for _ in range(120):
            dr, dc = rng.choice(directions)
            max_r = size - (len(word) if dr else 1)
            max_c = size - (len(word) if dc else 1)
            if max_r < 0 or max_c < 0:
                continue
            r0 = rng.randint(0, max_r)
            c0 = rng.randint(0, max_c)
            coords = [(r0 + i * dr, c0 + i * dc) for i in range(len(word))]
            if all(grid[r][c] in ("", word[i]) for i, (r, c) in enumerate(coords)):
                for i, (r, c) in enumerate(coords):
                    grid[r][c] = word[i]
                placements.append(
                    {
                        "word": display_word,
                        "normalized": word,
                        "start": [r0, c0],
                        "end": [coords[-1][0], coords[-1][1]],
                        "direction": (
                            "horizontal"
                            if (dr, dc) == (0, 1)
                            else "vertical"
                            if (dr, dc) == (1, 0)
                            else "diagonal"
                        ),
                    }
                )
                placed = True
                break
        if not placed:
            continue

    alphabet = "ABCDEFGHIJKLMNÑOPQRSTUVWXYZ"
    for r in range(size):
        for c in range(size):
            if not grid[r][c]:
                grid[r][c] = rng.choice(alphabet)

    return {
        "seed": seed,
        "size": size,
        "grid": grid,
        "words": [p["word"] for p in placements],
        "placements": placements,
    }


def _build_bingo_boards(
    terms: list[str], *, seed: int, board_count: int
) -> dict[str, Any]:
    rng = random.Random(seed)
    pool = list(terms)
    while len(pool) < 16:
        pool.append(f"Concepto {len(pool) + 1}")
    boards: list[dict[str, Any]] = []
    seen_signatures: set[tuple[str, ...]] = set()
    attempts = 0
    while len(boards) < board_count and attempts < board_count * 30:
        attempts += 1
        chosen = rng.sample(pool, 9)
        sig = tuple(chosen)
        if sig in seen_signatures:
            continue
        seen_signatures.add(sig)
        grid = [chosen[0:3], chosen[3:6], chosen[6:9]]
        grid[1][1] = "LIBRE"
        boards.append(
            {
                "board_number": len(boards) + 1,
                "cells": grid,
            }
        )
    caller_order = list(pool)
    rng.shuffle(caller_order)
    return {
        "seed": seed,
        "grid_size": 3,
        "boards": boards,
        "caller_cards": caller_order,
    }


def generate_didactic_tool(
    request: DidacticToolGenerateRequest,
    *,
    curricular_trace: dict[str, Any] | None = None,
) -> GeneratedDidacticResource:
    topic = request.topic.strip()
    subject = request.subject.strip()
    grade = request.grade.strip()
    seed = _stable_seed(topic, request.seed)
    footer = f"AulaLista · {subject} · {grade}"
    headers = ["Nombre", "Fecha", "Grupo"]

    if request.tool_id == "comprension-lectora":
        passage = request.source_text.strip() or (
            f"En nuestra comunidad escolar estudiamos '{topic}' desde {subject}. "
            f"Comprender cómo funciona {topic} ayuda a observar fenómenos cotidianos, "
            f"comparar evidencias y explicar ideas con claridad ante el grupo de {grade}."
        )
        return GeneratedDidacticResource(
            title=f"Comprensión lectora: {topic}",
            instructions="Lee el texto con atención, subraya las ideas clave y responde cada pregunta con oraciones completas.",
            content=AnnexContentData(
                subtitle=f"Lectura guiada · {subject} ({grade})",
                student_header_fields=headers,
                tool_kind="comprension-lectora",
                curricular_trace=curricular_trace,
                sections=[
                    AnnexSectionData(
                        heading="1. Lectura base",
                        prompt="Lee primero en silencio y luego comenta con tu pareja.",
                        items=[
                            AnnexItemData(kind="reading", text=passage, answer_lines=0)
                        ],
                    ),
                    AnnexSectionData(
                        heading="2. Preguntas de comprensión",
                        prompt="Responde apoyándote en el texto.",
                        items=[
                            AnnexItemData(
                                kind="question",
                                text=f"(Literal) ¿Cuál es la idea principal que presenta el texto sobre {topic}?",
                                answer_lines=3,
                            ),
                            AnnexItemData(
                                kind="question",
                                text=f"(Inferencial) ¿Por qué es útil estudiar {topic} en la vida cotidiana?",
                                answer_lines=3,
                            ),
                            AnnexItemData(
                                kind="question",
                                text=f"(Crítica) Escribe un ejemplo propio relacionado con {topic} y dibuja un esquema breve.",
                                answer_lines=2,
                            ),
                        ],
                    ),
                ],
                teacher_key=[
                    f"1. Literal: Identifica la definición o propósito central de {topic} mencionado en el texto.",
                    f"2. Inferencial: Conecta {topic} con la resolución de situaciones reales del entorno escolar o familiar.",
                    "3. Crítica: Evalúa pertinencia del ejemplo y coherencia del esquema dibujado.",
                ],
                footer_note=footer,
            ),
        )

    if request.tool_id == "rubrica-cotejo":
        return GeneratedDidacticResource(
            title=f"Rúbrica y lista de cotejo: {topic}",
            instructions="Revisa los criterios antes de entregar tu trabajo y marca la lista de verificación.",
            content=AnnexContentData(
                subtitle=f"Evaluación formativa · {subject} ({grade})",
                student_header_fields=headers,
                tool_kind="rubrica-cotejo",
                curricular_trace=curricular_trace,
                sections=[
                    AnnexSectionData(
                        heading="1. Rúbrica de desempeño",
                        prompt="Marca el nivel alcanzado en cada criterio.",
                        table=AnnexTableData(
                            headers=[
                                "Criterio",
                                "Destacado (4)",
                                "Satisfactorio (3)",
                                "En proceso (2)",
                                "Requiere apoyo (1)",
                            ],
                            rows=[
                                [
                                    f"Comprensión de {topic}",
                                    "Explica con claridad y ejemplos propios",
                                    "Explica correctamente las ideas clave",
                                    "Explica con algunas imprecisiones",
                                    "Requiere acompañamiento docente",
                                ],
                                [
                                    "Procedimiento y evidencia",
                                    "Presenta pasos ordenados y completos",
                                    "Presenta pasos comprensibles",
                                    "Omite algunos pasos importantes",
                                    "Sin procedimiento visible",
                                ],
                                [
                                    "Comunicación y limpieza",
                                    "Letra legible, orden y vocabulario preciso",
                                    "Buen orden y claridad general",
                                    "Presentación parcialmente ordenada",
                                    "Requiere apoyo para organizar",
                                ],
                            ],
                        ),
                        items=[
                            AnnexItemData(
                                kind="checklist",
                                text=f"Incluye el título y conceptos clave de {topic}.",
                                answer_lines=0,
                            ),
                            AnnexItemData(
                                kind="checklist",
                                text="Revisó ortografía, signos y claridad de respuestas.",
                                answer_lines=0,
                            ),
                            AnnexItemData(
                                kind="checklist",
                                text="Participó con respeto al compartir su resultado.",
                                answer_lines=0,
                            ),
                        ],
                    ),
                ],
                teacher_key=[
                    "Puntaje máximo de rúbrica: 12 puntos (10-12 Destacado, 7-9 Satisfactorio, 4-6 En proceso, 3 Requiere apoyo).",
                    "Usa la lista de cotejo para autoevaluación o coevaluación rápida al cierre de la sesión.",
                ],
                footer_note=footer,
            ),
        )

    if request.tool_id == "diagnostico-breve":
        terms = _extract_terms(topic, subject, request.terms, 4)
        return GeneratedDidacticResource(
            title=f"Diagnóstico breve: {topic}",
            instructions="Contesta con lo que sabes hasta hoy. Esta ficha ayuda a identificar qué reforzar juntos.",
            content=AnnexContentData(
                subtitle=f"Evaluación diagnóstica rápida · {subject} ({grade})",
                student_header_fields=headers,
                tool_kind="diagnostico-breve",
                curricular_trace=curricular_trace,
                sections=[
                    AnnexSectionData(
                        heading="1. Exploración inicial",
                        prompt="Responde de forma breve y clara.",
                        items=[
                            AnnexItemData(
                                kind="question",
                                text=f"¿Qué sabes o recuerdas acerca de {topic}?",
                                answer_lines=2,
                            ),
                            AnnexItemData(
                                kind="exercise",
                                text=f"Explica con tus palabras el concepto '{terms[0]}' aplicado a {topic}.",
                                answer_lines=2,
                            ),
                            AnnexItemData(
                                kind="exercise",
                                text=f"Resuelve o ejemplifica una situación donde intervenga '{terms[1]}'.",
                                answer_lines=3,
                            ),
                            AnnexItemData(
                                kind="question",
                                text=f"¿Qué duda te gustaría resolver en clase sobre {topic}?",
                                answer_lines=2,
                            ),
                        ],
                    )
                ],
                teacher_key=[
                    "Reactivo 1 (Saberes previos): Clasifica al grupo en nivel inicial, intermedio o consolidado.",
                    f"Reactivo 2 ({terms[0]}): Verifica uso correcto del término clave.",
                    f"Reactivo 3 ({terms[1]}): Observa transferencia a un ejemplo concreto.",
                    "Reactivo 4 (Metacognición): Recoge preguntas frecuentes para la siguiente sesión.",
                ],
                footer_note=footer,
            ),
        )

    if request.tool_id == "proyecto-aula":
        return GeneratedDidacticResource(
            title=f"Proyecto de aula: {topic}",
            instructions="Sigue las fases del proyecto en equipo, asignen roles y registren sus avances en el cronograma.",
            content=AnnexContentData(
                subtitle=f"Guía de proyecto NEM · {subject} ({grade})",
                student_header_fields=["Equipo", "Integrantes", "Fecha"],
                tool_kind="proyecto-aula",
                curricular_trace=curricular_trace,
                sections=[
                    AnnexSectionData(
                        heading="1. Propósito y cronograma por fases",
                        prompt="Organicen las actividades de cada fase con fechas reales.",
                        bullets=[
                            f"Problema o pregunta detonadora: ¿Cómo impacta {topic} en nuestra comunidad escolar?",
                            "Producto final sugerido: Cartel informativo, maqueta o presentación breve ante el grupo.",
                        ],
                        table=AnnexTableData(
                            headers=["Fase NEM", "Actividad clave", "Responsables", "Evidencia"],
                            rows=[
                                ["1. Planeación", f"Definir preguntas sobre {topic}", "", "Mapa de ideas"],
                                ["2. Acción", "Investigar, experimentar y producir", "", "Borrador / prototipo"],
                                ["3. Intervención", "Presentar hallazgos y reflexionar", "", "Producto final"],
                            ],
                        ),
                        items=[
                            AnnexItemData(
                                kind="question",
                                text="¿Cuál es el compromiso principal de nuestro equipo para lograr el producto final?",
                                answer_lines=2,
                            ),
                            AnnexItemData(
                                kind="checklist",
                                text="Todos los integrantes conocen su rol y fecha de entrega.",
                                answer_lines=0,
                            ),
                            AnnexItemData(
                                kind="checklist",
                                text="Incluimos fuentes, ejemplos o dibujos claros en nuestro producto.",
                                answer_lines=0,
                            ),
                        ],
                    )
                ],
                teacher_key=[
                    "Fase 1 (Planeación): Verifica que cada equipo formule una pregunta viable.",
                    "Fase 2 (Acción): Realiza una revisión formativa a mitad del cronograma.",
                    "Fase 3 (Intervención): Cierra con socialización y reflexión comunitaria.",
                ],
                footer_note=footer,
            ),
        )

    if request.tool_id == "tarjetas-repaso":
        terms = _extract_terms(topic, subject, request.terms, 8)
        cards = [
            {
                "front": term,
                "back": f"Idea clave de {term} dentro del tema {topic} ({subject}).",
            }
            for term in terms
        ]
        return GeneratedDidacticResource(
            title=f"Tarjetas de repaso: {topic}",
            instructions="Recorta por las líneas punteadas, dobla cada tarjeta y repasa en parejas preguntando el reverso.",
            content=AnnexContentData(
                subtitle=f"Tarjetas recortables · {subject} ({grade})",
                student_header_fields=headers,
                tool_kind="tarjetas-repaso",
                curricular_trace=curricular_trace,
                sections=[
                    AnnexSectionData(
                        heading="1. Banco de tarjetas (frente y reverso)",
                        prompt="Puedes editar cada concepto o definición antes de imprimir.",
                        table=AnnexTableData(
                            headers=["Frente (Concepto)", "Reverso (Explicación / Ejemplo)"],
                            rows=[[c["front"], c["back"]] for c in cards],
                        ),
                        items=[
                            AnnexItemData(
                                kind="checklist",
                                text="Recorté mis tarjetas y practiqué al menos 2 rondas con un compañero.",
                                answer_lines=0,
                            )
                        ],
                    )
                ],
                teacher_key=[
                    f"{i + 1}. {c['front']} -> {c['back']}" for i, c in enumerate(cards)
                ],
                metadata={"cut_cards": cards, "cut_mode": "flashcards"},
                footer_note=footer,
            ),
        )

    if request.tool_id == "memorama":
        terms = _extract_terms(topic, subject, request.terms, 6)
        cards: list[dict[str, str]] = []
        for idx, term in enumerate(terms, start=1):
            cards.append({"front": f"Par {idx} · Concepto", "back": term})
            cards.append(
                {
                    "front": f"Par {idx} · Pista",
                    "back": f"Relación con {topic}: {term.lower()}",
                }
            )
        rng = random.Random(seed)
        shuffled = list(cards)
        rng.shuffle(shuffled)
        return GeneratedDidacticResource(
            title=f"Memorama: {topic}",
            instructions="Recorta todas las tarjetas, colócalas boca abajo y encuentra cada par concepto-pista.",
            content=AnnexContentData(
                subtitle=f"Juego de pares recortables · Semilla #{seed}",
                student_header_fields=headers,
                tool_kind="memorama",
                curricular_trace=curricular_trace,
                sections=[
                    AnnexSectionData(
                        heading="1. Pares del memorama",
                        prompt="Imprime en cartulina o papel grueso para mayor duración.",
                        table=AnnexTableData(
                            headers=["Tarjeta A (Concepto)", "Tarjeta B (Definición / Pista)"],
                            rows=[
                                [term, f"Elemento clave de {topic}: {term.lower()}"]
                                for term in terms
                            ],
                        ),
                        items=[
                            AnnexItemData(
                                kind="checklist",
                                text="Al encontrar un par, explica en voz alta por qué coinciden.",
                                answer_lines=0,
                            )
                        ],
                    )
                ],
                teacher_key=[
                    f"Par {i + 1}: {t} <-> Elemento clave de {topic}"
                    for i, t in enumerate(terms)
                ],
                metadata={"cut_cards": shuffled, "cut_mode": "memorama", "seed": seed},
                footer_note=footer,
            ),
        )

    if request.tool_id == "sopa-de-letras":
        terms = _extract_terms(topic, subject, request.terms, 8)
        ws = _build_wordsearch(terms, seed=seed, size=12)
        return GeneratedDidacticResource(
            title=f"Sopa de letras: {topic}",
            instructions="Encuentra y encierra todas las palabras del banco en dirección horizontal, vertical o diagonal.",
            content=AnnexContentData(
                subtitle=f"Cuadrícula reproducible · Semilla #{seed}",
                student_header_fields=headers,
                tool_kind="sopa-de-letras",
                curricular_trace=curricular_trace,
                sections=[
                    AnnexSectionData(
                        heading="1. Palabras por encontrar",
                        prompt="Tacha cada palabra cuando la encuentres y elige dos para explicarlas abajo.",
                        bullets=ws["words"],
                        items=[
                            AnnexItemData(
                                kind="question",
                                text="Elige dos palabras encontradas y escribe una oración que explique cómo se relacionan con el tema:",
                                answer_lines=3,
                            )
                        ],
                    )
                ],
                teacher_key=[
                    f"{p['word']}: fila {p['start'][0] + 1}, col {p['start'][1] + 1} ({p['direction']})"
                    for p in ws["placements"]
                ],
                metadata={"wordsearch": ws, "seed": seed},
                footer_note=footer,
            ),
        )

    if request.tool_id == "bingo-tematico":
        terms = _extract_terms(topic, subject, request.terms, 16)
        bingo = _build_bingo_boards(terms, seed=seed, board_count=request.board_count)
        return GeneratedDidacticResource(
            title=f"Bingo temático: {topic}",
            instructions="Cada estudiante recibe un tablero único. Marca cada concepto cuando la o el docente lea su pista.",
            content=AnnexContentData(
                subtitle=f"{len(bingo['boards'])} tableros únicos · Semilla #{seed}",
                student_header_fields=["Nombre", "Grupo"],
                tool_kind="bingo-tematico",
                curricular_trace=curricular_trace,
                sections=[
                    AnnexSectionData(
                        heading="1. Dinámica del bingo",
                        prompt="Gana quien complete primero una línea horizontal, vertical o diagonal y explique sus conceptos.",
                        bullets=[
                            f"Total de tableros únicos generados: {len(bingo['boards'])} (semilla #{seed}).",
                            "La casilla central es LIBRE.",
                        ],
                        items=[
                            AnnexItemData(
                                kind="checklist",
                                text="Al gritar ¡Bingo!, explica en voz alta 2 conceptos marcados.",
                                answer_lines=0,
                            )
                        ],
                    )
                ],
                teacher_key=[
                    f"Tarjeta #{i + 1}: {word}"
                    for i, word in enumerate(bingo["caller_cards"])
                ],
                metadata={"bingo": bingo, "seed": seed},
                footer_note=footer,
            ),
        )

    if request.tool_id == "adivina-pistas":
        terms = _extract_terms(topic, subject, request.terms, 6)
        cards = [
            {
                "front": f"Tarjeta #{idx} · Adivina ({subject})",
                "back": (
                    f"Pista 1: Forma parte del tema {topic}.\n"
                    f"Pista 2: Empieza con '{term[0].upper()}' y tiene {len(term)} letras.\n"
                    f"Pista 3: Se usa para comprender {topic} en {grade}."
                ),
                "answer": term,
            }
            for idx, term in enumerate(terms, start=1)
        ]
        return GeneratedDidacticResource(
            title=f"Adivina con pistas: {topic}",
            instructions="Lee una pista a la vez. Si adivinan en la pista 1 ganan 3 puntos; pista 2, 2 puntos; pista 3, 1 punto.",
            content=AnnexContentData(
                subtitle=f"Tarjetas progresivas · {subject} ({grade})",
                student_header_fields=headers,
                tool_kind="adivina-pistas",
                curricular_trace=curricular_trace,
                sections=[
                    AnnexSectionData(
                        heading="1. Retos de pistas progresivas",
                        prompt="Recorta las tarjetas o úsalas en equipos por turnos.",
                        table=AnnexTableData(
                            headers=["Tarjeta", "Pistas progresivas"],
                            rows=[[c["front"], c["back"]] for c in cards],
                        ),
                        items=[
                            AnnexItemData(
                                kind="question",
                                text="Escribe tu propia tarjeta con 3 pistas sobre el tema:",
                                answer_lines=3,
                            )
                        ],
                    )
                ],
                teacher_key=[
                    f"Tarjeta #{idx}: {c['answer']}" for idx, c in enumerate(cards, start=1)
                ],
                metadata={"cut_cards": cards, "cut_mode": "clues", "seed": seed},
                footer_note=footer,
            ),
        )

    if request.tool_id == "quiz-proyectar":
        terms = _extract_terms(topic, subject, request.terms, 5)
        slides = [
            {
                "question": f"¿Cuál de los siguientes conceptos se relaciona directamente con {topic}?",
                "options": [terms[0], "Astronomía medieval", "Geología lunar", "Ninguno"],
                "correct_index": 0,
                "explanation": f"'{terms[0]}' es uno de los conceptos centrales al trabajar {topic}.",
                "timer_seconds": 30,
            },
            {
                "question": f"Al resolver una actividad de {topic} en {subject}, ¿qué paso conviene hacer primero?",
                "options": [
                    "Leer la consigna e identificar los datos clave",
                    "Saltar las instrucciones",
                    "Entregar sin revisar",
                    "Copiar sin comprender",
                ],
                "correct_index": 0,
                "explanation": "Identificar datos y propósito evita errores frecuentes.",
                "timer_seconds": 30,
            },
            {
                "question": f"¿Cómo podemos comprobar que comprendimos '{terms[1]}' dentro de {topic}?",
                "options": [
                    "Explicándolo con un ejemplo propio",
                    "Repitiendo sin entender",
                    "Dejando el espacio en blanco",
                    "Adivinando al azar",
                ],
                "correct_index": 0,
                "explanation": "Transferir un concepto a un ejemplo propio demuestra comprensión profunda.",
                "timer_seconds": 30,
            },
            {
                "question": f"¿Qué estrategia fortalece el trabajo en equipo sobre {topic}?",
                "options": [
                    "Escuchar ideas, contrastar evidencias y acordar una respuesta",
                    "Que una sola persona haga todo",
                    "No escuchar a los compañeros",
                    "Cambiar de tema",
                ],
                "correct_index": 0,
                "explanation": "El diálogo argumentado mejora los aprendizajes de todo el grupo.",
                "timer_seconds": 30,
            },
        ]
        return GeneratedDidacticResource(
            title=f"Quiz para proyectar: {topic}",
            instructions="Abre el Modo Proyector para jugar con todo el grupo o imprime esta hoja como respaldo.",
            content=AnnexContentData(
                subtitle=f"Quiz interactivo ({len(slides)} preguntas) · {subject}",
                student_header_fields=headers,
                tool_kind="quiz-proyectar",
                curricular_trace=curricular_trace,
                sections=[
                    AnnexSectionData(
                        heading="1. Preguntas del quiz",
                        prompt="Marca la opción correcta para cada pregunta.",
                        items=[
                            AnnexItemData(
                                kind="question",
                                text=(
                                    f"{s['question']}\n"
                                    + "   ".join(
                                        f"{chr(65 + idx)}) {opt}"
                                        for idx, opt in enumerate(s["options"])
                                    )
                                ),
                                answer_lines=1,
                            )
                            for s in slides
                        ],
                    )
                ],
                teacher_key=[
                    f"P{i + 1}: {chr(65 + s['correct_index'])}) {s['options'][s['correct_index']]} — {s['explanation']}"
                    for i, s in enumerate(slides)
                ],
                metadata={"quiz_slides": slides, "seed": seed},
                footer_note=footer,
            ),
        )

    # Default / adaptar-material from raw source_text
    return adapt_text_resource(
        title=f"Material adaptado: {topic}",
        subject=subject,
        grade=grade,
        topic=topic,
        source_text=request.source_text.strip() or f"Contenido base sobre {topic}.",
        adaptation_mode=request.adaptation_mode,
        curricular_trace=curricular_trace,
    )


_ADAPTATION_LABELS: dict[str, str] = {
    "lectura_facil": "Lectura fácil y frases cortas",
    "bajar_nivel": "Nivel de apoyo / andamiaje guiado",
    "subir_reto": "Nivel de ampliación y reto",
    "apoyo_visual": "Con apoyos visuales y espacios para dibujar",
    "resumen_esquema": "Resumen en esquema estructurado",
}


def adapt_text_resource(
    *,
    title: str,
    subject: str,
    grade: str,
    topic: str,
    source_text: str,
    adaptation_mode: AdaptationMode,
    source_annex_id: str | None = None,
    curricular_trace: dict[str, Any] | None = None,
) -> GeneratedDidacticResource:
    mode_label = _ADAPTATION_LABELS.get(adaptation_mode, "Adaptación docente")
    sentences = [
        s.strip()
        for s in re.split(r"(?<=[.!?])\s+", source_text.strip())
        if s.strip()
    ]
    if not sentences:
        sentences = [f"Idea principal sobre {topic}."]

    items: list[AnnexItemData] = [
        AnnexItemData(
            kind="reading",
            text="\n".join(f"• {s}" for s in sentences[:6]),
            answer_lines=0,
        )
    ]
    if adaptation_mode == "apoyo_visual":
        items.append(
            AnnexItemData(
                kind="exercise",
                text=f"Dibuja un esquema o ilustración que represente la idea principal de {topic}.",
                answer_lines=2,
            )
        )
    elif adaptation_mode == "subir_reto":
        items.append(
            AnnexItemData(
                kind="question",
                text=f"Analiza y propone una solución alternativa o aplicación nueva sobre {topic}.",
                answer_lines=4,
            )
        )
    else:
        items.append(
            AnnexItemData(
                kind="question",
                text=f"Con tus palabras, explica en dos frases lo más importante de {topic}.",
                answer_lines=3,
            )
        )

    return GeneratedDidacticResource(
        title=title,
        instructions=f"Versión adaptada ({mode_label}). Lee paso a paso y completa las actividades.",
        content=AnnexContentData(
            subtitle=f"{mode_label} · {subject} ({grade})",
            student_header_fields=["Nombre", "Fecha", "Grupo"],
            tool_kind="adaptar-material",
            curricular_trace=curricular_trace,
            sections=[
                AnnexSectionData(
                    heading=f"1. Contenido adaptado ({mode_label})",
                    prompt="El recurso original se conserva intacto en tu biblioteca.",
                    items=items,
                )
            ],
            teacher_key=[
                f"Modo de adaptación aplicado: {mode_label}.",
                "Original conservado sin modificaciones.",
            ],
            metadata={
                "adaptation_mode": adaptation_mode,
                "adapted_from_annex_id": source_annex_id,
            },
            footer_note=f"AulaLista · Adaptación ({mode_label})",
        ),
    )


def adapt_existing_annex(
    original: dict[str, Any],
    request: AdaptAnnexRequest,
) -> GeneratedDidacticResource:
    mode_label = _ADAPTATION_LABELS.get(request.adaptation_mode, "Adaptación")
    target_grade = (request.target_grade or original["grade"]).strip()
    orig_content = original["content"]
    adapted_sections: list[AnnexSectionData] = []
    for sec in orig_content.get("sections", []):
        new_items: list[AnnexItemData] = []
        for item in sec.get("items", []):
            text = str(item.get("text", "")).strip()
            kind = item.get("kind", "question")
            lines = int(item.get("answer_lines", 2))
            if request.adaptation_mode == "lectura_facil":
                text = f"[Paso guiado] {text}"
                lines = max(lines, 3) if kind in ("question", "exercise") else lines
            elif request.adaptation_mode == "bajar_nivel":
                text = f"{text} (Apoyo: usa un ejemplo sencillo)."
                lines = max(lines, 3) if kind in ("question", "exercise") else lines
            elif request.adaptation_mode == "subir_reto":
                text = f"{text} Justifica tu respuesta con evidencia."
                lines = max(lines, 4) if kind in ("question", "exercise") else lines
            elif request.adaptation_mode == "apoyo_visual":
                text = f"{text} Incluye un dibujo o esquema."
            new_items.append(AnnexItemData(kind=kind, text=text, answer_lines=lines))
        if not new_items:
            new_items.append(
                AnnexItemData(
                    kind="question",
                    text=f"Resume la idea principal de {original['topic']}.",
                    answer_lines=3,
                )
            )
        adapted_sections.append(
            AnnexSectionData(
                heading=str(sec.get("heading", "Sección adaptada")),
                prompt=str(sec.get("prompt", "")),
                items=new_items,
                bullets=list(sec.get("bullets") or []),
                table=(
                    AnnexTableData.model_validate(sec["table"])
                    if sec.get("table")
                    else None
                ),
            )
        )
    if not adapted_sections:
        return adapt_text_resource(
            title=f"{original['title']} ({mode_label})",
            subject=original["subject"],
            grade=target_grade,
            topic=original["topic"],
            source_text=original["instructions"],
            adaptation_mode=request.adaptation_mode,
            source_annex_id=original["id"],
            curricular_trace=orig_content.get("curricular_trace"),
        )

    extra_note = (
        f" {request.extra_instructions.strip()}"
        if request.extra_instructions.strip()
        else ""
    )
    return GeneratedDidacticResource(
        title=f"{original['title']} ({mode_label})",
        instructions=f"{original['instructions']} [Adaptación: {mode_label}.{extra_note}]",
        content=AnnexContentData(
            subtitle=f"{mode_label} · {original['subject']} ({target_grade})",
            student_header_fields=list(
                orig_content.get("student_header_fields")
                or ["Nombre", "Fecha", "Grupo"]
            ),
            tool_kind="adaptar-material",
            curricular_trace=orig_content.get("curricular_trace"),
            sections=adapted_sections,
            teacher_key=list(orig_content.get("teacher_key") or [])
            + [f"Adaptado de anexo original {original['id']} ({mode_label})."],
            metadata={
                "adaptation_mode": request.adaptation_mode,
                "adapted_from_annex_id": original["id"],
                "original_title": original["title"],
            },
            footer_note=f"AulaLista · Adaptación ({mode_label})",
        ),
    )
