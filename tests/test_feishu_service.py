from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest

from app.services.feishu_service import FeishuClient, FeishuNode


@pytest.mark.asyncio
async def test_feishu_connector_routes_supported_object_types(monkeypatch) -> None:
    client = FeishuClient()
    nodes = [
        FeishuNode("n1", "d1", "docx", "文档", None, False, datetime.now(UTC)),
        FeishuNode("n2", "s1", "sheet", "表格", None, False, None),
        FeishuNode("n3", "b1", "bitable", "多维表格", None, False, None),
        FeishuNode("n4", "f1", "file", "附件", None, False, None),
    ]
    monkeypatch.setattr(client, "list_wiki_nodes", AsyncMock(return_value=nodes))
    monkeypatch.setattr(client, "_docx_content", AsyncMock(return_value="docx content"))
    monkeypatch.setattr(client, "_sheet_content", AsyncMock(return_value="sheet content"))
    monkeypatch.setattr(client, "_bitable_content", AsyncMock(return_value="bitable content"))

    documents, unsupported = await client.remote_documents("space")

    assert [document.source_key for document in documents] == [
        "space:n1",
        "space:n2",
        "space:n3",
    ]
    assert unsupported == 1
