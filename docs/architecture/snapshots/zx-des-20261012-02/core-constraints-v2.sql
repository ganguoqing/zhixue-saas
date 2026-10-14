-- ZX-DES-20261012-02
-- Proposed / illustrative SQL. Not an executed migration and not evidence.
-- PostgreSQL 16 syntax. Translate only after ADR-001/006 are accepted.

-- Required parent: all columns NOT NULL, MATCH FULL, target UNIQUE matches exactly.
-- Optional parent: MATCH SIMPLE. tenant_id stays NOT NULL via its own tenants FK.
--   MIXED NULL is legal under MATCH SIMPLE and is NOT legal under MATCH FULL.
-- Global catalog FKs do not include tenant_id.

-- Example: school question has NULL owner; teacher question has owner in the same tenant.
-- (tenant_id NOT NULL, owner_membership_id NULL) must succeed.

ALTER TABLE questions
  ADD CONSTRAINT questions_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants (id)
  MATCH SIMPLE
  ON DELETE RESTRICT;

ALTER TABLE questions
  ADD CONSTRAINT questions_owner_fk
  FOREIGN KEY (tenant_id, owner_membership_id)
  REFERENCES tenant_memberships (tenant_id, id)
  MATCH SIMPLE
  ON DELETE RESTRICT;

ALTER TABLE questions
  ADD CONSTRAINT questions_owner_shape CHECK (
    (visibility = 'school' AND owner_membership_id IS NULL)
    OR (visibility = 'teacher' AND owner_membership_id IS NOT NULL)
  );

-- Global catalog reference. No tenant column in this key.
ALTER TABLE grades
  ADD CONSTRAINT grades_level_fk
  FOREIGN KEY (grade_level_id) REFERENCES grade_levels (id)
  MATCH SIMPLE
  ON DELETE RESTRICT;

-- Student import has no exam. Score import must have one.
ALTER TABLE import_batches
  ADD CONSTRAINT import_batches_exam_fk
  FOREIGN KEY (tenant_id, exam_id) REFERENCES exams (tenant_id, id)
  MATCH SIMPLE
  ON DELETE RESTRICT;

ALTER TABLE import_batches
  ADD CONSTRAINT import_batches_exam_shape CHECK (
    (batch_kind = 'students' AND exam_id IS NULL)
    OR (batch_kind IN ('score_total', 'score_itemized') AND exam_id IS NOT NULL)
  );

-- Roster identity is the version, not the exam+student pair across versions.
ALTER TABLE exam_roster_versions
  ADD CONSTRAINT roster_versions_exam_fk
  FOREIGN KEY (tenant_id, exam_id) REFERENCES exams (tenant_id, id)
  MATCH FULL
  ON DELETE RESTRICT;

ALTER TABLE exam_roster_versions
  ADD CONSTRAINT roster_versions_target
  UNIQUE (tenant_id, id, exam_id);

ALTER TABLE exam_roster_entries
  ADD CONSTRAINT roster_entries_version_fk
  FOREIGN KEY (tenant_id, roster_version_id, exam_id)
  REFERENCES exam_roster_versions (tenant_id, id, exam_id)
  MATCH FULL
  ON DELETE RESTRICT;

ALTER TABLE exam_roster_entries
  ADD CONSTRAINT roster_entries_student_in_version
  UNIQUE (tenant_id, roster_version_id, student_id);

ALTER TABLE exam_roster_entries
  ADD CONSTRAINT roster_entries_id_in_version
  UNIQUE (tenant_id, roster_version_id, id);

-- Pages are unique inside a page set, so page 1 can exist again in the next set.
ALTER TABLE submission_pages
  ADD CONSTRAINT submission_pages_in_set
  UNIQUE (tenant_id, page_set_id, page_index);

ALTER TABLE submission_pages
  ADD CONSTRAINT submission_pages_set_fk
  FOREIGN KEY (tenant_id, page_set_id) REFERENCES submission_page_sets (tenant_id, id)
  MATCH FULL
  ON DELETE RESTRICT;

-- Published score facts only. Drafts live in score_drafts and are not FK targets.
ALTER TABLE score_versions
  ADD CONSTRAINT score_versions_participation_id
  UNIQUE (tenant_id, participation_id, id);

ALTER TABLE score_current_pointers
  ADD CONSTRAINT score_pointers_published_fk
  FOREIGN KEY (tenant_id, participation_id, score_version_id)
  REFERENCES score_versions (tenant_id, participation_id, id)
  MATCH FULL
  ON DELETE RESTRICT;

-- basis shapes. Published items are immutable; this CHECK is on insert.
ALTER TABLE score_versions
  ADD CONSTRAINT score_versions_basis_shape CHECK (
    (basis_mode = 'itemized' AND total_score IS NOT NULL AND confirmation_id IS NOT NULL)
    OR (basis_mode = 'total_only' AND total_score IS NOT NULL AND confirmation_id IS NOT NULL)
    OR (basis_mode = 'absent' AND total_score IS NULL AND confirmation_id IS NOT NULL)
    OR (basis_mode = 'attribution_corrected_away' AND total_score IS NULL AND confirmation_id IS NOT NULL)
  );
