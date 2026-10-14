import { randomUUID } from 'node:crypto';
import {
  Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Req, Res,
} from '@nestjs/common';
import jwt from 'jsonwebtoken';
import type { AppConfig } from './config';
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
    return file.bytes;
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
      hints: hooks ? { fail: fail === '1', stopAfterClaim: stopAfterClaim === '1' } : undefined,
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
  claim(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { jobId?: string; capability?: string; tenantId?: string },
  ) {
    this.service(authorization, 'ai.job.claim');
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
    this.service(authorization, 'ai.result.accept');
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
  prepare(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { jobId?: string; attemptId?: string },
  ) {
    this.service(authorization, 'ai.job.prepare_invocation');
    if (!body.jobId || !body.attemptId) throw new ApiError(400, 'missing_fields');
    return this.store.prepareInvocation(body.jobId, body.attemptId);
  }

  @Post('/internal/jobs/mark-send-unknown')
  markUnknown(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { jobId?: string; invocationId?: string },
  ) {
    this.service(authorization, 'ai.invocation.observe');
    if (!body.jobId || !body.invocationId) throw new ApiError(400, 'missing_fields');
    return this.store.markSendUnknown(body.jobId, body.invocationId);
  }

  @Post('/internal/jobs/park')
  park(@Headers('authorization') authorization: string | undefined, @Body() body: { jobId?: string }) {
    this.service(authorization, 'reconciler.repair');
    if (!body.jobId) throw new ApiError(400, 'missing_fields');
    return this.store.park(body.jobId);
  }

  @Post('/internal/jobs/abandon-unknown')
  abandon(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { jobId?: string; invocationId?: string; reason?: string },
  ) {
    this.service(authorization, 'ai.billing.settle');
    if (!body.jobId || !body.invocationId) throw new ApiError(400, 'missing_fields');
    return this.store.abandon(body.jobId, body.invocationId, body.reason ?? '');
  }

  @Post('/internal/jobs/record-settlement')
  settle(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { jobId?: string; invocationId?: string; amount?: string; key?: string },
  ) {
    this.service(authorization, 'ai.billing.settle');
    if (!body.jobId || !body.invocationId || !body.amount || !body.key) throw new ApiError(400, 'missing_fields');
    return this.store.recordSettlement(body.jobId, body.invocationId, body.amount, body.key);
  }

  @Post('/internal/jobs/close-unproven')
  close(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { jobId?: string; expectedGeneration?: number },
  ) {
    this.service(authorization, 'reconciler.repair');
    if (!body.jobId) throw new ApiError(400, 'missing_fields');
    return this.store.closeUnproven(body.jobId, body.expectedGeneration);
  }

  @Post('/internal/jobs/takeover')
  takeover(@Headers('authorization') authorization: string | undefined, @Body() body: { jobId?: string }) {
    this.service(authorization, 'reconciler.repair');
    if (!body.jobId) throw new ApiError(400, 'missing_fields');
    return this.store.takeover(body.jobId);
  }

  @Post('/internal/reconcile')
  reconcile(@Headers('authorization') authorization: string | undefined) {
    this.service(authorization, 'reconciler.repair');
    return this.store.reconcile();
  }

  @Post('/internal/relay')
  relay(@Headers('authorization') authorization: string | undefined) {
    this.service(authorization, 'relay.dispatch');
    return this.store.relayOnce();
  }

  @Post('/internal/orphans/sweep')
  sweep(@Headers('authorization') authorization: string | undefined) {
    this.service(authorization, 'reconciler.repair');
    return this.store.sweepOrphans();
  }

  @Get('/internal/metrics')
  metrics(@Headers('authorization') authorization: string | undefined) {
    this.service(authorization, 'reconciler.repair');
    return this.store.metrics();
  }

  @Get('/internal/identity')
  identity(@Headers('authorization') authorization: string | undefined) {
    this.service(authorization, 'ai.job.claim');
    return this.store.ingressIdentity();
  }

  @Get('/internal/occupancy')
  occupancy(@Headers('authorization') authorization: string | undefined) {
    this.service(authorization, 'scheduler.admit');
    return this.store.occupancy();
  }

  @Post('/internal/test/billable-job')
  billable(
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    if (!this.config.testHooks) throw new ApiError(404, 'not_found');
    return this.store.createBillable(this.member(authorization), idempotencyKey || randomUUID());
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

  private service(authorization: string | undefined, scope: string): void {
    if (!authorization?.startsWith('Bearer ')) throw new ApiError(401, 'unauthorized');
    try {
      const decoded = jwt.verify(authorization.slice(7), this.config.serviceSecret, {
        audience: 'zhixue-internal',
      }) as jwt.JwtPayload;
      const scopes = String(decoded.scope ?? '').split(/\s+/);
      if (!scopes.includes(scope)) throw new ApiError(403, 'scope_denied');
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(401, 'unauthorized');
    }
  }
}
