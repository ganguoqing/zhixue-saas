import type { PoolClient } from 'pg';

export async function claimObjectReclaim(client: PoolClient, key: string): Promise<boolean> {
  const decision = await client.query(
    'SELECT zhixue_ctl.claim_object_reclaim($1) AS reclaim',
    [key],
  );
  return decision.rows[0]?.reclaim === true;
}
