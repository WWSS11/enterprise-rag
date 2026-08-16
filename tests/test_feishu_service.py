from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest

from app.services.feishu_service import FeishuAPIError, FeishuClient, FeishuNode


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


@pytest.mark.asyncio
async def test_wiki_pagination_continues_after_permission_filtered_empty_page(
    monkeypatch,
) -> None:
    client = FeishuClient()
    request = AsyncMock(
        side_effect=[
            {"items": [], "has_more": True, "page_token": "next-page"},
            {
                "items": [
                    {
                        "node_token": "n1",
                        "obj_token": "d1",
                        "obj_type": "docx",
                        "title": "可见文档",
                        "has_child": False,
                    }
                ],
                "has_more": False,
            },
        ]
    )
    monkeypatch.setattr(client, "_request", request)

    nodes = await client.list_wiki_nodes("space")

    assert [node.node_token for node in nodes] == ["n1"]
    assert request.await_count == 2
    assert request.await_args_list[1].kwargs["params"]["page_token"] == "next-page"


@pytest.mark.asyncio
async def test_wiki_pagination_rejects_missing_next_cursor(monkeypatch) -> None:
    client = FeishuClient()
    monkeypatch.setattr(
        client,
        "_request",
        AsyncMock(return_value={"items": [], "has_more": True}),
    )

    with pytest.raises(FeishuAPIError, match="pagination cursor") as caught:
        await client.list_wiki_nodes("space")
    assert caught.value.operation == "wiki/v2/spaces/space/nodes"


def test_feishu_api_error_exposes_only_structured_diagnostics() -> None:
    error = FeishuAPIError(
        "permission denied",
        operation="wiki/v2/spaces/space/nodes",
        code=131006,
        log_id="trace-1",
    )

    assert error.failure_details() == {
        "category": "feishu_api",
        "operation": "wiki/v2/spaces/space/nodes",
        "message": "permission denied",
        "error_code": 131006,
        "log_id": "trace-1",
        "retryable": False,
    }
