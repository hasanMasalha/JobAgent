from contextlib import asynccontextmanager

# load_dotenv MUST run before any route imports so module-level SDK clients
# (e.g. anthropic.Anthropic()) can read ANTHROPIC_API_KEY from the environment.
from dotenv import load_dotenv
load_dotenv("../.env")

from fastapi import FastAPI

from routes.apply import router as apply_router
from routes.cv import router as cv_router
from routes.jobs import router as jobs_router
from routes.linkedin_auth import router as linkedin_auth_router
from routes.matching import router as matching_router
from scheduler import start_scheduler, stop_scheduler


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
app.include_router(linkedin_auth_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
