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

## Notes

- Tarefas marcadas com `*` são opcionais (testes) e podem ser puladas para um MVP mais rápido; as tarefas de implementação principal nunca são opcionais.
- Cada tarefa referencia os requisitos específicos para rastreabilidade, e as tarefas de teste de propriedade referenciam a propriedade do design correspondente.
- Os testes baseados em propriedade usam `fast-check` (já presente no projeto), com mínimo de 100 iterações e a tag de comentário no padrão `// Feature: lead-followup, Property N: ...`.
- Os efeitos de borda (Prisma, Evolution, Rate_Limiter, relógio) são injetados como fakes/mocks em memória e relógios determinísticos (`now` injetado) para manter as propriedades rápidas e determinísticas.
- Critérios temporais (≤ 5s, ≤ 60s de tolerância) são validados pela lógica de agendamento/cadência do poll, não por assertivas de wall-clock.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1"] },
    { "id": 1, "tasks": ["2.2", "3.1", "4.1", "5.1", "6.1"] },
    { "id": 2, "tasks": ["3.2", "4.2", "5.2", "6.2", "7.1"] },
    { "id": 3, "tasks": ["4.3", "7.2", "7.3", "8.1"] },
    { "id": 4, "tasks": ["8.2"] },
    { "id": 5, "tasks": ["8.3"] },
    { "id": 6, "tasks": ["8.4"] },
    { "id": 7, "tasks": ["8.5"] },
    { "id": 8, "tasks": ["8.6", "8.7", "10.1"] },
    { "id": 9, "tasks": ["10.2", "11.1"] },
    { "id": 10, "tasks": ["11.2"] },
    { "id": 11, "tasks": ["12.1", "12.2"] },
    { "id": 12, "tasks": ["12.3"] },
    { "id": 13, "tasks": ["12.4"] }
  ]
}
```
