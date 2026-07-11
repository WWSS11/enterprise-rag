import asyncio

from app.workers.async_runtime import run_async


async def _loop_identity() -> int:
    return id(asyncio.get_running_loop())


def test_worker_async_runtime_reuses_event_loop() -> None:
    assert run_async(_loop_identity()) == run_async(_loop_identity())
