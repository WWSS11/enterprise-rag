from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any

import structlog

from app.core.config import get_settings
from app.services.document_parser import ParsedSection
from app.services.model_provider import get_embedding_model

logger = structlog.get_logger(__name__)

SENTENCE_BOUNDARY = re.compile(r"(?<=[。！？!?；;])|(?<=\.)\s+(?=[A-Z0-9])")
TOKEN_PIECE = re.compile(r"[\u3400-\u9fff]|[a-zA-Z0-9_]+|[^\s]")


def estimate_tokens(text: str) -> int:
    """Conservative language-neutral token estimate for chunk budgets."""

    total = 0
    for piece in TOKEN_PIECE.findall(text):
        if re.fullmatch(r"[a-zA-Z0-9_]+", piece):
            total += max(1, math.ceil(len(piece) / 4))
        else:
            total += 1
    return max(1, total) if text.strip() else 0


def truncate_to_tokens(text: str, limit: int) -> str:
    if estimate_tokens(text) <= limit:
        return text
    low, high = 0, len(text)
    while low < high:
        middle = (low + high + 1) // 2
        if estimate_tokens(text[:middle]) <= limit:
            low = middle
        else:
            high = middle - 1
    return text[:low].rstrip()


@dataclass(frozen=True, slots=True)
class AtomicDraft:
    atomic_index: int
    source_section_index: int
    content: str
    token_count: int
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ParentDraft:
    section_index: int
    source_section_index: int
    title: str | None
    heading_path: tuple[str, ...]
    content: str
    token_count: int
    atomic_start_index: int
    atomic_end_index: int
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RetrievalDraft:
    chunk_index: int
    parent_section_index: int
    content: str
    embedding_content: str
    token_count: int
    heading_path: tuple[str, ...]
    atomic_start_index: int
    atomic_end_index: int
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ChunkHierarchy:
    atomics: list[AtomicDraft]
    parents: list[ParentDraft]
    retrievals: list[RetrievalDraft]


def _hard_split(text: str, max_tokens: int) -> list[str]:
    output: list[str] = []
    remaining = text.strip()
    while remaining:
        piece = truncate_to_tokens(remaining, max_tokens)
        if not piece:
            piece = remaining[:1]
        output.append(piece)
        remaining = remaining[len(piece) :].strip()
    return output


def _atomic_texts(section: ParsedSection, max_tokens: int) -> list[str]:
    if section.section_type in {"table", "code", "structured"}:
        blocks = [line.strip() for line in section.text.splitlines() if line.strip()]
    else:
        paragraphs = [part.strip() for part in re.split(r"\n\s*\n", section.text) if part.strip()]
        blocks = []
        for paragraph in paragraphs:
            blocks.extend(
                part.strip() for part in SENTENCE_BOUNDARY.split(paragraph) if part.strip()
            )

    atomics: list[str] = []
    for block in blocks or [section.text.strip()]:
        if estimate_tokens(block) <= max_tokens:
            atomics.append(block)
        else:
            atomics.extend(_hard_split(block, max_tokens))
    return atomics


def build_atomic_drafts(sections: list[ParsedSection]) -> list[AtomicDraft]:
    max_tokens = get_settings().atomic_chunk_max_tokens
    atomics: list[AtomicDraft] = []
    for source_index, section in enumerate(sections):
        for content in _atomic_texts(section, max_tokens):
            metadata = {
                **section.metadata,
                "section_type": section.section_type,
                "source_section_index": source_index,
            }
            atomics.append(
                AtomicDraft(
                    atomic_index=len(atomics),
                    source_section_index=source_index,
                    content=content,
                    token_count=estimate_tokens(content),
                    metadata=metadata,
                )
            )
    return atomics


def _cosine(left: list[float], right: list[float]) -> float:
    dot = sum(a * b for a, b in zip(left, right, strict=False))
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    if not left_norm or not right_norm:
        return 1.0
    return dot / (left_norm * right_norm)


async def detect_semantic_breaks(atomics: list[AtomicDraft]) -> set[int]:
    """Return atomic indexes that should begin a new semantic parent block."""

    settings = get_settings()
    if not settings.semantic_chunking_enabled or len(atomics) < 2:
        return set()
    candidates = [
        index
        for index in range(1, len(atomics))
        if atomics[index - 1].source_section_index == atomics[index].source_section_index
        and atomics[index].metadata.get("section_type") == "prose"
    ]
    if not candidates:
        return set()
    try:
        vectors = await get_embedding_model().aembed_documents([item.content for item in atomics])
    except Exception as exc:
        await logger.awarning("semantic_boundary_detection_failed", error=str(exc))
        return set()
    scored = sorted(
        (
            (_cosine(vectors[index - 1], vectors[index]), index)
            for index in candidates
        ),
        key=lambda item: item[0],
    )
    maximum_breaks = max(
        1, math.ceil(len(scored) * settings.semantic_break_percentile / 100)
    )
    return {
        index
        for similarity, index in scored[:maximum_breaks]
        if similarity < settings.semantic_break_threshold
    }


def _context_prefix(document_name: str, section: ParsedSection) -> str:
    parts = [f"文档：{document_name}"]
    if section.heading_path:
        parts.append(f"章节：{' > '.join(section.heading_path)}")
    elif section.title:
        parts.append(f"章节：{section.title}")
    for key, label in (("page", "页码"), ("slide", "幻灯片"), ("sheet", "工作表")):
        if key in section.metadata:
            parts.append(f"{label}：{section.metadata[key]}")
    return "\n".join(parts)


def _overlap_start(units: list[AtomicDraft], end: int, overlap_tokens: int) -> int:
    if overlap_tokens <= 0:
        return end
    start = end
    total = 0
    while start > 0 and total < overlap_tokens:
        start -= 1
        total += units[start].token_count
    return start


def build_chunk_hierarchy(
    document_name: str,
    sections: list[ParsedSection],
    atomics: list[AtomicDraft] | None = None,
    semantic_breaks: set[int] | None = None,
) -> ChunkHierarchy:
    settings = get_settings()
    atomics = atomics or build_atomic_drafts(sections)
    semantic_breaks = semantic_breaks or set()
    by_source: dict[int, list[AtomicDraft]] = {}
    for atomic in atomics:
        by_source.setdefault(atomic.source_section_index, []).append(atomic)

    parents: list[ParentDraft] = []
    retrievals: list[RetrievalDraft] = []
    for source_index, section in enumerate(sections):
        source_units = by_source.get(source_index, [])
        cursor = 0
        while cursor < len(source_units):
            parent_units: list[AtomicDraft] = []
            parent_tokens = 0
            while cursor < len(source_units):
                unit = source_units[cursor]
                if parent_units and (
                    parent_tokens + unit.token_count > settings.parent_chunk_max_tokens
                    or unit.atomic_index in semantic_breaks
                ):
                    break
                parent_units.append(unit)
                parent_tokens += unit.token_count
                cursor += 1
            if not parent_units:
                parent_units.append(source_units[cursor])
                cursor += 1

            parent_index = len(parents)
            parent_content = "\n\n".join(item.content for item in parent_units)
            parents.append(
                ParentDraft(
                    section_index=parent_index,
                    source_section_index=source_index,
                    title=section.title,
                    heading_path=section.heading_path,
                    content=parent_content,
                    token_count=estimate_tokens(parent_content),
                    atomic_start_index=parent_units[0].atomic_index,
                    atomic_end_index=parent_units[-1].atomic_index,
                    metadata={**section.metadata, "section_type": section.section_type},
                )
            )

            local_start = 0
            while local_start < len(parent_units):
                local_end = local_start
                token_total = 0
                while local_end < len(parent_units):
                    candidate = parent_units[local_end]
                    if local_end > local_start and (
                        token_total + candidate.token_count > settings.retrieval_chunk_target_tokens
                        or candidate.atomic_index in semantic_breaks
                    ):
                        break
                    token_total += candidate.token_count
                    local_end += 1
                selected = parent_units[local_start:local_end]
                content = "\n\n".join(item.content for item in selected)
                prefix = _context_prefix(document_name, section)
                embedding_content = truncate_to_tokens(
                    f"{prefix}\n内容：{content}", settings.embedding_context_max_tokens
                )
                retrievals.append(
                    RetrievalDraft(
                        chunk_index=len(retrievals),
                        parent_section_index=parent_index,
                        content=content,
                        embedding_content=embedding_content,
                        token_count=estimate_tokens(content),
                        heading_path=section.heading_path,
                        atomic_start_index=selected[0].atomic_index,
                        atomic_end_index=selected[-1].atomic_index,
                        metadata={**section.metadata, "section_type": section.section_type},
                    )
                )
                if local_end >= len(parent_units):
                    break
                next_start = _overlap_start(
                    parent_units[:local_end], local_end, settings.retrieval_chunk_overlap_tokens
                )
                local_start = max(local_start + 1, next_start)

    return ChunkHierarchy(atomics=atomics, parents=parents, retrievals=retrievals)


async def build_chunk_hierarchy_async(
    document_name: str, sections: list[ParsedSection]
) -> ChunkHierarchy:
    atomics = build_atomic_drafts(sections)
    semantic_breaks = await detect_semantic_breaks(atomics)
    return build_chunk_hierarchy(document_name, sections, atomics, semantic_breaks)
