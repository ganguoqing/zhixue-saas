import os
import time

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()


class InferRequest(BaseModel):
    job_id: str
    input_hash: str
    delay_seconds: float | None = None
    fail: bool | None = None


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "endpoint": os.environ.get("MODEL_ENDPOINT", "mock://local")}


@app.post("/infer")
def infer(body: InferRequest) -> dict[str, object]:
    delay = body.delay_seconds or 0
    if delay > 0:
        time.sleep(delay)
    if body.fail:
        raise HTTPException(status_code=500, detail="synthetic_failure")
    return {
        "adapter": "mock",
        "endpoint": "mock://local",
        "model_version": "mock-1",
        "latency_ms": int(delay * 1000),
        "tokens": 0,
        "pages": 1,
        "estimated_cost": None,
        "cost_status": "unknown",
    }
