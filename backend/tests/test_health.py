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
