"""US Letter black-and-white printable PDF generator + pypdf copy duplicator."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from io import BytesIO
from typing import Any
from xml.sax.saxutils import escape

from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

MIN_COPIES = 1
MAX_COPIES = 50
MAX_EPSON_PDF_BYTES = 20 * 1024 * 1024  # 20 MB limit for Epson Email Print

_DRAWING_HINT_RE = re.compile(
    r"\b(dibuj\w*|ilustr\w*|esquema\w*|recuadro|traza\w*|colorea\w*|mapa|diagrama|gr[aá]fic\w*)",
    re.IGNORECASE,
)
_TRAILING_FIELD_NOISE_RE = re.compile(r"[:_\s]+$")
_LEADING_NUMBER_RE = re.compile(r"^\s*\d+[.)]\s+")


class PdfGenerationError(Exception):
    def __init__(self, code: str, status: int = 422):
        super().__init__(code)
        self.code = code
        self.status = status


def _latin1_safe(text: str) -> str:
    """Keep full Spanish Latin-1 (áéíóúñ¿¡üºª·) and replace exotic glyphs safely for Helvetica."""
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


def clean_header_field_label(raw: str) -> str:
    """Strip trailing colons/underscores that LLMs sometimes include in header labels."""
    cleaned = _TRAILING_FIELD_NOISE_RE.sub("", _latin1_safe(raw)).strip()
    return cleaned or _latin1_safe(raw).strip() or "Campo"


def strip_leading_number(text: str) -> str:
    """Remove duplicate leading numbering (e.g. '1. ' or '2) ') before auto-numbering."""
    return _LEADING_NUMBER_RE.sub("", text)


def needs_drawing_box(text: str) -> bool:
    """Return True when a prompt invites students to draw, sketch, map, or diagram."""
    return bool(_DRAWING_HINT_RE.search(text))


def _make_numbered_canvas(footer_note: str, margin: float):
    """Build a lightweight Canvas subclass that stamps 'Página X de Y' on every page."""
    safe_note = _latin1_safe(footer_note)[:90]

    class _EditorialNumberedCanvas(rl_canvas.Canvas):
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            super().__init__(*args, **kwargs)
            self._saved_page_states: list[dict[str, Any]] = []

        def showPage(self) -> None:
            self._saved_page_states.append(dict(self.__dict__))
            self._startPage()

        def save(self) -> None:
            total_pages = len(self._saved_page_states)
            for state in self._saved_page_states:
                self.__dict__.update(state)
                self._draw_footer(total_pages)
                super().showPage()
            super().save()

        def _draw_footer(self, total_pages: int) -> None:
            self.saveState()
            self.setStrokeColor(colors.HexColor("#BBBBBB"))
            self.setLineWidth(0.5)
            self.line(
                margin,
                0.48 * inch,
                letter[0] - margin,
                0.48 * inch,
            )
            self.setFont("Helvetica", 8.5)
            self.setFillColor(colors.HexColor("#444444"))
            if safe_note:
                self.drawString(margin, 0.33 * inch, safe_note)
            self.drawRightString(
                letter[0] - margin,
                0.33 * inch,
                f"Página {self._pageNumber} de {total_pages}",
            )
            self.restoreState()

    return _EditorialNumberedCanvas


def _build_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "meta": ParagraphStyle(
            "AnnexMeta",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8.5,
            leading=11.5,
            textColor=colors.HexColor("#333333"),
            spaceAfter=2,
        ),
        "title": ParagraphStyle(
            "AnnexTitle",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=16.5,
            leading=20.5,
            textColor=colors.black,
            alignment=0,
            spaceBefore=0,
            spaceAfter=3,
        ),
        "subtitle": ParagraphStyle(
            "AnnexSubtitle",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10,
            leading=13,
            textColor=colors.HexColor("#333333"),
            spaceAfter=6,
        ),
        "field_label": ParagraphStyle(
            "AnnexFieldLabel",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9.5,
            leading=12,
            textColor=colors.black,
        ),
        "instructions": ParagraphStyle(
            "AnnexInstructions",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10,
            leading=14,
            textColor=colors.black,
        ),
        "section": ParagraphStyle(
            "AnnexSection",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=11.5,
            leading=14.5,
            textColor=colors.black,
            spaceBefore=0,
            spaceAfter=0,
        ),
        "section_prompt": ParagraphStyle(
            "AnnexSectionPrompt",
            parent=base["Normal"],
            fontName="Helvetica-Oblique",
            fontSize=9.5,
            leading=13,
            textColor=colors.HexColor("#222222"),
            spaceBefore=4,
            spaceAfter=4,
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
        "checklist_item": ParagraphStyle(
            "AnnexChecklistItem",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10.5,
            leading=14,
            textColor=colors.black,
            spaceBefore=0,
            spaceAfter=0,
        ),
        "reading": ParagraphStyle(
            "AnnexReading",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10.5,
            leading=15,
            textColor=colors.black,
        ),
        "drawing_caption": ParagraphStyle(
            "AnnexDrawingCaption",
            parent=base["Normal"],
            fontName="Helvetica-Oblique",
            fontSize=8,
            leading=10,
            textColor=colors.HexColor("#666666"),
        ),
    }


def _student_header_table(
    fields: list[str],
    styles: dict[str, ParagraphStyle],
    usable_width: float,
) -> Table:
    """Precision underlined student header grid aligned flush to page margins."""
    labels = [
        clean_header_field_label(f)
        for f in fields[:4]
        if isinstance(f, str) and f.strip()
    ]
    if not labels:
        labels = ["Nombre", "Fecha", "Grupo"]

    label_style = styles["field_label"]
    col_gap = 16.0
    half_width = (usable_width - col_gap) / 2.0

    def _label_width(label: str) -> float:
        return min(max(len(label) * 6.0 + 12.0, 44.0), 115.0)

    def _row_table(pair: list[str]) -> Table:
        if len(pair) == 1:
            lw = _label_width(pair[0])
            row_data = [[Paragraph(f"{_p_text(pair[0])}:", label_style), ""]]
            tbl = Table(row_data, colWidths=[lw, usable_width - lw])
            tbl.setStyle(
                TableStyle(
                    [
                        ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
                        ("LEFTPADDING", (0, 0), (-1, -1), 0),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                        ("TOPPADDING", (0, 0), (-1, -1), 4),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                        ("LINEBELOW", (1, 0), (1, 0), 0.65, colors.HexColor("#444444")),
                    ]
                )
            )
            return tbl

        lw0 = _label_width(pair[0])
        lw1 = _label_width(pair[1])
        row_data = [
            [
                Paragraph(f"{_p_text(pair[0])}:", label_style),
                "",
                "",
                Paragraph(f"{_p_text(pair[1])}:", label_style),
                "",
            ]
        ]
        tbl = Table(
            row_data,
            colWidths=[lw0, half_width - lw0, col_gap, lw1, half_width - lw1],
        )
        tbl.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                    ("LINEBELOW", (1, 0), (1, 0), 0.65, colors.HexColor("#444444")),
                    ("LINEBELOW", (4, 0), (4, 0), 0.65, colors.HexColor("#444444")),
                ]
            )
        )
        return tbl

    row_tables: list[list[Table]] = []
    if len(labels) == 1:
        row_tables.append([_row_table(labels)])
    elif len(labels) == 2:
        row_tables.append([_row_table(labels)])
    elif len(labels) == 3:
        # Give generous full-width handwriting space to the first field (usually Nombre).
        row_tables.append([_row_table([labels[0]])])
        row_tables.append([_row_table(labels[1:3])])
    else:
        row_tables.append([_row_table(labels[:2])])
        row_tables.append([_row_table(labels[2:4])])

    wrapper = Table(row_tables, colWidths=[usable_width])
    wrapper.setStyle(
        TableStyle(
            [
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 1),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )
    return wrapper


def _editorial_double_rule(usable_width: float) -> list[Any]:
    return [
        HRFlowable(
            width=usable_width,
            thickness=1.4,
            color=colors.black,
            spaceBefore=3,
            spaceAfter=2,
        ),
        HRFlowable(
            width=usable_width,
            thickness=0.45,
            color=colors.HexColor("#666666"),
            spaceBefore=0,
            spaceAfter=8,
        ),
    ]


def _section_banner(
    heading: str,
    style: ParagraphStyle,
    usable_width: float,
) -> Table:
    """Crisp black-and-white editorial section strip with solid left accent rule."""
    table = Table([[Paragraph(_p_text(heading), style)]], colWidths=[usable_width])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F3F3F3")),
                ("LINEBEFORE", (0, 0), (0, -1), 2.5, colors.HexColor("#111111")),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return table


def _boxed_paragraph(
    text: str,
    style: ParagraphStyle,
    usable_width: float,
    *,
    fill_hex: str = "#F4F4F4",
    border_hex: str = "#333333",
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


def _reading_box(
    text: str,
    style: ParagraphStyle,
    usable_width: float,
) -> Table:
    """Left-ruled editorial frame for reading passages."""
    table = Table([[Paragraph(_p_text(text), style)]], colWidths=[usable_width])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FAFAFA")),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#BBBBBB")),
                ("LINEBEFORE", (0, 0), (0, -1), 2.2, colors.HexColor("#222222")),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ]
        )
    )
    return table


def _checklist_row(
    text: str,
    style: ParagraphStyle,
    usable_width: float,
) -> Table:
    """Vector 9x9pt hollow square checkbox aligned with checklist text."""
    checkbox = Table([[""]], colWidths=[9], rowHeights=[9])
    checkbox.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (0, 0), 0.8, colors.HexColor("#222222")),
                ("BACKGROUND", (0, 0), (0, 0), colors.white),
                ("TOPPADDING", (0, 0), (0, 0), 0),
                ("BOTTOMPADDING", (0, 0), (0, 0), 0),
                ("LEFTPADDING", (0, 0), (0, 0), 0),
                ("RIGHTPADDING", (0, 0), (0, 0), 0),
            ]
        )
    )
    row = Table(
        [[checkbox, Paragraph(_p_text(text), style)]],
        colWidths=[18, usable_width - 18],
    )
    row.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (0, 0), "TOP"),
                ("VALIGN", (1, 0), (1, 0), "TOP"),
                ("TOPPADDING", (0, 0), (0, 0), 4),
                ("TOPPADDING", (1, 0), (1, 0), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    return row


def _drawing_box(
    styles: dict[str, ParagraphStyle],
    usable_width: float,
    answer_lines: int,
) -> Table:
    """Hollow black-and-white frame for student drawings, diagrams, or maps."""
    height = 1.8 * inch if answer_lines >= 4 else 1.45 * inch
    box = Table(
        [[Paragraph("Espacio para dibujar / esquematizar", styles["drawing_caption"])]],
        colWidths=[usable_width],
        rowHeights=[height],
    )
    box.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                ("BOX", (0, 0), (-1, -1), 0.85, colors.HexColor("#333333")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return box


def _answer_lines(count: int, usable_width: float) -> list[Any]:
    """Primary-friendly 0.28 in ruled writing lines."""
    flowables: list[Any] = []
    for _ in range(max(0, min(10, count))):
        flowables.append(Spacer(1, 0.28 * inch))
        flowables.append(
            HRFlowable(
                width=usable_width,
                thickness=0.55,
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
        bottomMargin=0.68 * inch,
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

    trace = content.get("curricular_trace")
    if isinstance(trace, dict):
        trace_bits = [
            str(trace.get(k, "")).strip()
            for k in ("phase", "campo_formativo")
            if str(trace.get(k, "")).strip()
        ]
        pda_titles = [
            str(p.get("title", "")).strip()
            for p in (trace.get("pdas") or [])
            if isinstance(p, dict) and str(p.get("title", "")).strip()
        ]
        if trace_bits or pda_titles:
            trace_line = " · ".join(trace_bits)
            if pda_titles:
                trace_line += (" · PDA: " if trace_line else "PDA: ") + "; ".join(
                    pda_titles[:3]
                )
            story.append(Paragraph(_p_text(trace_line), styles["meta"]))

    header_fields = content.get("student_header_fields") or ["Nombre", "Fecha", "Grupo"]
    story.append(_student_header_table(header_fields, styles, usable_width))
    story.extend(_editorial_double_rule(usable_width))

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
    for s_idx, section in enumerate(sections):
        heading = str(section.get("heading", "")).strip()
        prompt = str(section.get("prompt", "")).strip()
        items = section.get("items") or []
        bullets = section.get("bullets") or []
        table_data = section.get("table")
        section_header: list[Any] = []
        if s_idx > 0:
            section_header.append(Spacer(1, 0.08 * inch))
        if heading:
            section_header.append(
                _section_banner(heading, styles["section"], usable_width)
            )
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
                block.append(Spacer(1, 0.04 * inch))
                block.append(_reading_box(text, styles["reading"], usable_width))
                block.append(Spacer(1, 0.08 * inch))
            elif kind == "checklist":
                block.append(
                    _checklist_row(text, styles["checklist_item"], usable_width)
                )
            else:
                question_index += 1
                clean_text = strip_leading_number(text)
                block.append(
                    Paragraph(
                        f"<b>{question_index}.</b> {_p_text(clean_text)}",
                        styles["item"],
                    )
                )
                if needs_drawing_box(clean_text):
                    block.append(Spacer(1, 0.04 * inch))
                    block.append(_drawing_box(styles, usable_width, lines))
                    block.append(Spacer(1, 0.05 * inch))
                    if lines > 0:
                        block.extend(_answer_lines(min(lines, 3), usable_width))
                elif lines > 0:
                    block.extend(_answer_lines(lines, usable_width))
            story.append(KeepTogether(block))

        if section_header:
            story.extend(section_header)
            section_header = []

        if isinstance(bullets, list) and bullets:
            for bullet in bullets:
                b_text = str(bullet).strip()
                if b_text:
                    story.append(
                        Paragraph(f"&#8226; {_p_text(b_text)}", styles["item"])
                    )
            story.append(Spacer(1, 0.06 * inch))

        if isinstance(table_data, dict) and table_data.get("headers"):
            headers = [str(h) for h in table_data["headers"][:8]]
            col_count = max(1, len(headers))
            col_width = usable_width / col_count
            matrix: list[list[Any]] = [
                [
                    Paragraph(f"<b>{_p_text(h)}</b>", styles["checklist_item"])
                    for h in headers
                ]
            ]
            for raw_row in (table_data.get("rows") or [])[:24]:
                padded = list(raw_row[:col_count]) + [""] * max(
                    0, col_count - len(raw_row)
                )
                matrix.append(
                    [
                        Paragraph(_p_text(str(cell)), styles["checklist_item"])
                        for cell in padded
                    ]
                )
            tbl = Table(matrix, colWidths=[col_width] * col_count, repeatRows=1)
            tbl.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EAEAEA")),
                        ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#222222")),
                        (
                            "INNERGRID",
                            (0, 0),
                            (-1, -1),
                            0.45,
                            colors.HexColor("#666666"),
                        ),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("TOPPADDING", (0, 0), (-1, -1), 5),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                        ("LEFTPADDING", (0, 0), (-1, -1), 6),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                    ]
                )
            )
            story.append(Spacer(1, 0.05 * inch))
            story.append(tbl)
            story.append(Spacer(1, 0.08 * inch))

    metadata = (
        content.get("metadata") if isinstance(content.get("metadata"), dict) else {}
    )

    # Word search printable letter grid
    wordsearch = (
        metadata.get("wordsearch")
        if isinstance(metadata.get("wordsearch"), dict)
        else None
    )
    if wordsearch and isinstance(wordsearch.get("grid"), list) and wordsearch["grid"]:
        grid = wordsearch["grid"]
        size = len(grid)
        cell_size = min(0.36 * inch, usable_width / max(1, size))
        ws_table = Table(
            [[str(ch) for ch in row] for row in grid],
            colWidths=[cell_size] * size,
            rowHeights=[cell_size] * size,
        )
        ws_table.setStyle(
            TableStyle(
                [
                    ("FONTNAME", (0, 0), (-1, -1), "Courier-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 10.5),
                    ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("BOX", (0, 0), (-1, -1), 1.0, colors.black),
                    ("INNERGRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#777777")),
                ]
            )
        )
        story.append(Spacer(1, 0.08 * inch))
        story.append(ws_table)
        story.append(Spacer(1, 0.1 * inch))

    # Bingo unique boards (2 per page cleanly)
    bingo = metadata.get("bingo") if isinstance(metadata.get("bingo"), dict) else None
    if bingo and isinstance(bingo.get("boards"), list) and bingo["boards"]:
        for board in bingo["boards"]:
            cells = board.get("cells") or []
            if not cells:
                continue
            b_num = board.get("board_number", 1)
            cols = max(1, len(cells[0]))
            col_w = usable_width / cols
            rows_p = [
                [
                    Paragraph(f"<b>{_p_text(str(c))}</b>", styles["checklist_item"])
                    for c in row
                ]
                for row in cells
            ]
            b_tbl = Table(
                rows_p, colWidths=[col_w] * cols, rowHeights=[0.65 * inch] * len(rows_p)
            )
            b_tbl.setStyle(
                TableStyle(
                    [
                        ("BOX", (0, 0), (-1, -1), 1.2, colors.black),
                        (
                            "INNERGRID",
                            (0, 0),
                            (-1, -1),
                            0.6,
                            colors.HexColor("#333333"),
                        ),
                        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                        ("BACKGROUND", (1, 1), (1, 1), colors.HexColor("#EAEAEA")),
                    ]
                )
            )
            story.append(
                KeepTogether(
                    [
                        Spacer(1, 0.08 * inch),
                        Paragraph(f"<b>Tablero #{b_num}</b>", styles["section"]),
                        Spacer(1, 0.04 * inch),
                        b_tbl,
                    ]
                )
            )

    # Cuttable cards grid (flashcards, memorama, clue cards)
    cut_cards = (
        metadata.get("cut_cards")
        if isinstance(metadata.get("cut_cards"), list)
        else None
    )
    if cut_cards:
        story.append(PageBreak())
        story.append(
            Paragraph("TARJETAS RECORTABLES · RECORTAR POR LOS BORDES", styles["meta"])
        )
        story.append(Spacer(1, 0.06 * inch))
        card_rows: list[list[Any]] = []
        pair_buf: list[Any] = []
        for card in cut_cards[:24]:
            if not isinstance(card, dict):
                continue
            front = str(card.get("front", "")).strip()
            back = str(card.get("back", "")).strip()
            cell_html = f"<b>{_p_text(front)}</b><br/><br/>{_p_text(back)}"
            pair_buf.append(Paragraph(cell_html, styles["checklist_item"]))
            if len(pair_buf) == 2:
                card_rows.append(pair_buf)
                pair_buf = []
        if pair_buf:
            pair_buf.append(Paragraph("", styles["checklist_item"]))
            card_rows.append(pair_buf)
        if card_rows:
            c_tbl = Table(card_rows, colWidths=[usable_width / 2.0, usable_width / 2.0])
            c_tbl.setStyle(
                TableStyle(
                    [
                        ("BOX", (0, 0), (-1, -1), 0.8, colors.HexColor("#333333")),
                        (
                            "INNERGRID",
                            (0, 0),
                            (-1, -1),
                            0.6,
                            colors.HexColor("#555555"),
                        ),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("TOPPADDING", (0, 0), (-1, -1), 10),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                        ("LEFTPADDING", (0, 0), (-1, -1), 10),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                    ]
                )
            )
            story.append(c_tbl)

    teacher_key = content.get("teacher_key")
    if isinstance(teacher_key, list) and any(str(x).strip() for x in teacher_key):
        story.append(PageBreak())
        story.append(
            Paragraph("CLAVE DOCENTE · NO REPARTIR AL ALUMNADO", styles["meta"])
        )
        story.append(
            Paragraph(
                _p_text(f"Clave: {annex_doc.get('title', 'Anexo')}"), styles["title"]
            )
        )
        story.extend(_editorial_double_rule(usable_width))
        if (
            wordsearch
            and isinstance(wordsearch.get("grid"), list)
            and wordsearch.get("placements")
        ):
            highlighted: set[tuple[int, int]] = set()
            for p in wordsearch["placements"]:
                r0, c0 = p["start"]
                r1, c1 = p["end"]
                steps = max(abs(r1 - r0), abs(c1 - c0))
                dr = 0 if steps == 0 else (r1 - r0) // steps
                dc = 0 if steps == 0 else (c1 - c0) // steps
                for i in range(steps + 1):
                    highlighted.add((r0 + i * dr, c0 + i * dc))
            grid = wordsearch["grid"]
            size = len(grid)
            cell_size = min(0.32 * inch, usable_width / max(1, size))
            sol_tbl = Table(
                [[str(ch) for ch in row] for row in grid],
                colWidths=[cell_size] * size,
                rowHeights=[cell_size] * size,
            )
            sol_style = [
                ("FONTNAME", (0, 0), (-1, -1), "Courier"),
                ("FONTSIZE", (0, 0), (-1, -1), 9.5),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("BOX", (0, 0), (-1, -1), 0.9, colors.black),
                ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#999999")),
            ]
            for r, c in highlighted:
                sol_style.append(
                    ("BACKGROUND", (c, r), (c, r), colors.HexColor("#DCDCDC"))
                )
                sol_style.append(("FONTNAME", (c, r), (c, r), "Courier-Bold"))
            sol_tbl.setStyle(TableStyle(sol_style))
            story.append(sol_tbl)
            story.append(Spacer(1, 0.1 * inch))
        for k_idx, entry in enumerate(teacher_key, start=1):
            text = str(entry).strip()
            if text:
                story.append(
                    Paragraph(f"<b>{k_idx}.</b> {_p_text(text)}", styles["item"])
                )

    doc.build(story, canvasmaker=_make_numbered_canvas(footer_note, margin))
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
