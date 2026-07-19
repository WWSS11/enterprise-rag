"""add knowledge-base scope to ingestion jobs

Revision ID: 20260718_0009
Revises: 20260713_0008
Create Date: 2026-07-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260718_0009"
down_revision: str | None = "20260713_0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "ingestion_jobs",
        sa.Column("knowledge_base_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_ingestion_jobs_knowledge_base_id",
        "ingestion_jobs",
        "knowledge_bases",
        ["knowledge_base_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.execute(
        """
        UPDATE ingestion_jobs AS jobs
        SET knowledge_base_id = documents.knowledge_base_id
        FROM documents
        WHERE jobs.document_id = documents.id
          AND jobs.knowledge_base_id IS NULL
        """
    )
    op.execute(
        """
        UPDATE ingestion_jobs
        SET knowledge_base_id = (result ->> 'knowledge_base_id')::uuid
        WHERE knowledge_base_id IS NULL
          AND (result ->> 'knowledge_base_id') IS NOT NULL
          AND (result ->> 'knowledge_base_id') ~* '^[0-9a-f-]{36}$'
        """
    )
    op.create_index(
        "ix_ingestion_jobs_tenant_kb_created",
        "ingestion_jobs",
        ["tenant_id", "knowledge_base_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_ingestion_jobs_tenant_kb_created", table_name="ingestion_jobs")
    op.drop_constraint(
        "fk_ingestion_jobs_knowledge_base_id", "ingestion_jobs", type_="foreignkey"
    )
    op.drop_column("ingestion_jobs", "knowledge_base_id")
