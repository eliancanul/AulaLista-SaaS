import { describe, expect, it } from "vitest";
import { AcentaApi } from "../src/acenta/api";
import { AcentaController } from "../src/acenta/controller";
import { SchoolContextStore } from "../src/acenta/school-context";
import { json, session } from "./acenta-fixtures";

describe("SchoolContextStore", () => {
  it("starts with default Benito Juárez and Miguel Hidalgo contexts", () => {
    const store = new SchoolContextStore();
    const snap = store.snapshot();
    expect(snap.schools).toHaveLength(2);
    expect(store.getActiveSchool().shortName).toBe("Benito Juárez");
    expect(store.getActiveSchool().grade).toBe("4.º A");
    expect(store.getActiveSubject().name).toBe("Matemáticas");
    expect(snap.hasScheduledPrint).toBe(false);
  });

  it("remembers each school's last active subject when switching schools", () => {
    const store = new SchoolContextStore();
    expect(store.selectSubject("benito", "benito-cie")).toBe(true);
    expect(store.getActiveSubject().name).toBe("Ciencias Naturales");

    expect(store.switchSchool("hidalgo")).toBe(true);
    expect(store.getActiveSchool().shortName).toBe("Miguel Hidalgo");
    expect(store.getActiveSubject().name).toBe("Matemáticas");

    expect(store.selectSubject("hidalgo", "hidalgo-con")).toBe(true);
    expect(store.getActiveSubject().name).toBe("Conocimiento del Medio");

    expect(store.switchSchool("benito")).toBe(true);
    expect(store.getActiveSubject().name).toBe("Ciencias Naturales");

    expect(store.switchSchool("hidalgo")).toBe(true);
    expect(store.getActiveSubject().name).toBe("Conocimiento del Medio");
  });

  it("adds subjects, deduplicates case-insensitively, and rejects blanks", () => {
    const store = new SchoolContextStore();
    expect(store.addSubject("benito", "   ")).toBeNull();

    const created = store.addSubject("benito", "  Geografía  ");
    expect(created).not.toBeNull();
    expect(created?.name).toBe("Geografía");
    expect(store.getActiveSubject().id).toBe(created?.id);

    const countBefore = store.getActiveSchool().subjects.length;
    const duplicate = store.addSubject("benito", "geografía");
    expect(duplicate?.id).toBe(created?.id);
    expect(store.getActiveSchool().subjects).toHaveLength(countBefore);
  });

  it("creates a new school with initials, expanded grade, and starter subjects", () => {
    const store = new SchoolContextStore();
    const added = store.addSchool({
      shortName: "Niños Héroes",
      grade: "5.º B",
      shift: "Vespertino",
    });
    expect(added).not.toBeNull();
    expect(added?.initials).toBe("NH");
    expect(added?.gradeLong).toBe("5.º de primaria");
    expect(added?.shift).toBe("Vespertino");
    expect(added?.subjects.map((s) => s.name)).toEqual([
      "Matemáticas",
      "Español",
    ]);
    expect(store.getActiveSchool().id).toBe(added?.id);
    expect(store.getActiveSubject().name).toBe("Matemáticas");

    expect(store.addSchool({ shortName: "  ", grade: "1.º A" })).toBeNull();
  });

  it("tracks scheduled print indicator and notifies subscribers once per change", () => {
    const store = new SchoolContextStore();
    let notifications = 0;
    const unsub = store.subscribe(() => {
      notifications += 1;
    });
    store.setHasScheduledPrint(true);
    store.setHasScheduledPrint(true);
    expect(store.snapshot().hasScheduledPrint).toBe(true);
    expect(notifications).toBe(1);

    store.setHasScheduledPrint(false);
    expect(store.snapshot().hasScheduledPrint).toBe(false);
    expect(notifications).toBe(2);
    unsub();
  });

  it("purges session-scoped school and subject names on controller closeSession", () => {
    const api = new AcentaApi(session, () =>
      Promise.resolve(json({ items: [], next_cursor: null })),
    );
    const controller = new AcentaController(api);
    controller.schools.addSchool({
      shortName: "Escuela Privada Confidencial",
      grade: "6.º C",
    });
    controller.schools.addSubject(
      controller.schools.getActiveSchool().id,
      "Materia Privada",
    );
    controller.schools.setHasScheduledPrint(true);

    controller.closeSession();

    const serialized = JSON.stringify(controller.schools.snapshot());
    expect(serialized).not.toContain("Escuela Privada Confidencial");
    expect(serialized).not.toContain("Materia Privada");
    expect(controller.schools.snapshot().hasScheduledPrint).toBe(false);
    expect(
      controller.schools.addSubject("benito", "Post cierre"),
    ).toBeNull();
  });
});
