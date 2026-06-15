# Design Document

## Overview

Esta feature adiciona um mecanismo de **follow-up automático de leads** ao agente conversacional (NestJS + Prisma + Postgres, WhatsApp via Evolution). Quando um lead para de interagir, o sistema reengaja em três níveis temporais — **1 hora, 1 dia (24h) e 2 dias (48h)** após a inatividade — com mensagens contextualizadas que retomam o que já foi mapeado (segmento, dor principal) para requalificar o lead.

A feature é composta por dois componentes centrais descritos nos requisitos:

- **Scheduler** (`FollowUpSchedulerService`): avalia periodicamente as conversas com follow-up pendente e, quando um nível vence, aciona o Follow_Up_Service.
- **Follow_Up_Service** (`FollowUpService`): agenda, avalia elegibilidade, dispara, cancela e encerra ciclos de follow-up, registrando cada transição como evento em `bot_events`.

### Princípios de design

1. **Durabilidade e idempotência via banco**: o estado do ciclo de follow-up vive em uma nova tabela persistente (`follow_up_schedules`), não em memória. Isso garante que reinicializações do processo não percam agendamentos e que cada nível seja disparado **no máximo uma vez** (Requisito 7).
2. **Reavaliação no instante do disparo**: a regra crítica — nunca enviar follow-up a um lead já encaminhado ao humano — é verificada **lendo os dados atuais** da Conversation/Lead no momento exato do disparo, nunca com dados pré-carregados (Requisito 2.3).
3. **Reaproveitamento da infraestrutura existente**: o envio passa pelo `ChannelAdapter` do WhatsApp (Evolution) e respeita o `RateLimiterService` (token bucket) já existente; a auditoria usa a tabela `BotEvent`; a composição textual reaproveita o mecanismo de geração de resposta (`AgentReplyService`).
4. **Separação entre lógica pura e efeitos colaterais**: a decisão de elegibilidade, o cálculo do Inactivity_Anchor, a seleção do próximo nível e a montagem da mensagem são funções puras e testáveis; o disparo, a persistência e o envio ficam isolados na borda.

### Mapeamento de requisitos para componentes

| Requisito | Responsável principal |
|-----------|----------------------|
| R1 Agendamento dos três níveis | `FollowUpSchedulerService` + `FollowUpService.scheduleNext` |
| R2 Elegibilidade e cancelamento por handoff | `FollowUpEligibilityService` (puro) + `FollowUpService.evaluateAtDispatch` |
| R3 Cancelamento por resposta do lead | `FollowUpService.onInboundReceived` (hook no inbound) |
| R4 Cancelamento por desistência | `FollowUpEligibilityService` (status `perdido`) + `FollowUpService` |
| R5 Mensagens contextualizadas | `ReengagementMessageComposer` |
| R6 Encerramento após o último nível | `FollowUpService.completeIfExhausted` |
| R7 Idempotência dos disparos | tabela `follow_up_schedules` (lock + marcação atômica) |
| R8 Observabilidade | `FollowUpEventRecorder` (grava em `bot_events`) |
| R9 Envio respeitando limites | `FollowUpSender` (Evolution + Rate_Limiter + janela) |

## Architecture

### Visão de alto nível

O ciclo de vida de um follow-up percorre dois caminhos de entrada: o **tick periódico** do Scheduler (que dispara níveis vencidos) e o **evento de inbound** (que cancela/reinicia o ciclo). Ambos operam sobre a mesma fonte de verdade persistente: a tabela `follow_up_schedules`.

```mermaid
graph TD
    subgraph Entradas
        CRON[Tick periodico do Scheduler]
        INBOUND[Mensagem inbound do lead]
        STATUS[Mudanca de status do Lead p/ perdido]
    end

    subgraph FollowUp[Modulo de Follow-up]
        SCHED[FollowUpSchedulerService]
        SVC[FollowUpService]
        ELIG[FollowUpEligibilityService - puro]
        COMP[ReengagementMessageComposer]
        SENDER[FollowUpSender]
        REC[FollowUpEventRecorder]
    end

    subgraph Infra[Infraestrutura existente]
        DB[(follow_up_schedules + conversations + leads)]
        EVT[(bot_events)]
        EVO[ChannelAdapter WhatsApp - Evolution]
        RL[RateLimiterService]
        REPLY[AgentReplyService]
    end

    CRON --> SCHED
    SCHED -->|reivindica linhas vencidas com lock| DB
    SCHED --> SVC
    INBOUND --> SVC
    STATUS --> SVC

    SVC --> ELIG
    SVC --> COMP
    COMP --> REPLY
    SVC --> SENDER
    SENDER --> RL
    SENDER --> EVO
    SVC --> REC
    REC --> EVT
    SVC --> DB
    ELIG --> DB
```

### Decisão de agendamento: tabela persistente + polling

Foram avaliadas duas abordagens para o agendamento periódico:

**Opção A — timers em memória (`setTimeout` por nível).** Simples, mas o estado se perde a cada reinício do processo, viola a durabilidade exigida por R1/R7 (níveis pendentes precisam sobreviver a deploys) e não suporta múltiplas instâncias.

**Opção B — tabela de follow-ups agendados + polling periódico (escolhida).** Cada conversa em follow-up tem uma linha em `follow_up_schedules` com o instante do próximo disparo (`nextRunAt`). Um job periódico (poll) seleciona as linhas vencidas, reivindica cada uma com um lock de banco e processa o disparo. Vantagens:

- **Durabilidade**: agendamentos sobrevivem a reinícios; o estado é o banco.
- **Idempotência e concorrência**: o lock por linha (`lockedUntil`, lease de 60s) e a marcação atômica do nível enviado atendem diretamente R7.1, R7.3 e R7.6.
- **Tolerância de 60s**: os requisitos exigem desvio máximo de 60 segundos em relação ao instante agendado (R1.2–R1.4). Com o poll rodando a cada **30 segundos**, o atraso máximo de detecção é ~30s, dentro da tolerância.
- **Escalabilidade futura**: `SELECT ... FOR UPDATE SKIP LOCKED` permite múltiplas instâncias sem disparo duplicado.

Para o tick periódico, a opção idiomática no NestJS é o pacote **`@nestjs/schedule`** (decorator `@Cron`/`@Interval`). Ele ainda não é dependência do projeto e deve ser adicionado. Caso se prefira evitar a dependência, um `setInterval` registrado em `onModuleInit` produz o mesmo efeito; o design não depende do mecanismo de tick em si, apenas de um gatilho a cada ~30s.

> Decisão: **`@nestjs/schedule` com `@Interval(30_000)`** disparando `FollowUpSchedulerService.tick()`. Justificativa: integra-se ao ciclo de vida do Nest, é testável (o tick é um método público invocável diretamente nos testes) e mantém a cadência de polling desacoplada da lógica de negócio.

### Pipeline de disparo (tick do Scheduler)

```mermaid
sequenceDiagram
    participant T as Tick (@Interval 30s)
    participant S as FollowUpSchedulerService
    participant DB as follow_up_schedules
    participant V as FollowUpEligibilityService
    participant C as ReengagementMessageComposer
    participant SN as FollowUpSender
    participant RL as RateLimiter
    participant EVO as Evolution
    participant R as FollowUpEventRecorder

    T->>S: tick()
    S->>DB: reivindicar linhas due (nextRunAt <= now, state=active)\ncom lease lockedUntil = now+60s (SKIP LOCKED)
    loop para cada schedule reivindicado
        S->>DB: ler snapshot ATUAL da Conversation+Lead (no disparo)
        S->>V: evaluate(snapshot)
        alt nao elegivel (handoff/perdido)
            S->>DB: marcar nivel cancelado + cycleState=cancelled
            S->>R: followup_cancelled (motivo handoff/lead_perdido)
        else snapshot indisponivel
            S->>R: followup_error (reavaliacao falhou) + mantem pendente
        else elegivel
            S->>C: compose(level, leadFacts)
            S->>SN: send(message, dentro da janela?)
            alt fora da janela OU rate-limited
                S->>DB: reagendar nextRunAt (mantem nivel pendente)
            else envio ok (Evolution confirma)
                S->>DB: marcar nivel enviado ATOMICO + lastOutboundAt
                S->>R: followup_sent (level, ts ms)
                S->>DB: agendar proximo nivel OU marcar p/ encerramento
            else Evolution falha
                S->>R: followup_error (evolution_error) + mantem pendente
            end
        end
        S->>DB: liberar lock (lockedUntil = null)
    end
```

### Pipeline de inbound (cancelamento/reinício)

O hook de cancelamento é acionado de dentro do fluxo de inbound já existente. O ponto de integração é o `InboundMessageProcessor` (após persistir o inbound e fazer backfill da proveniência) e/ou o `ConversationService.handleInboundMessage`, onde a mensagem inbound do lead é registrada. O Follow_Up_Service expõe `onInboundReceived(conversationId)`:

```mermaid
graph TD
    IN[Inbound do lead persistido] --> HOOK[FollowUpService.onInboundReceived]
    HOOK --> Q{Existe schedule com nivel pendente?}
    Q -->|nao| NOOP[No-op: sem evento, sem alteracao - R3.4]
    Q -->|sim| CANCEL[Cancelar todos os niveis pendentes - atomico/idempotente]
    CANCEL --> EVT[followup_cancelled motivo=resposta_do_lead]
    EVT --> RESET{Conversa ainda elegivel?}
    RESET -->|sim| RESCH[Redefinir Inactivity_Anchor = agora\nReiniciar a partir do nivel 1]
    RESET -->|nao| STOP[Nao reagenda]
```

O cancelamento por inbound é **idempotente** (R3.6): se já não há nível pendente, é no-op e nenhum `followup_cancelled` duplicado é gravado.

### Estrutura de módulo

Um novo módulo `FollowUpModule` (`apps/api/src/followup/`) reúne os serviços e é importado em `AppModule`. Ele importa `PrismaModule`, `ChannelModule` (para o `ChannelAdapterRegistry`/Evolution), `AgentModule` (para `AgentReplyService`) e usa o `RateLimiterService` (provido em escopo apropriado). O `InboundModule` passa a depender do `FollowUpService` para invocar o hook de inbound.

```
apps/api/src/followup/
  followup.module.ts
  followup.service.ts                 # FollowUpService (orquestracao + efeitos)
  followup-scheduler.service.ts       # FollowUpSchedulerService (@Interval tick)
  followup-eligibility.service.ts     # FollowUpEligibilityService (PURO)
  reengagement-message.composer.ts    # ReengagementMessageComposer (PURO + opcional LLM)
  followup-sender.service.ts          # FollowUpSender (Evolution + RateLimiter + janela)
  followup-event.recorder.ts          # FollowUpEventRecorder (bot_events com retry)
  followup.types.ts                   # tipos/enums (motivos, niveis, snapshot)
  followup.constants.ts               # niveis, offsets, janela, limites de retry
```

## Components and Interfaces

### FollowUpEligibilityService (lógica pura)

Centraliza toda a regra de elegibilidade (R2.1, R4.1). Recebe um **snapshot** imutável dos campos relevantes da Conversation e do Lead e devolve a decisão. Não faz I/O — por isso é facilmente testável por propriedades.

```typescript
/** Snapshot dos campos lidos da Conversation + Lead no instante avaliado. */
export interface ConversationSnapshot {
  leadStatus: string;              // novo | qualificando | chamar_humano | perdido
  stage: string;                   // abertura | descoberta | conversao | handoff_humano
  conversationStatus: string;      // active | inactive
  botPaused: boolean;
  assignedTo: string | null;
  handoffAccepted: boolean;
  handoffCompleted: boolean;
  handoffRequired: boolean;
}

export type IneligibilityReason =
  | 'handoff_humano'   // qualquer condicao do R2.1
  | 'lead_perdido';    // status do lead = perdido (R4.1)

export interface EligibilityResult {
  eligible: boolean;
  reason: IneligibilityReason | null;
}

@Injectable()
export class FollowUpEligibilityService {
  /**
   * Avalia a elegibilidade de uma Conversation para follow-up (R2.1, R4.1).
   * Funcao TOTAL e deterministica: o mesmo snapshot sempre produz o mesmo
   * resultado, sem I/O.
   */
  evaluate(snapshot: ConversationSnapshot): EligibilityResult;
}
```

Regra (não elegível se qualquer condição for verdadeira):
- `leadStatus === 'chamar_humano'` → `handoff_humano`
- `handoffAccepted` ou `handoffCompleted` verdadeiros → `handoff_humano`
- `stage === 'handoff_humano'` → `handoff_humano`
- `botPaused` verdadeiro → `handoff_humano`
- `assignedTo` não nulo e diferente de string vazia → `handoff_humano`
- `leadStatus === 'perdido'` → `lead_perdido`

Caso contrário, `{ eligible: true, reason: null }`.

### ReengagementMessageComposer (composição contextualizada)

Gera a Reengagement_Message para um nível, retomando o contexto mapeado (R5). É majoritariamente **determinístico e puro** (template contextual) para garantir limites verificáveis; opcionalmente enriquece o texto via `AgentReplyService`, mas o resultado final passa sempre por uma normalização que garante as invariantes (≤ 1000 caracteres, exatamente uma CTA/pergunta).

```typescript
export interface ReengagementContext {
  level: 1 | 2 | 3;
  segment: string | null;     // Lead.segment
  mainPain: string | null;    // Lead.mainPain
  agentName: string;
}

export interface ReengagementMessage {
  content: string;            // <= 1000 chars, exatamente 1 pergunta/CTA
  referencedSegment: boolean; // true quando o segmento foi referenciado
  referencedPain: boolean;    // true quando a dor principal foi referenciada
}

@Injectable()
export class ReengagementMessageComposer {
  /**
   * Monta a mensagem de reengajamento (R5.1-R5.5):
   *  - se segment preenchido -> referencia o valor exato do segmento;
   *  - se mainPain preenchido -> referencia o valor exato da dor;
   *  - se nenhum -> reengajamento generico, sem referencias;
   *  - SEMPRE inclui exatamente uma pergunta/CTA;
   *  - SEMPRE limita o conteudo a 1000 caracteres.
   */
  compose(ctx: ReengagementContext): ReengagementMessage;
}
```

A falha ou timeout de 30s na geração (R5.6) é tratada pelo `FollowUpService`: o nível permanece **não enviado** e um `followup_error` é registrado. O caminho determinístico não tem timeout; o limite de 30s aplica-se apenas ao enriquecimento por LLM, que, se estourar, faz fallback ao texto determinístico (sempre disponível).

### FollowUpSender (envio via Evolution + Rate_Limiter + janela)

Encapsula o envio respeitando os limites e a janela (R9). Não decide elegibilidade nem idempotência — apenas tenta entregar e classifica o resultado.

```typescript
export type SendOutcome =
  | { status: 'sent'; sentAt: Date }          // Evolution confirmou
  | { status: 'deferred'; reason: 'out_of_window' | 'rate_limited' }
  | { status: 'failed'; reason: 'evolution_error' };

@Injectable()
export class FollowUpSender {
  /**
   * Envia a Reengagement_Message pelo WhatsApp (R9):
   *  - se fora da janela permitida -> deferred(out_of_window) (R9.2);
   *  - se RateLimiter rejeita -> deferred(rate_limited) (R9.3);
   *  - usa o ChannelAdapter do WhatsApp (Evolution) p/ enviar (R9.1);
   *  - on sucesso, devolve sentAt p/ atualizar lastOutboundAt (R9.6);
   *  - on falha do Evolution -> failed(evolution_error) (R9.4).
   */
  send(params: {
    phone: string;
    instanceName: string | null;
    conversationId: string;
    content: string;
    now: Date;
  }): Promise<SendOutcome>;

  /** True se `now` esta dentro da janela de envio configurada (R9.2). */
  isWithinSendWindow(now: Date): boolean;
}
```

A janela de envio é configurável (ver Data Models / Config). O Rate_Limiter usado é o `RateLimiterService` existente (token bucket), com chave por telefone, coerente com o uso no inbound.

### FollowUpService (orquestração)

Coordena o ciclo completo. Métodos principais:

```typescript
@Injectable()
export class FollowUpService {
  /** Cria/garante o schedule e agenda o Nivel 1 a partir do anchor (R1.1, R1.2). */
  ensureScheduled(conversationId: string): Promise<void>;

  /**
   * Processa um schedule vencido reivindicado pelo Scheduler:
   * reavalia elegibilidade no instante do disparo (R2.3), compoe e envia,
   * marca o nivel enviado de forma atomica (R7.1), agenda o proximo nivel
   * (R1.3, R1.4) ou marca p/ encerramento (R6). Idempotente sob lock (R7.3).
   */
  processDue(scheduleId: string, now: Date): Promise<void>;

  /**
   * Hook de inbound (R3): cancela niveis pendentes e, se a conversa segue
   * elegivel, redefine o Inactivity_Anchor para agora e reinicia no Nivel 1.
   * Idempotente e no-op quando nao ha nivel pendente (R3.4, R3.6).
   */
  onInboundReceived(conversationId: string, now: Date): Promise<void>;

  /** Reage a mudanca de status do Lead para `perdido` (R4.2). */
  onLeadLost(conversationId: string, now: Date): Promise<void>;

  /** Encerra o ciclo apos a janela de 24h do Nivel 3 sem resposta (R6.1). */
  completeIfExhausted(scheduleId: string, now: Date): Promise<void>;
}
```

### FollowUpEventRecorder (observabilidade)

Grava os Follow_Up_Event na tabela `bot_events`, com retry (R8.4) e degradação graciosa (R8.5).

```typescript
export type FollowUpEventType =
  | 'followup_sent'
  | 'followup_cancelled'
  | 'followup_completed'
  | 'followup_error';

export type CancelReason =
  | 'handoff_humano'
  | 'lead_perdido'
  | 'resposta_do_lead';

@Injectable()
export class FollowUpEventRecorder {
  /**
   * Registra um Follow_Up_Event em bot_events. Tenta ate 3 vezes adicionais
   * (R8.4); esgotadas as tentativas, loga o erro com conversationId+tipo e
   * NAO interrompe o processamento (R8.5).
   * O payload inclui o instante em ISO-8601 com precisao de milissegundos.
   */
  record(event: {
    type: FollowUpEventType;
    conversationId: string;
    leadId: string;
    level?: 1 | 2 | 3;
    reason?: CancelReason | 'evolution_error' | 'schedule_failed' | 'reevaluation_failed';
    occurredAt: Date;
  }): Promise<void>;
}
```

### FollowUpSchedulerService (tick)

```typescript
@Injectable()
export class FollowUpSchedulerService {
  /**
   * Disparado a cada ~30s (@Interval). Reivindica os schedules vencidos
   * (nextRunAt <= now, cycleState=active, lock livre) aplicando um lease de
   * 60s (lockedUntil), e delega cada um ao FollowUpService.processDue.
   * Tambem varre os schedules em janela de encerramento (Nivel 3 disparado
   * ha mais de 24h) para chamar completeIfExhausted (R6.1).
   */
  @Interval(30_000)
  async tick(now: Date = new Date()): Promise<void>;
}
```

### Pontos de integração no código existente

- **Inbound** (`InboundMessageProcessor.process` / `flushDebouncedTurn`): após persistir o inbound do lead, chamar `followUpService.onInboundReceived(conversationId, now)`. Como esse processamento já é assíncrono fora da resposta ao webhook, o cancelamento em ≤ 5s (R3.1) é folgado.
- **ConversationService**: ao detectar transição de `status` do lead para `perdido` (intent `desistance`), chamar `followUpService.onLeadLost(conversationId, now)` (R4.2).
- **Após resposta do bot**: quando o bot envia um outbound aguardando resposta e a conversa permanece elegível, `ensureScheduled` é chamado para (re)agendar o Nível 1 a partir do `lastOutboundAt` (R1.1).

## Data Models

### Nova tabela: `follow_up_schedules`

Uma linha por Conversation rastreia todo o ciclo de follow-up. A unicidade por `conversationId` garante que não existam ciclos concorrentes para a mesma conversa.

```prisma
model FollowUpSchedule {
  id             String   @id @default(uuid()) @db.Uuid
  conversationId String   @unique @map("conversation_id") @db.Uuid
  leadId         String   @map("lead_id") @db.Uuid

  // Estado do ciclo: 'active' (em andamento), 'cancelled' (cancelado por
  // handoff/perdido/resposta), 'completed' (esgotou os 3 niveis).
  cycleState     String   @default("active") @map("cycle_state") @db.VarChar(20)

  // Instante a partir do qual a inatividade e medida (Inactivity_Anchor).
  inactivityAnchor DateTime @map("inactivity_anchor")

  // Maior nivel ja enviado (0 = nenhum). A marcacao atomica de "enviado"
  // incrementa este campo condicionalmente (WHERE max_sent_level < :level),
  // garantindo idempotencia e monotonicidade (R7.1, R7.2).
  maxSentLevel   Int      @default(0) @map("max_sent_level") @db.SmallInt

  // Proximo nivel a disparar (1..3) e seu instante agendado. Null quando nao
  // ha nivel pendente (ciclo cancelado/encerrado).
  pendingLevel   Int?     @map("pending_level") @db.SmallInt
  nextRunAt      DateTime? @map("next_run_at")

  // Instante em que o Nivel 3 foi disparado, base p/ a janela de 24h de
  // encerramento (R6.1).
  level3FiredAt  DateTime? @map("level3_fired_at")

  // Controle de concorrencia (lease lock). Uma linha esta "reivindicada"
  // enquanto lockedUntil > now; o lease expira em 60s (R7.6).
  lockedUntil    DateTime? @map("locked_until")

  // Tentativas adiadas do disparo corrente (janela/rate-limit/erro), p/ o
  // limite maximo de reenvios (R9.5).
  deferredAttempts Int     @default(0) @map("deferred_attempts") @db.SmallInt

  lastError      String?  @map("last_error") @db.VarChar(2000)

  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  conversation   Conversation @relation(fields: [conversationId], references: [id])

  @@index([cycleState, nextRunAt])
  @@index([cycleState, level3FiredAt])
  @@map("follow_up_schedules")
}
```

Relação inversa em `Conversation`:

```prisma
model Conversation {
  // ... campos existentes ...
  followUpSchedule FollowUpSchedule?
}
```

### Migração Prisma correspondente

Arquivo `apps/api/prisma/migrations/<timestamp>_add_follow_up_schedules/migration.sql` (aditivo, sem alterar tabelas existentes além da relação implícita por FK):

```sql
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
```

### Auditoria: novos tipos em `bot_events`

A tabela `BotEvent` existente (`conversation_id`, `lead_id`, `type`, `payload`, `created_at`) é reaproveitada. Adicionam-se os novos `type`:

| `type` | Quando | `payload` |
|--------|--------|-----------|
| `followup_sent` | Reengagement_Message enviada com sucesso (R8.1) | `{ level, occurredAt }` (occurredAt ISO-8601 com ms) |
| `followup_cancelled` | Ciclo cancelado (R8.2) | `{ reason, occurredAt }` reason ∈ {`handoff_humano`, `lead_perdido`, `resposta_do_lead`} |
| `followup_completed` | Ciclo encerrado por esgotamento (R8.3) | `{ occurredAt }` |
| `followup_error` | Falha (envio/cancelamento/registro/reavaliação) | `{ reason, level?, detail? }` |

### Configuração (env / `config.schema.ts`)

Novos parâmetros validados via Joi, com defaults seguros:

```typescript
// Offsets dos niveis (horas) — fixos por requisito, expostos p/ teste.
FOLLOWUP_LEVEL1_HOURS: default 1
FOLLOWUP_LEVEL2_HOURS: default 24
FOLLOWUP_LEVEL3_HOURS: default 48
// Janela de resposta apos o Nivel 3 antes de encerrar (horas).
FOLLOWUP_COMPLETION_WINDOW_HOURS: default 24
// Janela diaria de envio permitida (formato HH:mm-HH:mm, fuso America/Sao_Paulo).
FOLLOWUP_SEND_WINDOW: default '08:00-20:00'
// Espera minima ao reagendar por rate-limit (segundos, minimo 60).
FOLLOWUP_RETRY_BACKOFF_SECONDS: default 60
// Maximo de tentativas adiadas por nivel antes de interromper (R9.5).
FOLLOWUP_MAX_DEFERRALS: default 10
// Cadencia do poll (ms) — <= 60000 p/ respeitar a tolerancia de 60s.
FOLLOWUP_POLL_INTERVAL_MS: default 30000
```

### Modelo de estados do ciclo

```mermaid
stateDiagram-v2
    [*] --> Idle: conversa sem follow-up
    Idle --> ScheduledL1: ensureScheduled (anchor = lastOutboundAt)
    ScheduledL1 --> SentL1: disparo elegivel + envio ok
    SentL1 --> ScheduledL2: agenda anchor+24h
    ScheduledL2 --> SentL2: disparo elegivel + envio ok
    SentL2 --> ScheduledL3: agenda anchor+48h
    ScheduledL3 --> SentL3: disparo elegivel + envio ok
    SentL3 --> Completed: 24h sem inbound (R6.1)

    ScheduledL1 --> Cancelled: inbound / handoff / perdido
    ScheduledL2 --> Cancelled: inbound / handoff / perdido
    ScheduledL3 --> Cancelled: inbound / handoff / perdido
    SentL1 --> Cancelled: inbound / handoff / perdido
    SentL2 --> Cancelled: inbound / handoff / perdido

    Cancelled --> ScheduledL1: novo inbound + elegivel (reinicia)
    Completed --> ScheduledL1: novo inbound + elegivel (reinicia)
    Completed --> [*]
```

## Correctness Properties

*Uma propriedade é uma característica ou comportamento que deve ser verdadeiro em todas as execuções válidas do sistema — essencialmente, uma afirmação formal sobre o que o software deve fazer. Propriedades são a ponte entre especificações legíveis por humanos e garantias de correção verificáveis por máquina.*

As propriedades abaixo derivam diretamente do prework. Elas serão implementadas com testes baseados em propriedade (property-based testing) usando `fast-check` (já presente no projeto), com no mínimo 100 iterações cada. A lógica testada é majoritariamente pura (elegibilidade, cálculo de anchor/offsets, seleção de nível, composição); os efeitos de borda (Prisma, Evolution) são injetados via mocks/fakes em memória para manter as propriedades rápidas e determinísticas.

### Property 1: Elegibilidade é total e correta

*Para qualquer* `ConversationSnapshot`, `evaluate` retorna `eligible = false` se e somente se pelo menos uma condição de não-elegibilidade for verdadeira (`leadStatus === 'chamar_humano'`, `handoffAccepted`, `handoffCompleted`, `stage === 'handoff_humano'`, `botPaused`, `assignedTo` não nulo e não vazio, ou `leadStatus === 'perdido'`); o `reason` é `lead_perdido` quando a única causa é o status perdido e `handoff_humano` caso contrário; e a função é determinística.

**Validates: Requirements 2.1, 4.1**

### Property 2: Nunca dispara para conversa não elegível, reavaliando no instante do disparo

*Para qualquer* schedule com nível pendente cujo snapshot **lido no instante do disparo** seja não elegível, `processDue` não chama o `FollowUpSender`, marca o nível como cancelado, não agenda nenhum nível futuro e o estado do ciclo passa a `cancelled` — mesmo que o estado no momento do agendamento fosse elegível.

**Validates: Requirements 1.5, 1.7, 2.2, 2.3, 2.4, 4.2, 4.3**

### Property 3: Inactivity_Anchor é a última interação relevante

*Para qualquer* par de timestamps `lastOutboundAt` e `lastInboundAt` em que não exista inbound posterior ao último outbound, o Inactivity_Anchor calculado é exatamente igual a `lastOutboundAt`.

**Validates: Requirements 1.1**

### Property 4: Cada nível é agendado no offset correto a partir do anchor

*Para qualquer* Inactivity_Anchor e qualquer nível `n ∈ {1,2,3}`, o `nextRunAt` agendado para o nível `n` é exatamente `anchor + offset(n)`, onde `offset(1)=1h`, `offset(2)=24h`, `offset(3)=48h`.

**Validates: Requirements 1.2, 1.3, 1.4**

### Property 5: Monotonicidade e idempotência dos níveis (1 → 2 → 3, nunca repetir)

*Para qualquer* sequência de disparos bem-sucedidos sobre um ciclo, o próximo nível selecionado é sempre `maxSentLevel + 1` (em ordem crescente), `maxSentLevel` nunca decresce, nenhum nível é enviado mais de uma vez, e reprocessar um nível já marcado como enviado não produz nova mensagem.

**Validates: Requirements 1.3, 1.4, 7.1, 7.2, 7.4**

### Property 6: Inbound cancela todos os pendentes de forma idempotente com exatamente um evento

*Para qualquer* schedule com pelo menos um nível pendente, aplicar `onInboundReceived` deixa o ciclo sem nível pendente (cancelado) e registra **exatamente um** `followup_cancelled` com motivo `resposta_do_lead`; aplicar `onInboundReceived` novamente em seguida é um no-op (mesmo estado final, sem novo evento).

**Validates: Requirements 1.6, 3.1, 3.3, 3.6**

### Property 7: Inbound de conversa elegível reinicia o ciclo no Nível 1

*Para qualquer* schedule cuja Conversation permaneça elegível, ao receber um inbound no instante `t`, o Inactivity_Anchor é redefinido para `t` e o ciclo é reiniciado com `pendingLevel = 1` agendado para `t + 1h`.

**Validates: Requirements 3.2**

### Property 8: Inbound sem nível pendente é no-op

*Para qualquer* Conversation sem nenhum nível pendente (schedule inexistente, cancelado ou encerrado), `onInboundReceived` não grava `followup_cancelled` e não altera agendamentos existentes.

**Validates: Requirements 3.4**

### Property 9: Mensagem referencia segmento e dor quando preenchidos

*Para qualquer* `ReengagementContext`, a `Reengagement_Message` gerada contém o valor exato do segmento quando `segment` está preenchido e o valor exato da dor principal quando `mainPain` está preenchido; quando ambos estão vazios, a mensagem é genérica e não contém referências a segmento ou dor.

**Validates: Requirements 5.1, 5.2, 5.4**

### Property 10: Invariantes de forma da mensagem (≤ 1000 caracteres e exatamente uma CTA)

*Para qualquer* `ReengagementContext` (incluindo segmento e dor arbitrariamente longos e o caso genérico), a `Reengagement_Message` gerada tem no máximo 1000 caracteres e contém exatamente uma pergunta ou chamada para ação.

**Validates: Requirements 5.3, 5.4, 5.5**

### Property 11: Encerramento após o Nível 3 e estado terminal

*Para qualquer* ciclo cujo Nível 3 foi disparado há mais de 24 horas sem inbound, `completeIfExhausted` marca o ciclo como `completed` sem agendar novos níveis, e enquanto `completed` nenhum disparo ocorre; se um inbound chega dentro da janela de 24h após o Nível 3, o ciclo não é encerrado por `ciclo_concluido` e é tratado como cancelamento/reinício (Propriedades 6 e 7).

**Validates: Requirements 6.1, 6.3, 6.4**

### Property 12: Conteúdo e forma dos Follow_Up_Event

*Para qualquer* transição que gere um Follow_Up_Event, o evento registrado contém `conversationId` e `leadId`; um `followup_sent` inclui `level ∈ [1, máximo configurado]`; um `followup_cancelled` inclui um `reason` pertencente ao conjunto `{handoff_humano, lead_perdido, resposta_do_lead}`; e todo evento inclui o instante de ocorrência em formato data-hora com precisão de milissegundos.

**Validates: Requirements 4.4, 6.2, 8.1, 8.2, 8.3**

### Property 13: Lock de concorrência exclusivo com expiração de 60s

*Para qualquer* schedule, duas tentativas concorrentes de reivindicação resultam em no máximo uma aquisição do lock (a outra recebe indicação de bloqueio ativo); e um lock cujo lease expirou (mais de 60s sem confirmação) pode ser reivindicado novamente, com o nível ainda tratado como não enviado.

**Validates: Requirements 7.3, 7.6**

### Property 14: Disparo fora da janela é adiado sem marcar enviado

*Para qualquer* instante fora da janela de envio configurada, `send` retorna `deferred(out_of_window)`, o nível não é marcado como enviado e o `nextRunAt` é adiado para o início da próxima janela permitida.

**Validates: Requirements 9.2**

### Property 15: Rejeição do Rate_Limiter adia com backoff mínimo de 60s

*Para qualquer* disparo em que o `RateLimiterService` rejeite o envio, a `Reengagement_Message` permanece pendente (nível não marcado como enviado) e uma nova tentativa é reagendada após pelo menos 60 segundos.

**Validates: Requirements 9.3**

### Property 16: Envio confirmado atualiza lastOutboundAt

*Para qualquer* envio confirmado pelo Evolution_Channel no instante `sentAt`, o `lastOutboundAt` da Conversation é atualizado para `sentAt`.

**Validates: Requirements 9.6**

### Property 17: Falha de envio preserva o nível como pendente

*Para qualquer* disparo cujo envio falhe (Evolution retorna falha), o nível não é registrado como enviado, permanece pendente para nova tentativa e um Follow_Up_Event de erro é registrado.

**Validates: Requirements 7.5, 9.4**

## Error Handling

O tratamento de erros segue o princípio de **degradação segura**: na dúvida, não envia, preserva o estado pendente e registra o ocorrido, sem nunca arriscar um disparo indevido (especialmente para leads encaminhados ao humano).

### Falhas de agendamento (R1.8)

`FollowUpService.scheduleNext` é envolvido em uma rotina de retry com até 3 tentativas. Esgotadas, grava `followup_error` (reason `schedule_failed`) e **não** dispara o nível. O schedule permanece consistente (sem `nextRunAt` inválido).

### Reavaliação no disparo indisponível (R2.5)

Se a leitura do snapshot atual da Conversation/Lead falhar no instante do disparo, o envio é suprimido, o nível **permanece pendente** (será reavaliado no próximo tick) e um `followup_error` (reason `reevaluation_failed`) é registrado. Nunca se assume elegibilidade em caso de dúvida.

### Falha ao persistir cancelamento (R2.6, R3.5)

Se a marcação de cancelamento dos níveis pendentes não puder ser persistida, os níveis são **preservados como pendentes**, o envio é suprimido e um `followup_error` é registrado. No caso de inbound (R3.5), a mensagem inbound é retida para nova tentativa (o hook é reentrante e idempotente).

### Falha na geração da mensagem / timeout de 30s (R5.6)

A composição determinística não falha e está sempre disponível como fallback. O enriquecimento opcional via `AgentReplyService` é limitado a 30s; em timeout ou erro, usa-se o texto determinístico. Se até o caminho determinístico falhar (situação inesperada), o nível permanece **não enviado** e um `followup_error` é registrado.

### Falha de envio pelo Evolution (R9.4) e esgotamento de tentativas (R9.5)

Falha no `ChannelAdapter` resulta em `followup_error` (reason `evolution_error`), nível mantido pendente e mensagem preservada. O `deferredAttempts` é incrementado a cada adiamento (janela, rate-limit, erro). Ao atingir `FOLLOWUP_MAX_DEFERRALS`, registra-se `followup_error` (esgotamento) e os disparos daquele nível são interrompidos.

### Falha ao registrar Follow_Up_Event (R8.4, R8.5)

`FollowUpEventRecorder.record` tenta até 3 vezes adicionais. Esgotadas, loga o erro com `conversationId` e tipo do evento e **prossegue** o processamento da Conversation sem interrupção, preservando o estado atual do ciclo. A observabilidade nunca bloqueia a lógica de negócio.

### Falha ao registrar encerramento (R6.5)

Se o `followup_completed` não puder ser persistido, a Conversation **permanece no estado encerrado** (`cycleState = completed`) sem agendar novos níveis, e o erro de persistência é registrado em log.

### Concorrência e timeouts (R7.3, R7.6)

A reivindicação por lease (`lockedUntil = now + 60s`) garante exclusão mútua por conversa. Se um disparo travar e o lease expirar, o próximo tick reivindica a linha novamente; como o nível só é marcado enviado **após** confirmação do Evolution, um disparo interrompido nunca deixa o nível como falsamente enviado.

## Testing Strategy

A estratégia combina **testes baseados em propriedade** (para a lógica universal) e **testes de exemplo/integração** (para casos específicos, erros e wiring de serviços externos), seguindo o padrão já estabelecido no projeto.

### Property-based testing (fast-check)

PBT é apropriado aqui porque o núcleo da feature é lógica pura com grande espaço de entradas: elegibilidade, cálculo de anchor/offsets, seleção de nível, idempotência e composição de mensagem. Diretrizes:

- Biblioteca: **`fast-check`** (já em `apps/api/package.json`). Não reimplementar PBT do zero.
- Mínimo de **100 iterações** por teste de propriedade.
- Cada teste de propriedade referencia sua propriedade do design com uma tag em comentário, no padrão do projeto:
  `// Feature: lead-followup, Property {n}: {texto da propriedade}`
- Efeitos de borda (Prisma, Evolution, Rate_Limiter, relógio) são injetados como fakes/mocks em memória e relógios determinísticos (`now` injetado), como já feito em `rate-limiter.ts` e nas specs existentes.
- Geradores: snapshots de Conversation/Lead (combinando todas as flags de R2.1 e status do lead), timestamps para anchors/janelas, contextos de mensagem com segment/mainPain arbitrários (incluindo strings longas e vazias) e sequências de eventos (disparo/inbound) para exercitar monotonicidade e idempotência.

Mapa de propriedades → arquivos de teste sugeridos:

| Propriedade | Arquivo de teste |
|-------------|------------------|
| P1 | `followup-eligibility.service.spec.ts` |
| P3, P4, P5 | `followup.scheduling.property.spec.ts` |
| P9, P10 | `reengagement-message.composer.spec.ts` |
| P2, P6, P7, P8, P11, P12, P13, P14, P15, P16, P17 | `followup.service.property.spec.ts` (com fakes em memória) |

### Testes de exemplo e de erro (unitários)

Cobrem os critérios classificados como exemplo/erro no prework, com mocks que simulam falhas:

- **R1.8** retry de agendamento (falha 3x → `followup_error`, sem disparo).
- **R2.5 / R2.6 / R3.5** falhas de reavaliação e de persistência de cancelamento (nível preservado pendente, evento de erro).
- **R5.6** timeout/erro de geração (fallback determinístico; nível não enviado se tudo falhar).
- **R6.5** falha ao registrar encerramento (estado `completed` preservado).
- **R8.4 / R8.5** retry e degradação graciosa do recorder.
- **R9.5** esgotamento de tentativas adiadas (`FOLLOWUP_MAX_DEFERRALS`).

### Testes de integração (wiring de serviços externos)

Não usam PBT (comportamento não varia com a entrada e o custo de repetição é alto):

- **R9.1** verifica que `FollowUpSender.send`, dentro da janela e com token disponível, invoca o `ChannelAdapter` do WhatsApp (Evolution) exatamente uma vez (adapter mockado).
- **R9.4** verifica que uma falha do adapter Evolution produz `followup_error` com reason `evolution_error` e mantém o nível pendente.
- Integração do **hook de inbound**: ao processar um inbound no `InboundMessageProcessor`, `onInboundReceived` é chamado e o ciclo é cancelado (teste com fakes do módulo de inbound).

### Cobertura mínima por requisito

Cada acceptance criterion testável (PROPERTY) é coberto por exatamente uma propriedade (consolidadas conforme a reflexão do prework). Os critérios de erro/wiring (EXAMPLE/INTEGRATION) são cobertos por testes de exemplo ou integração dedicados. Critérios temporais (≤ 5s, ≤ 60s de tolerância) são validados pela lógica de agendamento/cadência do poll, não por assertivas de wall-clock.
