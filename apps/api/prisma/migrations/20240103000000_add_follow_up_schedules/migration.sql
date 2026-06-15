-- CreateTable
CREATE TABLE "follow_up_schedules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "cycle_state" VARCHAR(20) NOT NULL DEFAULT 'active',
    "inactivity_anchor" TIMESTAMP(3) NOT NULL,
    "max_sent_level" SMALLINT NOT NULL DEFAULT 0,
    "pending_level" SMALLINT,
    "next_run_at" TIMESTAMP(3),
    "level3_fired_at" TIMESTAMP(3),
    "locked_until" TIMESTAMP(3),
    "deferred_attempts" SMALLINT NOT NULL DEFAULT 0,
    "last_error" VARCHAR(2000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "follow_up_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (uma linha por conversa: sem ciclos concorrentes)
CREATE UNIQUE INDEX "follow_up_schedules_conversation_id_key" ON "follow_up_schedules"("conversation_id");

-- CreateIndex (selecao eficiente dos vencidos pelo poll)
CREATE INDEX "follow_up_schedules_cycle_state_next_run_at_idx" ON "follow_up_schedules"("cycle_state", "next_run_at");

-- CreateIndex (varredura da janela de encerramento do Nivel 3)
CREATE INDEX "follow_up_schedules_cycle_state_level3_fired_at_idx" ON "follow_up_schedules"("cycle_state", "level3_fired_at");

-- AddForeignKey
ALTER TABLE "follow_up_schedules" ADD CONSTRAINT "follow_up_schedules_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
