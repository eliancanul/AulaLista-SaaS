import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { AnnexDocument, PrintSettings } from "../src/acenta/annex-api";
import { AnnexesView } from "../src/acenta/AnnexesView";
import { AcentaApi } from "../src/acenta/api";
import { AcentaController } from "../src/acenta/controller";
import { json, session } from "./acenta-fixtures";

vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return {
    ...react,
    useSyncExternalStore: <T,>(_subscribe: unknown, snapshot: () => T) =>
      snapshot(),
  };
});

function sampleAnnex(overrides: Partial<AnnexDocument> = {}): AnnexDocument {
  return {
    id: "annex-1",
    scope_id: session.scopeId,
    title: "Fracciones equivalentes en clase",
    subject: "Matemáticas",
    grade: "4.º de primaria",
    topic: "Fracciones equivalentes",
    instructions: "Resuelve los ejercicios y dibuja tu representación.",
    content: {
      subtitle: "Práctica guiada",
      student_header_fields: ["Nombre", "Fecha", "Grupo"],
      sections: [
        {
          heading: "1. Representa fracciones",
          prompt: "Usa rectángulos del mismo tamaño.",
          items: [
            {
              kind: "exercise",
              text: "Dibuja dos fracciones equivalentes a 1/2.",
              answer_lines: 2,
            },
          ],
        },
      ],
      footer_note: "AulaLista · 4.º A",
    },
    status: "draft",
    provenance: "ai",
    model: "gpt-4o-mini",
    revision: 1,
    approved_at: null,
    created_at: "2026-11-20T10:00:00Z",
    updated_at: "2026-11-20T10:00:00Z",
    ...overrides,
  };
}

function sampleSettings(
  overrides: Partial<PrintSettings> = {},
): PrintSettings {
  return {
    scope_id: session.scopeId,
    printer_email: "salon4a@print.epsonconnect.com",
    default_copies: 25,
    default_print_time: "06:30",
    timezone: "America/Mexico_City",
    smtp_configured: true,
    updated_at: "2026-11-20T10:00:00Z",
    ...overrides,
  };
}

function makeController() {
  return new AcentaController(
    new AcentaApi(session, () => Promise.resolve(json({}))),
  );
}

it("defaults to live Carta preview with minimal print dock and zero legacy workflow bloat", () => {
  const controller = makeController();
  const html = renderToStaticMarkup(
    createElement(AnnexesView, {
      controller,
      initialAnnexes: [sampleAnnex()],
      initialSettings: sampleSettings(),
    }),
  );

  // Live Carta B&N preview is visible by default
  expect(html).toContain('aria-label="Vista previa tamaño Carta"');
  expect(html).toContain("Fracciones equivalentes en clase");
  expect(html).toContain("Espacio para dibujar / esquematizar");

  // Subtractive minimalism: removed legacy clutter is absent
  expect(html).not.toContain("workflow-steps");
  expect(html).not.toContain("Ideas rápidas");
  expect(html).not.toContain("Editar contenido");
  expect(html).not.toContain("Guardar cambios");
  expect(html).not.toContain("Aprobar para imprimir");

  // Discreet canvas topbar icons
  expect(html).toContain('aria-label="Editar ficha"');
  expect(html).toContain('aria-label="Descargar PDF"');
  expect(html).toContain('aria-label="Eliminar ficha"');

  // Minimal bottom print dock
  expect(html).toContain('aria-label="Barra de impresión"');
  expect(html).toContain('aria-label="Menos copias"');
  expect(html).toContain('aria-label="Más copias"');
  expect(html).toContain("Ahora");
  expect(html).toContain("Imprimir");
});

it("shows concise setup button in print dock when printer email is unconfigured", () => {
  const controller = makeController();
  const html = renderToStaticMarkup(
    createElement(AnnexesView, {
      controller,
      initialAnnexes: [sampleAnnex()],
      initialSettings: sampleSettings({ printer_email: null }),
    }),
  );

  expect(html).toContain("Configurar impresora");
  expect(html).not.toContain('aria-label="Menos copias"');
});

it("syncs header kicker and generator prompt with active school and subject", () => {
  const controller = makeController();
  controller.schools.switchSchool("hidalgo");
  controller.schools.selectSubject("hidalgo", "hidalgo-con");

  const html = renderToStaticMarkup(
    createElement(AnnexesView, {
      controller,
      initialAnnexes: [],
      initialSettings: sampleSettings(),
    }),
  );

  expect(html).toContain("Miguel Hidalgo · 3.º B · Conocimiento del Medio");
  expect(html).toContain("Nueva ficha para Conocimiento del Medio");
  expect(html).toContain("Tema para 3.º B…");
});

it("edits directly on the US Letter Carta sheet when editing mode is active", () => {
  const controller = makeController();
  const html = renderToStaticMarkup(
    createElement(AnnexesView, {
      controller,
      initialAnnexes: [sampleAnnex()],
      initialSettings: sampleSettings(),
      initialEditing: true,
    }),
  );

  expect(html).toContain('aria-label="Edición directa en hoja tamaño Carta"');
  expect(html).toContain("letter-sheet is-editing");
  expect(html).toContain('aria-label="Título de la ficha"');
  expect(html).toContain('aria-label="Instrucciones de la ficha"');
  expect(html).toContain("+ Agregar actividad");
  expect(html).toContain("+ Agregar sección");
  expect(html).toContain('aria-current="true"');
  expect(html).not.toContain("minimal-editor-panel");
});

it("renders accessible loading states before initial annexes resolve", () => {
  const controller = makeController();
  const html = renderToStaticMarkup(createElement(AnnexesView, { controller }));

  expect(html).toContain("Cargando fichas…");
  expect(html).toContain("Cargando estudio de anexos…");
  expect(html).toContain('role="status"');
  expect(html).not.toContain("Aún no tienes fichas");
  expect(html).not.toContain("Elige o genera una ficha");
});


