from dotenv import load_dotenv
load_dotenv("../.env")

from fastapi import FastAPI
from routes.cv import router as cv_router
from routes.jobs import router as jobs_router
from routes.matching import router as matching_router

app = FastAPI()
app.include_router(cv_router)
app.include_router(jobs_router)
app.include_router(matching_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
