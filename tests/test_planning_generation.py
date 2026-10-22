"""Public generation seam, disposable PostgreSQL and fake external transport only."""

import hashlib
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event, select, text, update
from sqlalchemy.orm import Session
from test_guided_planning import guided_body

from aulalista_api.auth import AuthenticatedActor, AuthError
from aulalista_api.auth_models import AuthSession
from aulalista_api.guided_planning import GeneratedPlanningRequest
from aulalista_api.materials import MaterialError, Materials
from aulalista_api.openai_planning import MODEL, ProviderError, ProviderResult
from aulalista_api.planning_generation import (
    GeneratedPlannings,
    GenerationAttempt,
    GenerationProfile,
)
from aulalista_api.plannings import Plannings


def request(**changes):
    body = guided_body(**changes)
    body.pop("fixture_context")
    body["contract_version"] = 3
    return GeneratedPlanningRequest.model_validate(body)


def output():
    return {
        "title": "Explorar materiales",
        "purpose": "Comparar propiedades observables.",
        "duration_minutes": 50,
        "activities": [
            {
                "key": "introduction",
                "title": "Observar",
                "statement": "Observar objetos.",
                "minutes": 10,
            },
            {
                "key": "exploration",
                "title": "Comparar",
                "statement": "Comparar propiedades.",
                "minutes": 30,
            },
            {
                "key": "closure",
                "title": "Explicar",
                "statement": "Explicar diferencias.",
                "minutes": 10,
            },
        ],
        "materials": ["Objetos de ejemplo"],
        "formative_assessment": "Escuchar explicaciones y dar retroalimentación.",
    }


class FakeProvider:
    def __init__(self):
        self.calls = []

    def count(self, payload):
        self.calls.append(("count", payload))
        return 500

    def generate(self, payload):
        self.calls.append(("generate", payload))
        return ProviderResult(
            output(), MODEL, "synthetic-request", 500, 100, None, None
        )


def profile(*requests, actor, scope, budget="0.1", input_policy="exact-input-v1"):
    return GenerationProfile(
        name="synthetic-test-only",
        actor_id=actor.principal_id if isinstance(actor, AuthenticatedActor) else actor,
        scope_id=scope,
        budget_usd=Decimal(budget),
        count_request_reserve_usd=Decimal("0.0001"),
        allowed_request_sha256=(
            frozenset(hashlib.sha256(r.canonical()).hexdigest() for r in requests)
            if input_policy == "exact-input-v1"
            else None
        ),
        input_policy=input_policy,
    )


def test_generation_is_disabled_and_scope_authorized(runtime_database, actors):
    actor, scope = actors[0]
    other, _ = actors[1]
    service = GeneratedPlannings(runtime_database)
    assert service.capability(actor, scope) == {"available": False}
    with pytest.raises(MaterialError) as denied:
        service.capability(other, scope)
    assert denied.value.status == 404


def test_generated_result_survives_restart_and_lost_response_without_resend(
    runtime_database, actors
):
    actor, scope = actors[0]
    key, body, provider = uuid4(), request(), FakeProvider()
    service = GeneratedPlannings(
        runtime_database, provider, profile(body, actor=actor, scope=scope)
    )
    saved = service.write(actor, scope, key, body)
    assert saved["request"] == body.model_dump(mode="json")
    assert saved["result"]["provenance"] == "openai-guided-v1"
    assert saved["receipt"]["source_id"] is None
    assert saved["receipt"]["revision"] == 1
    assert [kind for kind, _ in provider.calls] == ["count", "generate"]
    assert Plannings(runtime_database).read(actor, scope, operation_id=key) == saved
    restarted = GeneratedPlannings(runtime_database)
    assert restarted.operation(actor, scope, key) == saved
    assert restarted.write(actor, scope, key, body) == saved
    with pytest.raises(MaterialError) as changed:
        restarted.write(actor, scope, key, request(topic="Otra solicitud"))
    assert changed.value.detail == "conflict"
    assert len(provider.calls) == 2


def test_unknown_consumption_blocks_every_new_operation_without_retry(
    runtime_database, actors
):
    actor, scope = actors[0]
    body, key = request(), uuid4()

    class Timeout(FakeProvider):
        def count(self, payload):
            super().count(payload)
            raise ProviderError("provider_timeout")

    provider = Timeout()
    service = GeneratedPlannings(
        runtime_database, provider, profile(body, actor=actor, scope=scope)
    )
    for _ in range(2):
        with pytest.raises(MaterialError) as failed:
            service.write(actor, scope, key, body)
        assert failed.value.detail == "generation_uncertain"
    with pytest.raises(MaterialError) as busy:
        service.write(actor, scope, uuid4(), body)
    assert busy.value.detail == "generation_busy"
    assert len(provider.calls) == 1


@pytest.mark.parametrize(
    "invalid_field", ["duration", "purpose", "formative_assessment", "statement"]
)
def test_invalid_output_retains_observed_usage_and_never_retries(
    runtime_database, actors, invalid_field
):
    actor, scope = actors[0]
    body, key = request(), uuid4()

    class Invalid(FakeProvider):
        def generate(self, payload):
            self.calls.append(("generate", payload))
            invalid = output()
            if invalid_field == "duration":
                invalid["activities"][0]["minutes"] = 7
            elif invalid_field == "statement":
                invalid["activities"][0]["statement"] = "A" * 1001
            else:
                invalid[invalid_field] = "A" * 1001
            return ProviderResult(
                invalid, MODEL, "synthetic-invalid", 500, 100, None, None
            )

    provider = Invalid()
    service = GeneratedPlannings(
        runtime_database, provider, profile(body, actor=actor, scope=scope)
    )
    for _ in range(2):
        with pytest.raises(MaterialError) as invalid:
            service.write(actor, scope, key, body)
        assert invalid.value.detail == "generation_failed"
    with Session(runtime_database) as session:
        ledger = session.scalar(
            select(GenerationAttempt).where(GenerationAttempt.operation_id == key)
        )
        assert ledger.state == "failed"
        assert ledger.error_code == "provider_invalid_output"
        assert ledger.reserved_usd == Decimal("0.0008168")
        assert (ledger.count_requests, ledger.generation_requests) == (1, 1)
        assert ledger.counted_input_tokens == 500
        assert (ledger.input_tokens, ledger.output_tokens) == (500, 100)
        assert ledger.cached_tokens is None
        assert ledger.reasoning_tokens is None
        assert ledger.provider_request_id == "synthetic-invalid"
        assert ledger.planning_revision_id is None
    assert len(provider.calls) == 2


def test_count_limit_and_failures_consume_global_reservation_without_refund(
    runtime_database, actors
):
    actor, scope = actors[0]
    other, other_scope = actors[1]
    body = request()

    class TooLarge(FakeProvider):
        def count(self, payload):
            super().count(payload)
            return 2049

    provider = TooLarge()
    # Exactly two whole reservations: count 0.0001 + generation 0.0007168 each.
    service = GeneratedPlannings(
        runtime_database,
        provider,
        profile(body, actor=actor, scope=scope, budget="0.0016336"),
    )
    keys = [uuid4(), uuid4()]
    for (owner, target), key in zip(((actor, scope), (other, other_scope)), keys):
        service = GeneratedPlannings(
            runtime_database,
            provider,
            profile(body, actor=owner, scope=target, budget="0.0016336"),
        )
        with pytest.raises(MaterialError) as failed:
            service.write(owner, target, key, body)
        assert failed.value.detail == "generation_failed"
        with pytest.raises(MaterialError) as replay:
            service.write(owner, target, key, body)
        assert replay.value.detail == "generation_failed"
    with pytest.raises(MaterialError) as exhausted:
        service.write(other, other_scope, uuid4(), body)
    assert (exhausted.value.status, exhausted.value.detail) == (
        429,
        "generation_budget_exhausted",
    )
    assert [kind for kind, _ in provider.calls] == ["count", "count"]
    with Session(runtime_database) as session:
        records = session.scalars(select(GenerationAttempt)).all()
        assert len(records) == 2
        assert all(
            item.counted_input_tokens == 2049
            and item.input_tokens is None
            and item.generation_requests == 0
            for item in records
        )
        assert sum(item.reserved_usd for item in records) == Decimal("0.0016336")


@pytest.mark.parametrize("input_policy", ["exact-input-v1", "manual-variable-v1"])
def test_overlapping_admissions_share_one_global_budget_reservation(
    runtime_database, migrated_database, actors, input_policy
):
    body, provider = request(), FakeProvider()
    budget = Decimal("0.0008168")  # One count reserve plus maximum generation cost.
    release = threading.Event()
    first_insert, second_started, second_insert = (threading.Event() for _ in range(3))
    worker = threading.local()
    pids = {}

    def pause_admission(connection, cursor, statement, parameters, context, many):
        number = getattr(worker, "number", None)
        if number is None:
            return
        if number not in pids:
            pids[number] = connection.connection.driver_connection.info.backend_pid
            if number == 1:
                second_started.set()
        if statement.startswith("INSERT INTO planning_generation_attempt "):
            # Pause after the budget read and before the reservation can commit.
            (first_insert if number == 0 else second_insert).set()
            assert release.wait(5), "admission test did not release its transactions"

    def write(number):
        worker.number = number
        actor, scope = actors[number]
        service = GeneratedPlannings(
            runtime_database,
            provider,
            profile(
                body,
                actor=actor,
                scope=scope,
                budget=str(budget),
                input_policy=input_policy,
            ),
        )
        try:
            return service.write(actor, scope, uuid4(), body)
        except MaterialError as error:
            return error

    event.listen(runtime_database, "before_cursor_execute", pause_admission)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(write, 0)
            try:
                assert first_insert.wait(5)
                second = pool.submit(write, 1)
                assert second_started.wait(5)
                assert pids[0] != pids[1]
                # Observe actual overlap: the second connection is blocked by the
                # first, or (without serialization) has also passed admission.
                deadline = time.monotonic() + 1.5
                with migrated_database.connect() as observer:
                    while not second_insert.is_set():
                        if observer.scalar(
                            text("SELECT :first = ANY(pg_blocking_pids(:second))"),
                            {"first": pids[0], "second": pids[1]},
                        ):
                            break
                        assert time.monotonic() < deadline, "admissions did not overlap"
                        time.sleep(0.005)
                assert not first.done()
            finally:
                release.set()
            outcomes = [first.result(timeout=5), second.result(timeout=5)]
    finally:
        release.set()
        event.remove(runtime_database, "before_cursor_execute", pause_admission)

    saved = [item for item in outcomes if isinstance(item, dict)]
    denied = [item for item in outcomes if isinstance(item, MaterialError)]
    assert len(saved) == 1
    assert len(denied) == 1
    assert denied[0].detail in {"generation_busy", "generation_budget_exhausted"}
    assert [kind for kind, _ in provider.calls] == ["count", "generate"]
    with Session(runtime_database) as session:
        attempts = session.scalars(select(GenerationAttempt)).all()
        assert len(attempts) == 1
        assert attempts[0].state == "succeeded"
        assert sum(item.reserved_usd for item in attempts) == budget
        assert sum(item.reserved_usd for item in attempts) <= budget
    for actor, scope in actors:
        with pytest.raises(MaterialError) as exhausted:
            GeneratedPlannings(
                runtime_database,
                provider,
                profile(
                    body,
                    actor=actor,
                    scope=scope,
                    budget=str(budget),
                    input_policy=input_policy,
                ),
            ).write(actor, scope, uuid4(), body)
        assert exhausted.value.detail == "generation_budget_exhausted"
    assert [kind for kind, _ in provider.calls] == ["count", "generate"]


def test_input_permission_and_exact_reference_are_checked_without_transmission(
    runtime_database, actors
):
    actor, scope = actors[0]
    other, other_scope = actors[1]
    source = Materials(runtime_database).write(
        actor, scope, uuid4(), b"private synthetic bytes never sent"
    )
    source_id = UUID(source["source_id"])
    Materials(runtime_database).write(
        actor, scope, uuid4(), b"new version", source_id=source_id, expected_version=1
    )
    exact = request(reference={"source_id": str(source_id), "source_version": 1})
    unknown = request(reference={"source_id": str(uuid4()), "source_version": 1})
    provider = FakeProvider()
    service = GeneratedPlannings(
        runtime_database, provider, profile(exact, unknown, actor=actor, scope=scope)
    )
    for owner, target, body, expected in (
        (actor, scope, request(), 422),
        (actor, scope, unknown, 404),
        (other, other_scope, exact, 503),
        (other, scope, exact, 404),
    ):
        key = uuid4()
        with pytest.raises(MaterialError) as denied:
            service.write(owner, target, key, body)
        assert denied.value.status == expected
        assert provider.calls == []
    saved = service.write(actor, scope, uuid4(), exact)
    assert saved["receipt"]["source_version"] == 1
    assert saved["receipt"]["source_version_id"] == source["version_id"]
    for _, payload in provider.calls:
        manual = json.loads(payload["input"])
        assert "reference" not in manual and "contract_version" not in manual
        assert str(source_id) not in payload["input"]
        assert "private synthetic" not in payload["input"]
    assert saved["request"]["reference"] == exact.model_dump(mode="json")["reference"]


def test_active_attempt_is_durable_and_global_concurrency_has_no_database_lock_during_network(
    runtime_database, actors
):
    actor, scope = actors[0]
    other, other_scope = actors[1]
    body, key = request(), uuid4()
    entered, release = threading.Event(), threading.Event()

    class Paused(FakeProvider):
        def count(self, payload):
            counted = super().count(payload)
            entered.set()
            assert release.wait(5)
            return counted

    provider = Paused()
    service = GeneratedPlannings(
        runtime_database, provider, profile(body, actor=actor, scope=scope)
    )
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(service.write, actor, scope, key, body)
        try:
            assert entered.wait(5)
            with pytest.raises(MaterialError) as pending:
                GeneratedPlannings(runtime_database).operation(actor, scope, key)
            assert pending.value.detail == "generation_pending"
            with pytest.raises(MaterialError) as replay:
                service.write(actor, scope, key, body)
            assert replay.value.detail == "generation_pending"
            with pytest.raises(MaterialError) as changed:
                service.write(actor, scope, key, request(topic="Different"))
            assert changed.value.detail == "conflict"
            with pytest.raises(MaterialError) as busy:
                GeneratedPlannings(
                    runtime_database,
                    provider,
                    profile(body, actor=other, scope=other_scope),
                ).write(other, other_scope, uuid4(), body)
            assert busy.value.detail == "generation_busy"
        finally:
            release.set()
        saved = future.result(timeout=5)
    assert service.operation(actor, scope, key) == saved
    assert [kind for kind, _ in provider.calls] == ["count", "generate"]


@pytest.mark.parametrize("stage", ["count", "generate"])
@pytest.mark.parametrize("input_policy", ["exact-input-v1", "manual-variable-v1"])
def test_original_authenticated_session_is_revalidated_before_send_and_commit(
    runtime_database, actors, stage, input_policy
):
    principal, scope = actors[0]
    instant = datetime.now(UTC)
    digest = "a" * 64
    with Session(runtime_database) as session, session.begin():
        session.add(
            AuthSession(
                token_hash=digest,
                principal_id=principal,
                expires_at=instant + timedelta(hours=1),
                idle_expires_at=instant + timedelta(hours=1),
                revoked=False,
            )
        )
    actor = AuthenticatedActor(principal, digest)
    body, key = request(), uuid4()

    def revoke():
        with Session(runtime_database) as session, session.begin():
            session.execute(
                update(AuthSession)
                .where(AuthSession.token_hash == digest)
                .values(revoked=True)
            )

    class Revoking(FakeProvider):
        def count(self, payload):
            count = super().count(payload)
            if stage == "count":
                revoke()
            return count

        def generate(self, payload):
            result = super().generate(payload)
            if stage == "generate":
                revoke()
            return result

    provider = Revoking()
    service = GeneratedPlannings(
        runtime_database,
        provider,
        profile(body, actor=actor, scope=scope, input_policy=input_policy),
    )
    with pytest.raises(AuthError) as revoked:
        service.write(actor, scope, key, body)
    assert revoked.value.status == 401
    assert [kind for kind, _ in provider.calls] == (
        ["count"] if stage == "count" else ["count", "generate"]
    )
    with pytest.raises(AuthError):
        service.operation(actor, scope, key)
    with pytest.raises(MaterialError) as absent:
        Plannings(runtime_database).read(principal, scope, operation_id=key)
    assert absent.value.status == 404
    with pytest.raises(MaterialError) as uncertain:
        service.operation(principal, scope, key)
    assert uncertain.value.detail == "generation_uncertain"


@pytest.mark.parametrize("input_policy", ["exact-input-v1", "manual-variable-v1"])
def test_process_crash_expires_to_uncertain_and_cannot_resend(
    runtime_database, actors, monkeypatch, input_policy
):
    import aulalista_api.planning_generation as module

    class ProcessCrash(BaseException):
        pass

    class Crashing(FakeProvider):
        def count(self, payload):
            super().count(payload)
            raise ProcessCrash()

    actor, scope = actors[0]
    body, key, provider = request(), uuid4(), Crashing()
    service = GeneratedPlannings(
        runtime_database,
        provider,
        profile(body, actor=actor, scope=scope, input_policy=input_policy),
    )
    with pytest.raises(ProcessCrash):
        service.write(actor, scope, key, body)
    with pytest.raises(MaterialError) as pending:
        service.operation(actor, scope, key)
    assert pending.value.detail == "generation_pending"
    future = datetime.now(UTC) + timedelta(seconds=76)
    monkeypatch.setattr(module, "now", lambda: future)
    with pytest.raises(MaterialError) as expired:
        GeneratedPlannings(runtime_database).operation(actor, scope, key)
    assert expired.value.detail == "generation_uncertain"
    with pytest.raises(MaterialError) as replay:
        service.write(actor, scope, key, body)
    assert replay.value.detail == "generation_uncertain"
    with pytest.raises(MaterialError) as busy:
        service.write(actor, scope, uuid4(), body)
    assert busy.value.detail == "generation_busy"
    assert len(provider.calls) == 1


@pytest.mark.parametrize("stage", ["count", "generate"])
@pytest.mark.parametrize("input_policy", ["exact-input-v1", "manual-variable-v1"])
def test_late_external_completion_does_not_create_a_planning(
    runtime_database, actors, monkeypatch, stage, input_policy
):
    import aulalista_api.planning_generation as module

    actor, scope = actors[0]
    body, key = request(), uuid4()
    future = datetime.now(UTC) + timedelta(seconds=76)

    class Late(FakeProvider):
        def count(self, payload):
            result = super().count(payload)
            if stage == "count":
                monkeypatch.setattr(module, "now", lambda: future)
            return result

        def generate(self, payload):
            result = super().generate(payload)
            if stage == "generate":
                monkeypatch.setattr(module, "now", lambda: future)
            return result

    provider = Late()
    service = GeneratedPlannings(
        runtime_database,
        provider,
        profile(body, actor=actor, scope=scope, input_policy=input_policy),
    )
    with pytest.raises(MaterialError) as late:
        service.write(actor, scope, key, body)
    assert late.value.detail == "generation_uncertain"
    with pytest.raises(MaterialError) as absent:
        Plannings(runtime_database).read(actor, scope, operation_id=key)
    assert absent.value.status == 404
    assert len(provider.calls) == (1 if stage == "count" else 2)


@pytest.mark.parametrize("input_policy", ["exact-input-v1", "manual-variable-v1"])
def test_get_expiry_retains_late_usage_without_resurrecting_result(
    runtime_database, actors, monkeypatch, input_policy
):
    import aulalista_api.planning_generation as module

    actor, scope = actors[0]
    body, key = request(), uuid4()
    future = datetime.now(UTC) + timedelta(seconds=76)

    class ReturningAfterExpiry(FakeProvider):
        def generate(self, payload):
            result = super().generate(payload)
            monkeypatch.setattr(module, "now", lambda: future)
            with pytest.raises(MaterialError) as expired:
                GeneratedPlannings(runtime_database).operation(actor, scope, key)
            assert expired.value.detail == "generation_uncertain"
            return result

    provider = ReturningAfterExpiry()
    service = GeneratedPlannings(
        runtime_database,
        provider,
        profile(body, actor=actor, scope=scope, input_policy=input_policy),
    )
    with pytest.raises(MaterialError) as expired:
        service.write(actor, scope, key, body)
    assert expired.value.detail == "generation_uncertain"
    with Session(runtime_database) as session:
        attempt = session.scalar(
            select(GenerationAttempt).where(GenerationAttempt.operation_id == key)
        )
        assert attempt.state == "uncertain"
        assert attempt.planning_revision_id is None
        assert attempt.error_code == "operation_expired"
        assert (attempt.input_tokens, attempt.output_tokens) == (500, 100)
        assert attempt.provider_request_id == "synthetic-request"
    assert len(provider.calls) == 2


def test_profile_is_bound_to_owner_and_scope_before_admission(runtime_database, actors):
    actor, scope = actors[0]
    other, other_scope = actors[1]
    body, provider = request(), FakeProvider()
    service = GeneratedPlannings(
        runtime_database, provider, profile(body, actor=actor, scope=scope)
    )
    assert service.capability(actor, scope) == {"available": True}
    assert service.capability(other, other_scope) == {"available": False}
    key = uuid4()
    with pytest.raises(MaterialError) as unavailable:
        service.write(other, other_scope, key, body)
    assert (unavailable.value.status, unavailable.value.detail) == (
        503,
        "generation_unavailable",
    )
    with pytest.raises(MaterialError) as absent:
        service.operation(other, other_scope, key)
    assert absent.value.status == 404
    assert provider.calls == []


@pytest.mark.parametrize("stage", ["count", "generate"])
def test_expired_attempt_reports_durable_uncertainty_even_if_response_is_definite_failure(
    runtime_database, actors, monkeypatch, stage
):
    import aulalista_api.planning_generation as module

    actor, scope = actors[0]
    body, key = request(), uuid4()
    future = datetime.now(UTC) + timedelta(seconds=76)

    def expire():
        monkeypatch.setattr(module, "now", lambda: future)
        with pytest.raises(MaterialError) as pending:
            GeneratedPlannings(runtime_database).operation(actor, scope, key)
        assert pending.value.detail == "generation_uncertain"

    class Expired(FakeProvider):
        def count(self, payload):
            result = super().count(payload)
            if stage == "count":
                expire()
                return 2049
            return result

        def generate(self, payload):
            result = super().generate(payload)
            expire()
            result.output["duration_minutes"] = 99
            return result

    provider = Expired()
    service = GeneratedPlannings(
        runtime_database, provider, profile(body, actor=actor, scope=scope)
    )
    with pytest.raises(MaterialError) as failed:
        service.write(actor, scope, key, body)
    assert failed.value.detail == "generation_uncertain"
    with pytest.raises(MaterialError) as recovered:
        service.operation(actor, scope, key)
    assert recovered.value.detail == failed.value.detail
