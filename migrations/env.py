"""Migraciones explícitas, con la misma configuración del servidor."""

from alembic import context

from aulalista_api import (  # noqa: F401 -- register persisted models
    analytic_sections,
    chat_models,
    materials,
    planning_edits,
    planning_generation,
    plannings,
)
from aulalista_api.config import load_settings
from aulalista_api.database import Base, make_engine

engine = make_engine(load_settings())
try:
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=Base.metadata)
        with context.begin_transaction():
            context.run_migrations()
finally:
    engine.dispose()
