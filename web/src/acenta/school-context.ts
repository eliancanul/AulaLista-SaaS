/** School and subject workspace organizer with optional backend persistence (purged on logout). */

import type { AcentaApi } from "./api";

export interface SubjectSpace {
  id: string;
  name: string;
  activeTopic?: string;
}

export interface SchoolSpace {
  id: string;
  shortName: string;
  grade: string;
  gradeLong: string;
  shift: string;
  color: string;
  initials: string;
  lastSubjectId: string;
  subjects: SubjectSpace[];
}

export type AgentMode = "orchestrator" | "subject";

export interface SchoolContextSnapshot {
  schools: SchoolSpace[];
  activeSchoolId: string;
  activeSubjectId: string;
  activeAgentMode: AgentMode;
  hasScheduledPrint: boolean;
  syncStatus: "idle" | "loading" | "synced" | "saving";
}

interface PersistedSchoolSpacesPayload {
  schools: SchoolSpace[];
  activeSchoolId: string;
  activeSubjectId: string;
  activeAgentMode?: AgentMode;
}

const SCHOOL_PALETTE = ["#964e3b", "#3d6b59", "#4f667a", "#8f6d3b"] as const;

function deriveInitials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }
  return (words[0] ?? "ES").slice(0, 2).toUpperCase();
}

function expandGradeLong(grade: string): string {
  const match = grade.match(/([1-6])/);
  if (match) return `${match[1]}.º de primaria`;
  return grade.trim() || "4.º de primaria";
}

function defaultSchools(): SchoolSpace[] {
  return [
    {
      id: "benito",
      shortName: "Benito Juárez",
      grade: "4.º A",
      gradeLong: "4.º de primaria",
      shift: "Matutino",
      color: "#964e3b",
      initials: "BJ",
      lastSubjectId: "benito-mat",
      subjects: [
        { id: "benito-mat", name: "Matemáticas" },
        { id: "benito-esp", name: "Español" },
        { id: "benito-cie", name: "Ciencias Naturales" },
        { id: "benito-his", name: "Historia" },
      ],
    },
    {
      id: "hidalgo",
      shortName: "Miguel Hidalgo",
      grade: "3.º B",
      gradeLong: "3.º de primaria",
      shift: "Vespertino",
      color: "#3d6b59",
      initials: "MH",
      lastSubjectId: "hidalgo-mat",
      subjects: [
        { id: "hidalgo-mat", name: "Matemáticas" },
        { id: "hidalgo-esp", name: "Español" },
        { id: "hidalgo-con", name: "Conocimiento del Medio" },
      ],
    },
  ];
}

function freshSnapshot(): SchoolContextSnapshot {
  const schools = defaultSchools();
  return {
    schools,
    activeSchoolId: schools[0].id,
    activeSubjectId: schools[0].subjects[0].id,
    activeAgentMode: "subject",
    hasScheduledPrint: false,
    syncStatus: "idle",
  };
}

function isValidPersistedPayload(
  raw: unknown,
): raw is PersistedSchoolSpacesPayload {
  if (!raw || typeof raw !== "object") return false;
  const candidate = raw as Record<string, unknown>;
  if (!Array.isArray(candidate.schools) || candidate.schools.length === 0) {
    return false;
  }
  if (
    typeof candidate.activeSchoolId !== "string" ||
    typeof candidate.activeSubjectId !== "string"
  ) {
    return false;
  }
  return candidate.schools.every((sc) => {
    if (!sc || typeof sc !== "object") return false;
    const item = sc as Record<string, unknown>;
    return (
      typeof item.id === "string" &&
      typeof item.shortName === "string" &&
      typeof item.grade === "string" &&
      Array.isArray(item.subjects) &&
      item.subjects.length > 0
    );
  });
}

export class SchoolContextStore {
  private state: SchoolContextSnapshot = freshSnapshot();
  private listeners = new Set<() => void>();
  private closed = false;
  private counter = 0;
  private persistEnabled = false;
  private saveVersion = 0;
  private readonly api?: AcentaApi;

  constructor(api?: AcentaApi) {
    this.api = api;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  snapshot = (): SchoolContextSnapshot => this.state;

  private emit(next: SchoolContextSnapshot) {
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  private toPayload(state: SchoolContextSnapshot): PersistedSchoolSpacesPayload {
    return {
      schools: state.schools.map((sc) => ({
        id: sc.id,
        shortName: sc.shortName,
        grade: sc.grade,
        gradeLong: sc.gradeLong,
        shift: sc.shift,
        color: sc.color,
        initials: sc.initials,
        lastSubjectId: sc.lastSubjectId,
        subjects: sc.subjects.map((sub) =>
          sub.activeTopic
            ? { id: sub.id, name: sub.name, activeTopic: sub.activeTopic }
            : { id: sub.id, name: sub.name },
        ),
      })),
      activeSchoolId: state.activeSchoolId,
      activeSubjectId: state.activeSubjectId,
      activeAgentMode: state.activeAgentMode,
    };
  }

  private persistCurrent() {
    if (this.closed || !this.api || !this.persistEnabled) return;
    const version = ++this.saveVersion;
    const payload = this.toPayload(this.state);
    this.emit({ ...this.state, syncStatus: "saving" });
    void this.api
      .scopedJson("school-spaces", "PUT", payload)
      .then(() => {
        if (this.closed || this.saveVersion !== version) return;
        this.emit({ ...this.state, syncStatus: "synced" });
      })
      .catch(() => {
        if (this.closed || this.saveVersion !== version) return;
        this.emit({ ...this.state, syncStatus: "idle" });
      });
  }

  async load(): Promise<boolean> {
    if (this.closed || !this.api) return false;
    this.persistEnabled = true;
    this.emit({ ...this.state, syncStatus: "loading" });
    try {
      const response = await this.api.scopedJson("school-spaces");
      if (this.closed) return false;
      if (isValidPersistedPayload(response)) {
        const schools = response.schools.map((sc) => ({
          ...sc,
          gradeLong: sc.gradeLong || expandGradeLong(sc.grade),
          shift: sc.shift || "Matutino",
          color: sc.color || SCHOOL_PALETTE[0],
          initials: sc.initials || deriveInitials(sc.shortName),
          lastSubjectId: sc.lastSubjectId || sc.subjects[0].id,
        }));
        const activeSchool =
          schools.find((sc) => sc.id === response.activeSchoolId) ?? schools[0];
        const activeSubject =
          activeSchool.subjects.find(
            (sub) => sub.id === response.activeSubjectId,
          ) ??
          activeSchool.subjects.find(
            (sub) => sub.id === activeSchool.lastSubjectId,
          ) ??
          activeSchool.subjects[0];
        const activeAgentMode: AgentMode =
          response.activeAgentMode === "orchestrator" ? "orchestrator" : "subject";
        this.emit({
          ...this.state,
          schools,
          activeSchoolId: activeSchool.id,
          activeSubjectId: activeSubject.id,
          activeAgentMode,
          syncStatus: "synced",
        });
        return true;
      }
      this.emit({ ...this.state, syncStatus: "idle" });
      return false;
    } catch {
      if (!this.closed) {
        this.emit({ ...this.state, syncStatus: "idle" });
      }
      return false;
    }
  }

  getActiveSchool(): SchoolSpace {
    return (
      this.state.schools.find((sc) => sc.id === this.state.activeSchoolId) ??
      this.state.schools[0]
    );
  }

  getActiveSubject(): SubjectSpace {
    const school = this.getActiveSchool();
    return (
      school.subjects.find((sub) => sub.id === this.state.activeSubjectId) ??
      school.subjects[0]
    );
  }

  getActiveChannelKey(): string {
    const school = this.getActiveSchool();
    if (this.state.activeAgentMode === "orchestrator") {
      return `orchestrator:${school.id}`;
    }
    const subject = this.getActiveSubject();
    return `subject:${school.id}:${subject.id}`;
  }

  switchSchool(schoolId: string): boolean {
    if (this.closed) return false;
    const school = this.state.schools.find((sc) => sc.id === schoolId);
    if (!school || school.subjects.length === 0) return false;
    const targetSubjectId = school.subjects.some(
      (sub) => sub.id === school.lastSubjectId,
    )
      ? school.lastSubjectId
      : school.subjects[0].id;
    this.emit({
      ...this.state,
      activeSchoolId: school.id,
      activeSubjectId: targetSubjectId,
    });
    this.persistCurrent();
    return true;
  }

  selectOrchestrator(schoolId: string): boolean {
    if (this.closed) return false;
    const school = this.state.schools.find((sc) => sc.id === schoolId);
    if (!school) return false;
    const targetSubjectId = school.subjects.some(
      (sub) => sub.id === school.lastSubjectId,
    )
      ? school.lastSubjectId
      : school.subjects[0].id;
    this.emit({
      ...this.state,
      activeSchoolId: school.id,
      activeSubjectId: targetSubjectId,
      activeAgentMode: "orchestrator",
    });
    this.persistCurrent();
    return true;
  }

  selectSubject(schoolId: string, subjectId: string): boolean {
    if (this.closed) return false;
    const school = this.state.schools.find((sc) => sc.id === schoolId);
    if (!school || !school.subjects.some((sub) => sub.id === subjectId)) {
      return false;
    }
    const schools = this.state.schools.map((sc) =>
      sc.id === schoolId ? { ...sc, lastSubjectId: subjectId } : sc,
    );
    this.emit({
      ...this.state,
      schools,
      activeSchoolId: schoolId,
      activeSubjectId: subjectId,
      activeAgentMode: "subject",
    });
    this.persistCurrent();
    return true;
  }

  addSubject(schoolId: string, rawName: string): SubjectSpace | null {
    if (this.closed) return null;
    const name = rawName.trim().slice(0, 60);
    if (!name) return null;
    const school = this.state.schools.find((sc) => sc.id === schoolId);
    if (!school) return null;
    const existing = school.subjects.find(
      (sub) => sub.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      this.selectSubject(schoolId, existing.id);
      return existing;
    }
    const created: SubjectSpace = {
      id: `${schoolId}-sub-${Date.now().toString(36)}-${++this.counter}`,
      name,
    };
    const schools = this.state.schools.map((sc) =>
      sc.id === schoolId
        ? {
            ...sc,
            lastSubjectId: created.id,
            subjects: [...sc.subjects, created],
          }
        : sc,
    );
    this.emit({
      ...this.state,
      schools,
      activeSchoolId: schoolId,
      activeSubjectId: created.id,
      activeAgentMode: "subject",
    });
    this.persistCurrent();
    return created;
  }

  addSchool(input: {
    shortName: string;
    grade: string;
    shift?: string;
  }): SchoolSpace | null {
    if (this.closed) return null;
    const shortName = input.shortName.trim().slice(0, 60);
    const grade = input.grade.trim().slice(0, 24) || "4.º A";
    const shift = input.shift?.trim().slice(0, 24) || "Matutino";
    if (!shortName) return null;
    const id = `school-${Date.now().toString(36)}-${++this.counter}`;
    const matId = `${id}-mat`;
    const espId = `${id}-esp`;
    const color =
      SCHOOL_PALETTE[this.state.schools.length % SCHOOL_PALETTE.length];
    const created: SchoolSpace = {
      id,
      shortName,
      grade,
      gradeLong: expandGradeLong(grade),
      shift,
      color,
      initials: deriveInitials(shortName),
      lastSubjectId: matId,
      subjects: [
        { id: matId, name: "Matemáticas" },
        { id: espId, name: "Español" },
      ],
    };
    this.emit({
      ...this.state,
      schools: [...this.state.schools, created],
      activeSchoolId: created.id,
      activeSubjectId: matId,
      activeAgentMode: "subject",
    });
    this.persistCurrent();
    return created;
  }

  setHasScheduledPrint(hasScheduled: boolean) {
    if (this.closed || this.state.hasScheduledPrint === hasScheduled) return;
    this.emit({ ...this.state, hasScheduledPrint: hasScheduled });
  }

  close() {
    this.closed = true;
    this.persistEnabled = false;
    this.saveVersion += 1;
    this.state = freshSnapshot();
    for (const listener of this.listeners) listener();
    this.listeners.clear();
  }
}
