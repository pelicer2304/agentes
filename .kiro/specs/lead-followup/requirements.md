# Requirements Document

## Introduction

Esta feature adiciona um mecanismo de **follow-up automático de leads** ao agente conversacional (NestJS + Prisma + Postgres, canal WhatsApp via Evolution). Quando um lead para de interagir, o sistema reengaja em três níveis temporais — 1 hora, 1 dia e 2 dias após a última inatividade — com mensagens contextualizadas que retomam o que já foi mapeado na conversa (segmento, dor principal, etc.) para tentar **requalificar** o lead e fazê-lo avançar na qualificação.

A regra mais importante é de **elegibilidade**: um lead que já foi encaminhado ao time humano (handoff) não pode entrar nem permanecer no follow-up. O sistema também precisa cancelar o ciclo quando o lead volta a responder, quando desiste, e encerrar de forma definitiva após o terceiro nível sem resposta. O comportamento precisa ser idempotente (nunca disparar o mesmo nível duas vezes nem follow-ups concorrentes) e observável (cada disparo, cancelamento e encerramento é registrado como evento).

O escopo desta feature é a **decisão e o agendamento** do follow-up e o registro dos eventos. A composição textual final reaproveita o mecanismo de geração de resposta já existente, mas a feature define o contexto e o gatilho.

## Glossary

- **Follow_Up_Service**: componente responsável por agendar, avaliar a elegibilidade, disparar e cancelar os follow-ups de uma conversa.
- **Scheduler**: componente que avalia periodicamente as conversas pendentes e aciona o Follow_Up_Service quando um nível de follow-up vence.
- **Lead**: registro do contato comercial (tabela `leads`), com `status` em {`novo`, `qualificando`, `chamar_humano`, `perdido`}.
- **Conversation**: registro da conversa (tabela `conversations`), com `stage` em {`abertura`, `descoberta`, `conversao`, `handoff_humano`}, `status` em {`active`, `inactive`}, e os campos `botPaused`, `assignedTo`, `handoffOffered`, `handoffAccepted`, `handoffCompleted`, `handoffRequired`, `lastInboundAt`, `lastOutboundAt`.
- **Follow_Up_Level**: nível temporal do follow-up. Nível 1 = 1 hora, Nível 2 = 1 dia (24 horas), Nível 3 = 2 dias (48 horas), contados a partir do Inactivity_Anchor.
- **Inactivity_Anchor**: instante a partir do qual a inatividade é medida, definido como a última interação relevante da conversa (`lastOutboundAt` quando o último envio foi do bot aguardando resposta; reiniciado por nova mensagem inbound).
- **Reengagement_Message**: mensagem de reengajamento gerada para um Follow_Up_Level, que retoma o contexto já mapeado (segmento, dor principal) para requalificar o Lead.
- **Eligible_Conversation**: Conversation que satisfaz todas as condições de elegibilidade definidas no Requisito 2.
- **Handoff_Humano**: estado em que o Lead foi encaminhado ao time humano, caracterizado por qualquer uma das condições do Requisito 2.1.
- **Follow_Up_Event**: registro de auditoria gravado na tabela `bot_events` descrevendo um disparo, cancelamento ou encerramento de follow-up.
- **Evolution_Channel**: integração de envio de mensagens WhatsApp via Evolution API.
- **Rate_Limiter**: componente existente que impõe limites de frequência de envio por destinatário.

## Requirements

### Requisito 1: Agendamento dos três níveis de follow-up

**História do usuário:** Como operador comercial, quero que o sistema agende automaticamente follow-ups em 1 hora, 1 dia e 2 dias após a inatividade do lead, para que leads parados sejam reengajados sem ação manual.

#### Critérios de Aceitação

1. WHEN uma Conversation não registra nenhuma mensagem inbound do Lead em momento posterior ao último envio outbound do bot, THE Follow_Up_Service SHALL definir o Inactivity_Anchor como o valor de timestamp de `lastOutboundAt` dessa Conversation.
2. WHERE uma Conversation é Eligible_Conversation, THE Scheduler SHALL agendar o Follow_Up_Level 1 para o instante igual a Inactivity_Anchor mais 1 hora, com desvio máximo de 60 segundos em relação ao instante agendado.
3. WHEN o Follow_Up_Level 1 é disparado sem que o Lead registre mensagem inbound, THE Scheduler SHALL agendar o Follow_Up_Level 2 para o instante igual a Inactivity_Anchor mais 24 horas, com desvio máximo de 60 segundos em relação ao instante agendado.
4. WHEN o Follow_Up_Level 2 é disparado sem que o Lead registre mensagem inbound, THE Scheduler SHALL agendar o Follow_Up_Level 3 para o instante igual a Inactivity_Anchor mais 48 horas, com desvio máximo de 60 segundos em relação ao instante agendado.
5. WHEN o instante agendado de um Follow_Up_Level é alcançado, THE Scheduler SHALL solicitar ao Follow_Up_Service a avaliação de elegibilidade da Conversation antes de qualquer envio.
6. IF o Lead registra uma mensagem inbound antes do disparo de um Follow_Up_Level agendado, THEN THE Scheduler SHALL cancelar todos os Follow_Up_Level pendentes dessa Conversation.
7. IF a avaliação de elegibilidade solicitada no critério 5 retorna não elegível, THEN THE Follow_Up_Service SHALL suprimir o envio do Follow_Up_Level correspondente e impedir o agendamento dos níveis seguintes dessa Conversation.
8. IF a operação de agendamento de um Follow_Up_Level falha, THEN THE Scheduler SHALL repetir a tentativa de agendamento em até 3 vezes e, esgotadas as tentativas, registrar uma indicação de falha do agendamento sem disparar o Follow_Up_Level.

### Requisito 2: Elegibilidade e cancelamento por encaminhamento ao humano

**História do usuário:** Como operador comercial, quero que leads já encaminhados ao time humano nunca recebam follow-up automático, para que o bot não atrapalhe um atendimento humano em andamento.

#### Critérios de Aceitação

1. IF uma Conversation possui `status` do Lead igual a `chamar_humano`, OU `handoffAccepted` igual a verdadeiro, OU `handoffCompleted` igual a verdadeiro, OU `stage` igual a `handoff_humano`, OU `botPaused` igual a verdadeiro, OU `assignedTo` com valor não nulo e diferente de string vazia, THEN THE Follow_Up_Service SHALL classificar a Conversation como não elegível.
2. IF uma Conversation é classificada como não elegível por encaminhamento ao humano, THEN THE Follow_Up_Service SHALL marcar como cancelados todos os Follow_Up_Level pendentes dessa Conversation no mesmo ciclo de avaliação e SHALL não agendar novos Follow_Up_Level enquanto a Conversation permanecer não elegível.
3. WHEN o instante de disparo de um Follow_Up_Level é atingido, THE Follow_Up_Service SHALL reavaliar todas as condições do critério 1 utilizando os dados da Conversation persistidos e lidos nesse instante de disparo, sem reutilizar dados obtidos antes do instante de disparo, antes de enviar a Reengagement_Message.
4. IF uma Conversation é classificada como não elegível por encaminhamento ao humano no instante de disparo, THEN THE Follow_Up_Service SHALL suprimir o envio da Reengagement_Message, SHALL marcar o Follow_Up_Level como cancelado e SHALL registrar um evento de cancelamento com indicação de que o motivo foi o encaminhamento ao humano.
5. IF a reavaliação de elegibilidade no instante de disparo não pode ser concluída por indisponibilidade dos dados da Conversation, THEN THE Follow_Up_Service SHALL suprimir o envio da Reengagement_Message, SHALL preservar o Follow_Up_Level no estado pendente e SHALL registrar um evento indicando a falha de reavaliação.
6. IF o cancelamento dos Follow_Up_Level pendentes não pode ser persistido, THEN THE Follow_Up_Service SHALL preservar esses Follow_Up_Level no estado pendente, SHALL suprimir o envio da Reengagement_Message e SHALL registrar um evento indicando a falha de cancelamento.

### Requisito 3: Cancelamento por resposta do lead

**História do usuário:** Como operador comercial, quero que o ciclo de follow-up seja cancelado quando o lead volta a responder, para que o bot não envie cobranças a quem já reengajou.

#### Critérios de Aceitação

1. WHEN uma nova mensagem inbound é recebida em uma Conversation com pelo menos um Follow_Up_Level pendente, THE Follow_Up_Service SHALL cancelar todos os Follow_Up_Level pendentes dessa Conversation em até 5 segundos após o registro da mensagem inbound.
2. WHEN uma nova mensagem inbound é recebida e a Conversation permanece elegível (status ativo e sem opt-out registrado), THE Follow_Up_Service SHALL redefinir o Inactivity_Anchor para o instante de recebimento da mensagem inbound e reiniciar o agendamento a partir do Follow_Up_Level 1.
3. WHEN uma mensagem inbound cancela um ciclo de follow-up, THE Follow_Up_Service SHALL registrar exatamente um Follow_Up_Event de cancelamento contendo o motivo `resposta_do_lead` e o instante do cancelamento.
4. IF uma nova mensagem inbound é recebida em uma Conversation sem nenhum Follow_Up_Level pendente, THEN THE Follow_Up_Service SHALL ignorar a operação de cancelamento, sem registrar Follow_Up_Event de cancelamento e sem alterar agendamentos existentes.
5. IF o cancelamento dos Follow_Up_Level pendentes falha, THEN THE Follow_Up_Service SHALL preservar o estado pendente desses Follow_Up_Level, registrar um Follow_Up_Event de erro indicando a falha de cancelamento e reter a mensagem inbound para nova tentativa.
6. WHILE existir um cancelamento em processamento para a mesma Conversation, THE Follow_Up_Service SHALL processar mensagens inbound adicionais de forma idempotente, sem cancelar novamente Follow_Up_Level já cancelados e sem duplicar o Follow_Up_Event de cancelamento.

### Requisito 4: Cancelamento por desistência do lead

**História do usuário:** Como operador comercial, quero que leads que desistiram não recebam follow-up, para respeitar a decisão do lead e evitar contato indesejado.

#### Critérios de Aceitação

1. IF o `status` do Lead de uma Conversation é igual a `perdido`, THEN THE Follow_Up_Service SHALL classificar a Conversation como não elegível e SHALL não agendar novos Follow_Up_Level para essa Conversation.
2. WHEN o `status` do Lead muda para `perdido`, THE Follow_Up_Service SHALL cancelar todos os Follow_Up_Level pendentes dessa Conversation e SHALL não enviar nenhuma Reengagement_Message após a mudança de status.
3. IF o instante de disparo de um Follow_Up_Level é atingido e o `status` do Lead é igual a `perdido`, THEN THE Follow_Up_Service SHALL suprimir o envio da Reengagement_Message e SHALL marcar o Follow_Up_Level como cancelado.
4. WHEN um follow-up é cancelado por desistência, THE Follow_Up_Service SHALL registrar um Follow_Up_Event de cancelamento contendo o `conversationId`, o `leadId` e o motivo `lead_perdido`.

### Requisito 5: Mensagens contextualizadas de requalificação

**História do usuário:** Como operador comercial, quero que cada mensagem de follow-up retome o contexto já mapeado da conversa, para aumentar a chance de requalificar o lead em vez de soar genérica.

#### Critérios de Aceitação

1. WHEN o Follow_Up_Service dispara um Follow_Up_Level para uma Eligible_Conversation e o segmento do Lead está preenchido, THE Follow_Up_Service SHALL gerar uma Reengagement_Message que referencia o valor exato do segmento do Lead.
2. WHEN o Follow_Up_Service gera uma Reengagement_Message e a dor principal do Lead está preenchida, THE Follow_Up_Service SHALL referenciar textualmente o valor exato da dor principal mapeada na Reengagement_Message.
3. WHEN o Follow_Up_Service gera uma Reengagement_Message, THE Follow_Up_Service SHALL incluir exatamente uma pergunta ou chamada para ação que conduza o Lead ao próximo Follow_Up_Level de qualificação.
4. IF o segmento e a dor principal do Lead não estão preenchidos, THEN THE Follow_Up_Service SHALL gerar uma Reengagement_Message de reengajamento genérico, sem referências a segmento ou dor, contendo exatamente uma pergunta ou chamada para ação que convide o Lead a retomar a conversa.
5. WHEN o Follow_Up_Service gera uma Reengagement_Message, THE Follow_Up_Service SHALL limitar o conteúdo da mensagem a no máximo 1000 caracteres.
6. IF a geração da Reengagement_Message falha ou excede 30 segundos, THEN THE Follow_Up_Service SHALL preservar o Follow_Up_Level como não enviado e SHALL registrar uma indicação de falha.

### Requisito 6: Encerramento após o último nível

**História do usuário:** Como operador comercial, quero que o follow-up pare após o terceiro nível sem resposta, para que o bot não cobre o lead indefinidamente.

#### Critérios de Aceitação

1. WHEN o Follow_Up_Level 3 é disparado e o Lead não envia mensagem inbound dentro da janela de resposta de 24 horas contadas a partir do disparo, THE Follow_Up_Service SHALL encerrar o ciclo de follow-up da Conversation sem agendar novos níveis.
2. WHEN um ciclo de follow-up é encerrado por esgotamento dos níveis, THE Follow_Up_Service SHALL registrar, em até 5 segundos após o encerramento, um Follow_Up_Event de encerramento contendo o motivo `ciclo_concluido` e o identificador da Conversation.
3. WHILE um ciclo de follow-up está encerrado por esgotamento, THE Follow_Up_Service SHALL impedir qualquer novo disparo de follow-up para a Conversation até que uma nova mensagem inbound reinicie o ciclo conforme o Requisito 3.
4. IF o Lead envia uma mensagem inbound dentro da janela de resposta de 24 horas contadas a partir do disparo do Follow_Up_Level 3, THEN THE Follow_Up_Service SHALL não encerrar o ciclo pelo motivo `ciclo_concluido` e tratar a mensagem conforme o Requisito 3.
5. IF o registro do Follow_Up_Event de encerramento falha, THEN THE Follow_Up_Service SHALL manter a Conversation no estado encerrado sem agendar novos níveis e registrar uma indicação de erro identificando a falha de persistência.

### Requisito 7: Idempotência dos disparos

**História do usuário:** Como operador comercial, quero garantir que cada nível de follow-up seja enviado no máximo uma vez e que não existam follow-ups concorrentes, para evitar mensagens duplicadas ao lead.

#### Critérios de Aceitação

1. WHEN um Follow_Up_Level é enviado com sucesso para uma Conversation e a confirmação de envio é recebida, THE Follow_Up_Service SHALL registrar de forma atômica esse Follow_Up_Level como enviado para essa Conversation antes de avaliar qualquer disparo subsequente.
2. IF um Follow_Up_Level já está registrado como enviado para uma Conversation, THEN THE Follow_Up_Service SHALL suprimir qualquer disparo repetido do mesmo Follow_Up_Level para essa Conversation, sem produzir nova mensagem ao lead.
3. WHILE um disparo de follow-up está em andamento para uma Conversation, THE Follow_Up_Service SHALL impedir o início de outro disparo de follow-up concorrente para a mesma Conversation e SHALL retornar uma indicação de bloqueio ativo ao chamador.
4. WHEN o Scheduler avalia uma Conversation que já teve um Follow_Up_Level enviado no ciclo atual, THE Scheduler SHALL selecionar exatamente o próximo Follow_Up_Level pendente do ciclo, em ordem crescente de nível, e nenhum outro.
5. IF o envio de um Follow_Up_Level falha para uma Conversation, THEN THE Follow_Up_Service SHALL NOT registrar esse Follow_Up_Level como enviado, SHALL mantê-lo como pendente para nova tentativa e SHALL registrar uma indicação de falha.
6. IF um disparo de follow-up permanece em andamento por mais de 60 segundos sem confirmação de sucesso ou de falha para uma Conversation, THEN THE Follow_Up_Service SHALL liberar o bloqueio de concorrência dessa Conversation e SHALL tratar o respectivo Follow_Up_Level como não enviado.

### Requisito 8: Observabilidade dos eventos de follow-up

**História do usuário:** Como operador comercial, quero registrar cada follow-up enviado, cancelado ou encerrado, para auditar e medir a eficácia do reengajamento.

#### Critérios de Aceitação

1. WHEN uma Reengagement_Message é enviada com sucesso, THE Follow_Up_Service SHALL registrar, em até 5 segundos após a confirmação de envio, um Follow_Up_Event do tipo `followup_sent` contendo o `conversationId`, o `leadId`, o Follow_Up_Level (valor inteiro entre 1 e o número máximo de níveis configurado) e o instante de ocorrência em formato de data e hora com precisão de milissegundos.
2. WHEN um ciclo de follow-up é cancelado, THE Follow_Up_Service SHALL registrar, em até 5 segundos após o cancelamento, um Follow_Up_Event do tipo `followup_cancelled` contendo o `conversationId`, o `leadId`, o motivo do cancelamento (selecionado dentre o conjunto definido de motivos válidos) e o instante de ocorrência em formato de data e hora com precisão de milissegundos.
3. WHEN um ciclo de follow-up é encerrado por esgotamento dos níveis, THE Follow_Up_Service SHALL registrar, em até 5 segundos após o encerramento, um Follow_Up_Event do tipo `followup_completed` contendo o `conversationId`, o `leadId` e o instante de ocorrência em formato de data e hora com precisão de milissegundos.
4. IF o registro de um Follow_Up_Event falha, THEN THE Follow_Up_Service SHALL repetir a tentativa de registro até 3 vezes adicionais antes de desistir.
5. IF as tentativas de registro de um Follow_Up_Event se esgotam sem sucesso, THEN THE Follow_Up_Service SHALL registrar o erro em log com indicação do `conversationId` e do tipo de evento afetado e prosseguir o processamento da Conversation sem interrupção, preservando o estado atual do ciclo de follow-up.

### Requisito 9: Envio pelo canal WhatsApp respeitando limites

**História do usuário:** Como operador comercial, quero que os follow-ups sejam enviados pelo WhatsApp respeitando os limites de envio, para evitar bloqueios e contato fora da janela permitida.

#### Critérios de Aceitação

1. WHEN o Follow_Up_Service envia uma Reengagement_Message dentro da janela de envio permitida configurada, THE Follow_Up_Service SHALL utilizar o Evolution_Channel para o envio no canal WhatsApp.
2. IF o instante do disparo de uma Reengagement_Message está fora da janela de envio permitida configurada, THEN THE Follow_Up_Service SHALL adiar o envio até o início da próxima janela permitida e manter o Follow_Up_Level como não enviado.
3. IF o Rate_Limiter rejeita o envio de uma Reengagement_Message, THEN THE Follow_Up_Service SHALL adiar o disparo, manter a Reengagement_Message pendente sem marcar o Follow_Up_Level como enviado e reagendar nova tentativa após o intervalo de espera configurado (mínimo de 60 segundos).
4. IF o Evolution_Channel retorna falha no envio de uma Reengagement_Message, THEN THE Follow_Up_Service SHALL registrar um Follow_Up_Event de erro com o motivo `evolution_error`, manter o Follow_Up_Level como não enviado e preservar a Reengagement_Message como pendente.
5. IF o número de tentativas adiadas de uma Reengagement_Message atinge o limite máximo configurado de reenvios, THEN THE Follow_Up_Service SHALL registrar um Follow_Up_Event de erro indicando o esgotamento das tentativas e interromper novos disparos para esse Follow_Up_Level.
6. WHEN o Evolution_Channel confirma o envio de uma Reengagement_Message, THE Follow_Up_Service SHALL atualizar o `lastOutboundAt` da Conversation com o instante (timestamp) do envio confirmado.
