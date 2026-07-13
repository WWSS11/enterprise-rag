"""add evaluation citation evidence snapshots

Revision ID: 20260713_0008
Revises: 20260713_0007
Create Date: 2026-07-13
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260713_0008"
down_revision: str | None = "20260713_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "evaluation_results",
        sa.Column(
            "citation_evidence",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'::json"),
        ),
    )
    op.alter_column("evaluation_results", "citation_evidence", server_default=None)


def downgrade() -> None:
    op.drop_column("evaluation_results", "citation_evidence")
