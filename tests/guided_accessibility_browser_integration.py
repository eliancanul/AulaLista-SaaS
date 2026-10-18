"""Guided keyboard/focus/reflow through the existing real-auth PostgreSQL harness."""

import auth_browser_integration as auth_harness
from browser_integration import run_process_group


def test_guided_accessibility_through_real_auth_api(runtime_database, monkeypatch):
    # Reuse server/session setup unchanged; select only the new browser suite.
    # The existing harness substitutes email delivery, never actor/auth/API data.
    def run_accessibility(_command, **kwargs):
        run_process_group(
            [
                "npx",
                "--no-install",
                "playwright",
                "test",
                "--config",
                "playwright.guided-accessibility.config.ts",
            ],
            **kwargs,
        )

    monkeypatch.setattr(auth_harness, "run_process_group", run_accessibility)
    auth_harness.test_auth_journey_through_real_api(runtime_database, monkeypatch)
