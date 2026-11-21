"""Unit and PostgreSQL integration tests for persisted teacher school spaces."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from aulalista_api.app import create_app
from aulalista_api.material_routes import require_actor
from aulalista_api.school_spaces import (
    SchoolSpacesUpdate,
    default_school_spaces_payload,
)


def test_default_school_spaces_has_two_schools_and_valid_active_ids():
    defaults = default_school_spaces_payload()
    assert len(defaults["schools"]) == 2
    assert defaults["activeSchoolId"] == "benito"
    assert defaults["activeSubjectId"] == "benito-mat"
    school_ids = {s["id"] for s in defaults["schools"]}
    assert school_ids == {"benito", "hidalgo"}
    for school in defaults["schools"]:
        subject_ids = {subj["id"] for subj in school["subjects"]}
        assert school["lastSubjectId"] in subject_ids


def test_school_spaces_update_rejects_duplicate_ids_and_normalizes_active():
    with pytest.raises(ValidationError):
        SchoolSpacesUpdate.model_validate(
            {
                "schools": [
                    {
                        "id": "benito",
                        "shortName": "Benito Juárez",
                        "initials": "BJ",
                        "grade": "4.º A",
                        "gradeLong": "4.º de primaria",
                        "shift": "Matutino",
                        "color": "#a96245",
                        "lastSubjectId": "mat",
                        "subjects": [
                            {"id": "mat", "name": "Matemáticas"},
                            {"id": "mat", "name": "Duplicada"},
                        ],
                    }
                ],
                "activeSchoolId": "benito",
                "activeSubjectId": "mat",
            }
        )

    normalized = SchoolSpacesUpdate.model_validate(
        {
            "schools": [
                {
                    "id": "benito",
                    "shortName": "Benito Juárez",
                    "initials": "BJ",
                    "grade": "4.º A",
                    "gradeLong": "4.º de primaria",
                    "shift": "Matutino",
                    "color": "#a96245",
                    "lastSubjectId": "missing",
                    "subjects": [{"id": "mat", "name": "Matemáticas"}],
                }
            ],
            "activeSchoolId": "nonexistent",
            "activeSubjectId": "nonexistent",
        }
    )
    assert normalized.activeSchoolId == "benito"
    assert normalized.activeSubjectId == "mat"
    assert normalized.schools[0].lastSubjectId == "mat"


def test_school_spaces_get_put_and_scope_isolation(runtime_database, actors):
    (actor_a, scope_a), (actor_b, scope_b) = actors
    app = create_app(print_poller_seconds=0)
    current_actor = {"id": actor_a}
    app.dependency_overrides[require_actor] = lambda: current_actor["id"]

    with TestClient(app) as client:
        # 1. Initial GET returns seeded defaults with no-store
        initial = client.get(f"/scopes/{scope_a}/school-spaces")
        assert initial.status_code == 200
        assert initial.headers.get("cache-control") == "no-store"
        body = initial.json()
        assert body["activeSchoolId"] == "benito"
        assert body["activeSubjectId"] == "benito-mat"
        assert len(body["schools"]) == 2

        # 2. PUT persists custom school and subject
        updated_payload = {
            "schools": [
                {
                    "id": "juarez",
                    "shortName": "Niños Héroes",
                    "initials": "NH",
                    "grade": "5.º B",
                    "gradeLong": "5.º de primaria",
                    "shift": "Vespertino",
                    "color": "#5f7a68",
                    "lastSubjectId": "nh-geo",
                    "subjects": [
                        {"id": "nh-mat", "name": "Matemáticas"},
                        {"id": "nh-geo", "name": "Geografía"},
                    ],
                }
            ],
            "activeSchoolId": "juarez",
            "activeSubjectId": "nh-geo",
        }
        put_res = client.put(
            f"/scopes/{scope_a}/school-spaces",
            json=updated_payload,
        )
        assert put_res.status_code == 200
        assert put_res.headers.get("cache-control") == "no-store"
        assert put_res.json()["activeSchoolId"] == "juarez"
        assert put_res.json()["activeSubjectId"] == "nh-geo"

        # 3. Subsequent GET reads persisted payload
        reloaded = client.get(f"/scopes/{scope_a}/school-spaces")
        assert reloaded.status_code == 200
        assert reloaded.json()["schools"][0]["shortName"] == "Niños Héroes"
        assert reloaded.json()["activeSubjectId"] == "nh-geo"

        # 4. Invalid payload returns 422
        bad = client.put(
            f"/scopes/{scope_a}/school-spaces",
            json={"schools": [], "activeSchoolId": "x", "activeSubjectId": "y"},
        )
        assert bad.status_code == 422

        # 5. Cross-scope access is denied
        current_actor["id"] = actor_b
        denied = client.get(f"/scopes/{scope_a}/school-spaces")
        assert denied.status_code in (403, 404)

        # Actor B still sees its own independent defaults
        own_b = client.get(f"/scopes/{scope_b}/school-spaces")
        assert own_b.status_code == 200
        assert own_b.json()["activeSchoolId"] == "benito"
