-- AlterTable: campos aditivos do follow-up adiado (R11). 'opted_out' e apenas
-- um novo valor textual de cycle_state (VARCHAR), sem alteracao de schema.
ALTER TABLE "follow_up_schedules" ADD COLUMN "deferred" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "deferral_offset_hours" SMALLINT;
