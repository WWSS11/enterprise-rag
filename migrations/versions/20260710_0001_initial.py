"""initial enterprise schema

Revision ID: 20260710_0001
Revises:
Create Date: 2026-07-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260710_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "documents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.String(64), nullable=False),
        sa.Column("name", sa.String(512), nullable=False),
        sa.Column("source_type", sa.String(32), nullable=False),
        sa.Column("source_uri", sa.String(2048)),
        sa.Column("content_type", sa.String(255)),
        sa.Column("checksum", sa.String(64), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("chunk_count", sa.Integer(), nullable=False),
        sa.Column("error_message", sa.Text()),
        sa.Column("extra_metadata", sa.JSON(), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_documents"),
        sa.UniqueConstraint("tenant_id", "checksum", name="uq_documents_tenant_checksum"),
    )
    op.create_index("ix_documents_tenant_status", "documents", ["tenant_id", "status"])

    op.create_table(
        "conversations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.String(64), nullable=False),
        sa.Column("user_id", sa.String(128), nullable=False),
        sa.Column("title", sa.String(255)),
        sa.Column("status", sa.String(32), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_conversations"),
    )
    op.create_index("ix_conversations_tenant_user", "conversations", ["tenant_id", "user_id"])

    op.create_table(
        "document_chunks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.String(64), nullable=False),
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("vector_id", sa.String(64), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("token_count", sa.Integer(), nullable=False),
        sa.Column("source_metadata", sa.JSON(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.id"],
            name="fk_document_chunks_document_id_documents",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_document_chunks"),
        sa.UniqueConstraint("document_id", "chunk_index", name="uq_chunks_document_index"),
        sa.UniqueConstraint("vector_id", name="uq_chunks_vector_id"),
    )
    op.create_index("ix_chunks_tenant_document", "document_chunks", ["tenant_id", "document_id"])

    op.create_table(
        "chat_messages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("citations", sa.JSON(), nullable=False),
        sa.Column("token_usage", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["conversations.id"],
            name="fk_chat_messages_conversation_id_conversations",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_chat_messages"),
    )
    op.create_index(
        "ix_messages_conversation_created", "chat_messages", ["conversation_id", "created_at"]
    )

    op.create_table(
        "ingestion_jobs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.String(64), nullable=False),
        sa.Column("document_id", sa.Uuid()),
        sa.Column("task_id", sa.String(255)),
        sa.Column("job_type", sa.String(64), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("progress", sa.Integer(), nullable=False),
        sa.Column("result", sa.JSON(), nullable=False),
        sa.Column("error_message", sa.Text()),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.id"],
            name="fk_ingestion_jobs_document_id_documents",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_ingestion_jobs"),
        sa.UniqueConstraint("task_id", name="uq_ingestion_jobs_task_id"),
    )
    op.create_index("ix_ingestion_jobs_tenant_status", "ingestion_jobs", ["tenant_id", "status"])

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.String(64), nullable=False),
        sa.Column("user_id", sa.String(128)),
        sa.Column("action", sa.String(128), nullable=False),
        sa.Column("resource_type", sa.String(64), nullable=False),
        sa.Column("resource_id", sa.String(128)),
        sa.Column("request_id", sa.String(64)),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_audit_logs"),
    )
    op.create_index("ix_audit_logs_tenant_created", "audit_logs", ["tenant_id", "created_at"])


def downgrade() -> None:
    op.drop_table("audit_logs")
    op.drop_table("ingestion_jobs")
    op.drop_table("chat_messages")
    op.drop_table("document_chunks")
    op.drop_table("conversations")
    op.drop_table("documents")
