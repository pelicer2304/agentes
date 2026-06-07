-- AlterTable (additive only — all new columns nullable or defaulted to preserve Playground data)
ALTER TABLE "conversations" ADD COLUMN     "instance_name" VARCHAR(100),
ADD COLUMN     "external_chat_id" VARCHAR(100),
ADD COLUMN     "bot_paused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "assigned_to" UUID,
ADD COLUMN     "handoff_offered" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "handoff_accepted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "handoff_completed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_inbound_at" TIMESTAMP(3),
ADD COLUMN     "last_outbound_at" TIMESTAMP(3);

-- AlterTable (additive only — all new columns nullable to preserve Playground data)
ALTER TABLE "messages" ADD COLUMN     "external_message_id" VARCHAR(128),
ADD COLUMN     "external_chat_id" VARCHAR(100),
ADD COLUMN     "instance_name" VARCHAR(100),
ADD COLUMN     "message_type" VARCHAR(20),
ADD COLUMN     "raw_payload" JSONB,
ADD COLUMN     "delivery_status" VARCHAR(20);

-- CreateTable
CREATE TABLE "webhook_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" VARCHAR(50) NOT NULL,
    "instance_name" VARCHAR(100),
    "event_type" VARCHAR(100),
    "external_message_id" VARCHAR(128),
    "phone" VARCHAR(30),
    "payload" JSONB,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "error" VARCHAR(2000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID,
    "lead_id" UUID,
    "type" VARCHAR(50) NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(254) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_config" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pricing_range_enabled" BOOLEAN NOT NULL DEFAULT true,
    "pricing_starting_at" DECIMAL(12,2) NOT NULL DEFAULT 2500,
    "pricing_text" VARCHAR(2000) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_channel_instance_name_status_idx" ON "conversations"("channel", "instance_name", "status");

-- CreateIndex
CREATE INDEX "messages_external_message_id_instance_name_idx" ON "messages"("external_message_id", "instance_name");

-- CreateIndex
CREATE INDEX "webhook_logs_created_at_idx" ON "webhook_logs"("created_at");

-- CreateIndex
CREATE INDEX "bot_events_conversation_id_idx" ON "bot_events"("conversation_id");

-- CreateIndex
CREATE INDEX "bot_events_type_created_at_idx" ON "bot_events"("type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
-- Partial unique idempotency index: constrains only WhatsApp rows where both keys
-- are present so multiple Playground rows with NULL/NULL do not collide.
CREATE UNIQUE INDEX "uq_message_idempotency" ON "messages" ("external_message_id", "instance_name") WHERE "external_message_id" IS NOT NULL AND "instance_name" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_events" ADD CONSTRAINT "bot_events_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
