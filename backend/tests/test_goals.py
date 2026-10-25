import os
import tempfile

import pytest

os.environ["DATA_DIR"] = tempfile.mkdtemp()

from services.goals import create_goal, get_goal, update_goal, goal_wire


@pytest.mark.asyncio
async def test_create_and_get_goal():
    res = await create_goal("conv1", "do something", None)
    assert "goal" in res and res["goal"] is not None
    g = await get_goal("conv1")
    assert g is not None
    assert g.objective == "do something"


@pytest.mark.asyncio
async def test_update_goal_complete():
    g = await get_goal("conv1")
    assert g is not None
    res = await update_goal("conv1", g.id, g.revision, "complete")
    assert res["goal"]["phase"] == "complete"
