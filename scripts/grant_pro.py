"""CLI helper to grant or list complimentary Pro Docente / Escuela accounts (e.g. family/beta accounts).

Usage examples:
    uv run --locked python scripts/grant_pro.py --email papa@gmail.com --plan docente
    uv run --locked python scripts/grant_pro.py --email mama@gmail.com --plan docente
    uv run --locked python scripts/grant_pro.py --all-scopes --plan docente
    uv run --locked python scripts/grant_pro.py --list
"""

from __future__ import annotations

import argparse
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from aulalista_api.auth_models import Identity
from aulalista_api.billing import (
    PlanId,
    ScopeSubscription,
    grant_courtesy_plan,
)
from aulalista_api.config import load_settings
from aulalista_api.database import PersonalScope, make_engine


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Otorga o consulta cuentas Pro de cortesía en AulaLista / Acenta."
    )
    parser.add_argument(
        "--email",
        action="append",
        default=[],
        help="Correo verificado del usuario a activar en Pro de cortesía (puede repetirse).",
    )
    parser.add_argument(
        "--scope-id",
        action="append",
        default=[],
        help="UUID de personal_scope a activar en Pro de cortesía (puede repetirse).",
    )
    parser.add_argument(
        "--all-scopes",
        action="store_true",
        help="Otorga el plan de cortesía a todos los scopes existentes en la base local.",
    )
    parser.add_argument(
        "--plan",
        choices=("docente", "escuela"),
        default="docente",
        help="Plan a otorgar (default: docente = Pro Docente).",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="Muestra las suscripciones registradas.",
    )
    args = parser.parse_args()

    engine = make_engine(load_settings())
    plan_id: PlanId = args.plan

    with Session(engine) as session:
        if args.list:
            rows = session.execute(
                select(
                    PersonalScope.id,
                    Identity.email,
                    ScopeSubscription.plan_id,
                    ScopeSubscription.billing_provider,
                    ScopeSubscription.status,
                )
                .outerjoin(
                    Identity, Identity.principal_id == PersonalScope.owner_principal_id
                )
                .outerjoin(
                    ScopeSubscription, ScopeSubscription.scope_id == PersonalScope.id
                )
            ).all()
            if not rows:
                print("No hay cuentas registradas todavía.")
            for scope_id, email, cur_plan, provider, status in rows:
                print(
                    f"scope={scope_id}  email={email or '(sin correo)'}  "
                    f"plan={cur_plan or 'free'}  provider={provider or 'beta_preview'}  "
                    f"status={status or 'active'}"
                )
            return 0

        granted = 0
        for raw_email in args.email:
            norm = raw_email.strip().lower()
            ident = session.scalar(
                select(Identity).where(Identity.email == norm)
            )
            if ident is None:
                print(
                    f"[AVISO] No se encontró cuenta con correo '{norm}'. "
                    f"También puedes agregarlo a AULALISTA_PRO_GRANT_EMAILS para que se active automáticamente al iniciar sesión."
                )
                continue
            scope = session.scalar(
                select(PersonalScope).where(
                    PersonalScope.owner_principal_id == ident.principal_id
                )
            )
            if scope is None:
                print(f"[AVISO] Usuario '{norm}' aún no tiene personal_scope.")
                continue
            grant_courtesy_plan(
                session, scope.id, plan_id=plan_id, reason=f"cli_email:{norm}"
            )
            print(f"[OK] {norm} (scope={scope.id}) -> {plan_id} (courtesy_pro)")
            granted += 1

        for raw_scope in args.scope_id:
            scope_id = UUID(raw_scope.strip())
            if session.get(PersonalScope, scope_id) is None:
                print(f"[AVISO] scope_id '{scope_id}' no existe.")
                continue
            grant_courtesy_plan(
                session, scope_id, plan_id=plan_id, reason="cli_scope"
            )
            print(f"[OK] scope={scope_id} -> {plan_id} (courtesy_pro)")
            granted += 1

        if args.all_scopes:
            scopes = session.scalars(select(PersonalScope)).all()
            for scope in scopes:
                grant_courtesy_plan(
                    session, scope.id, plan_id=plan_id, reason="cli_all_scopes"
                )
                print(f"[OK] scope={scope.id} -> {plan_id} (courtesy_pro)")
                granted += 1

        session.commit()
        if granted == 0 and not args.list:
            parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
