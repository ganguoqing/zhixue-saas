import asyncio
import os
import time

import httpx
import jwt
from bullmq import Worker


def service_token(scope: str) -> str:
    return jwt.encode(
        {"scope": scope, "aud": "zhixue-internal", "iat": int(time.time())},
        os.environ["SERVICE_JWT_SECRET"],
        algorithm="HS256",
    )


def headers(scope: str, idempotency_key: str | None = None) -> dict[str, str]:
    result = {"authorization": f"Bearer {service_token(scope)}"}
    if idempotency_key:
        result["idempotency-key"] = idempotency_key
    return result


async def finish(client: httpx.AsyncClient, data: dict, claimed: dict) -> dict:
    api = os.environ["API_BASE"]
    if data.get("billable"):
        prepared = await client.post(
            f"{api}/internal/jobs/prepare-invocation",
            json={"jobId": data["jobId"], "attemptId": claimed["attemptId"]},
            headers=headers("ai.job.prepare_invocation"),
        )
        prepared.raise_for_status()
        invocation_id = prepared.json()["id"]
        timeout = 0.5 if data.get("delaySeconds") else 5
        try:
            await client.post(
                f"{os.environ['INFERENCE_URL']}/infer",
                json={
                    "job_id": data["jobId"],
                    "input_hash": claimed["inputHash"],
                    "delay_seconds": data.get("delaySeconds"),
                },
                timeout=timeout,
            )
        except httpx.TimeoutException:
            marked = await client.post(
                f"{api}/internal/jobs/mark-send-unknown",
                json={"jobId": data["jobId"], "invocationId": invocation_id},
                headers=headers("ai.invocation.observe"),
            )
            marked.raise_for_status()
            parked = await client.post(
                f"{api}/internal/jobs/park",
                json={"jobId": data["jobId"]},
                headers=headers("reconciler.repair"),
            )
            parked.raise_for_status()
            print(f"parked job_id={data['jobId']}", flush=True)
            return {"parked": True}
    else:
        await client.post(
            f"{os.environ['INFERENCE_URL']}/infer",
            json={"job_id": data["jobId"], "input_hash": claimed["inputHash"], "fail": bool(data.get("fail"))},
            timeout=5,
        )
    accepted = await client.post(
        f"{api}/internal/jobs/accept",
        json={
            "jobId": data["jobId"],
            "attemptId": claimed["attemptId"],
            "fencingEpoch": claimed["fencingEpoch"],
            "leaseToken": claimed["leaseToken"],
            "generation": claimed["generation"],
            "inputHash": claimed["inputHash"],
            "ok": not bool(data.get("fail")),
        },
        headers=headers("ai.result.accept", f"accept:{claimed['attemptId']}"),
    )
    if accepted.status_code >= 400:
        print(f"accept_rejected job_id={data['jobId']} status={accepted.status_code}", flush=True)
        return {"rejected": accepted.status_code}
    print(f"accepted job_id={data['jobId']}", flush=True)
    return accepted.json()


async def process(job, _token):
    data = job.data or {}
    api = os.environ["API_BASE"]
    print(f"received job_id={data.get('jobId')} action={data.get('action', 'execute')}", flush=True)
    async with httpx.AsyncClient(timeout=10, trust_env=False) as client:
        if data.get("action") == "takeover":
            takeover = await client.post(
                f"{api}/internal/jobs/takeover",
                json={"jobId": data["jobId"]},
                headers=headers("reconciler.repair"),
            )
            if takeover.status_code >= 400:
                return {"ignored": True, "status": takeover.status_code}
            body = takeover.json()
            if body.get("status") == "failed_final":
                return body
            return await finish(client, data, body)
        claim = await client.post(
            f"{api}/internal/jobs/claim",
            json={"jobId": data["jobId"], "capability": data.get("capability")},
            headers=headers("ai.job.claim"),
        )
        if claim.status_code >= 400:
            print(
                f"claim_rejected job_id={data.get('jobId')} status={claim.status_code} body={claim.text[:300]}",
                flush=True,
            )
            return {"ignored": True, "status": claim.status_code}
        claimed = claim.json()
        if claimed.get("status") == "failed_final":
            return claimed
        if data.get("stopAfterClaim"):
            os._exit(1)
        return await finish(client, data, claimed)


async def main() -> None:
    worker = Worker(
        "zhixue-jobs",
        process,
        {
            "connection": {
                "host": os.environ["REDIS_HOST"],
                "port": int(os.environ["REDIS_PORT"]),
            },
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
