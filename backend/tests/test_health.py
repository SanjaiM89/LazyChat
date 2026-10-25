import httpx
import pytest

from main import create_app


@pytest.mark.asyncio
async def test_healthz():
    app = create_app()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/healthz")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_tools_list():
    app = create_app()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/v1/tools/")
        assert r.status_code == 200
        names = [t["function"]["name"] for t in r.json()]
        assert "shell" in names

@pytest.mark.asyncio
async def test_shell_tool_run():
    app = create_app()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post("/api/v1/tools/shell/run", json={"command": "echo hi"})
        assert r.status_code == 200
        data = r.json()
        assert data["ok"] is True
        assert "hi" in data["data"]["stdout"]


def test_compaction_prune():
    from services.compaction import PRUNE_THRESHOLD_CHARS, prune_text
    short = "a" * 100
    assert prune_text(short) == short
    long = "a" * (PRUNE_THRESHOLD_CHARS + 100)
    out = prune_text(long)
    assert "chars cut" in out


def test_json_schema_validate():
    from services.json_schema import validate_schema
    schema = {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}
    assert validate_schema({"name": "x"}, schema) is None
    assert validate_schema({}, schema) is not None
    assert validate_schema({"name": 5}, schema) is not None


def test_spill_read_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    from services import spill
    # reload module-level DATA_DIR
    spill.DATA_DIR = str(tmp_path)
    text = "x" * 10000
    res = spill.spill_text("conv1", text, threshold_chars=100)
    assert res is not None
    assert res["spilled"] is True
    read = spill.read_spill(res["path"])
    assert read is not None
    assert read["chars"] == 10000


def test_workspace_paths():
    from services.workspace_paths import (
        default_workspace_title,
        fully_qualified_workspace_path,
    )
    assert fully_qualified_workspace_path("/tmp/foo") is True
    assert fully_qualified_workspace_path("foo") is False
    assert default_workspace_title("/tmp/foo") == "foo"


@pytest.mark.asyncio
async def test_goals_rest_create_and_get():
    app = create_app()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post("/api/v1/goals/create", json={"conversation_id": "c2", "objective": "test goal"})
        assert r.status_code == 200
        data = r.json()
        assert data["goal"] is not None
        gid = data["goal"]["id"]
        rev = data["goal"]["revision"]
        r2 = await client.get("/api/v1/goals/c2")
        assert r2.status_code == 200
        assert r2.json()["goal"]["id"] == gid
