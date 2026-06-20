from contextlib import asynccontextmanager

# load_dotenv MUST run before any route imports so module-level SDK clients
# (e.g. anthropic.Anthropic()) can read ANTHROPIC_API_KEY from the environment.
from dotenv import load_dotenv
load_dotenv("../.env")

from fastapi import FastAPI  # noqa: E402

from routes.apply import router as apply_router  # noqa: E402
from routes.ats_apply import router as ats_apply_router  # noqa: E402
from routes.cv import router as cv_router  # noqa: E402
from routes.jobs import router as jobs_router  # noqa: E402
from routes.jobs_cleanup import router as cleanup_router  # noqa: E402
from routes.linkedin_auth import router as linkedin_auth_router  # noqa: E402
from routes.matching import router as matching_router  # noqa: E402
from scheduler import start_scheduler, stop_scheduler  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(lifespan=lifespan)
app.include_router(cv_router)
app.include_router(jobs_router)
app.include_router(matching_router)
app.include_router(apply_router)
app.include_router(ats_apply_router)
app.include_router(linkedin_auth_router)
app.include_router(cleanup_router)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/fetch-active-jobs")
async def fetch_active_jobs_route():
    from active_jobs_fetcher import fetch_and_save_jobs
    result = await fetch_and_save_jobs()
    return result
