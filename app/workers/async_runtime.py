import asyncio
import os
import threading
from collections.abc import Coroutine
from typing import Any

_lock = threading.Lock()
_ready = threading.Event()
_loop: asyncio.AbstractEventLoop | None = None
_thread: threading.Thread | None = None
_pid: int | None = None


def _loop_main() -> None:
    global _loop
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    _loop = loop
    _ready.set()
    loop.run_forever()


def _ensure_loop() -> asyncio.AbstractEventLoop:
    global _loop, _pid, _ready, _thread
    current_pid = os.getpid()
    with _lock:
        if _pid != current_pid:
            _pid = current_pid
            _loop = None
            _thread = None
            _ready = threading.Event()
        if _loop is None or not _loop.is_running():
            _thread = threading.Thread(
                target=_loop_main,
                name="celery-async-runtime",
                daemon=True,
            )
            _thread.start()
    if not _ready.wait(timeout=10):
        raise RuntimeError("Celery async runtime did not start")
    if _loop is None:
        raise RuntimeError("Celery async runtime is unavailable")
    return _loop


def run_async[T](coroutine: Coroutine[Any, Any, T]) -> T:
    """Run async application code on one persistent loop per Celery child process."""

    future = asyncio.run_coroutine_threadsafe(coroutine, _ensure_loop())
    return future.result()
