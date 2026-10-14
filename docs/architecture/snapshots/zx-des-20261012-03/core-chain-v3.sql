-- ZX-DES-20261012-03 illustrative DDL. Not executed. Not a migration.
-- Supersedes the imprecise FK phrases in data-dictionary v2 section 3.
-- Ordinary CHECK cannot read other tables. Cross-row completeness is the
-- publish function plus a seal, not a CHECK.

-- generation and its page set share submission_id.
ALTER TABLE submission_page_sets
  ADD CONSTRAINT uq_page_sets_id
  UNIQUE (tenant_id, submission_id, id);

ALTER TABLE submission_generations
  ADD CONSTRAINT uq_generations_id
  UNIQUE (tenant_id, id, submission_id);

ALTER TABLE submission_generations
  ADD CONSTRAINT fk_generation_page_set
  FOREIGN KEY (tenant_id, submission_id, page_set_id)
  REFERENCES submission_page_sets (tenant_id, submission_id, id)
  MATCH FULL
  ON DELETE RESTRICT
  NOT DEFERRABLE;

-- One participation per exam and student. Roster versions do not mint another.
ALTER TABLE exam_participations
  ADD CONSTRAINT uq_participation_exam_student
  UNIQUE (tenant_id, exam_id, student_id);

ALTER TABLE exam_participations
  ADD CONSTRAINT uq_participation_paper
  UNIQUE (tenant_id, id, exam_id, paper_version_id);

ALTER TABLE exam_roster_entries
  ADD CONSTRAINT uq_roster_entry_id
  UNIQUE (tenant_id, roster_version_id, id, exam_id);

-- Links are immutable. The participation id stays.
ALTER TABLE participation_roster_links
  ADD CONSTRAINT uq_roster_link
  UNIQUE (tenant_id, participation_id, roster_version_id, roster_entry_id);

ALTER TABLE participation_roster_links
  ADD CONSTRAINT fk_link_participation
  FOREIGN KEY (tenant_id, participation_id, exam_id)
  REFERENCES exam_participations (tenant_id, id, exam_id)
  MATCH FULL
  ON DELETE RESTRICT;

ALTER TABLE participation_roster_links
  ADD CONSTRAINT fk_link_entry
  FOREIGN KEY (tenant_id, roster_version_id, roster_entry_id, exam_id)
  REFERENCES exam_roster_entries (tenant_id, roster_version_id, id, exam_id)
  MATCH FULL
  ON DELETE RESTRICT;

-- Immutable match decision. Later generations may point at the same decision.
ALTER TABLE match_decisions
  ADD CONSTRAINT uq_match_decision
  UNIQUE (tenant_id, id, submission_id, exam_id, participation_id, paper_version_id);

ALTER TABLE match_decisions
  ADD CONSTRAINT fk_decision_participation
  FOREIGN KEY (tenant_id, participation_id, exam_id, paper_version_id)
  REFERENCES exam_participations (tenant_id, id, exam_id, paper_version_id)
  MATCH FULL
  ON DELETE RESTRICT;

-- One binding row per generation. It copies the decision, it is not "generation+1" alone.
ALTER TABLE matching_bindings
  ADD CONSTRAINT uq_binding_chain
  UNIQUE (
    tenant_id, id, generation_id, submission_id, match_decision_id,
    exam_id, participation_id, paper_version_id
  );

ALTER TABLE matching_bindings
  ADD CONSTRAINT uq_one_binding_per_generation
  UNIQUE (tenant_id, generation_id);

ALTER TABLE matching_bindings
  ADD CONSTRAINT fk_binding_generation
  FOREIGN KEY (tenant_id, generation_id, submission_id)
  REFERENCES submission_generations (tenant_id, id, submission_id)
  MATCH FULL
  ON DELETE RESTRICT;

ALTER TABLE matching_bindings
  ADD CONSTRAINT fk_binding_decision
  FOREIGN KEY (
    tenant_id, match_decision_id, submission_id, exam_id,
    participation_id, paper_version_id
  )
  REFERENCES match_decisions (
    tenant_id, id, submission_id, exam_id, participation_id, paper_version_id
  )
  MATCH FULL
  ON DELETE RESTRICT;

ALTER TABLE answer_revisions
  ADD CONSTRAINT uq_answer_slot
  UNIQUE (tenant_id, id, participation_id, paper_version_id, paper_question_id);

ALTER TABLE answer_revisions
  ADD CONSTRAINT fk_answer_binding
  FOREIGN KEY (
    tenant_id, binding_id, generation_id, submission_id,
    exam_id, participation_id, paper_version_id
  )
  REFERENCES matching_bindings (
    tenant_id, id, generation_id, submission_id,
    exam_id, participation_id, paper_version_id
  )
  MATCH FULL
  ON DELETE RESTRICT;

ALTER TABLE answer_revisions
  ADD CONSTRAINT fk_answer_question
  FOREIGN KEY (tenant_id, paper_version_id, paper_question_id)
  REFERENCES paper_questions (tenant_id, paper_version_id, id)
  MATCH FULL
  ON DELETE RESTRICT;

ALTER TABLE human_reviews
  ADD CONSTRAINT uq_review_slot
  UNIQUE (tenant_id, id, participation_id, paper_version_id, paper_question_id);

ALTER TABLE human_reviews
  ADD CONSTRAINT fk_review_answer
  FOREIGN KEY (
    tenant_id, answer_revision_id, participation_id,
    paper_version_id, paper_question_id
  )
  REFERENCES answer_revisions (
    tenant_id, id, participation_id, paper_version_id, paper_question_id
  )
  MATCH FULL
  ON DELETE RESTRICT;

ALTER TABLE score_versions
  ADD CONSTRAINT uq_score_version_chain
  UNIQUE (tenant_id, id, participation_id, exam_id, paper_version_id);

ALTER TABLE score_version_items
  ADD CONSTRAINT fk_published_item_version
  FOREIGN KEY (tenant_id, score_version_id, participation_id, exam_id, paper_version_id)
  REFERENCES score_versions (tenant_id, id, participation_id, exam_id, paper_version_id)
  MATCH FULL
  ON DELETE RESTRICT;

ALTER TABLE score_version_items
  ADD CONSTRAINT fk_published_item_slot
  FOREIGN KEY (tenant_id, paper_version_id, paper_question_id)
  REFERENCES paper_questions (tenant_id, paper_version_id, id)
  MATCH FULL
  ON DELETE RESTRICT;

ALTER TABLE score_version_items
  ADD CONSTRAINT fk_published_item_review
  FOREIGN KEY (tenant_id, review_id, participation_id, paper_version_id, paper_question_id)
  REFERENCES human_reviews (tenant_id, id, participation_id, paper_version_id, paper_question_id)
  MATCH FULL
  ON DELETE RESTRICT;

-- queued until Claim: attempt columns stay null. Binding is null only before match.
ALTER TABLE processing_jobs
  ADD CONSTRAINT chk_attempt_until_claim CHECK (
    (claimed_at IS NULL AND current_attempt_id IS NULL AND current_fencing_epoch = 0)
    OR
    (claimed_at IS NOT NULL AND current_attempt_id IS NOT NULL AND current_fencing_epoch >= 1)
  );

ALTER TABLE processing_jobs
  ADD CONSTRAINT chk_binding_by_stage CHECK (
    (stage IN ('validate_asset', 'identity_ocr') AND binding_id IS NULL)
    OR
    (stage IN ('answer_ocr', 'mark_extraction', 'model_grade') AND binding_id IS NOT NULL)
  );

-- App roles have no INSERT on score_versions / score_version_items.
-- zhixue_app has EXECUTE on publish_score_version only.
-- The function inserts every required item, then inserts score_version_seals.
-- BEFORE INSERT on items raises if that version is already sealed.
-- BEFORE DELETE OR UPDATE on items always raises.
-- This is procedural enforcement. A CHECK cannot count sibling items.

-- Legal generation 1 and 2 are described in data-dictionary.md section 5.
-- Counterexamples that these FKs reject are in review-remediation-v3.md R3-01.
