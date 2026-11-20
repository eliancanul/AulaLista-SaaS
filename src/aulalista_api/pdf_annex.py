"""US Letter black-and-white printable PDF generator + pypdf copy duplicator."""

from __future__ import annotations

from datetime import UTC, datetime
from io import BytesIO
from typing import Any
from xml.sax.saxutils import escape

from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

MIN_COPIES = 1
MAX_COPIES = 50
MAX_EPSON_PDF_BYTES = 20 * 1024 * 1024  # 20 MB limit for Epson Email Print


class PdfGenerationError(Exception):
    def __init__(self, code: str, status: int = 422):
        super().__init__(code)
        self.code = code
        self.status = status


def _latin1_safe(text: str) -> str:
    """Keep full Spanish Latin-1 (áéíóúñ¿¡ü—·) and replace exotic glyphs safely for Helvetica."""
    replacements = {
        "\u2014": "-",
        "\u2013": "-",
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u2022": "*",
        "\u2026": "...",
        "\u00a0": " ",
    }
    for src, dst in replacements.items():
        text = text.replace(src, dst)
    return text.encode("latin-1", errors="replace").decode("latin-1")


def _p_text(text: str) -> str:
    return escape(_latin1_safe(text)).replace("\n", "<br/>")


class _NumberedCanvasMixin:
    """Draws subtle page footer on every page of a single copy."""

    @staticmethod
    def draw_footer(footer_note: str):
        note = _latin1_safe(footer_note)

        def on_page(canvas, doc) -> None:
            canvas.saveState()
            canvas.setStrokeColor(colors.HexColor("#CCCCCC"))
            canvas.setLineWidth(0.5)
            canvas.line(
                doc.leftMargin,
                0.48 * inch,
                letter[0] - doc.rightMargin,
                0.48 * inch,
            )
            canvas.setFont("Helvetica", 8.5)
            canvas.setFillColor(colors.HexColor("#444444"))
            if note:
                canvas.drawString(doc.leftMargin, 0.33 * inch, note[:90])
            canvas.drawRightString(
                letter[0] - doc.rightMargin,
                0.33 * inch,
                f"Página {canvas.getPageNumber()}",
            )
            canvas.restoreState()

        return on_page


def _build_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "meta": ParagraphStyle(
            "AnnexMeta",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9,
            leading=12,
            textColor=colors.HexColor("#333333"),
            spaceAfter=2,
        ),
        "title": ParagraphStyle(
            "AnnexTitle",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=16,
            leading=20,
            textColor=colors.black,
            alignment=0,
            spaceBefore=0,
            spaceAfter=4,
        ),
        "subtitle": ParagraphStyle(
            "AnnexSubtitle",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10,
            leading=13,
            textColor=colors.HexColor("#333333"),
            spaceAfter=8,
        ),
        "instructions": ParagraphStyle(
            "AnnexInstructions",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10.5,
            leading=14,
            textColor=colors.black,
        ),
        "section": ParagraphStyle(
            "AnnexSection",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=12,
            leading=15,
            textColor=colors.black,
            spaceBefore=10,
            spaceAfter=4,
        ),
        "section_prompt": ParagraphStyle(
            "AnnexSectionPrompt",
            parent=base["Normal"],
            fontName="Helvetica-Oblique",
            fontSize=9.5,
            leading=13,
            textColor=colors.HexColor("#222222"),
            spaceAfter=5,
        ),
        "item": ParagraphStyle(
            "AnnexItem",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10.5,
            leading=14.5,
            textColor=colors.black,
            spaceBefore=4,
            spaceAfter=4,
        ),
        "reading": ParagraphStyle(
            "AnnexReading",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10.5,
            leading=15,
            textColor=colors.black,
        ),
    }


def _student_header_table(fields: list[str], usable_width: float) -> Table:
    labels = [_latin1_safe(f) for f in fields[:4]] or ["Nombre", "Fecha", "Grupo"]
    cells = [f"{label}: ______________________" for label in labels]
    # Fit up to 2 rows cleanly so fields never collide horizontally.
    rows: list[list[str]] = []
    if len(cells) <= 2:
        rows.append(cells)
    elif len(cells) == 3:
        rows.append([f"{labels[0]}: ____________________________________", ""])
        rows.append(
            [
                f"{labels[1]}: ________________________",
                f"{labels[2]}: ________________________",
            ]
        )
    else:
        rows.append(cells[:2])
        rows.append(cells[2:4])
    cols = max(len(r) for r in rows)
    col_widths = [usable_width / cols] * cols
    table = Table(rows, colWidths=col_widths)
    style_cmds: list[Any] = [
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TEXTCOLOR", (0, 0), (-1, -1), colors.black),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]
    if len(cells) == 3:
        style_cmds.append(("SPAN", (0, 0), (1, 0)))
    table.setStyle(TableStyle(style_cmds))
    return table


def _boxed_paragraph(
    text: str,
    style: ParagraphStyle,
    usable_width: float,
    *,
    fill_hex: str = "#F5F5F5",
    border_hex: str = "#444444",
) -> Table:
    table = Table([[Paragraph(text, style)]], colWidths=[usable_width])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(fill_hex)),
                ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor(border_hex)),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
            ]
        )
    )
    return table


def _answer_lines(count: int, usable_width: float) -> list[Any]:
    flowables: list[Any] = []
    for _ in range(max(0, min(10, count))):
        flowables.append(Spacer(1, 0.24 * inch))
        flowables.append(
            HRFlowable(
                width=usable_width,
                thickness=0.6,
                color=colors.HexColor("#555555"),
                spaceBefore=0,
                spaceAfter=2,
            )
        )
    if flowables:
        flowables.append(Spacer(1, 0.06 * inch))
    return flowables


def duplicate_pdf_copies(single_copy_pdf: bytes, copies: int) -> bytes:
    """Duplicate all pages of a PDF `copies` times (1..50) and enforce Epson's 20 MB limit."""
    if (
        not isinstance(copies, int)
        or isinstance(copies, bool)
        or not (MIN_COPIES <= copies <= MAX_COPIES)
    ):
        raise PdfGenerationError("invalid_copies", status=422)
    if not single_copy_pdf.startswith(b"%PDF"):
        raise PdfGenerationError("invalid_pdf", status=500)
    if copies == 1:
        if len(single_copy_pdf) > MAX_EPSON_PDF_BYTES:
            raise PdfGenerationError("pdf_exceeds_epson_limit", status=422)
        return single_copy_pdf

    reader = PdfReader(BytesIO(single_copy_pdf))
    writer = PdfWriter()
    for _ in range(copies):
        writer.append(reader)
    writer.compress_identical_objects(remove_duplicates=True, remove_unreferenced=True)
    out = BytesIO()
    writer.write(out)
    data = out.getvalue()
    if len(data) > MAX_EPSON_PDF_BYTES:
        raise PdfGenerationError("pdf_exceeds_epson_limit", status=422)
    return data


def render_annex_pdf(annex_doc: dict[str, Any], *, copies: int = 1) -> bytes:
    """Render a printable US Letter black-and-white PDF for an annex, duplicated `copies` times."""
    if (
        not isinstance(copies, int)
        or isinstance(copies, bool)
        or not (MIN_COPIES <= copies <= MAX_COPIES)
    ):
        raise PdfGenerationError("invalid_copies", status=422)

    margin = 0.65 * inch
    usable_width = letter[0] - 2 * margin
    styles = _build_styles()
    content = annex_doc.get("content") or {}
    footer_note = (
        content.get("footer_note")
        or f"{annex_doc.get('subject', '')} · {annex_doc.get('grade', '')}"
    )

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        leftMargin=margin,
        rightMargin=margin,
        topMargin=0.6 * inch,
        bottomMargin=0.65 * inch,
        title=_latin1_safe(str(annex_doc.get("title", "Anexo escolar"))),
        author="AulaLista",
    )

    story: list[Any] = []
    meta_parts = [
        p
        for p in (annex_doc.get("subject"), annex_doc.get("grade"))
        if isinstance(p, str) and p.strip()
    ]
    if meta_parts:
        story.append(Paragraph(_p_text(" · ".join(meta_parts).upper()), styles["meta"]))
    story.append(
        Paragraph(_p_text(str(annex_doc.get("title", "Anexo"))), styles["title"])
    )
    subtitle = content.get("subtitle")
    if isinstance(subtitle, str) and subtitle.strip():
        story.append(Paragraph(_p_text(subtitle), styles["subtitle"]))

    header_fields = content.get("student_header_fields") or ["Nombre", "Fecha", "Grupo"]
    story.append(_student_header_table(header_fields, usable_width))
    story.append(
        HRFlowable(
            width=usable_width,
            thickness=1.2,
            color=colors.black,
            spaceBefore=2,
            spaceAfter=8,
        )
    )

    instructions = str(annex_doc.get("instructions", "")).strip()
    if instructions:
        story.append(
            _boxed_paragraph(
                f"<b>Instrucciones:</b> {_p_text(instructions)}",
                styles["instructions"],
                usable_width,
                fill_hex="#F4F4F4",
                border_hex="#333333",
            )
        )
        story.append(Spacer(1, 0.1 * inch))

    sections = content.get("sections") or []
    for section in sections:
        heading = str(section.get("heading", "")).strip()
        prompt = str(section.get("prompt", "")).strip()
        items = section.get("items") or []
        section_header: list[Any] = []
        if heading:
            section_header.append(Paragraph(_p_text(heading), styles["section"]))
        if prompt:
            section_header.append(Paragraph(_p_text(prompt), styles["section_prompt"]))

        question_index = 0
        for idx, item in enumerate(items):
            kind = item.get("kind", "question")
            text = str(item.get("text", "")).strip()
            lines = int(item.get("answer_lines", 0) or 0)
            block: list[Any] = []
            if idx == 0 and section_header:
                block.extend(section_header)
                section_header = []

            if kind == "reading":
                block.append(
                    _boxed_paragraph(
                        _p_text(text),
                        styles["reading"],
                        usable_width,
                        fill_hex="#FFFFFF",
                        border_hex="#555555",
                    )
                )
                block.append(Spacer(1, 0.08 * inch))
            elif kind == "checklist":
                block.append(
                    Paragraph(f"[ &nbsp;&nbsp; ] &nbsp;{_p_text(text)}", styles["item"])
                )
            else:
                question_index += 1
                block.append(
                    Paragraph(
                        f"<b>{question_index}.</b> {_p_text(text)}",
                        styles["item"],
                    )
                )
                if lines > 0:
                    block.extend(_answer_lines(lines, usable_width))
            story.append(KeepTogether(block))

        if section_header:
            story.extend(section_header)

    footer_cb = _NumberedCanvasMixin.draw_footer(footer_note)
    doc.build(story, onFirstPage=footer_cb, onLaterPages=footer_cb)
    return duplicate_pdf_copies(buf.getvalue(), copies)


def render_test_page_pdf(
    *,
    printer_email: str,
    default_copies: int,
    default_print_time: str,
    generated_at: datetime | None = None,
) -> bytes:
    """Render a 1-page US Letter verification sheet for Epson Email Print."""
    stamp = (
        (generated_at or datetime.now(UTC))
        .astimezone(UTC)
        .strftime("%Y-%m-%d %H:%M UTC")
    )
    doc_payload = {
        "title": "Hoja de prueba · Impresión AulaLista",
        "subject": "Verificación de impresora",
        "grade": "Epson Email Print",
        "instructions": (
            "Si puedes leer esta hoja con claridad, tu impresora Epson L3250 está "
            "correctamente conectada con AulaLista y lista para imprimir anexos automáticamente."
        ),
        "content": {
            "subtitle": f"Generada el {stamp}",
            "student_header_fields": ["Docente", "Fecha"],
            "sections": [
                {
                    "heading": "1. Datos de configuración verificados",
                    "prompt": "Revisa márgenes, acentos en español (áéíóúñ¿¡) y líneas.",
                    "items": [
                        {
                            "kind": "checklist",
                            "text": f"Correo de impresora: {printer_email}",
                            "answer_lines": 0,
                        },
                        {
                            "kind": "checklist",
                            "text": f"Copias por defecto: {default_copies} alumnos",
                            "answer_lines": 0,
                        },
                        {
                            "kind": "checklist",
                            "text": f"Hora sugerida de impresión: {default_print_time}",
                            "answer_lines": 0,
                        },
                    ],
                },
                {
                    "heading": "2. Prueba de líneas para respuestas",
                    "prompt": "Las líneas deben verse nítidas en impresión blanco y negro.",
                    "items": [
                        {
                            "kind": "question",
                            "text": "Nota rápida de prueba (márgenes tamaño Carta 8.5 x 11 in):",
                            "answer_lines": 2,
                        }
                    ],
                },
            ],
            "footer_note": "AulaLista · Hoja de prueba Epson Email Print",
        },
    }
    return render_annex_pdf(doc_payload, copies=1)
