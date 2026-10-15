import asyncio
import os
import time

import httpx
import jwt
from bullmq import Worker
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource
import json
from pathlib import Path

SCHEMA_ROOT = Path(__file__).resolve().parents[2] / "docs" / "architecture" / "schemas"
PAYLOAD_SCHEMA = json.loads((SCHEMA_ROOT / "model-grade-payload-1.0.0.schema.json").read_text())
ENVELOPE_SCHEMA = json.loads((SCHEMA_ROOT / "acceptance-envelope-1.0.0.schema.json").read_text())
ENVELOPE_VALIDATOR = Draft202012Validator(
    ENVELOPE_SCHEMA,
    registry=Registry().with_resources([
        (PAYLOAD_SCHEMA["$id"], Resource.from_contents(PAYLOAD_SCHEMA)),
        (ENVELOPE_SCHEMA["$id"], Resource.from_contents(ENVELOPE_SCHEMA)),
    ]),
    format_checker=FormatChecker(),
)


def build_envelope(job_id, attempt_id, claimed, invocation_id, items):
    return {
        "schema_version": "acceptance-envelope/1.0.0",
        "job_id": job_id,
        "attempt_id": attempt_id,
        "generation": claimed["generation"],
        "fencing_epoch": claimed["fencingEpoch"],
        "lease_token": claimed["leaseToken"],
        "input_hash": claimed["inputHash"],
        "invocation_id": invocation_id,
        "payload": {"schema_version": "model-grade-payload/1.0.0", "items": items},
    }


def schema_ok(envelope: dict) -> bool:
    return ENVELOPE_VALIDATOR.is_valid(envelope)


def service_token(scope: str, job_id: str | None = None, attempt_id: str | None = None) -> str:
    payload = {
        "scope": scope,
        "iss": "zhixue-worker",
        "sub": "svc:worker",
        "aud": "zhixue-internal",
        "iat": int(time.time()),
        "exp": int(time.time()) + 60,
        "jti": os.urandom(16).hex(),
    }
    if job_id:
        payload["job_id"] = job_id
    if attempt_id:
        payload["attempt_id"] = attempt_id
    return jwt.encode(payload, os.environ["WORKER_JWT_SECRET"], algorithm="HS256")


def headers(scope: str, job_id: str | None = None, attempt_id: str | None = None, idempotency_key: str | None = None) -> dict[str, str]:
    result = {"authorization": f"Bearer {service_token(scope, job_id, attempt_id)}"}
    if idempotency_key:
        result["idempotency-key"] = idempotency_key
    return result


async def finish(client: httpx.AsyncClient, data: dict, claimed: dict) -> dict:
    api = os.environ["API_BASE"]
    job_id = data["jobId"]
    attempt_id = claimed["attemptId"]
    if data.get("killAfterClaim") or data.get("stopAfterClaim"):
        os.kill(os.getpid(), 9)
    if claimed.get("billable") is True:
        prepared = await client.post(
            f"{api}/internal/jobs/prepare-invocation",
            json={"jobId": job_id, "attemptId": attempt_id},
            headers=headers("ai.job.prepare_invocation", job_id, attempt_id),
        )
        prepared.raise_for_status()
        payload = prepared.json()
        invocation_id = payload["id"]
        send_state = payload.get("send_state")
        if send_state == "send_unknown":
            print(f"resend_blocked job_id={job_id}", flush=True)
            return {"send_unknown": True, "http": False}
        if send_state == "observed":
            stored = payload.get("response_body") or {}
            items = stored.get("items") if isinstance(stored, dict) else None
            if not items:
                return await stage_failure(client, data, claimed, invocation_id, "missing_persisted_result", None)
            envelope = build_envelope(job_id, attempt_id, claimed, invocation_id, items)
            if not schema_ok(envelope):
                return await stage_failure(client, data, claimed, invocation_id, "schema_rejected", 200)
            return await accept(client, data, claimed, True, envelope, "accepted")
        if send_state != "not_sent":
            return {"ignored": True, "send_state": send_state}
        permit = await client.post(
            f"{api}/internal/jobs/issue-send-permit",
            json={"jobId": job_id, "attemptId": attempt_id, "invocationId": invocation_id},
            headers=headers("ai.invocation.issue_permit", job_id, attempt_id),
        )
        if permit.status_code >= 400:
            print(f"permit_rejected job_id={job_id} status={permit.status_code}", flush=True)
            return {"permit_rejected": permit.status_code}
        if data.get("killAfterPermit"):
            os.kill(os.getpid(), 9)
        frozen = await client.get(
            f"{api}/internal/jobs/{job_id}/frozen",
            headers=headers("ai.job.read_frozen", job_id),
        )
        frozen.raise_for_status()
        fixture = frozen.json()
        try:
            inferred = await client.post(
                f"{os.environ['INFERENCE_URL']}/infer",
                json={
                    "job_id": job_id,
                    "input_hash": claimed["inputHash"],
                    "stage": "model_grade",
                    "delay_seconds": data.get("delaySeconds"),
                    "sample": data.get("sample"),
                    "mode": data.get("providerMode"),
                    "asset_id": fixture.get("assetId"),
                    "questions": fixture.get("questions"),
                },
                timeout=0.5 if data.get("delaySeconds") else 5,
            )
        except httpx.TimeoutException:
            print(f"provider_timeout job_id={job_id}", flush=True)
            return {"send_unknown": True}
        if data.get("killAfterHttp"):
            os.kill(os.getpid(), 9)
        response_body = None
        if inferred.status_code < 400:
            try:
                response_body = inferred.json()
            except ValueError:
                response_body = None
        observed = await client.post(
            f"{api}/internal/jobs/record-observation",
            json={
                "jobId": job_id,
                "attemptId": attempt_id,
                "invocationId": invocation_id,
                "providerStatus": inferred.status_code,
                "responseBody": response_body,
            },
            headers=headers("ai.invocation.observe", job_id, attempt_id),
        )
        observed.raise_for_status()
        if data.get("killAfterObserve"):
            os.kill(os.getpid(), 9)
        if inferred.status_code >= 400:
            return await stage_failure(client, data, claimed, invocation_id, "provider_http", inferred.status_code)
        if response_body is None:
            return await stage_failure(client, data, claimed, invocation_id, "bad_json", inferred.status_code)
        envelope = build_envelope(job_id, attempt_id, claimed, invocation_id, response_body.get("items") or [])
        if not schema_ok(envelope):
            return await stage_failure(client, data, claimed, invocation_id, "schema_rejected", 200)
        return await accept(client, data, claimed, True, envelope, "accepted")
    inferred = await client.post(
        f"{os.environ['INFERENCE_URL']}/infer",
        json={
            "job_id": job_id,
            "input_hash": claimed["inputHash"],
            "stage": "validate_asset",
            "sample": data.get("sample"),
            "mode": data.get("providerMode"),
        },
        timeout=5,
    )
    outcome = None
    ok = False
    if inferred.status_code < 400:
        try:
            body = inferred.json()
            if body.get("outcome") == "accepted" and body.get("input_hash") == claimed["inputHash"]:
                ok = True
                outcome = "accepted"
        except ValueError:
            ok = False
    return await accept(client, data, claimed, ok, None, outcome)


async def stage_failure(client, data, claimed, invocation_id, code, provider_status):
    failed = await client.post(
        f"{os.environ['API_BASE']}/internal/jobs/stage-failure",
        json={
            "jobId": data["jobId"],
            "attemptId": claimed["attemptId"],
            "invocationId": invocation_id,
            "failureCode": code,
            "providerStatus": provider_status,
            "fencingEpoch": claimed["fencingEpoch"],
            "generation": claimed["generation"],
            "inputHash": claimed["inputHash"],
            "leaseToken": claimed["leaseToken"],
        },
        headers=headers("ai.result.accept", data["jobId"], claimed["attemptId"], f"fail:{claimed['attemptId']}:{code}"),
    )
    print(f"stage_failure job_id={data['jobId']} code={code} status={failed.status_code}", flush=True)
    if failed.status_code >= 400:
        return {"rejected": failed.status_code, "failure": code}
    return failed.json()


async def accept(client, data, claimed, ok, envelope, outcome):
    accepted = await client.post(
        f"{os.environ['API_BASE']}/internal/jobs/accept",
        json={
            "jobId": data["jobId"],
            "attemptId": claimed["attemptId"],
            "fencingEpoch": claimed["fencingEpoch"],
            "leaseToken": claimed["leaseToken"],
            "generation": claimed["generation"],
            "inputHash": claimed["inputHash"],
            "ok": ok,
            "outcome": outcome,
            "envelope": envelope,
        },
        headers=headers("ai.result.accept", data["jobId"], claimed["attemptId"], f"accept:{claimed['attemptId']}"),
    )
    if accepted.status_code >= 400:
        print(f"accept_rejected job_id={data['jobId']} status={accepted.status_code} body={accepted.text[:200]}", flush=True)
        return {"rejected": accepted.status_code}
    print(f"accepted job_id={data['jobId']}", flush=True)
    return accepted.json()


async def process(job, _token):
    data = job.data or {}
    api = os.environ["API_BASE"]
    print(f"received job_id={data.get('jobId')} action={data.get('action', 'execute')}", flush=True)
    async with httpx.AsyncClient(timeout=10, trust_env=False) as client:
        if data.get("action") == "execute_current":
            continued = await client.post(
                f"{api}/internal/jobs/continue",
                json={"jobId": data["jobId"], "capability": data.get("capability"), "leaseToken": data.get("leaseToken")},
                headers=headers("ai.job.claim", data.get("jobId")),
            )
            if continued.status_code >= 400:
                print(f"continue_rejected job_id={data.get('jobId')} status={continued.status_code}", flush=True)
                return {"ignored": True, "status": continued.status_code}
            return await finish(client, data, continued.json())
        claim = await client.post(
            f"{api}/internal/jobs/claim",
            json={"jobId": data["jobId"], "capability": data.get("capability")},
            headers=headers("ai.job.claim", data.get("jobId")),
        )
        if claim.status_code >= 400:
            print(f"claim_rejected job_id={data.get('jobId')} status={claim.status_code} body={claim.text[:300]}", flush=True)
            return {"ignored": True, "status": claim.status_code}
        claimed = claim.json()
        if claimed.get("status") == "failed_final":
            return claimed
        return await finish(client, data, claimed)


async def main() -> None:
    report = os.environ.get("WORKER_ENV_REPORT")
    if report:
        with open(report, "w", encoding="utf-8") as handle:
            for name in sorted(os.environ):
                handle.write(f"{name}\n")
    worker = Worker(
        "zhixue-jobs",
        process,
        {
            "connection": {
                "host": os.environ["REDIS_HOST"],
                "port": int(os.environ["REDIS_PORT"]),
                "db": int(os.environ.get("REDIS_DB", "0")),
            },
            "prefix": os.environ.get("QUEUE_PREFIX", "zhixue"),
            "concurrency": 8,
        },
    )
    try:
        while True:
            await asyncio.sleep(1)
    finally:
        await worker.close()


if __name__ == "__main__":
    asyncio.run(main())
