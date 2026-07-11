from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class KnowledgeBase(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "knowledge_bases"
    __table_args__ = (
        UniqueConstraint("tenant_id", "slug", name="uq_knowledge_bases_tenant_slug"),
        Index("ix_knowledge_bases_tenant_status", "tenant_id", "status"),
    )

    tenant_id: Mapped[str] = mapped_column(String(64), nullable=False)
    slug: Mapped[str] = mapped_column(String(128), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    access_mode: Mapped[str] = mapped_column(String(32), default="tenant", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_by: Mapped[str] = mapped_column(String(128), nullable=False)

    members: Mapped[list[KnowledgeBaseMember]] = relationship(
        back_populates="knowledge_base", cascade="all, delete-orphan", passive_deletes=True
    )


class KnowledgeBaseMember(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "knowledge_base_members"
    __table_args__ = (
        UniqueConstraint(
            "knowledge_base_id",
            "principal_type",
            "principal_id",
            name="uq_kb_members_principal",
        ),
        Index("ix_kb_members_tenant_principal", "tenant_id", "principal_type", "principal_id"),
    )

    tenant_id: Mapped[str] = mapped_column(String(64), nullable=False)
    knowledge_base_id: Mapped[UUID] = mapped_column(
        ForeignKey("knowledge_bases.id", ondelete="CASCADE"), nullable=False
    )
    principal_type: Mapped[str] = mapped_column(String(32), default="user", nullable=False)
    principal_id: Mapped[str] = mapped_column(String(128), nullable=False)
    permission: Mapped[str] = mapped_column(String(32), default="reader", nullable=False)

    knowledge_base: Mapped[KnowledgeBase] = relationship(back_populates="members")


class Document(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "documents"
    __table_args__ = (
        UniqueConstraint("knowledge_base_id", "checksum", name="uq_documents_kb_checksum"),
        UniqueConstraint(
            "knowledge_base_id", "source_type", "source_key", name="uq_documents_kb_source_key"
        ),
        Index("ix_documents_tenant_status", "tenant_id", "status"),
        Index("ix_documents_kb_status", "knowledge_base_id", "status"),
    )

    tenant_id: Mapped[str] = mapped_column(String(64), default="default", nullable=False)
    knowledge_base_id: Mapped[UUID] = mapped_column(
        ForeignKey("knowledge_bases.id", ondelete="RESTRICT"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(512), nullable=False)
    source_type: Mapped[str] = mapped_column(String(32), default="upload", nullable=False)
    source_key: Mapped[str | None] = mapped_column(String(1024))
    source_uri: Mapped[str | None] = mapped_column(String(2048))
    source_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    content_type: Mapped[str | None] = mapped_column(String(255))
    checksum: Mapped[str] = mapped_column(String(64), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    chunk_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    index_version: Mapped[str | None] = mapped_column(String(64))
    indexed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error_message: Mapped[str | None] = mapped_column(Text)
    extra_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)

    chunks: Mapped[list[DocumentChunk]] = relationship(
        back_populates="document", cascade="all, delete-orphan", passive_deletes=True
    )


class DocumentChunk(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "document_chunks"
    __table_args__ = (
        UniqueConstraint("document_id", "chunk_index", name="uq_chunks_document_index"),
        UniqueConstraint("vector_id", name="uq_chunks_vector_id"),
        Index("ix_chunks_tenant_document", "tenant_id", "document_id"),
    )

    tenant_id: Mapped[str] = mapped_column(String(64), default="default", nullable=False)
    knowledge_base_id: Mapped[UUID] = mapped_column(
        ForeignKey("knowledge_bases.id", ondelete="RESTRICT"), nullable=False
    )
    document_id: Mapped[UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    vector_id: Mapped[str] = mapped_column(String(64), nullable=False)
    index_version: Mapped[str] = mapped_column(String(64), nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    token_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    source_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)

    document: Mapped[Document] = relationship(back_populates="chunks")


class Conversation(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "conversations"
    __table_args__ = (Index("ix_conversations_tenant_user", "tenant_id", "user_id"),)

    tenant_id: Mapped[str] = mapped_column(String(64), default="default", nullable=False)
    knowledge_base_id: Mapped[UUID] = mapped_column(
        ForeignKey("knowledge_bases.id", ondelete="RESTRICT"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(String(128), nullable=False)
    title: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)

    messages: Mapped[list[ChatMessage]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan", passive_deletes=True
    )


class ChatMessage(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "chat_messages"
    __table_args__ = (Index("ix_messages_conversation_created", "conversation_id", "created_at"),)

    conversation_id: Mapped[UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    citations: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    token_usage: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    conversation: Mapped[Conversation] = relationship(back_populates="messages")


class IngestionJob(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "ingestion_jobs"
    __table_args__ = (Index("ix_ingestion_jobs_tenant_status", "tenant_id", "status"),)

    tenant_id: Mapped[str] = mapped_column(String(64), default="default", nullable=False)
    document_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL")
    )
    task_id: Mapped[str | None] = mapped_column(String(255), unique=True)
    job_type: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="queued", nullable=False)
    progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    result: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text)


class AuditLog(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_logs_tenant_created", "tenant_id", "created_at"),)

    tenant_id: Mapped[str] = mapped_column(String(64), default="default", nullable=False)
    user_id: Mapped[str | None] = mapped_column(String(128))
    action: Mapped[str] = mapped_column(String(128), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(64), nullable=False)
    resource_id: Mapped[str | None] = mapped_column(String(128))
    request_id: Mapped[str | None] = mapped_column(String(64))
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
