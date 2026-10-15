import os
import time

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

app = FastAPI()


class InferRequest(BaseModel):
    job_id: str
    input_hash: str
    stage: str = "validate_asset"
    delay_seconds: float | None = None
    sample: str | None = None
    mode: str | None = None
    questions: list[dict] | None = None
    asset_id: str | None = None


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "endpoint": os.environ.get("MODEL_ENDPOINT", "mock://local")}


@app.post("/infer", response_model=None)
def infer(body: InferRequest):
    delay = body.delay_seconds or 0
    if delay > 0:
        time.sleep(delay)
    count_path = os.environ.get("INFERENCE_COUNT_PATH")
    if count_path:
        with open(count_path, "a", encoding="utf-8") as handle:
            handle.write(f"{body.job_id}\n")
    if body.sample and "SYNTHETIC_PROVIDER_FAULT" in body.sample:
        raise HTTPException(status_code=500, detail="provider_fault")
    if body.mode == "bad_json":
        return Response(content="{not-json", media_type="application/json", status_code=200)
    if body.mode == "http_500":
        raise HTTPException(status_code=500, detail="provider_fault")
    if body.mode == "illegal_uuid":
        return {
            "items": [{
                "paper_question_id": "not-a-uuid",
                "recognized_answer": "synthetic",
                "suggested_score": "1.00",
                "criterion_awards": [{"criterion_id": "018f0a3e-7c21-7b2a-8c11-222222222222", "awarded_points": "1.00"}],
                "evidence": [{"source_asset_id": body.asset_id, "page_index": 1, "bbox": [0, 0, 1, 1]}],
            }],
        }
    if body.mode == "timeout":
        time.sleep(30)
    if body.stage == "model_grade":
        items = []
        for question in body.questions or []:
            items.append({
                "paper_question_id": question["id"],
                "recognized_answer": "synthetic",
                "suggested_score": "1.00",
                "criterion_awards": [{
                    "criterion_id": question["criterion_id"],
                    "awarded_points": "1.00",
                }],
                "evidence": [{
                    "source_asset_id": body.asset_id,
                    "page_index": 1,
                    "bbox": [0, 0, 1, 1],
                }],
            })
        return {
            "adapter": "mock",
            "model_version": "mock-1",
            "tokens": 0,
            "pages": 1,
            "estimated_cost": None,
            "cost_status": "unknown",
            "items": items,
        }
    return {
        "adapter": "mock",
        "outcome": "accepted",
        "input_hash": body.input_hash,
        "model_version": "mock-1",
        "tokens": 0,
        "pages": 1,
        "estimated_cost": None,
        "cost_status": "unknown",
    }
