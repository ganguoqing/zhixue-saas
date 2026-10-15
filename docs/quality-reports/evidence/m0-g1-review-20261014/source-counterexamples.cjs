// Source-logic probes only. Pool doubles are NOT PostgreSQL/RLS integration evidence.
const {M0Store}=require(require('node:path').resolve('apps/api/dist/store.js'));
const {createHash,randomUUID}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const A='11111111-1111-4111-8111-111111111111';
const Q='018f0a3e-7c21-7b2a-8c11-111111111111';
const digest=x=>createHash('sha256').update(x).digest('hex');
const results=[];
function fixture(status='running',stage='model_grade'){
 const calls=[];
 const job={id:randomUUID(),status,result_status:'pending',stage,billable:stage==='model_grade',current_fencing_epoch:1,current_attempt_id:randomUUID(),input_generation:1,input_hash:digest('input'),occupancy_held:false,cancel_requested:false,current_lease_until:new Date(Date.now()+60000),paper_version_id:randomUUID(),submission_id:randomUUID(),logical_key:'source-probe'};
 const leaseToken='source-probe-lease-token';
 const proposals=[];
 const client={release(){},async query(sql,args=[]){
  calls.push({sql,args});
  const result=rows=>({rows,rowCount:rows.length});
  if(/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)||sql.includes('set_config'))return result([]);
  if(sql.includes('SELECT id FROM zhixue.global_execution_occupancy'))return result([{id:1}]);
  if(sql.includes('SELECT tenant_id FROM zhixue.tenant_execution_occupancy'))return result([{tenant_id:A}]);
  if(sql.includes('FROM zhixue.processing_jobs WHERE id = $1 FOR UPDATE'))return result([{...job}]);
  if(sql.includes('zhixue_ctl.job_tenant'))return result([{tenant_id:A}]);
  if(sql.includes('FROM zhixue.command_receipts'))return result([]);
  if(sql.includes('SELECT lease_token_hash, lease_until'))return result([{lease_token_hash:digest(leaseToken),lease_until:new Date(Date.now()+60000)}]);
  if(sql.includes('FROM zhixue.paper_questions'))return result(args[1]===Q?[{found:1}]:[]);
  if(sql.includes('INSERT INTO zhixue.grade_proposals')){proposals.push(JSON.parse(args[3]));return result([]);}
  if(sql.includes('SELECT occupancy_held'))return result([{occupancy_held:false}]);
  if(sql.includes('DELETE FROM zhixue.job_admissions'))return result([]);
  if(sql.includes('UPDATE zhixue.processing_jobs'))return result([{state_version:'2'}]);
  if(sql.includes('INSERT INTO zhixue.command_receipts'))return result([]);
  if(sql.includes('SELECT 1 FROM zhixue.grade_proposals'))return result([]);
  if(sql.includes('INSERT INTO zhixue.answer_revisions')||sql.includes('INSERT INTO zhixue.score_drafts'))return result([]);
  if(sql.includes('COUNT(*)::int AS n FROM zhixue.score_versions'))return result([{n:0}]);
  if(sql.includes('FROM zhixue.model_invocations'))return result([]);
  if(sql.includes('INSERT INTO zhixue.model_invocations'))return result([]);
  if(sql.includes('data_scope_grants'))return result([]); // actor explicitly has no scope
  throw Error('Unhandled source probe query: '+sql);
 }};
 const pool={query:client.query.bind(client),async connect(){return client;}};
 const store=Object.create(M0Store.prototype);
 Object.assign(store,{app:pool,ingress:pool,reconciler:pool,config:{env:'dev',fileMaxBytes:100000}});
 const actor={tenantId:A,userId:randomUUID(),membershipId:randomUUID()};
 const item={paper_question_id:Q,recognized_answer:'synthetic',suggested_score:'1.00',criterion_awards:[{criterion_id:randomUUID(),awarded_points:'1.00'}],evidence:[{source_asset_id:randomUUID(),page_index:1,bbox:[0,0,1,1]}]};
 const envelope={schema_version:'acceptance-envelope/1.0.0',job_id:job.id,attempt_id:job.current_attempt_id,generation:1,fencing_epoch:1,lease_token:leaseToken,input_hash:job.input_hash,invocation_id:randomUUID(),payload:{schema_version:'model-grade-payload/1.0.0',items:[item]}};
 const input={jobId:job.id,attemptId:job.current_attempt_id,fencingEpoch:1,leaseToken,generation:1,inputHash:job.input_hash,idempotencyKey:randomUUID(),envelope};
 return {store,job,calls,proposals,actor,input};
}
async function probe(name,fn){await fn();results.push({name,reproduced:true,evidenceKind:'source_logic_with_pool_doubles'});}
(async()=>{
 await probe('out_of_scope_cancel',async()=>{const f=fixture('queued','validate_asset');const r=await f.store.cancel(f.actor,f.job.id);assert.equal(r.status,'cancelled');assert.equal(f.calls.some(c=>c.sql.includes('data_scope_grants')),false);});
 await probe('out_of_scope_manual_recovery',async()=>{const f=fixture('exception_review');const r=await f.store.manualScore(f.actor,f.job.id);assert.ok(r.draftId);assert.equal(f.calls.some(c=>c.sql.includes('data_scope_grants')),false);});
 await probe('terminal_cancel_reports_cancelled',async()=>{const f=fixture('succeeded','validate_asset');assert.equal((await f.store.cancel(f.actor,f.job.id)).status,'cancelled');});
 await probe('fabricated_invocation_accepted',async()=>{const f=fixture();assert.equal((await f.store.accept(f.input)).status,'succeeded');assert.equal(f.calls.some(c=>c.sql.includes('model_invocations')),false);assert.equal(f.proposals.length,1);});
 await probe('mismatched_envelope_controls_accepted',async()=>{const f=fixture();Object.assign(f.input.envelope,{job_id:randomUUID(),attempt_id:randomUUID(),generation:777,fencing_epoch:777,lease_token:'other-lease-token-123',input_hash:digest('other')});assert.equal((await f.store.accept(f.input)).status,'succeeded');});
 await probe('unknown_second_question_accepted',async()=>{const f=fixture();f.input.envelope.payload.items.push({...f.input.envelope.payload.items[0],paper_question_id:randomUUID()});assert.equal((await f.store.accept(f.input)).status,'succeeded');assert.equal(f.proposals[0].items.length,2);});
 await probe('duplicate_questions_accepted',async()=>{const f=fixture();f.input.envelope.payload.items.push({...f.input.envelope.payload.items[0]});assert.equal((await f.store.accept(f.input)).status,'succeeded');});
 await probe('invalid_evidence_order_and_score_sum_accepted',async()=>{const f=fixture();const i=f.input.envelope.payload.items[0];i.suggested_score='9999.99';i.evidence[0].bbox=[0.9,0.9,0.1,0.1];i.evidence[0].page_index=9999;assert.equal((await f.store.accept(f.input)).status,'succeeded');});
 await probe('prepare_invocation_on_cancelled_job',async()=>{const f=fixture('cancelled');const r=await f.store.prepareInvocation(f.job.id,f.job.current_attempt_id);assert.equal(r.send_state,'not_sent');});
 await probe('orphan_sweep_deletes_inflight_uncommitted_file',async()=>{const f=fixture();const root=path.resolve('sweep-probe');fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'pending-finalize.pdf'),'%PDF synthetic inflight');f.store.config.fileRoot=root;f.store.reconciler={async query(){return {rows:[],rowCount:0}}};assert.equal(await f.store.sweepOrphans(),1);assert.equal(fs.existsSync(path.join(root,'pending-finalize.pdf')),false);});
 fs.writeFileSync('source-counterexamples.json',JSON.stringify({scope:'Source logic only; no database, network, HTTP or RLS verification',results},null,2));
 console.log(JSON.stringify({sourceCounterexamples:results.length,allReproduced:true}));
})().catch(e=>{console.error(e);process.exitCode=1});
