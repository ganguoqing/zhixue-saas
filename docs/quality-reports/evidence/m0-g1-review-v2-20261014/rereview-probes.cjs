// Source-method tests with DB/HTTP doubles; not integration or RLS verification.
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {randomUUID,createHash}=require('node:crypto');
const jwt=require('jsonwebtoken');
const {M0Store}=require(path.resolve('apps/api/dist/store.js'));
const {verifyServiceToken}=require(path.resolve('apps/api/dist/service-auth.js'));
const A='11111111-1111-4111-8111-111111111111';
const Q=randomUUID(), ASSET=randomUUID();
const hash=x=>createHash('sha256').update(x).digest('hex');
const checks=[];
async function record(name,kind,fn){const details=await fn();checks.push({name,kind,...details});}
function instance(){return Object.create(M0Store.prototype)}
function fixture(){
 const job={id:randomUUID(),status:'running',stage:'model_grade',billable:true,current_attempt_id:randomUUID(),current_fencing_epoch:1,input_generation:1,input_hash:hash('input'),occupancy_held:true,cancel_requested:false,current_lease_until:new Date(Date.now()-1000),paper_version_id:randomUUID(),submission_id:randomUUID(),logical_key:'source',binding_id:randomUUID()};
 const calls=[],attempts=[],lease='synthetic-valid-lease-token';
 const client={release(){},async query(sql,args=[]){calls.push({sql,args});const result=rows=>({rows,rowCount:rows.length});
  if(sql.includes('pg_advisory_')||/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)||sql.includes('set_config'))return result([]);
  if(sql.includes('zhixue_ctl.list_capability_dispatches'))return result([]);
  if(sql.includes('zhixue_ctl.list_expired_without_unknown'))return result([{job_id:job.id}]);
  if(sql.includes('zhixue_ctl.job_tenant'))return result([{tenant_id:A}]);
  if(sql.includes('global_execution_occupancy'))return result([{id:1,occupied:1}]);
  if(sql.includes('tenant_execution_occupancy'))return result([{tenant_id:A,occupied:1}]);
  if(sql.includes('SELECT submission_id FROM'))return result([{submission_id:job.submission_id}]);
  if(sql.includes('SELECT id FROM zhixue.submissions'))return result([{id:job.submission_id}]);
  if(sql.includes('FROM zhixue.processing_jobs WHERE id = $1 FOR UPDATE'))return result([{...job}]);
  if(sql.includes('SELECT 1 FROM zhixue.model_invocations'))return result([]);
  if(sql.includes('INSERT INTO zhixue.execution_attempts')){attempts.push(args[1]);return result([]);}
  if(sql.includes('UPDATE zhixue.processing_jobs'))return result([{state_version:'2'}]);
  if(sql.includes('SELECT id FROM zhixue.execution_attempts'))return result([{id:job.current_attempt_id}]);
  if(sql.includes('FROM zhixue.command_receipts'))return result([]);
  if(sql.includes('SELECT lease_token_hash, lease_until'))return result([{lease_token_hash:hash(lease),lease_until:new Date(Date.now()+60000)}]);
  throw Error('unhandled source probe SQL '+sql);
 }};
 const pool={query:client.query.bind(client),async connect(){return client}};
 const store=instance();let queueAdds=0;
 Object.assign(store,{ingress:pool,reconciler:pool,app:pool,config:{env:'dev',maxAttempts:3,leaseSeconds:2,graceSeconds:0},queue:{async add(){queueAdds++}}});
 store.admitAll=async()=>0;
 return {store,job,calls,attempts,lease,queueAdds:()=>queueAdds};
}
(async()=>{
 await record('takeover_creates_attempt_but_reconcile_dispatches_nothing','remaining_defect',async()=>{const f=fixture();const r=await f.store.reconcile();assert.equal(r.takeovers,1);assert.equal(f.attempts.length,1);assert.equal(f.queueAdds(),0);return {takeovers:1,newAttempts:1,workerDispatches:0};});
 await record('model_grade_provider_error_returns_409_and_rolls_back','remaining_defect',async()=>{const f=fixture();f.job.current_lease_until=new Date(Date.now()+60000);await assert.rejects(f.store.accept({jobId:f.job.id,attemptId:f.job.current_attempt_id,fencingEpoch:1,leaseToken:f.lease,generation:1,inputHash:f.job.input_hash,idempotencyKey:randomUUID(),ok:false,outcome:'provider_error',envelope:null}),e=>e.status===409&&e.message==='control_mismatch');assert.ok(f.calls.some(c=>c.sql==='ROLLBACK'));assert.ok(!f.calls.some(c=>c.sql.includes('UPDATE zhixue.processing_jobs')));return {error:'control_mismatch',transaction:'rolled_back',jobNotTerminated:true};});
 const semanticClient={async query(sql,args){let rows;
  if(sql.includes('SELECT id FROM zhixue.paper_questions'))rows=[{id:Q}];
  else if(sql.includes('SELECT asset_id FROM'))rows=[{asset_id:ASSET}];
  else if(sql.includes('COUNT(*)::int'))rows=[{n:1}];
  else if(sql.includes('SELECT max_points'))rows=[{max_points:'1.00'}];
  else throw Error(sql);
  return {rows,rowCount:rows.length};
 }};
 const item=()=>({paper_question_id:Q,suggested_score:'1.00',criterion_awards:[{criterion_id:randomUUID(),awarded_points:'1.00'}],evidence:[{source_asset_id:ASSET,page_index:1,bbox:[0,0,1,1]}]});
 const store=instance();
 await record('duplicate_criterion_overaward_accepted','remaining_defect',async()=>{const i=item();i.criterion_awards.push({...i.criterion_awards[0]});i.suggested_score='2.00';const r=await store.gradeSemantic(semanticClient,A,{paper_version_id:randomUUID(),submission_id:randomUUID()},[i]);assert.equal(r,null);return {rubricMax:'1.00',sameCriterionAwardedTwice:'2.00',semanticError:r};});
 await record('valid_decimal_sum_rejected','remaining_defect',async()=>{const i=item();i.suggested_score='0.30';i.criterion_awards=[{criterion_id:randomUUID(),awarded_points:'0.10'},{criterion_id:randomUUID(),awarded_points:'0.20'}];const r=await store.gradeSemantic(semanticClient,A,{paper_version_id:randomUUID(),submission_id:randomUUID()},[i]);assert.equal(r,'score_mismatch');return {validSum:'0.10+0.20=0.30',semanticError:r};});
 const cfg={workerSecret:'synthetic-worker-key',billingSecret:'synthetic-billing-key',reconcilerSecret:'synthetic-reconciler-key',relaySecret:'synthetic-relay-key',schedulerSecret:'synthetic-scheduler-key'};
 function token(scope='ai.result.accept',opts={}){return jwt.sign({iss:'zhixue-worker',sub:'svc:worker',scope,jti:randomUUID(),...opts},cfg.workerSecret,{audience:'zhixue-internal',expiresIn:'60s'});}
 await record('old_shared_token_rejected_by_new_verifier','fixed_guard_and_CI_incompatibility',async()=>{const old=jwt.sign({scope:'ai.job.claim'},'synthetic-old-shared-secret',{audience:'zhixue-internal',expiresIn:'10m'});assert.throws(()=>verifyServiceToken(cfg,'Bearer '+old,'ai.job.claim',{}),e=>e.status===401);return {status:401};});
 await record('worker_key_cannot_expand_billing_scope','fixed_guard',async()=>{assert.throws(()=>verifyServiceToken(cfg,'Bearer '+token('ai.billing.settle'),'ai.billing.settle',{}),e=>e.status===403);return {status:403};});
 await record('missing_exp_rejected','fixed_guard',async()=>{const t=jwt.sign({iss:'zhixue-worker',sub:'svc:worker',scope:'ai.job.claim',jti:randomUUID()},cfg.workerSecret,{audience:'zhixue-internal'});assert.throws(()=>verifyServiceToken(cfg,'Bearer '+t,'ai.job.claim',{}),e=>e.status===401);return {status:401};});
 await record('token_attempt_mismatch_rejected','fixed_guard',async()=>{assert.throws(()=>verifyServiceToken(cfg,'Bearer '+token('ai.result.accept',{job_id:'job1',attempt_id:'attempt1'}),'ai.result.accept',{jobId:'job1',attemptId:'attempt2'}),e=>e.status===403);return {status:403};});
 await record('possession_of_billing_key_allows_billing_identity','credential_distribution_risk',async()=>{const t=jwt.sign({iss:'zhixue-billing',sub:'svc:billing',scope:'ai.billing.settle',jti:randomUUID(),job_id:'job1'},cfg.billingSecret,{audience:'zhixue-internal',expiresIn:'60s'});assert.equal(verifyServiceToken(cfg,'Bearer '+t,'ai.billing.settle',{jobId:'job1'}).issuer,'zhixue-billing');return {accepted:true,note:'New runner passes the entire multi-service environment to Worker; no production claim'};});
 fs.writeFileSync('rereview-source-results.json',JSON.stringify({evidenceKind:'source_methods_with_doubles_not_DB_integration',checks},null,2));
 console.log(JSON.stringify({checks:checks.length,allExpectedResultsObserved:true}));
})().catch(e=>{console.error(e);process.exitCode=1});
