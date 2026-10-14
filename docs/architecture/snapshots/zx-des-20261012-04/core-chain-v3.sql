-- ZX-DES-20261012-03 illustrative DDL, R4 patch ZX-DES-20261012-04.
-- Not executed. Not a migration.
-- v4 changes: uq_binding_answer_target is the seven-column FK target;
-- match_decisions reference the submission exam and frozen paper;
-- roster links carry student_id on both parent keys.
-- Snapshot of the previous text: snapshots/zx-des-20261012-03/core-chain-v3.sql.
-- An eight-column UNIQUE is not a seven-column foreign-key target.

-- Prerequisite uniques used as FK targets. Partial indexes are not used.

ALTER TABLE paper_questions
  ADD CONSTRAINT uq_paper_question
  UNIQUE (tenant_id, paper_version_id, id);

ALTER TABLE submissions
  ADD CONSTRAINT uq_submission_frozen
  UNIQUE (tenant_id, id, exam_id, frozen_paper_version_id);

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

ALTER TABLE exam_participations
  ADD CONSTRAINT uq_participation_exam_student
  UNIQUE (tenant_id, exam_id, student_id);

ALTER TABLE exam_participations
  ADD CONSTRAINT uq_participation_paper
  UNIQUE (tenant_id, id, exam_id, paper_version_id);

ALTER TABLE exam_participations
  ADD CONSTRAINT uq_participation_id_exam_student
  UNIQUE (tenant_id, id, exam_id, student_id);

ALTER TABLE exam_roster_entries
  ADD CONSTRAINT uq_roster_entry_student
  UNIQUE (tenant_id, roster_version_id, id, exam_id, student_id);

-- student_id is one column on the link. Both parents must contain that same value.
ALTER TABLE participation_roster_links
  ADD CONSTRAINT uq_roster_link
  UNIQUE (tenant_id, participation_id, roster_version_id, roster_entry_id, student_id);

ALTER TABLE participation_roster_links
  ADD CONSTRAINT fk_link_participation
  FOREIGN KEY (tenant_id, participation_id, exam_id, student_id)
  REFERENCES exam_participations (tenant_id, id, exam_id, student_id)
  MATCH FULL
  ON DELETE RESTRICT;

ALTER TABLE participation_roster_links
  ADD CONSTRAINT fk_link_entry
  FOREIGN KEY (tenant_id, roster_version_id, roster_entry_id, exam_id, student_id)
  REFERENCES exam_roster_entries (tenant_id, roster_version_id, id, exam_id, student_id)
  MATCH FULL
  ON DELETE RESTRICT;

ALTER TABLE match_decisions
  ADD CONSTRAINT uq_match_decision
  UNIQUE (tenant_id, id, submission_id, exam_id, participation_id, paper_version_id);

ALTER TABLE match_decisions
  ADD CONSTRAINT fk_decision_participation
  FOREIGN KEY (tenant_id, participation_id, exam_id, paper_version_id)
  REFERENCES exam_participations (tenant_id, id, exam_id, paper_version_id)
  MATCH FULL
  ON DELETE RESTRICT;

ALTER TABLE match_decisions
  ADD CONSTRAINT fk_decision_submission
  FOREIGN KEY (tenant_id, submission_id, exam_id, paper_version_id)
  REFERENCES submissions (tenant_id, id, exam_id, frozen_paper_version_id)
  MATCH FULL
  ON DELETE RESTRICT;

ALTER TABLE matching_bindings
  ADD CONSTRAINT uq_binding_chain
  UNIQUE (
    tenant_id, id, generation_id, submission_id, match_decision_id,
    exam_id, participation_id, paper_version_id
  );

-- Exact target of fk_answer_binding. Not a substitute for uq_binding_chain.
ALTER TABLE matching_bindings
  ADD CONSTRAINT uq_binding_answer_target
  UNIQUE (
    tenant_id, id, generation_id, submission_id,
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

ALTER TABLE score_versions
  ADD CONSTRAINT uq_score_version_pointer
  UNIQUE (tenant_id, participation_id, id);

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

-- First queued and cancel-before-claim use epoch 0.
-- queued_after_claim, running, and awaiting_settlement keep epoch >= 1.
ALTER TABLE processing_jobs
  ADD CONSTRAINT chk_attempt_until_claim CHECK (
    (
      status IN ('queued', 'cancelled')
      AND claimed_at IS NULL
      AND current_attempt_id IS NULL
      AND current_fencing_epoch = 0
    )
    OR
    (
      status <> 'queued'
      AND claimed_at IS NOT NULL
      AND current_attempt_id IS NOT NULL
      AND current_fencing_epoch >= 1
    )
  );

ALTER TABLE processing_jobs
  ADD CONSTRAINT chk_binding_by_stage CHECK (
    (stage IN ('validate_asset', 'identity_ocr') AND binding_id IS NULL)
    OR
    (stage IN ('answer_ocr', 'mark_extraction', 'model_grade') AND binding_id IS NOT NULL)
  );

-- zhixue_app has EXECUTE on publish_score_version and no INSERT on score tables.
-- The function inserts items, then score_version_seals.
-- A later INSERT on a sealed version raises. UPDATE and DELETE of items raise.
-- Ordinary CHECK cannot count sibling rows.

-- FK target index: fk_generation_page_set → uq_page_sets_id;
-- fk_link_participation → uq_participation_id_exam_student;
-- fk_link_entry → uq_roster_entry_student;
-- fk_decision_participation → uq_participation_paper;
-- fk_decision_submission → uq_submission_frozen;
-- fk_binding_generation → uq_generations_id;
-- fk_binding_decision → uq_match_decision;
-- fk_answer_binding → uq_binding_answer_target;
-- fk_answer_question / fk_published_item_slot → uq_paper_question;
-- fk_review_answer → uq_answer_slot;
-- fk_published_item_version → uq_score_version_chain;
-- fk_published_item_review → uq_review_slot;
-- score_current_pointers → uq_score_version_pointer.
