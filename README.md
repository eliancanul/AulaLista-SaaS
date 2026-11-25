# AulaLista SaaS

AulaLista is a web application for individual school teachers in Mexico. A teacher signs in, builds lesson plans against the national curriculum context, generates printable annexes and classroom tools, keeps their own source documents, and can ask a private chat assistant for help; plans and usage quotas are tracked per account. The backend is FastAPI on PostgreSQL (`src/`), the frontend is React, TypeScript and Vite (`web/`), and the product UI is in Spanish.

The project is under active development. Test data is synthetic and nothing here claims a production deployment.

[![backend](https://github.com/eliancanul/AulaLista-SaaS/actions/workflows/backend.yml/badge.svg?branch=main)](https://github.com/eliancanul/AulaLista-SaaS/actions/workflows/backend.yml)
[![web](https://github.com/eliancanul/AulaLista-SaaS/actions/workflows/web.yml/badge.svg?branch=main)](https://github.com/eliancanul/AulaLista-SaaS/actions/workflows/web.yml)
[![evaluation-offline](https://github.com/eliancanul/AulaLista-SaaS/actions/workflows/evaluation.yml/badge.svg?branch=main)](https://github.com/eliancanul/AulaLista-SaaS/actions/workflows/evaluation.yml)

The badges show the current state of each workflow on `main`.

## Testing strategy

Each layer exists because it catches a class of failure the layer below cannot. The risks that shaped the suite are: one teacher reading another's material, losing or duplicating a write when a request is retried or a response is lost, spending money on a model provider twice, and a UI that looks correct against a stub but breaks against the real API.

| Layer | Where | What it is for |
| --- | --- | --- |
| Unit and contract | `tests/` (files that need no database) | Pure rules: configuration that fails closed, request and result contracts, auth primitives, the provider adapters driven through an injected transport. Fast, so they run first. |
| API against real PostgreSQL | `tests/` (integration files) | Everything whose guarantee lives in the database: ownership scoping, constraints, triggers that keep history immutable, compare-and-swap on concurrent edits, idempotent replay after a lost response, migrations up and down. There is no SQLite substitute and no skip when the database is missing, because those guarantees do not exist in a fake. |
| Frontend unit (Vitest) | `web/tests/*.test.ts` | State, storage and recovery logic in the controllers: what the client keeps, discards or retries on reload, logout, expiry and uncertain responses. No browser needed. |
| Browser journeys (Playwright) | `web/tests/*.browser.ts` | User journeys in Chromium against a fixture server: layout at several viewport sizes, keyboard and focus behaviour, printing views. Cheap enough to cover many states. |
| Connected end to end (Playwright driven by pytest) | `tests/*_browser_integration.py`, `web/tests/*.integration.ts`, `web/tests/*.connected.ts` | A smaller set where the browser talks to the real API, real sessions and real PostgreSQL with no route interception. This is the layer that proves the pieces agree with each other. |
| Offline evaluation | `evaluation/`, `document_checks/` | An instrument that prepares and scores requests for comparing prompting variants, plus source-integrity checks. It runs on frozen synthetic inputs whose hashes are verified first, uses only the Python standard library, and needs no network. |

Some decisions worth calling out:

- **Deterministic seam for OpenAI calls.** The provider adapters in `src/aulalista_api/openai_*.py` accept a transport as a parameter. Tests pass a synthetic transport that returns success, rejection, timeout or an uncertain outcome on demand, so the budget reservation, retry and "never send twice" rules are tested exactly, without a credential and without model nondeterminism. None of the three workflows defines a secret. The trade-off is explicit: these tests say nothing about the quality of real model output.
- **Tenant isolation has its own step.** `tests/test_runtime_isolation.py` runs two real sessions through a single recycled database connection and checks that the second teacher cannot reach the first one's data by any route, then checks that the first teacher's rows are unchanged.
- **The test database protects itself.** The fixtures in `tests/conftest.py` drop and rebuild the schema, so they refuse to run unless the target is on loopback, has the expected name and role, carries an explicit marker, and the caller has opted in.
- **Logs are tested too.** After the integration tests, the backend workflow inspects the PostgreSQL log and fails if it contains private rows or statement parameters.
- **Tests run against the installed package.** CI installs a non-editable wheel, so packaging mistakes fail the build instead of surfacing at deploy time.
- **CI lists test files explicitly.** The backend workflow names the files for each step instead of running bare `pytest`. This keeps the database-dependent steps separate and mandatory, at the cost that a new test file only gates merges once it is added to the list.

### Test counts

Counted on 24 November 2026 at commit `85a21e1`, rounded down. The numbers are what the tools collect, not a claim about what passes; the badges above carry that.

| Suite | Tests | How it was counted |
| --- | --- | --- |
| Backend, pytest | 870+ | `uv run --frozen pytest --collect-only -q` (at least 420 need no database; most of the rest require PostgreSQL) |
| Frontend unit, Vitest | 670+ | cases executed by `npm test` across 39 files (`vitest list` shows 410+ declared tests before parametrisation) |
| Browser journeys, Playwright | 130+ | `playwright test --list -c playwright.config.ts` |
| Connected end to end, Playwright | 25+ | `playwright test --list` over the five other `playwright.*.config.ts` files |
| Offline evaluation, unittest | 120+ | `unittest discover` over `evaluation/tests` and `document_checks/tests` |

### Continuous integration

Three GitHub Actions workflows run on pull requests and on pushes to `main`:

- [`backend`](.github/workflows/backend.yml): lint and format with Ruff, migrations applied twice to a PostgreSQL 17 service, then unit, PostgreSQL integration, chat and isolation tests as separate steps, the log inspection, and a package build.
- [`web`](.github/workflows/web.yml): Vitest, typecheck and production build, Playwright journeys, the connected browser suites against the real API and PostgreSQL, and a check that the production wheel contains no test entry points. It is limited to changes under the paths it depends on.
- [`evaluation-offline`](.github/workflows/evaluation.yml): manifest verification and the offline suites, run with and without Python assertions enabled.

Actions are pinned by commit SHA, and tool versions are pinned in `pyproject.toml`, `uv.lock` and `web/package-lock.json`.

## Running the tests locally

Requirements: Python 3.12, [uv](https://docs.astral.sh/uv/) 0.12.23 (the version is pinned in `pyproject.toml`), Node.js 24, and Docker for the disposable database.

Offline evaluation, no dependencies to install:

```sh
python3 -B evaluation/scripts/freeze.py verify --root evaluation --input evaluation/manifests/input.manifest.json
python3 -B -m unittest discover -s evaluation/tests
PYTHONPATH=src:. python3 -B -m unittest discover -s document_checks/tests
```

Backend. The database from `compose.test.yml` is disposable: it listens on loopback only and stores data in memory.

```sh
uv sync --locked --no-editable
docker compose -f compose.test.yml up -d --wait
export AULALISTA_DATABASE_URL='postgresql+psycopg://aulalista_test@127.0.0.1:55432/aulalista_test'
export AULALISTA_TEST_DATABASE_URL="$AULALISTA_DATABASE_URL"
export AULALISTA_TEST_ALLOW_RESET=1
uv run --locked --no-editable alembic upgrade head
uv run --locked --no-editable pytest
```

CI does not run bare `pytest`; it runs the file lists in [`backend.yml`](.github/workflows/backend.yml) as separate steps. To run only the tests that need no database, pass the list from its first test step.

Frontend unit tests and browser journeys:

```sh
cd web
npm ci --ignore-scripts
npm test
npx --no-install playwright install chromium
npm run test:browser
```

Connected end-to-end suites. With the database and variables above and the web dependencies installed, pytest starts the API, the web server and Playwright, and stops them afterwards:

```sh
uv run --locked --no-editable pytest tests/browser_integration.py
uv run --locked --no-editable pytest tests/auth_browser_integration.py
uv run --locked --no-editable pytest tests/pilot_browser_integration.py
uv run --locked --no-editable pytest tests/chat_browser_integration.py
uv run --locked --no-editable pytest tests/guided_accessibility_browser_integration.py
```

When finished: `docker compose -f compose.test.yml down`. More detail, including the runtime database role, is in [docs/development.md](docs/development.md) (Spanish).

## Repository map

| Path | Contents |
| --- | --- |
| `src/aulalista_api/` | FastAPI application: auth, materials, lesson plans, annexes, documents, chat, billing, printing |
| `migrations/` | Alembic migrations |
| `tests/` | pytest suites and the runners that drive the connected browser tests |
| `web/` | React frontend; `web/tests/` holds Vitest and Playwright tests and their fixtures |
| `evaluation/`, `document_checks/` | Offline evaluation instrument and source-integrity checks |
| `.github/workflows/` | The three CI workflows |
| `docs/` | Specs, architecture decision records, review notes and the development guide |
| `deploy/`, `Dockerfile`, `scripts/` | Deployment template and local helper scripts |

## How this is built

Development is AI-assisted: coding agents write changes, working from a written spec and a small issue. The process in [AGENTS.md](AGENTS.md) and [docs/workflow.md](docs/workflow.md) treats their output as a candidate, not a result. Each change needs tests that would fail if its guarantee broke, a review by a different agent or person than the author, and CI on the exact commit being merged; a new commit invalidates earlier evidence for what it touches.

Most project documentation is in Spanish. The previous README, an internal evidence log for the first delivery cuts, is kept at [docs/registro-evidencia.md](docs/registro-evidencia.md).
