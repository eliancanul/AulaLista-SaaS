"""Synthetic software fixtures only; no pedagogical or OCR quality evidence."""

import copy
import unittest

from test_source_integrity import fixture, make

from aulalista_api.source_anchors import AnchorIndex
from aulalista_api.source_evidence import VerificationContext


def index_for(texts):
    snapshot = make(fixture(texts))
    context = VerificationContext.create(
        snapshot,
        owner_id="00000000-0000-0000-0000-000000000004",
        scope_id=snapshot.data["identity"]["scope_id"],
        expected_snapshot_sha256=snapshot.sha256,
        targets=[
            {
                "id": "source",
                "role": None,
                "context_id": None,
                "representation_id": "raw",
            }
        ],
    )
    return AnchorIndex(context, "source")


def proposal(index, mention_number=0, number_index=0):
    data = index.data
    mention = data["mentions"][mention_number]
    activity = next(a for a in data["activities"] if a["id"] == mention["activity_id"])
    span = next(
        s for s in activity["spans"] if s["page"] == mention["evidence"]["page"]
    )
    return {
        "reference_id": mention["number_references"][number_index]["id"],
        "session_id": mention["session_id"],
        "activity_id": mention["activity_id"],
        "evidence": index.ref(span["page"], span["start"], span["end"]),
    }


def resource_fixture(*, suffix="", origin="source", same_key_twice=False):
    key = "resource-1.pdf"
    text = (
        'Sesión 1\n- Usar anexo 1 "' + key + suffix + '".\n'
        'Sesión 2\n- Reusar anexo 1 "' + key + suffix + '".\n'
    )
    resource = 'Recurso "' + key + '": contenido sintético.\n'
    parts = fixture(
        {
            1: {"state": "readable", "text": text},
            2: {"state": "no_text", "text": ""},
            3: {"state": "readable", "text": resource * (2 if same_key_twice else 1)},
        }
    )
    units = []
    for i in range(2 if same_key_twice else 1):
        units.append(
            {
                "id": "unit-" + str(i),
                "start": i * len(resource),
                "end": (i + 1) * len(resource),
                "role": "resource",
                "metadata": {"annex_number": 1, "resource_key": key, "origin": origin},
                "dependencies": [],
            }
        )
    parts[3][0]["pages"][2]["units"] = units
    snapshot = make(parts)
    context = VerificationContext.create(
        snapshot,
        owner_id="00000000-0000-0000-0000-000000000004",
        scope_id=snapshot.data["identity"]["scope_id"],
        expected_snapshot_sha256=snapshot.sha256,
        targets=[
            {
                "id": "source",
                "role": None,
                "context_id": None,
                "representation_id": "raw",
            }
        ],
    )
    index = AnchorIndex(context, "source")
    catalogue = [
        {
            "id": "candidate-" + str(i),
            "number": 1,
            "key": key,
            "location": index.ref(3, u["start"], u["end"]),
        }
        for i, u in enumerate(units)
    ]
    return index, catalogue


class AnchorTests(unittest.TestCase):
    def test_mention_beyond_initial_excerpt_is_retained_and_short_quote_cannot_back_it(
        self,
    ):
        text = "Sesión 1\n- " + "software " * 600 + "anexo 12.\n"
        index = index_for({1: {"state": "readable", "text": text}})
        claim = proposal(index)
        self.assertEqual(index.data["mentions"][0]["numbers"], [12])
        self.assertEqual(index.evaluate([claim])["counts"]["evidenced_relations"], 1)
        claim["evidence"] = index.ref(1, 9, 100)
        self.assertEqual(index.evaluate([claim])["counts"]["evidenced_relations"], 0)

    def test_point_and_page_labels_end_annex_number_without_absorbing_later_number(
        self,
    ):
        for suffix in ("punto 12", "página 12", ", punto 12"):
            index = index_for(
                {
                    1: {
                        "state": "readable",
                        "text": "Sesión 1\n- Usar anexo 1 " + suffix + ".\n",
                    }
                }
            )
            self.assertEqual(index.data["mentions"][0]["numbers"], [1])

    def test_occurrences_keep_repeated_projects_sessions_and_annex_numbers_distinct(
        self,
    ):
        index = index_for(
            {
                1: {
                    "state": "readable",
                    "text": "Proyecto: Igual\nSesión 1\n- Usar anexo 1.\n"
                    "Proyecto: Igual\nSesión 1\n- Usar anexo 1.\n",
                }
            }
        )
        data = index.data
        self.assertEqual(len(data["projects"]), 2)
        self.assertEqual(len(data["sessions"]), 2)
        self.assertEqual(len(data["activities"]), 2)
        self.assertEqual(len(data["mentions"]), 2)
        self.assertNotEqual(data["sessions"][0]["id"], data["sessions"][1]["id"])
        self.assertNotEqual(data["mentions"][0]["id"], data["mentions"][1]["id"])
        self.assertNotEqual(
            data["mentions"][0]["session_id"], data["mentions"][1]["session_id"]
        )
        self.assertEqual([m["numbers"] for m in data["mentions"]], [[1], [1]])

    def test_continuation_and_two_sessions_on_same_page(self):
        index = index_for(
            {
                1: {"state": "readable", "text": "Sesión 1\n- Inicio anexo 1.\n"},
                2: {
                    "state": "readable",
                    "text": "Continuación anexo 2.\nSesión 2\n- Otro anexo 3.\n",
                },
            }
        )
        data = index.data
        first, continuation, other = data["mentions"]
        self.assertEqual(first["session_id"], continuation["session_id"])
        self.assertEqual(first["activity_id"], continuation["activity_id"])
        self.assertNotEqual(continuation["session_id"], other["session_id"])
        self.assertEqual(len(data["sessions"][0]["spans"]), 2)

    def test_every_unreadable_page_breaks_continuity_without_empty_page_assumption(
        self,
    ):
        for state in ("failed", "not_processed", "no_text"):
            with self.subTest(state=state):
                page = {"state": state, "text": ""}
                if state != "no_text":
                    page["reason"] = "synthetic unavailable observation"
                data = index_for(
                    {
                        1: {"state": "readable", "text": "Sesión 1\n- Usar anexo 1.\n"},
                        2: page,
                        3: {"state": "readable", "text": "- Continuar anexo 2.\n"},
                    }
                ).data
                self.assertIsNone(data["mentions"][1]["session_id"])
                self.assertTrue(data["unassigned_spans"])
                self.assertEqual(len(data["pages"]), 3)

    def test_uncertain_heading_project_reset_and_layout_prelude_stay_unassigned(self):
        data = index_for(
            {
                1: {
                    "state": "readable",
                    "text": "Sesión 1\n- Usar anexo 1.\nSesión ?\n- Anexo 2.\n"
                    "Proyecto: Segundo\n- Anexo 3.\n"
                    "Tema siguiente Fecha: martes\nSesión 2 Tema:\n- Anexo 4.\n",
                }
            }
        ).data
        self.assertEqual(
            [m["session_id"] is None for m in data["mentions"]],
            [False, True, True, False],
        )
        self.assertTrue(
            any(
                s["reason"] == "heading_prelude_unassigned"
                for s in data["unassigned_spans"]
            )
        )

    def test_lexical_mentions_lists_and_unsupported_text_keep_distinct_denominators(
        self,
    ):
        data = index_for(
            {
                1: {
                    "state": "readable",
                    "text": "Sesión 1\n- Anexos 1, 12 y 1. Punto 9, página 88.\n"
                    "- Anexo 12. Punto 1.\n- No usar anexo 3.\n- Si procede, anexo 4.\n"
                    "- Anexos 1-3.\n- Ver anexo sin número.\n- Anexo 01.\n",
                }
            }
        ).data
        mentions = data["mentions"]
        self.assertEqual(len(mentions), 7)
        self.assertEqual(mentions[0]["numbers"], [1, 12, 1])
        self.assertEqual(mentions[1]["numbers"], [12])
        self.assertEqual([m["numbers"] for m in mentions[2:]], [[], [], [], [], []])
        refs = mentions[0]["number_references"]
        self.assertEqual(len(refs), 3)
        self.assertNotEqual(refs[0]["id"], refs[2]["id"])
        self.assertFalse(any(m["obligation"] != "not_inferred" for m in mentions))

    def test_relation_requires_the_actual_mention_inside_its_activity_and_session(self):
        index = index_for(
            {
                1: {
                    "state": "readable",
                    "text": "Sesión 1\n- Preparar al inicio y después usar anexo 1.\n"
                    "Sesión 2\n- Otra actividad anexo 1.\n",
                }
            }
        )
        good = proposal(index)
        result = index.evaluate([good])
        self.assertEqual(result["counts"]["evidenced_relations"], 1)
        self.assertEqual(result["counts"]["numbered_references"], 2)
        self.assertEqual(result["counts"]["missing_relations"], 1)
        self.assertEqual(result["relations"][0]["resource_state"], "missing")
        for key in ("session_id", "activity_id", "evidence"):
            bad = copy.deepcopy(good)
            bad[key] = proposal(index, 1)[key]
            with self.subTest(key=key):
                self.assertEqual(
                    index.evaluate([bad])["counts"]["evidenced_relations"], 0
                )
        bad = copy.deepcopy(good)
        mention = index.data["mentions"][0]
        bad["evidence"] = index.ref(
            1, good["evidence"]["start"], mention["evidence"]["end"] - 1
        )
        self.assertEqual(index.evaluate([bad])["counts"]["evidenced_relations"], 0)
        bad = copy.deepcopy(good)
        bad["evidence"]["source_id"] = "foreign"
        self.assertEqual(index.evaluate([bad])["counts"]["evidenced_relations"], 0)

    def test_duplicate_predictions_never_add_credit_or_hide_conflicting_context(self):
        index = index_for({1: {"state": "readable", "text": "Sesión 1\n- Anexo 1.\n"}})
        good = proposal(index)
        result = index.evaluate([good, good])
        self.assertEqual(result["counts"]["evidenced_relations"], 1)
        self.assertEqual(result["counts"]["duplicate_predictions"], 1)
        bad = dict(good, session_id="declared-but-wrong", checked=True)
        self.assertEqual(index.evaluate([good, bad]), index.evaluate([bad, good]))
        self.assertEqual(
            index.evaluate([good, bad])["counts"]["evidenced_relations"], 0
        )
        self.assertEqual(index.evaluate([])["counts"]["numbered_references"], 1)

    def test_wrapped_qualifiers_and_ranges_remain_unresolved(self):
        for text in (
            "- No utilizar\nel anexo 1.",
            "- Si hay tiempo,\ntrabajar el anexo 1.",
            "- Actividad opcional,\nver anexo 1.",
            "- Anexos 1..2.",
            "- Anexos 1٫2.",
            "- Anexos 1. .2.",
            "- Anexos 1 o 2.",
            "- Anexos 1 y II.",
            "- Anexo 1%.",
            "- Anexos 1±2.",
            "- Anexos 1 + 2.",
            "- Anexos 1 ≠ 2.",
        ):
            with self.subTest(text=text):
                index = index_for(
                    {1: {"state": "readable", "text": "Sesión 1\n" + text}}
                )
                mention = index.data["mentions"][0]
                self.assertEqual(mention["numbers"], [])
                self.assertNotEqual(mention["parse_state"], "numbered")
                if mention["number_references"]:
                    self.assertEqual(
                        index.evaluate([proposal(index)])["counts"][
                            "evidenced_relations"
                        ],
                        0,
                    )

    def test_explicit_reuse_requires_own_resource_evidence_and_complete_key(self):
        index, catalogue = resource_fixture()
        props = [proposal(index, i) for i in range(2)]
        result = index.evaluate(props, catalogue)
        self.assertEqual(result["counts"]["located_relations"], 2)
        self.assertEqual(result["counts"]["ambiguous_relations"], 0)
        self.assertFalse(result["repeated_numbers"][0]["identity_unresolved"])
        self.assertEqual(
            {r["resource_id"] for r in result["relations"]}, {"candidate-0"}
        )
        self.assertTrue(all(r["resource_evidence"] for r in result["relations"]))
        unavailable = copy.deepcopy(catalogue)
        unavailable[0]["location"] = None
        self.assertEqual(
            index.evaluate(props, unavailable)["counts"]["located_relations"], 0
        )
        unavailable = copy.deepcopy(catalogue)
        unavailable[0]["location"]["original_sha256"] = "0" * 64
        self.assertEqual(
            index.evaluate(props, unavailable)["counts"]["located_relations"], 0
        )
        index, catalogue = resource_fixture(origin="generated")
        self.assertEqual(
            index.evaluate([proposal(index)], catalogue)["counts"]["located_relations"],
            0,
        )

    def test_two_candidates_are_not_resolved_by_first_or_same_number(self):
        index, catalogue = resource_fixture(same_key_twice=True)
        props = [proposal(index, i) for i in range(2)]
        result = index.evaluate(props, catalogue)
        self.assertEqual(result["counts"]["located_relations"], 0)
        self.assertEqual(result["counts"]["ambiguous_relations"], 2)
        self.assertEqual(
            index.evaluate(props, catalogue),
            index.evaluate(list(reversed(props)), list(reversed(catalogue))),
        )
        # A valid source resource is still not identified by its number alone.
        no_key = copy.deepcopy(props[0])
        m = index.data["mentions"][0]["evidence"]
        no_key["evidence"] = index.ref(m["page"], m["start"], m["end"])
        result = index.evaluate([no_key], catalogue[:1])
        self.assertEqual(result["counts"]["evidenced_relations"], 1)
        self.assertEqual(result["counts"]["located_relations"], 0)

    def test_cropped_key_does_not_select_prefix_resource(self):
        for suffix in ("2", "-extra", "\u200bextra"):
            with self.subTest(suffix=suffix):
                index, catalogue = resource_fixture(suffix=suffix)
                prop = proposal(index)
                text = prop["evidence"]["quote"]
                end = (
                    prop["evidence"]["start"]
                    + text.index("resource-1.pdf")
                    + len("resource-1.pdf")
                )
                prop["evidence"] = index.ref(1, prop["evidence"]["start"], end)
                self.assertEqual(
                    index.evaluate([prop], catalogue)["counts"]["located_relations"], 0
                )

    def test_source_resource_unit_cannot_supply_key_to_preceding_activity(self):
        text = 'Sesión 1\n- Usar anexo 1.\nRecurso "resource-1.pdf": contenido.\n'
        start = text.index("Recurso")
        parts = fixture({1: {"state": "readable", "text": text}})
        parts[3][0]["pages"][0]["units"] = [
            {
                "id": "r",
                "start": start,
                "end": len(text),
                "role": "resource",
                "metadata": {
                    "annex_number": 1,
                    "resource_key": "resource-1.pdf",
                    "origin": "source",
                },
                "dependencies": [],
            }
        ]
        snapshot = make(parts)
        ctx = VerificationContext.create(
            snapshot,
            owner_id="00000000-0000-0000-0000-000000000004",
            scope_id=snapshot.data["identity"]["scope_id"],
            expected_snapshot_sha256=snapshot.sha256,
            targets=[
                {
                    "id": "source",
                    "role": None,
                    "context_id": None,
                    "representation_id": "raw",
                }
            ],
        )
        index = AnchorIndex(ctx, "source")
        catalogue = [
            {
                "id": "candidate",
                "number": 1,
                "key": "resource-1.pdf",
                "location": index.ref(1, start, len(text)),
            }
        ]
        broad = proposal(index)
        broad["evidence"] = index.ref(1, broad["evidence"]["start"], len(text))
        self.assertEqual(
            index.evaluate([broad], catalogue)["counts"]["located_relations"], 0
        )
        self.assertEqual(index.data["activities"][0]["spans"][0]["end"], start)


if __name__ == "__main__":
    unittest.main()
