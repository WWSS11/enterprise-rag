"""separate retrieval and citation ground truth

Revision ID: 20260712_0005
Revises: 20260711_0004
Create Date: 2026-07-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260712_0005"
down_revision: str | None = "20260711_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "evaluation_cases",
        sa.Column("acceptable_citation_document_ids", sa.JSON()),
    )
    op.execute(
        "UPDATE evaluation_cases "
        "SET acceptable_citation_document_ids = expected_document_ids"
    )
    op.alter_column(
        "evaluation_cases", "acceptable_citation_document_ids", nullable=False
    )


def downgrade() -> None:
    op.drop_column("evaluation_cases", "acceptable_citation_document_ids")
