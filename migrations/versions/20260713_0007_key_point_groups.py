"""add key point synonym groups

Revision ID: 20260713_0007
Revises: 20260712_0006
Create Date: 2026-07-13
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260713_0007"
down_revision: str | None = "20260712_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "evaluation_cases",
        sa.Column("required_key_point_groups", sa.JSON()),
    )
    op.execute(
        """
        UPDATE evaluation_cases
        SET required_key_point_groups = COALESCE(
            (
                SELECT json_agg(json_build_array(point))
                FROM json_array_elements_text(required_key_points) AS points(point)
            ),
            '[]'::json
        )
        """
    )
    op.alter_column(
        "evaluation_cases", "required_key_point_groups", nullable=False
    )


def downgrade() -> None:
    op.drop_column("evaluation_cases", "required_key_point_groups")
