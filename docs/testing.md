# Testing strategy, CI and how to run every suite

The long version of what the [README](../README.md) summarises.

## What is tested, at which layer, and what is left out

The suite is organised around four ways this product can hurt a teacher: someone else reads their material, a retried or interrupted save loses or duplicates their work, a model call is paid for twice, or the UI works against a stub and breaks against the real API.

| Risk | Layer | Example in the repo |
| --- | --- | --- |
| A teacher reaches another teacher's data | API tests on real PostgreSQL | `test_owner_authority_covers_all_operations_and_manipulated_scope` and `test_new_app_never_accepts_client_identity` in [`tests/test_materials.py`](../tests/test_materials.py). [`tests/test_runtime_isolation.py`](../tests/test_runtime_isolation.py) forces two real sessions through one recycled database connection and then checks the first teacher's rows are unchanged. |
| An edit is lost or applied twice | API tests on real PostgreSQL, then Vitest for the client side | [`tests/test_planning_edits.py`](../tests/test_planning_edits.py): two connections race and only one compare-and-swap wins; a response lost after commit is recovered from its receipt without a second write; a draft survives an application restart. [`web/tests/editor-exit.test.ts`](../web/tests/editor-exit.test.ts): the editor does not let the user leave until the draft is confirmed, and a duplicate click cannot start a second write. |
| Malformed or hostile input is accepted | Unit and contract tests, no database | [`tests/test_config.py`](../tests/test_config.py): invalid configuration prevents startup without echoing the value. `test_guided_request_rejects_invalid_and_untrusted_fields` in [`tests/test_guided_planning.py`](../tests/test_guided_planning.py). Uploads with a spoofed type, path traversal or XXE are rejected in [`tests/test_documents_and_websearch.py`](../tests/test_documents_and_websearch.py). |
| Sessions outlive logout, or login can be forced | API tests on real PostgreSQL | [`tests/test_auth_integration.py`](../tests/test_auth_integration.py): one-time codes are single use under concurrency, CSRF is required on writes, the per-IP limit cannot be bypassed with `X-Forwarded-For`, and a Google identity is never linked to an account by matching email. |
| A model call is sent or charged twice | Unit tests on the adapter, API tests on the ledger | [`tests/test_planning_generation.py`](../tests/test_planning_generation.py): an attempt with unknown outcome blocks new operations instead of retrying; a process crash expires to "uncertain" and cannot resend; overlapping admissions share one budget reservation. |
| Quotas and billing state are wrong | API tests on real PostgreSQL | [`tests/test_billing_and_quotas.py`](../tests/test_billing_and_quotas.py): plan limits and usage counters, webhook signature verification and idempotency. This area is thin: three long scenario tests. |
| The UI and the API disagree | Playwright against the real API, sessions and PostgreSQL | [`web/tests/auth.integration.ts`](../web/tests/auth.integration.ts) lets a real save commit, drops the response in the browser, and checks the UI recovers the saved state instead of writing again. These suites are started by pytest runners in `tests/*_browser_integration.py`. |
| Layout, keyboard and focus regress | Playwright against a fixture server | [`web/tests/*.browser.ts`](../web/tests): the same journeys at several viewport sizes, focus return after closing panels, print views. Chromium only. |
| The evaluation instrument itself is wrong | Standard-library `unittest`, no network | [`evaluation/tests`](../evaluation/tests) and [`document_checks/tests`](../document_checks/tests) run on frozen synthetic inputs whose hashes are verified first. |

### Real database, mocks only at third parties

Integration tests run against PostgreSQL 17, the same major version in `compose.test.yml` and in CI. There is no SQLite or in-memory substitute and no skip when the database is absent, because the guarantees under test (composite foreign keys, triggers that keep history immutable, grants of the non-owner runtime role, transaction races) only exist in the real engine.

Test doubles are reserved for systems this project does not own:

- **OpenAI.** The adapters in `src/aulalista_api/openai_*.py` take a transport as a parameter. Tests inject one that returns success, rejection, timeout or an uncertain outcome on demand, which makes the budget and "never send twice" rules exactly testable.
- **Outgoing email.** The connected auth suite replaces only the sender and reads the one-time code from it; sessions, cookies and CSRF are real.

None of the three workflows defines a secret, so no test can reach a paid service.

### Left out on purpose

- **Quality of real model output.** The injected transport proves the plumbing around a model call, not that a generated lesson plan is good. That needs human judgement and is not automated here.
- **Row-level security.** Isolation is enforced in the use case and verified at the HTTP boundary. The runtime database role can still read across owners with raw SQL; [docs/development.md](development.md) states this limit.
- **Live third parties.** No test signs in with a real Google account, delivers real email, or calls Stripe.
- **Other browsers, load and performance.** Chromium only; no load tests.
- **Visual snapshots.** Screenshots are kept as CI artifacts for people to look at; no test asserts on pixels.
- **A coverage percentage.** None is measured or reported.

### Known gaps

- The backend workflow names the test files for each step instead of running bare `pytest`. That keeps the database steps separate and mandatory, but a new test file only gates merges once it is added to the list. `tests/test_ci_coverage.py` fails the build when a `tests/test_*.py` file is missing from every workflow; it does not cover the web suites, which Vitest and the Playwright configs select on their own.
- A few tests wait on real time: three `waitForTimeout` calls in `web/tests/auth.integration.ts` sit out the real resend cooldown, and some concurrency tests poll with short `time.sleep` loops.

Size, for scale only, as collected at commit `85a21e1`: 870+ pytest tests, 670+ Vitest cases, 160+ Playwright tests (25+ of them against the real API and database), 120+ offline `unittest` tests.

### Two examples from the history

- [#111](https://github.com/eliancanul/AulaLista-SaaS/pull/111) (for issue [#98](https://github.com/eliancanul/AulaLista-SaaS/issues/98)): the existing isolation tests opened a fresh connection per request, so they could not show what happens when one physical connection serves two teachers. The PR adds that test and a negative control: with the old pooling the new assertion fails.
- [#8](https://github.com/eliancanul/AulaLista-SaaS/pull/8) (for issue [#7](https://github.com/eliancanul/AulaLista-SaaS/issues/7)): the offline scorer gave credit depending on list order when a prediction contained contradictory claims. It was reproduced with a failing test before the fix, so the instrument was corrected before being used to compare anything.

## Continuous integration

Three GitHub Actions workflows run on pull requests and on pushes to `main`. All three pin actions by commit SHA and declare `permissions: contents: read`.

- [`backend`](../.github/workflows/backend.yml): Ruff lint and format, migrations applied twice to a PostgreSQL service, then unit, PostgreSQL integration, chat and isolation tests as separate steps. Afterwards it inspects the PostgreSQL log and fails if private rows or statement parameters were written to it.
- [`web`](../.github/workflows/web.yml): Vitest, typecheck and production build, Playwright journeys, the connected browser suites, and a check that the production wheel contains no test entry points. The workflow starts on every pull request; its first job compares the change with the paths the suite depends on and the suite runs only when one of them changed.
- [`evaluation-offline`](../.github/workflows/evaluation.yml): manifest verification and the offline suites, with and without Python assertions enabled.

Tests import the installed, non-editable package, so a packaging mistake fails in CI.

### Required checks

Branch protection on `main` requires three checks before a pull request can be merged, with no bypass for administrators: `backend-tests`, `web-required` and `synthetic-instrument`. A direct push to `main` is rejected for the same reason.

`web-required` is a small job at the end of the `web` workflow. It passes when the web suite passed, or when the change touched none of the paths the suite depends on; it fails when the suite failed, was cancelled, or was skipped for any other reason. Without it, a pull request that only edits documentation would wait forever for a check that never starts.

Approving reviews are not required by GitHub, because the repository has a single maintainer who cannot approve their own pull requests. The review described in [docs/workflow.md](workflow.md) is recorded as a pull request comment and linked from the pull request description.

## Running the tests

From a fresh clone. Requirements are stated per suite.

**Offline evaluation.** Needs Python 3.12 only.

```sh
python3 -B evaluation/scripts/freeze.py verify --root evaluation --input evaluation/manifests/input.manifest.json
python3 -B -m unittest discover -s evaluation/tests
PYTHONPATH=src:. python3 -B -m unittest discover -s document_checks/tests
```

**Backend tests that need no database.** Needs [uv](https://docs.astral.sh/uv/) 0.12.23; `pyproject.toml` rejects other versions.

```sh
uv sync --locked --no-editable
uv run --locked --no-editable pytest tests/test_config.py tests/test_auth_unit.py tests/test_guided_planning.py tests/test_planning_result.py tests/test_openai_planning.py
```

**Backend tests on PostgreSQL.** Needs Docker. The database in `compose.test.yml` listens on loopback only and keeps its data in memory. The fixtures drop and rebuild the schema, and refuse to unless the target is this database and `AULALISTA_TEST_ALLOW_RESET=1` is set.

```sh
docker compose -f compose.test.yml up -d --wait
export AULALISTA_DATABASE_URL='postgresql+psycopg://aulalista_test@127.0.0.1:55432/aulalista_test'
export AULALISTA_TEST_DATABASE_URL="$AULALISTA_DATABASE_URL"
export AULALISTA_TEST_ALLOW_RESET=1
uv run --locked --no-editable alembic upgrade head
uv run --locked --no-editable pytest tests/test_postgres.py tests/test_materials.py tests/test_planning_edits.py tests/test_auth_integration.py
```

The complete file lists per step are in [`backend.yml`](../.github/workflows/backend.yml).

**Frontend unit tests.** Needs Node.js 24.

```sh
cd web
npm ci --ignore-scripts
npm test
```

**Browser journeys against the fixture server.** Needs the step above and a Chromium download of about 100 MB. Takes around six minutes.

```sh
npx --no-install playwright install chromium
npm run test:browser
```

**Connected end to end.** Needs the PostgreSQL setup, the web dependencies and Chromium from the steps above. Run from the repository root; pytest starts the API, the web server and Playwright, and stops them afterwards.

```sh
uv run --locked --no-editable pytest tests/browser_integration.py
uv run --locked --no-editable pytest tests/auth_browser_integration.py
```

When finished: `docker compose -f compose.test.yml down`. [docs/development.md](development.md) (Spanish) covers the runtime database role and the remaining suites.

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

## How the work is done

AI coding agents write the code in this repository, each change starting from a written spec and a small issue. [docs/workflow.md](workflow.md) sets the gates before a change can be merged: tests that fail if the guarantee breaks, an adversarial review by an agent other than the one that wrote the change, recorded in the pull request, and CI on the exact commit, with any later commit invalidating the earlier evidence. Of these, CI is the one GitHub enforces (see [Required checks](#required-checks)); the reviewers are AI agents commenting from the maintainer's account, not a second person.

Changes arrive through pull requests tied to issues: see the [merged pull requests](https://github.com/eliancanul/AulaLista-SaaS/pulls?q=is%3Apr+is%3Amerged) (60+) and the [issue tracker](https://github.com/eliancanul/AulaLista-SaaS/issues).

Most project documentation is in Spanish. The first README, an internal evidence log for the first delivery cuts, is kept at [docs/registro-evidencia.md](registro-evidencia.md).

<!-- throwaway line for a documentation-only test pull request -->
