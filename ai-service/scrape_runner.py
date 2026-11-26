"""One daily scrape at a time, run in the background.

Until 2026-10-04 two full scrapes started at 05:00 UTC every day: the
scheduler's and the Daily Scrape workflow's, which also held its HTTP request
open within a 55 min SSH timeout. Now the scheduler is the only scheduled
trigger, the endpoint only starts a run, and ensure_running refuses to start a
second one while one is going.

The service runs a single uvicorn worker (entrypoint.sh), so module state is
enough to tell whether a run is going.
"""
import asyncio
import traceback
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone  # noqa: UP017

import intake_history

_task: asyncio.Task | None = None
_status: dict = {"state": "not run since the service started"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")  # noqa: UP017


def is_running() -> bool:
    return _task is not None and not _task.done()


def status() -> dict:
    return {**_status, "running": is_running()}


def ensure_running(
    run: Callable[..., Awaitable[dict]], *, trigger: str, **kwargs
) -> tuple[asyncio.Task, bool]:
    """Start run(**kwargs) unless a scrape is already running.

    Returns (task, started). When a scrape is already running, that run's task
    comes back with started=False, so a caller that needs the scrape finished
    (the scheduler's daily pipeline) can await it either way.
    """
    global _task
    if is_running():
        print(f"[scrape-runner] {trigger}: a scrape is already running ({_status.get('trigger')}), not starting another")
        return _task, False
    _status.clear()
    _status.update(state="running", trigger=trigger, options=kwargs, started_at=_now())
    print(f"[scrape-runner] {trigger}: starting scrape {kwargs}")
    _task = asyncio.create_task(_run(run, kwargs, trigger))
    return _task, True


async def _run(run: Callable[..., Awaitable[dict]], kwargs: dict, trigger: str = "") -> dict | None:
    # Failures are recorded, not raised: nothing may be awaiting this task
    # (the endpoint returns at once), and the daily pipeline should still go on
    # to matching with whatever is stored.
    #
    # The daily pipeline ("scheduler") records the scrape as a step of its own
    # IntakeRun; any other start (the endpoint, the startup recovery) gets a
    # run of kind "scrape" here, so it's in the history too.
    run_id = None if trigger == "scheduler" else await intake_history.start_run("scrape", trigger or "unknown")
    step: dict = {}
    try:
        result = await run(**kwargs)
    except asyncio.CancelledError:
        # The pipeline's time limit (scheduler.STEP_TIMEOUT_S) or a shutdown.
        _status.update(state="cancelled", finished_at=_now(), error="cancelled (time limit or shutdown)")
        step = {"status": "cancelled", "stored": 0}
        raise
    except Exception as e:
        traceback.print_exc()
        _status.update(state="failed", finished_at=_now(), error=repr(e))
        step = {"status": "failed", "error": repr(e)[:500], "stored": 0}
        return None
    else:
        _status.update(state="finished", finished_at=_now(), result=result)
        step = {"status": "ok", "result": intake_history.summary(result),
                "stored": intake_history.stored_by("scrape", result)}
        return result
    finally:
        if run_id:
            step["problems"] = intake_history.step_problems("scrape", step)
            await intake_history.record_step(run_id, "scrape", step)
            problems = list(step["problems"])
            if step.get("stored", 0) == 0:
                problems.insert(0, "The run stored 0 jobs")
            await intake_history.finish_run(run_id, jobs_stored=step.get("stored", 0), problems=problems)
