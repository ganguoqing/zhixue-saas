import jwt from 'jsonwebtoken';
import type { AppConfig } from './config';
import { ApiError } from './store';

export interface ServiceIdentity {
  issuer: string;
  subject: string;
  scope: string;
  jti: string;
  jobId?: string;
  attemptId?: string;
}

const POLICIES: Record<string, { secret: keyof AppConfig; subject: string; scopes: string[] }> = {
  'zhixue-worker': {
    secret: 'workerSecret',
    subject: 'svc:worker',
    scopes: [
      'ai.job.claim',
      'ai.job.prepare_invocation',
      'ai.invocation.issue_permit',
      'ai.invocation.observe',
      'ai.result.accept',
      'ai.job.read_frozen',
    ],
  },
  'zhixue-reconciler': {
    secret: 'reconcilerSecret',
    subject: 'svc:reconciler',
    scopes: ['reconciler.repair', 'reconciler.metrics', 'reconciler.sweep'],
  },
  'zhixue-scheduler': {
    secret: 'schedulerSecret',
    subject: 'svc:scheduler',
    scopes: ['scheduler.admit'],
  },
  'zhixue-relay': {
    secret: 'relaySecret',
    subject: 'svc:relay',
    scopes: ['relay.deliver'],
  },
  'zhixue-billing': {
    secret: 'billingSecret',
    subject: 'svc:billing',
    scopes: ['ai.billing.settle'],
  },
};

export function verifyServiceToken(
  config: AppConfig,
  authorization: string | undefined,
  scope: string,
  body: { jobId?: string; attemptId?: string },
): ServiceIdentity {
  if (!authorization?.startsWith('Bearer ')) throw new ApiError(401, 'unauthorized');
  const token = authorization.slice(7);
  const decodedUnsafe = jwt.decode(token);
  if (!decodedUnsafe || typeof decodedUnsafe === 'string') throw new ApiError(401, 'unauthorized');
  const issuer = String(decodedUnsafe.iss ?? '');
  const policy = POLICIES[issuer];
  if (!policy) throw new ApiError(401, 'unauthorized');
  let decoded: jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, String(config[policy.secret]), {
      audience: 'zhixue-internal',
      issuer,
    }) as jwt.JwtPayload;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(401, 'unauthorized');
  }
  if (decoded.sub !== policy.subject) throw new ApiError(401, 'unauthorized');
  if (!decoded.exp || !decoded.jti) throw new ApiError(401, 'unauthorized');
  const scopes = String(decoded.scope ?? '').split(/\s+/);
  if (!scopes.includes(scope) || !policy.scopes.includes(scope)) throw new ApiError(403, 'scope_denied');
  const jobId = decoded.job_id ? String(decoded.job_id) : undefined;
  const attemptId = decoded.attempt_id ? String(decoded.attempt_id) : undefined;
  if (jobId && body.jobId && jobId !== body.jobId) throw new ApiError(403, 'job_mismatch');
  if (attemptId && body.attemptId && attemptId !== body.attemptId) throw new ApiError(403, 'attempt_mismatch');
  return {
    issuer,
    subject: policy.subject,
    scope,
    jti: String(decoded.jti),
    jobId,
    attemptId,
  };
}
