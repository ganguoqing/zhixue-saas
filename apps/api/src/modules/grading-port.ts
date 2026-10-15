import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

function minorUnits(value: string): number | null {
  const match = /^(0|[1-9]\d{0,3})\.(\d{2})$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 100 + Number(match[2]);
}

export async function evaluateGrade(
  client: PoolClient,
  tenantId: string,
  job: { paper_version_id: string | null; submission_id: string },
  items: unknown[],
): Promise<string | null> {
  const questions = await client.query(
    'SELECT id FROM zhixue.paper_questions WHERE tenant_id = $1 AND paper_version_id = $2 ORDER BY id',
    [tenantId, job.paper_version_id],
  );
  const expected = new Set(questions.rows.map((row) => row.id as string));
  const seen = new Set<string>();
  if (items.length !== expected.size) return 'question_set_mismatch';
  const asset = await client.query(
    'SELECT asset_id, page_count, ocr_char_count FROM zhixue.submissions WHERE id = $1',
    [job.submission_id],
  );
  const assetId = asset.rows[0]?.asset_id as string | undefined;
  const pageCount = asset.rows[0]?.page_count as number;
  const ocrChars = asset.rows[0]?.ocr_char_count as number;
  for (const raw of items) {
    const item = raw as {
      paper_question_id: string;
      suggested_score: string;
      criterion_awards: Array<{ criterion_id: string; awarded_points: string }>;
      evidence: Array<{ source_asset_id: string; page_index: number; bbox?: number[]; ocr_span?: { start: number; end: number } }>;
    };
    if (seen.has(item.paper_question_id) || !expected.has(item.paper_question_id)) return 'question_set_mismatch';
    seen.add(item.paper_question_id);
    const criteria = new Set<string>();
    let sum = 0;
    for (const award of item.criterion_awards) {
      if (criteria.has(award.criterion_id)) return 'rubric_duplicate';
      criteria.add(award.criterion_id);
      const points = minorUnits(award.awarded_points);
      if (points === null) return 'score_mismatch';
      const rubric = await client.query(
        `SELECT max_points FROM zhixue.rubric_points
         WHERE paper_version_id = $1 AND question_id = $2 AND criterion_id = $3`,
        [job.paper_version_id, item.paper_question_id, award.criterion_id],
      );
      if (rubric.rowCount !== 1) return 'rubric_mismatch';
      const max = minorUnits(Number(rubric.rows[0].max_points).toFixed(2));
      if (max === null || points > max) return 'rubric_mismatch';
      sum += points;
    }
    const suggested = minorUnits(item.suggested_score);
    if (suggested === null || suggested !== sum) return 'score_mismatch';
    for (const evidence of item.evidence) {
      if (evidence.source_asset_id !== assetId) return 'evidence_asset';
      if (evidence.page_index < 1 || evidence.page_index > pageCount) return 'evidence_page';
      if (evidence.bbox && (evidence.bbox[0] > evidence.bbox[2] || evidence.bbox[1] > evidence.bbox[3])) return 'evidence_bbox';
      if (evidence.ocr_span && (evidence.ocr_span.start >= evidence.ocr_span.end || evidence.ocr_span.end > ocrChars)) {
        return 'evidence_span';
      }
    }
  }
  return null;
}

export async function insertGradeProposal(
  client: PoolClient,
  tenantId: string,
  jobId: string,
  payload: unknown,
): Promise<void> {
  await client.query(
    `INSERT INTO zhixue.grade_proposals (tenant_id, id, job_id, status, payload)
     VALUES ($1, $2, $3, 'review_required', $4::jsonb)`,
    [tenantId, randomUUID(), jobId, JSON.stringify(payload)],
  );
}
