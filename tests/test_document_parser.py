from app.services.document_parser import parse_document


def test_parse_text_document(tmp_path) -> None:
    path = tmp_path / "notes.txt"
    path.write_text("企业级 RAG", encoding="utf-8")
    assert parse_document(path) == "企业级 RAG"


def test_parse_xml_document(tmp_path) -> None:
    path = tmp_path / "knowledge.xml"
    path.write_text(
        "<root><title>权限设计</title><body>最小权限原则</body></root>",
        encoding="utf-8",
    )
    assert parse_document(path) == "权限设计\n最小权限原则"


def test_parse_powerpoint_document(tmp_path) -> None:
    from pptx import Presentation

    path = tmp_path / "architecture.pptx"
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[1])
    slide.shapes.title.text = "企业 RAG"
    slide.placeholders[1].text = "异步入库与权限过滤"
    presentation.save(path)

    content = parse_document(path)
    assert "企业 RAG" in content
    assert "异步入库与权限过滤" in content
