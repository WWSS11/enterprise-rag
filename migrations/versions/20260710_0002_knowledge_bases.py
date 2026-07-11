"""add knowledge-base authorization and versioned indexing

Revision ID: 20260710_0002
Revises: 20260710_0001
Create Date: 2026-07-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260710_0002"
down_revision: str | None = "20260710_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "knowledge_bases",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.String(64), nullable=False),
        sa.Column("slug", sa.String(128), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("access_mode", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False),
        sa.Column("created_by", sa.String(128), nullable=False),
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
        sa.PrimaryKeyConstraint("id", name="pk_knowledge_bases"),
        sa.UniqueConstraint("tenant_id", "slug", name="uq_knowledge_bases_tenant_slug"),
    )
    op.create_index(
        "ix_knowledge_bases_tenant_status", "knowledge_bases", ["tenant_id", "status"]
    )
    op.create_table(
        "knowledge_base_members",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.String(64), nullable=False),
        sa.Column("knowledge_base_id", sa.Uuid(), nullable=False),
        sa.Column("principal_type", sa.String(32), nullable=False),
        sa.Column("principal_id", sa.String(128), nullable=False),
        sa.Column("permission", sa.String(32), nullable=False),
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
            ["knowledge_base_id"],
            ["knowledge_bases.id"],
            name="fk_knowledge_base_members_knowledge_base_id_knowledge_bases",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_knowledge_base_members"),
        sa.UniqueConstraint(
            "knowledge_base_id",
            "principal_type",
            "principal_id",
            name="uq_kb_members_principal",
        ),
    )
    op.create_index(
        "ix_kb_members_tenant_principal",
        "knowledge_base_members",
        ["tenant_id", "principal_type", "principal_id"],
    )

    op.add_column("documents", sa.Column("knowledge_base_id", sa.Uuid(), nullable=True))
    op.add_column("documents", sa.Column("source_key", sa.String(1024)))
    op.add_column("documents", sa.Column("source_updated_at", sa.DateTime(timezone=True)))
    op.add_column("documents", sa.Column("index_version", sa.String(64)))
    op.add_column("documents", sa.Column("indexed_at", sa.DateTime(timezone=True)))
    op.add_column("document_chunks", sa.Column("knowledge_base_id", sa.Uuid(), nullable=True))
    op.add_column("document_chunks", sa.Column("index_version", sa.String(64), nullable=True))
    op.add_column("conversations", sa.Column("knowledge_base_id", sa.Uuid(), nullable=True))

    op.execute(
        """
        INSERT INTO knowledge_bases (
            id, tenant_id, slug, name, access_mode, status, is_default, created_by
        )
        SELECT gen_random_uuid(), tenant_id, 'default', '默认知识库',
               'tenant', 'active', true, 'migration'
        FROM (
            SELECT tenant_id FROM documents
            UNION
            SELECT tenant_id FROM conversations
        ) tenants
        ON CONFLICT (tenant_id, slug) DO NOTHING
        """
    )
    op.execute(
        """
        UPDATE documents d
        SET knowledge_base_id = kb.id,
            index_version = CASE WHEN d.status = 'ready' THEN 'legacy' ELSE NULL END
        FROM knowledge_bases kb
        WHERE kb.tenant_id = d.tenant_id AND kb.slug = 'default'
        """
    )
    op.execute(
        """
        UPDATE conversations c
        SET knowledge_base_id = kb.id
        FROM knowledge_bases kb
        WHERE kb.tenant_id = c.tenant_id AND kb.slug = 'default'
        """
    )
    op.execute(
        """
        UPDATE document_chunks dc
        SET knowledge_base_id = d.knowledge_base_id,
            index_version = COALESCE(d.index_version, 'legacy')
        FROM documents d
        WHERE d.id = dc.document_id
        """
    )

    op.alter_column("documents", "knowledge_base_id", nullable=False)
    op.alter_column("document_chunks", "knowledge_base_id", nullable=False)
    op.alter_column("document_chunks", "index_version", nullable=False)
    op.alter_column("conversations", "knowledge_base_id", nullable=False)

    op.create_foreign_key(
        "fk_documents_knowledge_base_id_knowledge_bases",
        "documents",
        "knowledge_bases",
        ["knowledge_base_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_document_chunks_knowledge_base_id_knowledge_bases",
        "document_chunks",
        "knowledge_bases",
        ["knowledge_base_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_conversations_knowledge_base_id_knowledge_bases",
        "conversations",
        "knowledge_bases",
        ["knowledge_base_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.drop_constraint("uq_documents_tenant_checksum", "documents", type_="unique")
    op.create_unique_constraint(
        "uq_documents_kb_checksum", "documents", ["knowledge_base_id", "checksum"]
    )
    op.create_unique_constraint(
        "uq_documents_kb_source_key",
        "documents",
        ["knowledge_base_id", "source_type", "source_key"],
    )
    op.create_index("ix_documents_kb_status", "documents", ["knowledge_base_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_documents_kb_status", table_name="documents")
    op.drop_constraint("uq_documents_kb_source_key", "documents", type_="unique")
    op.drop_constraint("uq_documents_kb_checksum", "documents", type_="unique")
    op.create_unique_constraint(
        "uq_documents_tenant_checksum", "documents", ["tenant_id", "checksum"]
    )
    op.drop_constraint(
        "fk_conversations_knowledge_base_id_knowledge_bases",
        "conversations",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_document_chunks_knowledge_base_id_knowledge_bases",
        "document_chunks",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_documents_knowledge_base_id_knowledge_bases", "documents", type_="foreignkey"
    )
    op.drop_column("conversations", "knowledge_base_id")
    op.drop_column("document_chunks", "index_version")
    op.drop_column("document_chunks", "knowledge_base_id")
    op.drop_column("documents", "indexed_at")
    op.drop_column("documents", "index_version")
    op.drop_column("documents", "source_updated_at")
    op.drop_column("documents", "source_key")
    op.drop_column("documents", "knowledge_base_id")
    op.drop_table("knowledge_base_members")
    op.drop_table("knowledge_bases")
