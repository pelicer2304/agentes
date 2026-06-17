# Implementation Plan: Lead Follow-up

## Overview

Plano incremental para implementar o follow-up automático de leads no app `apps/api` (NestJS + Prisma + Postgres, WhatsApp via Evolution). A construção segue a ordem de dependência: primeiro a fundação de dados (migração Prisma, tipos e configuração), depois a lógica pura e testável (elegibilidade, composição da mensagem, cálculo de anchor/níveis), em seguida os serviços de borda (recorder, sender), a orquestração (`FollowUpService`), o agendador (`FollowUpSchedulerService`), o módulo e o wiring no `AppModule`, e por fim a integração dos hooks no fluxo de inbound/conversa. Cada propriedade de correção do design vira um teste baseado em propriedade com `fast-check` (mínimo de 100 iterações), e os critérios de erro/wiring viram testes de exemplo e de integração.

## Tasks

- [x] 1. Fundação de dados: migração Prisma, tipos e constantes
  - [x] 1.1 Adicionar o modelo `FollowUpSchedule` e a relação inversa em `Conversation`, e criar a migração SQL
    - Adicionar o modelo `FollowUpSchedule` em `apps/api/prisma/schema.prisma` com os campos `id`, `conversationId` (único), `leadId`, `cycleState`, `inactivityAnchor`, `maxSentLevel`, `pendingLevel`, `nextRunAt`, `level3FiredAt`, `lockedUntil`, `deferredAttempts`, `lastError`, `createdAt`, `updatedAt` e os índices `(cycleState, nextRunAt)` e `(cycleState, level3FiredAt)`
    - Adicionar o campo de relação inversa `followUpSchedule FollowUpSchedule?` no modelo `Conversation`
    - Criar a migração `apps/api/prisma/migrations/<timestamp>_add_follow_up_schedules/migration.sql` aditiva (CreateTable, índice único por `conversation_id`, índices de poll e de janela de encerramento, e a foreign key com `ON DELETE CASCADE`)
    - Regenerar o Prisma Client após a alteração do schema
    - _Requirements: 7.1, 7.2, 7.3, 7.6_

  - [x] 1.2 Definir os tipos, enums e constantes do follow-up
    - Criar `apps/api/src/followup/followup.types.ts` com `ConversationSnapshot`, `IneligibilityReason`, `EligibilityResult`, `ReengagementContext`, `ReengagementMessage`, `SendOutcome`, `FollowUpEventType`, `CancelReason`
    - Criar `apps/api/src/followup/followup.constants.ts` com os níveis (1, 2, 3), o número máximo de níveis e os nomes dos novos tipos de `BotEvent` (`followup_sent`, `followup_cancelled`, `followup_completed`, `followup_error`)
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 2. Configuração dos parâmetros de follow-up
  - [x] 2.1 Adicionar e validar os novos parâmetros em `config.schema.ts`
    - Em `apps/api/src/config/config.schema.ts`, adicionar via Joi com defaults seguros: `FOLLOWUP_LEVEL1_HOURS` (1), `FOLLOWUP_LEVEL2_HOURS` (24), `FOLLOWUP_LEVEL3_HOURS` (48), `FOLLOWUP_COMPLETION_WINDOW_HOURS` (24), `FOLLOWUP_SEND_WINDOW` ('08:00-20:00'), `FOLLOWUP_RETRY_BACKOFF_SECONDS` (mínimo 60), `FOLLOWUP_MAX_DEFERRALS` (10), `FOLLOWUP_POLL_INTERVAL_MS` (30000, ≤ 60000)
    - Expor os valores tipados no `ConfigService` para consumo pelos serviços de follow-up
    - _Requirements: 1.2, 1.3, 1.4, 6.1, 9.2, 9.3, 9.5_

  - [x]* 2.2 Escrever testes unitários do schema de configuração
    - Em `apps/api/src/config/config.schema.spec.ts`, validar defaults, o formato `HH:mm-HH:mm` da janela e o mínimo de 60s do backoff
    - _Requirements: 9.2, 9.3, 9.5_

- [x] 3. Implementar a lógica pura de elegibilidade
  - [x] 3.1 Implementar `FollowUpEligibilityService.evaluate`
    - Criar `apps/api/src/followup/followup-eligibility.service.ts` como função total e determinística (sem I/O) que recebe um `ConversationSnapshot` e devolve `EligibilityResult`
    - Marcar não elegível por `handoff_humano` quando `leadStatus === 'chamar_humano'`, `handoffAccepted`, `handoffCompleted`, `stage === 'handoff_humano'`, `botPaused`, ou `assignedTo` não nulo e diferente de string vazia
    - Marcar não elegível por `lead_perdido` quando `leadStatus === 'perdido'` for a única causa
    - _Requirements: 2.1, 4.1_

  - [x]* 3.2 Escrever teste de propriedade da elegibilidade
    - Em `apps/api/src/followup/followup-eligibility.service.spec.ts`, gerar `ConversationSnapshot` cobrindo todas as flags e status
    - **Property 1: Elegibilidade é total e correta** — `eligible = false` sse alguma condição de não-elegibilidade for verdadeira, com `reason` correto e determinismo
    - Tag de comentário: `// Feature: lead-followup, Property 1: ...`
    - _Properties: 1_
    - _Requirements: 2.1, 4.1_

- [x] 4. Implementar a composição contextualizada da mensagem
  - [x] 4.1 Implementar `ReengagementMessageComposer.compose` (puro, fallback determinístico)
    - Criar `apps/api/src/followup/reengagement-message.composer.ts` com o caminho determinístico (template contextual) sempre disponível
    - Referenciar o valor exato do `segment` quando preenchido e o valor exato do `mainPain` quando preenchido; quando ambos vazios, gerar mensagem genérica sem referências
    - Garantir as invariantes de forma: no máximo 1000 caracteres e exatamente uma pergunta/CTA, com normalização final
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x]* 4.2 Escrever testes de propriedade da composição
    - Em `apps/api/src/followup/reengagement-message.composer.spec.ts`, gerar `ReengagementContext` com `segment`/`mainPain` arbitrários (incluindo strings longas e vazias)
    - **Property 9: Mensagem referencia segmento e dor quando preenchidos**
    - **Property 10: Invariantes de forma da mensagem (≤ 1000 caracteres e exatamente uma CTA)**
    - Tags: `// Feature: lead-followup, Property 9: ...` e `// Feature: lead-followup, Property 10: ...`
    - _Properties: 9, 10_
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x]* 4.3 Escrever testes de exemplo/erro do fallback de composição
    - Verificar que, em timeout/erro do enriquecimento opcional, o texto determinístico é usado e as invariantes são mantidas
    - _Requirements: 5.6_

- [x] 5. Implementar o cálculo de anchor e o agendamento de níveis (lógica pura)
  - [x] 5.1 Implementar as funções puras de anchor, offsets e seleção de nível
    - Criar `apps/api/src/followup/followup-scheduling.ts` com: cálculo do `Inactivity_Anchor` (igual a `lastOutboundAt` quando não há inbound posterior ao último outbound), cálculo de `nextRunAt = anchor + offset(n)` com `offset(1)=1h`, `offset(2)=24h`, `offset(3)=48h`, e seleção do próximo nível como `maxSentLevel + 1`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 7.4_

  - [x]* 5.2 Escrever testes de propriedade de anchor/agendamento/seleção
    - Em `apps/api/src/followup/followup.scheduling.property.spec.ts`, gerar timestamps e níveis arbitrários
    - **Property 3: Inactivity_Anchor é a última interação relevante**
    - **Property 4: Cada nível é agendado no offset correto a partir do anchor**
    - **Property 5: Monotonicidade e idempotência dos níveis (1 → 2 → 3, nunca repetir)**
    - Tags: `// Feature: lead-followup, Property 3: ...`, `Property 4: ...`, `Property 5: ...`
    - _Properties: 3, 4, 5_
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 7.1, 7.2, 7.4_

- [x] 6. Implementar o registro de eventos (observabilidade)
  - [x] 6.1 Implementar `FollowUpEventRecorder.record`
    - Criar `apps/api/src/followup/followup-event.recorder.ts` que grava `Follow_Up_Event` em `bot_events` com `conversationId`, `leadId`, `type`, `level?`, `reason?` e o instante em ISO-8601 com precisão de milissegundos
    - Tentar até 3 vezes adicionais em caso de falha (R8.4); esgotadas, logar o erro com `conversationId` + tipo e prosseguir sem interromper (R8.5)
    - _Requirements: 4.4, 6.2, 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x]* 6.2 Escrever testes de exemplo/erro do recorder
    - Em `apps/api/src/followup/followup-event.recorder.spec.ts`, simular falhas de persistência e verificar o retry (até 3 tentativas) e a degradação graciosa sem interromper o processamento
    - _Requirements: 8.4, 8.5_

- [x] 7. Implementar o envio via WhatsApp respeitando limites
  - [x] 7.1 Implementar `FollowUpSender.send` e `isWithinSendWindow`
    - Criar `apps/api/src/followup/followup-sender.service.ts` usando o `ChannelAdapter` do WhatsApp (Evolution) e o `RateLimiterService` existente (chave por telefone)
    - Retornar `deferred(out_of_window)` fora da janela configurada, `deferred(rate_limited)` quando o `RateLimiterService` rejeita, `failed(evolution_error)` em falha do Evolution, e `sent(sentAt)` em confirmação
    - Implementar `isWithinSendWindow(now)` conforme a janela configurada
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.6_

  - [x]* 7.2 Escrever testes de propriedade do sender
    - Em `apps/api/src/followup/followup-sender.property.spec.ts`, com Evolution e RateLimiter fakeados e relógio injetado
    - **Property 14: Disparo fora da janela é adiado sem marcar enviado**
    - **Property 15: Rejeição do Rate_Limiter adia com backoff mínimo de 60s**
    - **Property 16: Envio confirmado atualiza lastOutboundAt**
    - **Property 17: Falha de envio preserva o nível como pendente**
    - Tags: `// Feature: lead-followup, Property 14: ...` ... `Property 17: ...`
    - _Properties: 14, 15, 16, 17_
    - _Requirements: 7.5, 9.2, 9.3, 9.4, 9.6_

  - [x]* 7.3 Escrever testes de integração do envio (wiring Evolution)
    - Em `apps/api/src/followup/followup-sender.integration.spec.ts`, verificar que, dentro da janela e com token disponível, `send` invoca o `ChannelAdapter` do WhatsApp exatamente uma vez; e que falha do adapter produz `evolution_error` mantendo o nível pendente
    - _Requirements: 9.1, 9.4_

- [x] 8. Implementar a orquestração `FollowUpService`
  - [x] 8.1 Implementar `ensureScheduled`
    - Em `apps/api/src/followup/followup.service.ts`, criar/garantir a linha em `follow_up_schedules` e agendar o Nível 1 a partir do `Inactivity_Anchor` (`anchor + 1h`)
    - _Requirements: 1.1, 1.2_

  - [x] 8.2 Implementar `processDue` (reavaliação no disparo, envio, marcação atômica e agendamento do próximo nível)
    - Reavaliar a elegibilidade lendo o snapshot atual no instante do disparo (R2.3); se não elegível, suprimir envio, marcar o nível cancelado, `cycleState=cancelled` e registrar `followup_cancelled` com o motivo correto
    - Se o snapshot estiver indisponível, suprimir envio, manter o nível pendente e registrar `followup_error` (`reevaluation_failed`)
    - Compor a mensagem (com fallback determinístico e timeout de 30s no enriquecimento), enviar via `FollowUpSender`, e tratar `deferred` (reagendar com backoff e incrementar `deferredAttempts`, interrompendo ao atingir `FOLLOWUP_MAX_DEFERRALS`)
    - Em envio confirmado, marcar o nível como enviado de forma atômica (`WHERE max_sent_level < :level`), atualizar `lastOutboundAt`, registrar `followup_sent` e agendar o próximo nível ou preparar o encerramento
    - Em falha de envio, não marcar enviado, manter pendente e registrar `followup_error`; aplicar retry de agendamento até 3 vezes (R1.8) registrando `followup_error` (`schedule_failed`) ao esgotar; respeitar o lock/lease de 60s (R7.3, R7.6)
    - _Requirements: 1.5, 1.7, 1.8, 2.2, 2.3, 2.4, 2.5, 2.6, 5.6, 7.1, 7.2, 7.3, 7.5, 7.6, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x] 8.3 Implementar `onInboundReceived` (cancelamento e reinício)
    - Cancelar de forma atômica e idempotente todos os níveis pendentes; no-op quando não há nível pendente (sem evento, sem alteração)
    - Registrar exatamente um `followup_cancelled` com motivo `resposta_do_lead`; em falha de persistência, preservar pendentes e registrar `followup_error`
    - Se a conversa permanece elegível, redefinir o `Inactivity_Anchor` para o instante do inbound e reiniciar no Nível 1 (`t + 1h`)
    - _Requirements: 1.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 8.4 Implementar `onLeadLost`
    - Ao mudar o status do Lead para `perdido`, cancelar todos os níveis pendentes, não enviar nenhuma mensagem após a mudança e registrar `followup_cancelled` com `conversationId`, `leadId` e motivo `lead_perdido`
    - _Requirements: 4.2, 4.3, 4.4_

  - [x] 8.5 Implementar `completeIfExhausted`
    - Encerrar o ciclo (`cycleState=completed`) quando o Nível 3 foi disparado há mais de 24h sem inbound, sem agendar novos níveis; registrar `followup_completed` com `conversationId` e instante (ms)
    - Não encerrar por `ciclo_concluido` se houver inbound dentro da janela de 24h; em falha de registro do encerramento, preservar o estado `completed` e logar o erro
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x]* 8.6 Escrever testes de propriedade do `FollowUpService` (fakes em memória)
    - Em `apps/api/src/followup/followup.service.property.spec.ts`, com Prisma/Evolution/RateLimiter fakeados e relógio injetado
    - **Property 2: Nunca dispara para conversa não elegível, reavaliando no instante do disparo**
    - **Property 6: Inbound cancela todos os pendentes de forma idempotente com exatamente um evento**
    - **Property 7: Inbound de conversa elegível reinicia o ciclo no Nível 1**
    - **Property 8: Inbound sem nível pendente é no-op**
    - **Property 11: Encerramento após o Nível 3 e estado terminal**
    - **Property 12: Conteúdo e forma dos Follow_Up_Event**
    - **Property 13: Lock de concorrência exclusivo com expiração de 60s**
    - Tags: `// Feature: lead-followup, Property 2: ...` ... `Property 13: ...`
    - _Properties: 2, 6, 7, 8, 11, 12, 13_
    - _Requirements: 1.5, 1.6, 1.7, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.6, 4.2, 4.3, 6.1, 6.3, 6.4, 7.3, 7.6, 8.1, 8.2, 8.3_

  - [x]* 8.7 Escrever testes de exemplo/erro do `FollowUpService`
    - Em `apps/api/src/followup/followup.service.spec.ts`, cobrir falhas com mocks: retry de agendamento esgotado (R1.8), reavaliação indisponível (R2.5), falha de persistência de cancelamento (R2.6 e R3.5), falha ao registrar encerramento (R6.5) e esgotamento de tentativas adiadas (R9.5)
    - _Requirements: 1.8, 2.5, 2.6, 3.5, 6.5, 9.5_

- [x] 9. Checkpoint - garantir que os testes passam
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implementar o agendador periódico `FollowUpSchedulerService`
  - [x] 10.1 Implementar o `tick` com reivindicação por lease e varredura de encerramento
    - Criar `apps/api/src/followup/followup-scheduler.service.ts` com `@Interval(FOLLOWUP_POLL_INTERVAL_MS)` chamando `tick(now)`
    - Reivindicar os schedules vencidos (`nextRunAt <= now`, `cycleState=active`, lock livre) aplicando o lease de 60s (`lockedUntil = now + 60s`) com `SELECT ... FOR UPDATE SKIP LOCKED`, delegando cada um a `FollowUpService.processDue` e liberando o lock ao final
    - Varrer os schedules na janela de encerramento (Nível 3 disparado há mais de 24h) e chamar `FollowUpService.completeIfExhausted`
    - _Requirements: 1.5, 6.1, 7.3, 7.6_

  - [x]* 10.2 Escrever testes do agendador
    - Em `apps/api/src/followup/followup-scheduler.service.spec.ts`, verificar a reivindicação com lease, o respeito ao lock ativo e a delegação a `processDue`/`completeIfExhausted`
    - _Requirements: 7.3, 7.6_

- [x] 11. Criar o módulo e fazer o wiring
  - [x] 11.1 Adicionar a dependência `@nestjs/schedule` e registrar o `ScheduleModule`
    - Adicionar `@nestjs/schedule` em `apps/api/package.json` e registrar `ScheduleModule.forRoot()` no `apps/api/src/app.module.ts`
    - _Requirements: 1.5_

  - [x] 11.2 Criar `FollowUpModule` e importá-lo no `AppModule`
    - Criar `apps/api/src/followup/followup.module.ts` declarando os providers (`FollowUpService`, `FollowUpSchedulerService`, `FollowUpEligibilityService`, `ReengagementMessageComposer`, `FollowUpSender`, `FollowUpEventRecorder`) e importando `PrismaModule`, `ChannelModule`, `AgentModule` e o `RateLimiterService`
    - Exportar `FollowUpService` e importar `FollowUpModule` no `apps/api/src/app.module.ts`
    - _Requirements: 1.5_

- [x] 12. Integrar os hooks no fluxo existente
  - [x] 12.1 Integrar o hook de inbound (cancelamento por resposta)
    - No `InboundMessageProcessor` (`process` / `flushDebouncedTurn`), após persistir o inbound do lead, chamar `followUpService.onInboundReceived(conversationId, now)`
    - _Requirements: 3.1_

  - [x] 12.2 Integrar o hook de desistência (cancelamento por lead perdido)
    - No `ConversationService`, ao detectar transição do status do lead para `perdido` (intent `desistance`), chamar `followUpService.onLeadLost(conversationId, now)`
    - _Requirements: 4.2_

  - [x] 12.3 Integrar `ensureScheduled` após o outbound do bot
    - No fluxo de envio do bot, quando o bot envia um outbound aguardando resposta e a conversa permanece elegível, chamar `followUpService.ensureScheduled(conversationId)` para (re)agendar o Nível 1 a partir do `lastOutboundAt`
    - _Requirements: 1.1_

  - [x]* 12.4 Escrever testes de integração dos hooks
    - Verificar, com fakes do módulo de inbound/conversa, que processar um inbound chama `onInboundReceived` e cancela o ciclo, que a transição para `perdido` chama `onLeadLost`, e que o outbound do bot dispara `ensureScheduled`
    - _Requirements: 3.1, 4.2, 1.1_

- [x] 13. Checkpoint final - garantir que os testes passam
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Fundação da evolução: dados, configuração e tipos (Requisitos 10–13)
  - [x] 14.1 Criar a migração Prisma aditiva `add_followup_deferral_optout` e atualizar o schema
    - Em `apps/api/prisma/schema.prisma`, adicionar ao modelo `FollowUpSchedule` os campos `deferred Boolean @default(false) @map("deferred")` e `deferralOffsetHours Int? @map("deferral_offset_hours") @db.SmallInt`
    - Documentar no schema que `cycleState` passa a aceitar o novo valor textual `'opted_out'` (apenas novo valor de `VARCHAR`, sem alteração de tipo/coluna)
    - Criar `apps/api/prisma/migrations/<timestamp>_add_followup_deferral_optout/migration.sql` aditiva com `ALTER TABLE "follow_up_schedules" ADD COLUMN "deferred" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "deferral_offset_hours" SMALLINT;`
    - Regenerar o Prisma Client após a alteração do schema
    - _Requirements: 11.1, 12.2_

  - [x] 14.2 Estender os tipos, enums e snapshot do follow-up
    - Em `apps/api/src/followup/followup.types.ts`, adicionar `EngagementIntent` (`'interesse_normal' | 'nao_agora' | 'opt_out'`), `TurnContext` (`lastBotMessage: string | null`, `leadMessage: string`) e `EngagementClassification` (`intent`, `confidence`, `deferral?: { durationHours?: number }`, `failSafe: boolean`)
    - Adicionar `opt_out` ao tipo `CancelReason`
    - Adicionar o campo booleano `optedOut` ao `ConversationSnapshot` (derivado de `cycleState === 'opted_out'`)
    - _Requirements: 10.1, 12.2, 12.5_

  - [x] 14.3 Adicionar e validar os novos parâmetros de configuração da evolução
    - Em `apps/api/src/config/config.schema.ts` e `apps/api/src/config/config.service.ts`, adicionar via Joi com defaults seguros: `FOLLOWUP_DEFAULT_DEFERRAL_HOURS` (5), `FOLLOWUP_MIN_DEFERRAL_HOURS` (1), `ENGAGEMENT_CLASSIFIER_TIMEOUT_MS` (10000), `ENGAGEMENT_DEFERRAL_INFER_TIMEOUT_MS` (30000), `ENGAGEMENT_CONFIDENCE_THRESHOLD` (0.70), `ENGAGEMENT_CLASSIFIER_MODEL` ('')
    - Expor os valores tipados no `ConfigService` para consumo pelo classificador e pelo `FollowUpService`
    - _Requirements: 10.6, 10.9, 11.2, 11.3, 11.4_

- [x] 15. Implementar o `EngagementClassifierService` (classificador síncrono e leve do turno)
  - [x] 15.1 Implementar `EngagementClassifierService.classify(ctx: TurnContext)`
    - Criar `apps/api/src/followup/engagement-classifier.service.ts` usando a `LLMProvider` existente (`complete({ responseFormat: 'json' })`) com uma chamada curta (prompt mínimo, temperatura baixa), sem listas de palavras-chave fixas (R10.3)
    - Validar e normalizar o JSON `{ engagementIntent, confidence, deferral? }`; mapear sempre para exatamente um valor de `EngagementIntent`
    - Rebaixar para `interesse_normal` quando `confidence < ENGAGEMENT_CONFIDENCE_THRESHOLD` ou houver empate/ambiguidade (R10.6), inclusive o caso de fato de negócio com negações (R10.5, R10.7)
    - Aplicar `Promise.race` com timeout de `ENGAGEMENT_CLASSIFIER_TIMEOUT_MS` (10s); em timeout, erro ou parse inválido, retornar `interesse_normal` com `failSafe = true` e registrar log de aviso (R10.9)
    - Quando `intent === 'nao_agora'` e o lead indica prazo, preencher `deferral.durationHours` inferido pelo LLM (opcional)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.9_

  - [x]* 15.2 Escrever testes de propriedade do classificador (LLM mockado)
    - Em `apps/api/src/followup/engagement-classifier.property.spec.ts`, gerar retornos do LLM arbitrários (JSON inválido, classes desconhecidas, `confidence ∈ [0,1]`), com a `LLMProvider` fakeada
    - **Property 18: Classificação de engajamento é total e segura sob baixa confiança** (inclui o fato de negócio com negações)
    - **Property 19: Fail-safe da classificação por timeout/erro/indeterminação**
    - Tags: `// Feature: lead-followup, Property 18: ...` e `// Feature: lead-followup, Property 19: ...`
    - _Properties: 18, 19_
    - _Requirements: 10.1, 10.4, 10.5, 10.6, 10.7, 10.9, 13.5_

  - [x]* 15.3 Escrever testes de exemplo adversariais de falso positivo (OBRIGATÓRIOS)
    - Em `apps/api/src/followup/engagement-classifier.spec.ts`, com a `LLMProvider` fakeada, verificar que as mensagens "não, eu volto a te acionar quando eu quiser" e "os clientes não me chamam, eu que chamo eles" resultam em `interesse_normal`
    - _Requirements: 10.7_

- [x] 16. Incorporar o opt-out na elegibilidade
  - [x] 16.1 Atualizar `FollowUpEligibilityService.evaluate` para o estado Opt_Out
    - Em `apps/api/src/followup/followup-eligibility.service.ts`, marcar não elegível quando `optedOut` for verdadeiro, com `reason = 'opt_out'` quando o opt-out for a única causa de inelegibilidade, preservando a precedência de rotulagem de `handoff_humano` e `lead_perdido`
    - _Requirements: 12.2_

  - [x]* 16.2 Estender o teste de propriedade da elegibilidade com o opt-out
    - Em `apps/api/src/followup/followup-eligibility.service.spec.ts`, gerar `ConversationSnapshot` com `optedOut` arbitrário
    - **Property 21: Elegibilidade incorpora o estado Opt_Out**
    - Tag: `// Feature: lead-followup, Property 21: ...`
    - _Properties: 21_
    - _Requirements: 12.2_

- [x] 17. Implementar o follow-up adiado e o opt-out no `FollowUpService`
  - [x] 17.1 Implementar `scheduleDeferred(conversationId, offsetHours, now)`
    - Em `apps/api/src/followup/followup.service.ts`, agendar um `Deferred_Followup` em substituição ao Nível 1: `inactivityAnchor = now`, `maxSentLevel = 0`, `pendingLevel = 1`, `deferred = true`, `deferralOffsetHours = offsetHours`, `nextRunAt = now + offsetHours`
    - Resolver o `Deferral_Offset`: sem prazo → `FOLLOWUP_DEFAULT_DEFERRAL_HOURS` (5h); com `Inferred_Deferral` válido → o valor inferido com piso de `FOLLOWUP_MIN_DEFERRAL_HOURS` (1h) e sem teto; prazo indicado mas inferência inválida/ausente/`< 1h`/timeout → fallback de 5h, mantendo a conversa elegível para o adiado
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.8_

  - [x] 17.2 Adaptar `handleSent` para a retomada da cadência após o adiado
    - Em `apps/api/src/followup/followup.service.ts`, quando `deferred === true` e `level === 1`, retomar a cadência a partir do `sentAt`: agendar o Nível 2 para `sentAt + 24h` e o Nível 3 para `sentAt + 48h`, e desativar o flag `deferred`
    - _Requirements: 11.5_

  - [x] 17.3 Implementar `onOptOut(conversationId, now)`
    - Em `apps/api/src/followup/followup.service.ts`, cancelar todos os níveis pendentes em até 5s, persistir `cycleState = 'opted_out'`, não reiniciar o ciclo e registrar exatamente um `followup_cancelled` com motivo `opt_out` (instante com precisão de ms); idempotente sob turnos repetidos de opt-out (segunda execução: no-op)
    - Em falha de persistência, preservar os níveis pendentes, suprimir novos envios e registrar `followup_error`
    - _Requirements: 12.1, 12.2, 12.5, 12.6, 12.7_

  - [x] 17.4 Implementar `resumeFromOptOut(conversationId, now)`
    - Em `apps/api/src/followup/followup.service.ts`, ao receber um turno posterior `interesse_normal` em conversa `opted_out`, remover o estado Opt_Out, redefinir o `Inactivity_Anchor` para `now` e reiniciar o ciclo a partir do Nível 1 (delegando ao mesmo caminho de reinício do `onInboundReceived`)
    - _Requirements: 12.4_

  - [x]* 17.5 Escrever testes de propriedade do `FollowUpService` para a evolução (fakes em memória)
    - Em `apps/api/src/followup/followup.service.deferral-optout.property.spec.ts`, com Prisma/Evolution/RateLimiter fakeados e relógio injetado
    - **Property 22: nao_agora agenda o Deferred_Followup substituindo o Nível 1**
    - **Property 23: Resolução do Deferral_Offset (default, inferido com piso, fallback)**
    - **Property 24: Disparo do Deferred_Followup retoma a cadência normal**
    - **Property 25: Opt-out cancela sem reiniciar, é idempotente e registra um único evento; reentrada reinicia no Nível 1**
    - Tags: `// Feature: lead-followup, Property 22: ...` ... `Property 25: ...`
    - _Properties: 22, 23, 24, 25_
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.8, 12.1, 12.4, 12.5, 12.6_

- [x] 18. Integrar a classificação no pipeline do turno e o roteamento sem escalonamento indevido
  - [x] 18.1 Integrar o `EngagementClassifierService` no `ConversationService.handleInboundMessage`
    - Em `apps/api/src/.../conversation.service.ts`, inserir a resolução do Engagement_Intent entre `resolveIntent` (passo 7) e a decisão de handoff (passo 8), concluindo antes da geração da resposta (R13.3, R13.4)
    - Aplicar a heurística de gating barata e determinística: só chamar o LLM quando houver follow-up pendente/ativo (`cycleState ∈ {active, opted_out}`), estado `suggested`, lead qualificado (`qualificationReadyForOffer`), ou negação combinada a referência temporal/recusa; caso contrário assumir `interesse_normal` sem chamar o LLM
    - _Requirements: 10.8, 13.1, 13.2, 13.3, 13.4, 13.5_

  - [x] 18.2 Implementar o early-branch de desfecho por Engagement_Intent
    - Em `apps/api/src/.../conversation.service.ts`, após resolver o Engagement_Intent: `nao_agora` → resposta determinística de reconhecimento do adiamento (≤30s) + `FollowUpService.scheduleDeferred`, sem handoff; `opt_out` → confirmação determinística de baixa + `FollowUpService.onOptOut`, sem handoff; `interesse_normal` em conversa `opted_out` → `FollowUpService.resumeFromOptOut`
    - Garantir que `nao_agora`/`opt_out` NUNCA marquem `finalHandoff` nem sejam tratados como `handoff_accept` (curto-circuitando a regra de auto-escala do `general` em `suggested` — corrige o bug do "quando")
    - _Requirements: 10.8, 11.6, 12.3, 12.4, 13.1, 13.2_

  - [x]* 18.3 Escrever teste de propriedade de roteamento do desengajamento
    - Em `apps/api/src/.../conversation.service.engagement-routing.property.spec.ts`, gerar estados de handoff arbitrários (`none`, `suggested`, `accepted`) com Engagement_Intent `nao_agora`/`opt_out`
    - **Property 20: Desengajamento nunca escala para o time humano**
    - Tag: `// Feature: lead-followup, Property 20: ...`
    - _Properties: 20_
    - _Requirements: 10.8, 12.3, 13.1, 13.2_

  - [x]* 18.4 Escrever testes de integração do turno
    - Verificar, com fakes do classificador/FollowUpService, que um inbound `nao_agora` aciona `scheduleDeferred` sem handoff, que um inbound `opt_out` aciona `onOptOut` sem handoff, e que a classificação é concluída antes da geração da resposta (sem depender da análise assíncrona de CRM)
    - _Requirements: 13.3, 13.4_

- [x] 19. Checkpoint final da evolução - garantir que todos os testes passam e o build está limpo
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tarefas marcadas com `*` são opcionais (testes) e podem ser puladas para um MVP mais rápido; as tarefas de implementação principal nunca são opcionais.
- Cada tarefa referencia os requisitos específicos para rastreabilidade, e as tarefas de teste de propriedade referenciam a propriedade do design correspondente.
- Os testes baseados em propriedade usam `fast-check` (já presente no projeto), com mínimo de 100 iterações e a tag de comentário no padrão `// Feature: lead-followup, Property N: ...`.
- Os efeitos de borda (Prisma, Evolution, Rate_Limiter, relógio) são injetados como fakes/mocks em memória e relógios determinísticos (`now` injetado) para manter as propriedades rápidas e determinísticas.
- Critérios temporais (≤ 5s, ≤ 60s de tolerância) são validados pela lógica de agendamento/cadência do poll, não por assertivas de wall-clock.

## Task Dependency Graph

As tarefas 1–13 já estão concluídas e não constam do grafo. As ondas abaixo cobrem apenas as tarefas incompletas da evolução (14–18), respeitando conflitos de arquivo: `17.1`–`17.4` editam `followup.service.ts` (ondas separadas) e `18.1`–`18.2` editam `conversation.service.ts` (ondas separadas).

```json
{
  "waves": [
    { "id": 0, "tasks": ["14.1", "14.2", "14.3"] },
    { "id": 1, "tasks": ["15.1", "16.1"] },
    { "id": 2, "tasks": ["15.2", "15.3", "16.2", "17.1"] },
    { "id": 3, "tasks": ["17.2"] },
    { "id": 4, "tasks": ["17.3"] },
    { "id": 5, "tasks": ["17.4"] },
    { "id": 6, "tasks": ["17.5", "18.1"] },
    { "id": 7, "tasks": ["18.2"] },
    { "id": 8, "tasks": ["18.3", "18.4"] }
  ]
}
```
