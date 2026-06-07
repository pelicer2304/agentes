-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(200) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "email" VARCHAR(254),
    "company_name" VARCHAR(200),
    "segment" VARCHAR(100),
    "business_description" VARCHAR(2000),
    "whatsapp_usage" VARCHAR(500),
    "main_pain" VARCHAR(1000),
    "secondary_pains" JSONB,
    "desired_outcome" VARCHAR(1000),
    "estimated_volume" VARCHAR(100),
    "urgency" VARCHAR(50),
    "decision_role" VARCHAR(100),
    "budget_signal" VARCHAR(500),
    "objections" JSONB,
    "recommended_service" VARCHAR(200),
    "lead_score" SMALLINT,
    "temperature" VARCHAR(20),
    "status" VARCHAR(50) NOT NULL,
    "summary" VARCHAR(5000),
    "next_step" VARCHAR(1000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lead_id" UUID NOT NULL,
    "channel" VARCHAR(50) NOT NULL,
    "stage" VARCHAR(50) NOT NULL,
    "status" VARCHAR(50) NOT NULL,
    "last_intent" VARCHAR(100),
    "handoff_required" BOOLEAN NOT NULL DEFAULT false,
    "handoff_reason" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "role" VARCHAR(50) NOT NULL,
    "direction" VARCHAR(20) NOT NULL,
    "content" VARCHAR(10000) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_analyses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "detected_segment" VARCHAR(100),
    "detected_intent" VARCHAR(100),
    "main_pain" VARCHAR(1000),
    "recommended_service" VARCHAR(200),
    "score" SMALLINT,
    "temperature" VARCHAR(20),
    "status" VARCHAR(50),
    "should_handoff" BOOLEAN,
    "handoff_reason" VARCHAR(500),
    "commercial_summary" VARCHAR(5000),
    "next_best_question" VARCHAR(1000),
    "score_reasons" JSONB,
    "raw_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_base" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category" VARCHAR(50) NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "content" VARCHAR(5000) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_base_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agent_name" VARCHAR(100) NOT NULL,
    "initial_message" VARCHAR(500) NOT NULL,
    "tone_of_voice" VARCHAR(300),
    "services" JSONB,
    "do_not_promise" JSONB,
    "handoff_criteria" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_settings_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_analyses" ADD CONSTRAINT "agent_analyses_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_analyses" ADD CONSTRAINT "agent_analyses_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
