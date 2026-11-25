# AulaLista SaaS

A web app where a school teacher in Mexico builds lesson plans, generates printable classroom material and keeps their own documents. FastAPI and PostgreSQL in `src/`, React and TypeScript in `web/`.

[![backend](https://github.com/eliancanul/AulaLista-SaaS/actions/workflows/backend.yml/badge.svg?branch=main)](https://github.com/eliancanul/AulaLista-SaaS/actions/workflows/backend.yml)
[![web](https://github.com/eliancanul/AulaLista-SaaS/actions/workflows/web.yml/badge.svg?branch=main)](https://github.com/eliancanul/AulaLista-SaaS/actions/workflows/web.yml)
[![evaluation-offline](https://github.com/eliancanul/AulaLista-SaaS/actions/workflows/evaluation.yml/badge.svg?branch=main)](https://github.com/eliancanul/AulaLista-SaaS/actions/workflows/evaluation.yml)

## Why this exists

I made this web app with my mother and father in mind. They are teachers, and every new school year they get really busy making the study plans and exercises for their classes. So I built them an easy-to-use, intuitive platform (because they are definitely not "tech-friendly") with everything they need to create those materials. The latest feature is a connection to our local printer over email, for an automated print schedule every day. They are very happy with this piece of software, and I am happy that something I built has an impact on their lives.

## What the tests protect

Each layer exists because of one way this product can hurt a teacher:

- **Another teacher reads their material.** API tests on real PostgreSQL push two sessions through one database connection and check nothing leaks: [`test_runtime_isolation.py`](tests/test_runtime_isolation.py).
- **A retried save loses or duplicates their work.** Two connections race and only one write wins: [`test_planning_edits.py`](tests/test_planning_edits.py).
- **A model call is paid for twice.** An attempt with an unknown outcome blocks instead of retrying: [`test_planning_generation.py`](tests/test_planning_generation.py).
- **The UI works against a stub and breaks against the real API.** Playwright drives the real API, sessions and database: [`auth.integration.ts`](web/tests/auth.integration.ts).

Integration tests use PostgreSQL 17, never an in-memory substitute. Only OpenAI and outgoing email are replaced by test doubles.

Not tested, on purpose: the quality of what the model writes, browsers other than Chromium, and load. Known gaps and the reasoning are in [docs/testing.md](docs/testing.md).

Two cases where a failing test came before the fix: [#111](https://github.com/eliancanul/AulaLista-SaaS/pull/111) and [#8](https://github.com/eliancanul/AulaLista-SaaS/pull/8).

## Run it

```sh
uv sync --locked --no-editable
uv run --locked --no-editable pytest tests/test_config.py tests/test_auth_unit.py   # no database needed

cd web && npm ci --ignore-scripts && npm test                                       # frontend unit tests
```

The PostgreSQL and Playwright suites need Docker and Chromium; every command is in [docs/testing.md](docs/testing.md).

## How it is built

AI coding agents write most of the code. The process for a change is in [docs/workflow.md](docs/workflow.md): tests that fail when its guarantee breaks, an adversarial review by an agent other than the one that wrote it, recorded as a comment on the pull request, and CI on the exact commit against current `main`. Branch protection on `main` enforces the pull request and CI gates, with no bypass for administrators: direct pushes to `main` are blocked, and a pull request cannot be merged until it is up to date with `main` and the three required checks pass (see [docs/testing.md](docs/testing.md#required-checks) for what GitHub checks and its limits). The review is a rule of the process, not something GitHub enforces: this repository has one maintainer, and the reviewing agents comment from the same account. The history is in the [merged pull requests](https://github.com/eliancanul/AulaLista-SaaS/pulls?q=is%3Apr+is%3Amerged).

For scale: about 870 pytest tests, 670 Vitest cases and 160 Playwright tests. Most documentation under `docs/` is in Spanish.
