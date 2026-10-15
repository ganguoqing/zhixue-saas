import type { PoolClient } from 'pg';

export async function projectAssetNotice(
  client: PoolClient,
  eventId: string,
  tenantId: string,
  submissionId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO zhixue.asset_notices (event_id, tenant_id, submission_id)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [eventId, tenantId, submissionId],
  );
  await client.query(
    `INSERT INTO zhixue.consumer_inbox (consumer_name, event_id, tenant_id)
     VALUES ('m0-relay', $1, $2)
     ON CONFLICT DO NOTHING`,
    [eventId, tenantId],
  );
}
