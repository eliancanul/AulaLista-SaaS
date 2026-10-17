import { describe, it, expect } from "vitest";
import { AcentaNavigation, type NavigationLocation, type NavigationPosition } from "../src/acenta/navigation";
import { planning, revised } from "./acenta-fixtures";

function setup() {
  let state = { view: "home", result: null, closed: false } as NavigationLocation & { closed: boolean };
  const listeners = new Set<() => void>();
  const markers: unknown[] = [];
  let position: NavigationPosition = { x: 0, y: 0, focus: "request" };
  const changes: (NavigationPosition | null)[] = [];
  const update = (next: Partial<typeof state>) => {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  };
  const navigation = new AcentaNavigation({
    snapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    restoreNavigation: update,
  }, {
    replaceState: (marker) => { markers[markers.length ? markers.length - 1 : 0] = marker; },
    pushState: (marker) => { markers.push(marker); },
  }, () => position, (p) => { changes.push(p); });
  return { navigation, markers, changes, update, state: () => state, position: (p: NavigationPosition) => { position = p; } };
}

describe("private workspace history", () => {
  it("restores destinations and position with only opaque references in history", () => {
    const s = setup();
    s.update({ view: "resources" });
    s.position({ x: 0, y: 742, focus: "resource-button" });
    const doc = planning();
    s.update({ view: "result", result: doc });
    expect(s.markers).toHaveLength(3);
    const serialized = JSON.stringify(s.markers);
    expect(serialized).not.toContain(doc.receipt.planning_id);
    expect(serialized).not.toContain(doc.result.title);
    expect(serialized).not.toContain("resources");
    s.navigation.restore(s.markers[1]);
    expect(s.state()).toMatchObject({ view: "resources", result: null });
    expect(s.changes.at(-1)).toEqual({ x: 0, y: 742, focus: "resource-button" });
    expect(s.markers).toHaveLength(3);
    s.navigation.restore(s.markers[2]);
    expect(s.state().result).toBe(doc);
  });
  it("does not push duplicate destinations or revision-only updates", () => {
    const s = setup(), doc = planning();
    s.update({ view: "result", result: doc });
    s.update({ view: "result", result: revised(doc, "Texto guardado") });
    s.update({ view: "resources" });
    expect(s.markers).toHaveLength(3);
    s.navigation.restore(s.markers[1]);
    expect(s.state().result?.receipt.revision).toBe(2);
  });
  it("ignores malformed, other-session and stale forward destinations", () => {
    const s = setup(), other = setup();
    s.update({ view: "resources" });
    s.update({ view: "result", result: planning() });
    const oldForward = s.markers[2];
    s.navigation.restore(other.markers[0]);
    for (const marker of [null, {}, { acentaNavigation: [] }, { acentaNavigation: { session: "other", index: 1 } }])
      s.navigation.restore(marker);
    expect(s.state().view).toBe("result");
    s.navigation.restore(s.markers[0]);
    s.update({ view: "resources" });
    s.navigation.restore(oldForward);
    expect(s.state().view).toBe("resources");
  });
  it("rejects a replaced forward entry even when its index has been reused", () => {
    const s = setup();
    s.update({ view: "resources" });
    const old = s.markers[1];
    s.navigation.restore(s.markers[0]);
    s.update({ view: "result", result: planning() });
    s.navigation.restore(s.markers[0]);
    s.navigation.restore(old);
    expect(s.state().view).toBe("home");
  });
  it("drops private destinations at session close and on disposal", () => {
    const s = setup();
    s.update({ view: "result", result: planning() });
    const old = s.markers[1];
    s.update({ view: "home", result: null, closed: true });
    expect(s.markers.at(-1)).toBeNull();
    s.navigation.restore(old);
    expect(s.state().result).toBeNull();
    s.navigation.dispose();
  });
});
