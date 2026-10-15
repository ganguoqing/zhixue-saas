"""Actual Worker.finish with HTTP doubles. This is not a provider integration test."""
import asyncio
import importlib.util
import json
import os
from pathlib import Path
os.environ.update(API_BASE='http://api.test',INFERENCE_URL='http://inference.test',SERVICE_JWT_SECRET='synthetic-only-test-secret')
spec=importlib.util.spec_from_file_location('worker_under_review','apps/worker/worker.py')
worker=importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
class Response:
 def __init__(self,status,payload): self.status_code=status;self.payload=payload
 def json(self): return self.payload
 def raise_for_status(self):
  if self.status_code>=400: raise RuntimeError('HTTP failure')
class Client:
 def __init__(self,infer_status=200):self.calls=[];self.infer_status=infer_status
 async def post(self,url,**kw):
  route=url.split('.test')[-1];self.calls.append({'route':route,'json':kw.get('json')})
  if route=='/internal/jobs/prepare-invocation': return Response(201,{'id':'synthetic-invocation'})
  if route=='/infer':return Response(self.infer_status,{'error':'provider_failure'} if self.infer_status>=400 else {'adapter':'mock'})
  return Response(201,{'status':'succeeded'})
async def main():
 claimed=dict(attemptId='synthetic-attempt',fencingEpoch=1,leaseToken='synthetic-lease',generation=1,inputHash='synthetic-hash')
 failure=Client(500)
 await worker.finish(failure,{'jobId':'synthetic-job','billable':False},claimed)
 assert failure.calls[-1]['route']=='/internal/jobs/accept'
 assert failure.calls[-1]['json']['ok'] is True
 paid=Client(200)
 await worker.finish(paid,{'jobId':'synthetic-job','billable':True},claimed)
 routes=[c['route'] for c in paid.calls]
 assert routes==['/internal/jobs/prepare-invocation','/infer','/internal/jobs/accept']
 assert 'envelope' not in paid.calls[-1]['json']
 claims=worker.jwt.decode(worker.service_token('ai.billing.settle reconciler.repair'),'synthetic-only-test-secret',algorithms=['HS256'],audience='zhixue-internal')
 assert 'exp' not in claims
 Path('worker-counterexamples.json').write_text(json.dumps({'scope':'Source logic only with HTTP doubles; no provider requests', 'provider_http_500_sent_to_accept_as_ok_true':failure.calls, 'billable_HTTP_without_precommitted_send_permit':paid.calls,'worker_can_mint_billing_and_reconciler_scopes':True,'worker_token_has_expiration':False},indent=2))
 print('Worker source probes reproduced; no provider or service network used')
asyncio.run(main())
