# Requirements Document

## Introduction

O ResponseGuardService é uma camada determinística de pós-processamento que executa DEPOIS que o LLM/regra local gera uma resposta e ANTES de salvar/enviar ao cliente. O objetivo é corrigir padrões problemáticos conhecidos na resposta do agente sem alterar o LLM, prompts, intent classifier, async analysis ou a arquitetura existente do AgentReplyService, AgentAnalysisService e ConversationService.

O serviço recebe o reply gerado junto com contexto da conversa (mensagem do usuário, estado, fatos conhecidos, flags de handoff) e retorna o reply corrigido com indicação se houve alteração e o motivo.

## Glossary

- **Response_Guard**: Serviço NestJS (`ResponseGuardService`) que aplica regras determinísticas de pós-processamento na resposta gerada pelo agente antes do salvamento.
- **Guard_Input**: Objeto de entrada contendo `{ reply, userMessage, conversationState, leadSummary, intent, handoffOffered, handoffAccepted, handoffCompleted, priceAskedCount, knownFacts }`.
- **Guard_Output**: Objeto de saída contendo `{ reply: string, changed: boolean, guardReason: string | null }`.
- **Conversation_State**: Estado atual da conversa incluindo stage e histórico.
- **Lead_Summary**: Resumo do lead com segment, pains, volume e dados coletados.
- **Known_Facts**: Objeto com fatos extraídos da conversa (segment, volume, pains, etc.), produzido pelo FactExtractorService.
- **Handoff_Offered**: Flag indicando que o agente já ofereceu encaminhamento ao cliente.
- **Handoff_Accepted**: Flag indicando que o cliente aceitou o encaminhamento.
- **Handoff_Completed**: Flag indicando que o encaminhamento foi finalizado.
- **Isolated_Handoff**: Reply que contém apenas uma oferta de encaminhamento genérica sem contexto (ex: "Posso encaminhar?").
- **Contextual_Handoff**: Reply que contextualiza o cenário do cliente antes de oferecer encaminhamento.
- **Safe_Price_Response**: Resposta padrão para perguntas de preço que não promete valores nem bloqueia o atendimento.
- **IA_Explanation_Phrase**: Frase longa explicando como a IA funciona: "A IA responde com base em regras, base de conhecimento e limites definidos. Quando a conversa foge do esperado, ela encaminha para humano."
- **Pricing_Range_Enabled**: Flag de configuração indicando se há faixa de preço configurada para o agente.
- **Conversation_Service**: Serviço existente que orquestra o fluxo de mensagens e chamará o Response_Guard após geração do reply.

## Requirements

### Requirement 1: Block isolated handoff offers

**User Story:** As a conversation designer, I want isolated handoff phrases to be replaced with contextual responses, so that the client always receives context before a handoff offer.

#### Acceptance Criteria

1. WHEN the reply is exactly "Posso encaminhar?" or a short variant without contextual preamble, THE Response_Guard SHALL replace the reply with a Contextual_Handoff response based on the Known_Facts segment.
2. WHEN the Known_Facts segment matches "clínica" or "clinica", THE Response_Guard SHALL use the clinic-specific contextual handoff template.
3. WHEN the Known_Facts segment matches "etiqueta" or "fábrica" or "fabrica", THE Response_Guard SHALL use the label/factory-specific contextual handoff template.
4. WHEN the Known_Facts segment matches "restaurante", THE Response_Guard SHALL use the restaurant-specific contextual handoff template.
5. WHEN the Known_Facts segment matches "academia" or "fitness", THE Response_Guard SHALL use the gym-specific contextual handoff template.
6. WHEN the Known_Facts segment matches "contabil" or "escritório" or "escritorio", THE Response_Guard SHALL use the accounting-specific contextual handoff template.
7. WHEN the Known_Facts segment does not match any known niche, THE Response_Guard SHALL use the fallback contextual handoff template.
8. THE Response_Guard SHALL detect Isolated_Handoff variants including: "Posso encaminhar?", "Quer que eu encaminhe?", "Deseja seguir?", "Interessa?", and other short-form handoff questions below 60 characters that lack contextual preamble.

### Requirement 2: Handoff completed priority response

**User Story:** As a conversation designer, I want the system to always acknowledge that handoff was already done when the client confirms after completion, so that the client is never confused about their status.

#### Acceptance Criteria

1. WHEN Handoff_Completed is true AND the user message is an acceptance or acknowledgment phrase, THE Response_Guard SHALL replace the reply with "Seu atendimento já foi encaminhado para a equipe da Decodifica com o resumo do cenário."
2. THE Response_Guard SHALL recognize acceptance phrases including: "sim", "pode", "pode encaminhar", "sim pode encaminhar", "tá bom manda", "quero proposta", "manda", "ok".
3. WHEN Handoff_Completed is true, THE Response_Guard SHALL apply rule 2 with higher priority than all other guard rules.

### Requirement 3: Fix price responses

**User Story:** As a conversation designer, I want price-deflecting replies to be replaced with helpful safe responses, so that clients asking about price are not blocked or frustrated.

#### Acceptance Criteria

1. WHEN the user message contains a price keyword (preço, valor, custa, orçamento, faixa) AND the reply contains a price-blocking phrase, THE Response_Guard SHALL replace the reply with a Safe_Price_Response.
2. WHEN Pricing_Range_Enabled is false, THE Response_Guard SHALL use the response: "Sem uma faixa configurada aqui, não consigo te passar um valor fechado. O que posso fazer é encaminhar para a equipe te dar uma estimativa direta com base no seu caso, sem mais perguntas."
3. WHEN Pricing_Range_Enabled is true, THE Response_Guard SHALL use a response referencing the configured starting price from Lead_Summary.
4. THE Response_Guard SHALL detect price-blocking phrases including: "Não trabalho com valores", "Não trabalho com faixas", "não posso informar", "não consigo informar", "prefiro que a equipe".

### Requirement 4: Handle frustrated client about price

**User Story:** As a conversation designer, I want frustrated price requests to receive direct price responses without additional diagnosis questions, so that impatient clients are not alienated.

#### Acceptance Criteria

1. WHEN the user message matches a frustration-about-price pattern, THE Response_Guard SHALL apply the Safe_Price_Response regardless of the current reply content.
2. THE Response_Guard SHALL detect frustration-about-price patterns including: "só me diz quanto custa", "não tenho tempo", "não quero contar minha vida", "me dá uma faixa", "quero saber o preço mesmo".
3. WHEN frustration-about-price is detected AND the reply contains additional diagnostic questions, THE Response_Guard SHALL remove the diagnostic questions and replace with the Safe_Price_Response.

### Requirement 5: Fix broken phrases

**User Story:** As a conversation designer, I want known text artifacts and broken phrases in replies to be automatically corrected, so that the client always receives grammatically correct and professional responses.

#### Acceptance Criteria

1. WHEN the reply contains "Sua pressa, mas", THE Response_Guard SHALL replace it with "Entendo sua pressa, mas".
2. WHEN the reply contains "Sua pressa." as a standalone sentence fragment, THE Response_Guard SHALL replace it with "Entendo sua pressa."
3. WHEN the reply contains "falta de organizam", THE Response_Guard SHALL replace it with "falta de organização".
4. WHEN the reply contains "Não trabalho com valores.", THE Response_Guard SHALL replace it with the Safe_Price_Response.
5. WHEN the reply contains "Não trabalho com faixas de preço.", THE Response_Guard SHALL replace it with the Safe_Price_Response.
6. WHEN the reply contains exclamation marks, THE Response_Guard SHALL replace each exclamation mark with a period.

### Requirement 6: Prevent repeated IA explanation

**User Story:** As a conversation designer, I want the long IA explanation to appear at most once per conversation, so that the client does not receive repetitive boilerplate.

#### Acceptance Criteria

1. WHEN the reply contains the IA_Explanation_Phrase AND the conversation history already includes that phrase in a previous assistant message, THE Response_Guard SHALL replace the IA_Explanation_Phrase with: "A ideia é automatizar o que é repetitivo e encaminhar para humano quando o atendimento exigir mais cuidado."
2. WHEN the reply contains the IA_Explanation_Phrase AND the conversation history does not include that phrase, THE Response_Guard SHALL keep the phrase unchanged.
3. THE Response_Guard SHALL detect the IA_Explanation_Phrase by partial match against the key substring "A IA responde com base em regras, base de conhecimento e limites definidos".

### Requirement 7: Block handoff before explicit acceptance

**User Story:** As a conversation designer, I want the guard to prevent handoff state escalation when only an offer is made, so that handoff only triggers when the client explicitly accepts.

#### Acceptance Criteria

1. WHEN the reply only offers handoff (contains an offer question without confirmation language) AND Handoff_Accepted is false, THE Response_Guard SHALL maintain the Guard_Output status as "qualificando" and set Handoff_Offered to true without transitioning to "chamar_humano".
2. THE Response_Guard SHALL only allow transition to "chamar_humano" status WHEN the user message contains a clear acceptance phrase.

### Requirement 8: Service interface and integration contract

**User Story:** As a developer, I want the ResponseGuardService to have a clear input/output contract and integration point, so that it can be called from ConversationService without modifying existing architecture.

#### Acceptance Criteria

1. THE Response_Guard SHALL accept a Guard_Input object and return a Guard_Output object synchronously.
2. THE Response_Guard SHALL set `changed` to true in Guard_Output WHEN any rule modifies the original reply.
3. THE Response_Guard SHALL set `guardReason` to a descriptive string identifying which rule triggered the change WHEN `changed` is true.
4. THE Response_Guard SHALL set `guardReason` to null WHEN `changed` is false.
5. THE Response_Guard SHALL be called from Conversation_Service after reply generation and before saving the assistant message.
6. THE Response_Guard SHALL NOT modify, call, or depend on the LLM provider, prompt builder, intent classifier, or async analysis services.
7. THE Response_Guard SHALL be implemented as a NestJS Injectable service at `apps/api/src/agent/response-guard.service.ts`.

### Requirement 9: Rule priority ordering

**User Story:** As a developer, I want guard rules to execute in a defined priority order, so that conflicts between rules are resolved deterministically.

#### Acceptance Criteria

1. THE Response_Guard SHALL apply rules in the following priority order: Rule 2 (handoff completed) > Rule 4 (frustrated price) > Rule 1 (isolated handoff) > Rule 3 (price response fix) > Rule 5 (broken phrases) > Rule 6 (IA explanation) > Rule 7 (block premature handoff).
2. WHEN a higher-priority rule modifies the reply, THE Response_Guard SHALL still apply lower-priority rules that operate on different aspects of the reply (non-conflicting transformations like exclamation removal).
3. WHEN a higher-priority rule fully replaces the reply, THE Response_Guard SHALL skip lower-priority rules that would fully replace the reply again.
