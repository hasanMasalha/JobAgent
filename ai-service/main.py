from fastapi import FastAPI
from routes.cv import router as cv_router

app = FastAPI()
app.include_router(cv_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
