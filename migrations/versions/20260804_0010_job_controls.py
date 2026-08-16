"""add cancellable and retry-linked async work

Revision ID: 20260804_0010
Revises: 20260718_0009
Create Date: 2026-08-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260804_0010"
down_revision: str | None = "20260718_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "ingestion_jobs",
        sa.Column("retry_of_job_id", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "ingestion_jobs",
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "ingestion_jobs",
        sa.Column("cancelled_by", sa.String(length=128), nullable=True),
    )
    op.create_foreign_key(
        "fk_ingestion_jobs_retry_of_job_id",
        "ingestion_jobs",
        "ingestion_jobs",
        ["retry_of_job_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_ingestion_jobs_retry_of_job_id",
        "ingestion_jobs",
        ["retry_of_job_id"],
    )
    op.create_index(
        "uq_ingestion_jobs_active_retry",
        "ingestion_jobs",
        ["retry_of_job_id"],
        unique=True,
        postgresql_where=sa.text(
            "retry_of_job_id IS NOT NULL AND status IN ('queued', 'running')"
        ),
    )

    op.add_column(
        "evaluation_runs",
        sa.Column("retry_of_run_id", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "evaluation_runs",
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "evaluation_runs",
        sa.Column("cancelled_by", sa.String(length=128), nullable=True),
    )
    op.create_foreign_key(
        "fk_evaluation_runs_retry_of_run_id",
        "evaluation_runs",
        "evaluation_runs",
        ["retry_of_run_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_evaluation_runs_retry_of_run_id",
        "evaluation_runs",
        ["retry_of_run_id"],
    )
    op.create_index(
        "uq_evaluation_runs_active_retry",
        "evaluation_runs",
        ["retry_of_run_id"],
        unique=True,
        postgresql_where=sa.text(
            "retry_of_run_id IS NOT NULL AND status IN ('queued', 'running')"
        ),
    )


def downgrade() -> None:
    op.drop_index("uq_evaluation_runs_active_retry", table_name="evaluation_runs")
    op.drop_index("ix_evaluation_runs_retry_of_run_id", table_name="evaluation_runs")
    op.drop_constraint(
        "fk_evaluation_runs_retry_of_run_id", "evaluation_runs", type_="foreignkey"
    )
    op.drop_column("evaluation_runs", "cancelled_by")
    op.drop_column("evaluation_runs", "cancelled_at")
    op.drop_column("evaluation_runs", "retry_of_run_id")

    op.drop_index("uq_ingestion_jobs_active_retry", table_name="ingestion_jobs")
    op.drop_index("ix_ingestion_jobs_retry_of_job_id", table_name="ingestion_jobs")
    op.drop_constraint(
        "fk_ingestion_jobs_retry_of_job_id", "ingestion_jobs", type_="foreignkey"
    )
    op.drop_column("ingestion_jobs", "cancelled_by")
    op.drop_column("ingestion_jobs", "cancelled_at")
    op.drop_column("ingestion_jobs", "retry_of_job_id")
