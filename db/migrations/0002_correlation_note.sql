-- Compatible column added after 0001. Used to prove upgrade from the previous schema.
SET ROLE zhixue_owner;
ALTER TABLE zhixue.submissions ADD COLUMN IF NOT EXISTS correlation_note text;
RESET ROLE;
