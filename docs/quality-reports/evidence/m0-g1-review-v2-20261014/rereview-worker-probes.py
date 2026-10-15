"""Source-method probes with HTTP doubles; no provider/API network requests."""
import asyncio
import importlib.util
import json
import os
from pathlib import Path
os.environ.update(API_BASE='http://api.test',INFERENCE_URL='http://inference.test',WORKER_JWT_SECRET='synthetic-worker-key')
spec=importlib.util.spec_from_file_location('review_worker','apps/worker/worker.py')
w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
class Response:
 def __init__(self,status,body):self.status_code=status;self.body=body;self.text=json.dumps(body)
 def json(self):return self.body
 def raise_for_status(self):
  if self.status_code>=400:raise RuntimeError('HTTP error')
class Client:
 def __init__(self,status=200,prepared_state='send_unknown'):
  self.calls=[];self.status=status;self.prepared_state=prepared_state
 async def get(self,url,**kw):
  self.calls.append({'method':'GET','route':url.split('.test')[-1]})
  return Response(200,{'assetId':'synthetic-asset','questions':[]})
 async def post(self,url,**kw):
  route=url.split('.test')[-1];self.calls.append({'method':'POST','route':route,'body':kw.get('json')})
  if route=='/internal/jobs/prepare-invocation':return Response(201,{'id':'existing-invocation','send_state':self.prepared_state})
  if route=='/infer':return Response(self.status,{'items':[],'outcome':'accepted','input_hash':'synthetic-hash'})
  return Response(201,{'status':'succeeded'})
async def main():
 claimed={'attemptId':'synthetic-attempt','fencingEpoch':1,'leaseToken':'synthetic-lease','generation':1,'inputHash':'synthetic-hash'}
 results=[]
 for state in ['send_unknown','observed']:
  c=Client(prepared_state=state)
  for _ in range(2):await w.finish(c,{'jobId':'synthetic-job','billable':True},claimed)
  sends=sum(x['route']=='/infer' for x in c.calls)
  permits=sum(x['route']=='/internal/jobs/issue-send-permit' for x in c.calls)
  assert sends==2 and permits==0
  results.append({'name':'existing_'+state+'_reentered','providerRequests':sends,'newPermits':permits,'reproduced':True})
 c=Client(status=500)
 await w.finish(c,{'jobId':'synthetic-job','billable':False},claimed)
 assert c.calls[-1]['body']['ok'] is False
 results.append({'name':'validate_asset_500_no_longer_ok_true','fixedGuard':True})
 c=Client(status=500,prepared_state='not_sent')
 await w.finish(c,{'jobId':'synthetic-job','billable':True},claimed)
 assert c.calls[-1]['body']['envelope'] is None and c.calls[-1]['body']['outcome']=='provider_error'
 assert c.calls[-2]['route']=='/internal/jobs/record-observation'
 results.append({'name':'model_grade_500_observed_then_no_envelope','matches_store_409_counterexample':True,'calls':c.calls})
 c=Client(status=200,prepared_state='not_sent')
 await w.finish(c,{'jobId':'synthetic-job','billable':True},claimed)
 routes=[x['route'] for x in c.calls]
 assert routes.index('/internal/jobs/issue-send-permit')<routes.index('/infer')
 results.append({'name':'fresh_intent_requests_permit_before_provider','fixedOrdering':True})
 Path('rereview-worker-results.json').write_text(json.dumps({'evidenceKind':'source_methods_with_HTTP_doubles_not_provider_integration','checks':results},indent=2))
 print(json.dumps({'checks':len(results),'allExpectedResultsObserved':True}))
asyncio.run(main())
