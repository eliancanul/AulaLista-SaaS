/** Session-scoped school and subject workspace organizer (in-memory only, purged on logout). */

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

export interface SchoolContextSnapshot {
  schools: SchoolSpace[];
  activeSchoolId: string;
  activeSubjectId: string;
  hasScheduledPrint: boolean;
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
    hasScheduledPrint: false,
  };
}

export class SchoolContextStore {
  private state: SchoolContextSnapshot = freshSnapshot();
  private listeners = new Set<() => void>();
  private closed = false;
  private counter = 0;

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
    });
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
      id: `${schoolId}-sub-${++this.counter}`,
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
    });
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
    const id = `school-${++this.counter}`;
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
    });
    return created;
  }

  setHasScheduledPrint(hasScheduled: boolean) {
    if (this.closed || this.state.hasScheduledPrint === hasScheduled) return;
    this.emit({ ...this.state, hasScheduledPrint: hasScheduled });
  }

  close() {
    this.closed = true;
    this.state = freshSnapshot();
    for (const listener of this.listeners) listener();
    this.listeners.clear();
  }
}
