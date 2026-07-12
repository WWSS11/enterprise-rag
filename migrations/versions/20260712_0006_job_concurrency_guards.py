"""add ingestion and rebuild concurrency guards

Revision ID: 20260712_0006
Revises: 20260712_0005
Create Date: 2026-07-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260712_0006"
down_revision: str | None = "20260712_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "uq_ingestion_jobs_active_document",
        "ingestion_jobs",
        ["document_id"],
        unique=True,
        postgresql_where=sa.text(
            "document_id IS NOT NULL AND status IN ('queued', 'running')"
        ),
    )
    op.create_index(
        "uq_ingestion_jobs_active_rebuild",
        "ingestion_jobs",
        ["job_type"],
        unique=True,
        postgresql_where=sa.text(
            "job_type = 'vector_index_rebuild' AND status IN ('queued', 'running')"
        ),
    )


def downgrade() -> None:
    op.drop_index("uq_ingestion_jobs_active_rebuild", table_name="ingestion_jobs")
    op.drop_index("uq_ingestion_jobs_active_document", table_name="ingestion_jobs")
