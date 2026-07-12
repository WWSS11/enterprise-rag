"""add hierarchical document chunks

Revision ID: 20260711_0004
Revises: 20260711_0003
Create Date: 2026-07-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260711_0004"
down_revision: str | None = "20260711_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "document_sections",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.String(64), nullable=False),
        sa.Column("knowledge_base_id", sa.Uuid(), nullable=False),
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("index_version", sa.String(64), nullable=False),
        sa.Column("section_index", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(1024)),
        sa.Column("heading_path", sa.JSON(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("token_count", sa.Integer(), nullable=False),
        sa.Column("source_metadata", sa.JSON(), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.id"],
            name="fk_document_sections_document_id_documents",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["knowledge_base_id"],
            ["knowledge_bases.id"],
            name="fk_document_sections_knowledge_base_id_knowledge_bases",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_document_sections"),
        sa.UniqueConstraint(
            "document_id", "section_index", name="uq_sections_document_index"
        ),
    )
    op.create_index(
        "ix_sections_document_version",
        "document_sections",
        ["document_id", "index_version"],
    )

    op.create_table(
        "document_atomic_units",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.String(64), nullable=False),
        sa.Column("knowledge_base_id", sa.Uuid(), nullable=False),
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("section_id", sa.Uuid(), nullable=False),
        sa.Column("index_version", sa.String(64), nullable=False),
        sa.Column("atomic_index", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("token_count", sa.Integer(), nullable=False),
        sa.Column("source_metadata", sa.JSON(), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.id"],
            name="fk_document_atomic_units_document_id_documents",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["knowledge_base_id"],
            ["knowledge_bases.id"],
            name="fk_document_atomic_units_knowledge_base_id_knowledge_bases",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["section_id"],
            ["document_sections.id"],
            name="fk_document_atomic_units_section_id_document_sections",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_document_atomic_units"),
        sa.UniqueConstraint(
            "document_id", "atomic_index", name="uq_atomic_document_index"
        ),
    )
    op.create_index(
        "ix_atomic_section_index",
        "document_atomic_units",
        ["section_id", "atomic_index"],
    )

    op.add_column("document_chunks", sa.Column("parent_section_id", sa.Uuid()))
    op.add_column("document_chunks", sa.Column("embedding_content", sa.Text()))
    op.add_column("document_chunks", sa.Column("heading_path", sa.JSON()))
    op.add_column("document_chunks", sa.Column("atomic_start_index", sa.Integer()))
    op.add_column("document_chunks", sa.Column("atomic_end_index", sa.Integer()))
    op.execute(
        "UPDATE document_chunks SET embedding_content = content, heading_path = '[]'::json"
    )
    op.alter_column("document_chunks", "embedding_content", nullable=False)
    op.alter_column("document_chunks", "heading_path", nullable=False)
    op.create_foreign_key(
        "fk_document_chunks_parent_section_id_document_sections",
        "document_chunks",
        "document_sections",
        ["parent_section_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_document_chunks_parent_section_id_document_sections",
        "document_chunks",
        type_="foreignkey",
    )
    op.drop_column("document_chunks", "atomic_end_index")
    op.drop_column("document_chunks", "atomic_start_index")
    op.drop_column("document_chunks", "heading_path")
    op.drop_column("document_chunks", "embedding_content")
    op.drop_column("document_chunks", "parent_section_id")
    op.drop_table("document_atomic_units")
    op.drop_table("document_sections")
