import { randomUUID } from 'node:crypto';
import {
  Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Req, Res, StreamableFile,
} from '@nestjs/common';
import jwt from 'jsonwebtoken';
import type { AppConfig } from './config';
import { verifyServiceToken } from './service-auth';
import { log } from './logger';
import { ApiError, M0Store } from './store';

interface Member {
  userId: string;
  tenantId: string;
  membershipId: string;
  role: 'member';
}

export const APP_CONFIG = Symbol('APP_CONFIG');

@Controller()
export class M0Controller {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly store: M0Store,
  ) {}

  @Get('/health')
  health() {
    return this.store.health();
  }

  @Post('/api/session')
  @HttpCode(200)
  async session(@Body() body: { email?: string; password?: string }) {
    const result = await this.store.login(body.email ?? '', body.password ?? '');
    const token = jwt.sign(result.tokenInput, this.config.userSecret, {
      audience: 'zhixue-app',
      expiresIn: '8h',
    });
    return { token };
  }

  @Get('/api/submissions/:id')
  submission(@Headers('authorization') authorization: string | undefined, @Param('id') id: string) {
    return this.store.submission(this.member(authorization), id);
  }

  @Get('/api/assets/:id/content')
  async asset(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void },
  ) {
    const file = await this.store.assetBytes(this.member(authorization), id);
    response.setHeader('content-type', file.mediaType);
    response.setHeader('content-length', String(file.bytes.length));
    return new StreamableFile(Uint8Array.from(file.bytes));
  }

  @Get('/api/jobs/:id')
  job(@Headers('authorization') authorization: string | undefined, @Param('id') id: string) {
    return this.store.jobView(this.member(authorization), id);
  }

  @Post('/api/uploads/finalize')
  @HttpCode(200)
  finalize(
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Headers('x-test-crash') crash: string | undefined,
    @Headers('x-test-tenant-cap') tenantCap: string | undefined,
    @Headers('x-test-global-cap') globalCap: string | undefined,
    @Headers('x-test-fail') fail: string | undefined,
    @Headers('x-test-stop-after-claim') stopAfterClaim: string | undefined,
    @Headers('x-test-kill') kill: string | undefined,
    @Headers('x-test-provider-mode') providerMode: string | undefined,
    @Headers('x-test-upload-lease') uploadLease: string | undefined,
    @Body() body: { contentBase64?: string; classId?: string; subjectId?: string; tenantId?: string },
    @Req() request: { header(name: string): string | undefined },
  ) {
    const actor = this.member(authorization);
    if (body.tenantId && body.tenantId !== actor.tenantId) throw new ApiError(403, 'forged_tenant');
    if (!idempotencyKey || !body.contentBase64 || !body.classId || !body.subjectId) {
      throw new ApiError(400, 'missing_fields');
    }
    const hooks = this.config.testHooks;
    return this.store.finalize(actor, {
      contentBase64: body.contentBase64,
      classId: body.classId,
      subjectId: body.subjectId,
      idempotencyKey,
      correlationId: correlationId || randomUUID(),
      crash: hooks ? crash : undefined,
      caps: hooks && tenantCap && globalCap
        ? { tenant: Number(tenantCap), global: Number(globalCap) }
        : undefined,
      hints: hooks ? {
        fail: fail === '1',
        stopAfterClaim: stopAfterClaim === '1' || kill === 'after-claim',
        killAfterPermit: kill === 'after-permit',
        killAfterHttp: kill === 'after-http',
        killAfterObserve: kill === 'after-observe',
        uploadLeaseSeconds: uploadLease ? Number(uploadLease) : undefined,
        providerMode,
      } : undefined,
    }).finally(() => {
      log('http_finalize', { correlationId: request.header('x-correlation-id') ?? null });
    });
  }

  @Post('/api/jobs/:id/cancel')
  cancel(@Headers('authorization') authorization: string | undefined, @Param('id') id: string) {
    return this.store.cancel(this.member(authorization), id);
  }

  @Post('/api/jobs/:id/manual-score')
  manual(@Headers('authorization') authorization: string | undefined, @Param('id') id: string) {
    return this.store.manualScore(this.member(authorization), id);
  }

  @Get('/ops/usage')
  usage(@Headers('authorization') authorization: string | undefined) {
    this.platform(authorization);
    return this.store.opsUsage();
  }

  @Post('/internal/jobs/claim')
  async claim(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { jobId?: string; capability?: string; tenantId?: string },
  ) {
    await this.service(authorization, 'ai.job.claim', body);
    if (!body.jobId || !body.capability) throw new ApiError(400, 'missing_fields');
    return this.store.claim(body.jobId, body.capability);
  }

  @Post('/internal/jobs/accept')
  async accept(
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: {
      jobId?: string; attemptId?: string; fencingEpoch?: number; leaseToken?: string;
      generation?: number; inputHash?: string; ok?: boolean; tenantId?: string; envelope?: unknown;
    },
    @Res({ passthrough: true }) response: { status(code: number): void },
  ) {
    await this.service(authorization, 'ai.result.accept', body);
    if (!body.jobId || !body.attemptId || !body.leaseToken || !idempotencyKey) {
      throw new ApiError(400, 'missing_fields');
    }
    const result = await this.store.accept({
      jobId: body.jobId,
      attemptId: body.attemptId,
      fencingEpoch: Number(body.fencingEpoch),
      leaseToken: body.leaseToken,
      generation: Number(body.generation),
      inputHash: body.inputHash ?? '',
      ok: body.ok,
      outcome: (body as { outcome?: string }).outcome,
      tenantId: body.tenantId,
      idempotencyKey,
      envelope: body.envelope,
    });
    if (result.error) throw new ApiError(422, String(result.error));
    if (result.replay === true) {
      response.status(200);
      delete result.replay;
    }
    return result;
  }

  @Post('/internal/jobs/prepare-invocation')
  async prepare(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { jobId?: string; attemptId?: string },
  ) {
    await this.service(authorization, 'ai.job.prepare_invocation', body);
    if (!body.jobId || !body.attemptId) throw new ApiError(400, 'missing_fields');
    return this.store.prepareInvocation(body.jobId, body.attemptId);
  }

  @Post('/internal/jobs/mark-send-unknown')
  async markUnknown(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { jobId?: string; invocationId?: string },
  ) {
    await this.service(authorization, 'ai.invocation.observe', body);
    if (!body.jobId || !body.invocationId) throw new ApiError(400, 'missing_fields');
    return this.store.markSendUnknown(body.jobId, body.invocationId);
  }

  @Post('/internal/jobs/park')
  async park(@Headers('authorization') authorization: string | undefined, @Body() body: { jobId?: string }) {
    await this.service(authorization, 'reconciler.repair', body);
    if (!body.jobId) throw new ApiError(400, 'missing_fields');
    return this.store.park(body.jobId);
  }

  @Post('/internal/jobs/abandon-unknown')
  async abandon(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { jobId?: string; invocationId?: string; reason?: string },
  ) {
    await this.service(authorization, 'ai.billing.settle', body);
    if (!body.jobId || !body.invocationId) throw new ApiError(400, 'missing_fields');
    return this.store.abandon(body.jobId, body.invocationId, body.reason ?? '');
  }

  @Post('/internal/jobs/record-settlement')
  async settle(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { jobId?: string; invocationId?: string; amount?: string; key?: string },
  ) {
    await this.service(authorization, 'ai.billing.settle', body);
    if (!body.jobId || !body.invocationId || !body.amount || !body.key) throw new ApiError(400, 'missing_fields');
    return this.store.recordSettlement(body.jobId, body.invocationId, body.amount, body.key);
  }

  @Post('/internal/jobs/close-unproven')
  async close(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { jobId?: string; expectedGeneration?: number },
  ) {
    await this.service(authorization, 'reconciler.repair', body);
    if (!body.jobId) throw new ApiError(400, 'missing_fields');
    return this.store.closeUnproven(body.jobId, body.expectedGeneration);
  }

  @Post('/internal/jobs/takeover')
  async takeover(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-test-crash') crash: string | undefined,
    @Body() body: { jobId?: string },
  ) {
    await this.service(authorization, 'reconciler.repair', body);
    if (!body.jobId) throw new ApiError(400, 'missing_fields');
    return this.store.takeover(body.jobId, this.config.testHooks ? crash : undefined);
  }

  @Post('/internal/reconcile')
  async reconcile(@Headers('authorization') authorization: string | undefined) {
    await this.service(authorization, 'reconciler.repair');
    return this.store.reconcile();
  }

  @Post('/internal/relay')
  async relay(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-test-crash') crash: string | undefined,
  ) {
    await this.service(authorization, 'relay.deliver');
    return this.store.relayOnce(this.config.testHooks ? crash : undefined);
  }

  @Post('/internal/orphans/sweep')
  async sweep(@Headers('authorization') authorization: string | undefined) {
    await this.service(authorization, 'reconciler.repair');
    return this.store.sweepOrphans();
  }

  @Get('/internal/metrics')
  async metrics(@Headers('authorization') authorization: string | undefined) {
    await this.service(authorization, 'reconciler.repair');
    return this.store.metrics();
  }

  @Get('/internal/identity')
  async identity(@Headers('authorization') authorization: string | undefined) {
    await this.service(authorization, 'ai.job.claim');
    return this.store.ingressIdentity();
  }

  @Get('/internal/occupancy')
  async occupancy(@Headers('authorization') authorization: string | undefined) {
    await this.service(authorization, 'scheduler.admit');
    return this.store.occupancy();
  }

  @Post('/internal/jobs/stage-failure')
  async stageFailure(
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: {
      jobId?: string; attemptId?: string; invocationId?: string; failureCode?: string;
      providerStatus?: number; fencingEpoch?: number; generation?: number; inputHash?: string; leaseToken?: string;
    },
  ) {
    await this.service(authorization, 'ai.result.accept', body);
    if (!body.jobId || !body.attemptId || !body.failureCode || !idempotencyKey || !body.leaseToken || !body.inputHash) {
      throw new ApiError(400, 'missing_fields');
    }
    return this.store.recordStageFailure({
      jobId: body.jobId,
      attemptId: body.attemptId,
      invocationId: body.invocationId,
      failureCode: body.failureCode,
      providerStatus: body.providerStatus,
      fencingEpoch: Number(body.fencingEpoch),
      generation: Number(body.generation),
      inputHash: body.inputHash,
      leaseToken: body.leaseToken,
      idempotencyKey,
    });
  }

  @Post('/internal/jobs/continue')
  async continueAttempt(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { jobId?: string; capability?: string; leaseToken?: string },
  ) {
    await this.service(authorization, 'ai.job.claim', body);
    if (!body.jobId || !body.capability || !body.leaseToken) throw new ApiError(400, 'missing_fields');
    return this.store.continueAttempt(body.jobId, body.capability, body.leaseToken);
  }

  @Post('/internal/jobs/issue-send-permit')
  async permit(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { jobId?: string; attemptId?: string; invocationId?: string },
  ) {
    await this.service(authorization, 'ai.invocation.issue_permit', body);
    if (!body.jobId || !body.attemptId || !body.invocationId) throw new ApiError(400, 'missing_fields');
    return this.store.issueSendPermit(body.jobId, body.attemptId, body.invocationId);
  }

  @Post('/internal/jobs/record-observation')
  async observe(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { jobId?: string; attemptId?: string; invocationId?: string; providerStatus?: number },
  ) {
    await this.service(authorization, 'ai.invocation.observe', body);
    if (!body.jobId || !body.attemptId || !body.invocationId || body.providerStatus === undefined) {
      throw new ApiError(400, 'missing_fields');
    }
    return this.store.recordObservation(body.jobId, body.attemptId, body.invocationId, body.providerStatus, (body as { responseBody?: unknown }).responseBody);
  }

  @Get('/internal/jobs/:id/frozen')
  async frozen(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
  ) {
    await this.service(authorization, 'ai.job.read_frozen', { jobId: id });
    return this.store.frozenFixture(id);
  }

  @Post('/internal/test/billable-job')
  billable(
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-test-delay') delayHeader: string | undefined,
    @Headers('x-test-kill') kill: string | undefined,
    @Headers('x-test-provider-mode') providerMode: string | undefined,
    @Headers('x-test-fail') fail: string | undefined,
  ) {
    if (!this.config.testHooks) throw new ApiError(404, 'not_found');
    const delay = delayHeader === undefined ? 3 : Number(delayHeader);
    return this.store.createBillable(
      this.member(authorization),
      idempotencyKey || randomUUID(),
      Number.isFinite(delay) ? delay : 3,
      {
        stopAfterClaim: kill === 'after-claim',
        killAfterPermit: kill === 'after-permit',
        killAfterHttp: kill === 'after-http',
        killAfterObserve: kill === 'after-observe',
        providerMode,
        fail: fail === '1',
      },
    );
  }

  private member(authorization: string | undefined): Member {
    const decoded = this.verifyUser(authorization);
    if (decoded.role !== 'member' || !decoded.tenantId || !decoded.membershipId || !decoded.sub) {
      throw new ApiError(403, 'member_required');
    }
    return {
      userId: String(decoded.sub),
      tenantId: String(decoded.tenantId),
      membershipId: String(decoded.membershipId),
      role: 'member',
    };
  }

  private platform(authorization: string | undefined): void {
    const decoded = this.verifyUser(authorization);
    if (decoded.role !== 'platform') throw new ApiError(403, 'platform_required');
  }

  private verifyUser(authorization: string | undefined): jwt.JwtPayload {
    if (!authorization?.startsWith('Bearer ')) throw new ApiError(401, 'unauthorized');
    try {
      return jwt.verify(authorization.slice(7), this.config.userSecret, { audience: 'zhixue-app' }) as jwt.JwtPayload;
    } catch {
      throw new ApiError(401, 'unauthorized');
    }
  }

  private async service(
    authorization: string | undefined,
    scope: string,
    body: { jobId?: string; attemptId?: string } = {},
  ): Promise<void> {
    const identity = verifyServiceToken(this.config, authorization, scope, body);
    await this.store.consumeJti(identity.issuer, identity.jti, identity.subject);
  }
}
