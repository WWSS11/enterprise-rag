"""prevent concurrent persisted Feishu sync runs

Revision ID: 20260808_0011
Revises: 20260804_0010
Create Date: 2026-08-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260808_0011"
down_revision: str | None = "20260804_0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "uq_ingestion_jobs_active_feishu_sync",
        "ingestion_jobs",
        ["tenant_id", "job_type"],
        unique=True,
        postgresql_where=sa.text(
            "job_type = 'feishu_sync' AND status IN ('queued', 'running')"
        ),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_ingestion_jobs_active_feishu_sync",
        table_name="ingestion_jobs",
    )
