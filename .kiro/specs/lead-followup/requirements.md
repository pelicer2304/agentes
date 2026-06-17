# Requirements Document

## Introduction

Esta feature adiciona um mecanismo de **follow-up automático de leads** ao agente conversacional (NestJS + Prisma + Postgres, canal WhatsApp via Evolution). Quando um lead para de interagir, o sistema reengaja em três níveis temporais — 1 hora, 1 dia e 2 dias após a última inatividade — com mensagens contextualizadas que retomam o que já foi mapeado na conversa (segmento, dor principal, etc.) para tentar **requalificar** o lead e fazê-lo avançar na qualificação.

A regra mais importante é de **elegibilidade**: um lead que já foi encaminhado ao time humano (handoff) não pode entrar nem permanecer no follow-up. O sistema também precisa cancelar o ciclo quando o lead volta a responder, quando desiste, e encerrar de forma definitiva após o terceiro nível sem resposta. O comportamento precisa ser idempotente (nunca disparar o mesmo nível duas vezes nem follow-ups concorrentes) e observável (cada disparo, cancelamento e encerramento é registrado como evento).

O escopo desta feature é a **decisão e o agendamento** do follow-up e o registro dos eventos. A composição textual final reaproveita o mecanismo de geração de resposta já existente, mas a feature define o contexto e o gatilho.

Esta evolução acrescenta **detecção contextual de engajamento** ao ciclo. Em cada turno, o sistema classifica a intenção de engajamento do Lead — interesse normal, "me chama depois" (adiamento) ou "não me contate mais" (opt-out) — usando análise contextual de um modelo de linguagem (LLM) que considera a pergunta anterior do bot e a resposta do Lead, em vez de listas de palavras-chave fixas. Essa mudança corrige um comportamento em que uma desistência educada (por exemplo, "não, eu volto a te acionar quando eu quiser") era erroneamente tratada como pedido de atendimento humano. A partir desta classificação, o follow-up passa a oferecer um **follow-up adiado** quando o Lead pede para ser chamado mais tarde e um **opt-out definitivo** quando o Lead pede para parar, sem nunca escalar essas situações para o time humano.

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
- **Engagement_Intent**: classificação contextual da intenção de engajamento do Lead em um turno, com valores em {`interesse_normal`, `nao_agora`, `opt_out`}. `interesse_normal` indica interesse comum ou ausência de sinal de desengajamento; `nao_agora` indica pedido de adiamento ("me chama depois"); `opt_out` indica pedido explícito para parar de receber mensagens.
- **Engagement_Classifier**: componente que determina o Engagement_Intent de um turno a partir de análise contextual do LLM, reaproveitando o Agent_Analysis_Service, considerando o Turn_Context e nunca listas de palavras-chave fixas.
- **Agent_Analysis_Service**: serviço existente (`AgentAnalysisService`) que executa um LLM sobre o histórico da conversa e devolve um resultado estruturado em JSON, reaproveitado para produzir o Engagement_Intent.
- **Turn_Context**: par formado pela última pergunta ou mensagem outbound do bot e pela mensagem inbound do Lead que a respondeu, usado como entrada para a classificação contextual do Engagement_Intent.
- **Deferred_Followup**: Follow_Up_Level agendado em substituição ao Nível 1 quando o Engagement_Intent é `nao_agora`, disparado após o Deferral_Offset em vez de 1 hora.
- **Deferral_Offset**: intervalo de tempo até o disparo de um Deferred_Followup. Igual ao Default_Deferral_Offset quando o Lead não indica prazo, ou ao prazo inferido pelo LLM (Inferred_Deferral) quando o Lead indica um prazo.
- **Default_Deferral_Offset**: intervalo padrão configurável para o Deferred_Followup, com valor padrão de 5 horas.
- **Inferred_Deferral**: intervalo de tempo inferido pelo LLM a partir do prazo indicado pelo Lead (por exemplo, "amanhã de manhã", "semana que vem", "mês que vem"), aplicado sem limite superior.
- **Opt_Out**: estado em que o Lead solicitou explicitamente parar de receber mensagens, tornando a Conversation não elegível para novos follow-ups até que o Lead manifeste interesse normal genuíno.
- **Disengagement_Signal**: sinal de desengajamento (`nao_agora` ou `opt_out`) derivado do Engagement_Intent, que por si só nunca dispara encaminhamento ao time humano.

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

### Requisito 10: Detecção contextual de desengajamento

**História do usuário:** Como operador comercial, quero que o sistema entenda, pelo contexto da conversa, quando o lead quer adiar ou parar de ser contatado, para que respostas educadas de adiamento ou recusa não sejam tratadas como interesse, nem escaladas indevidamente.

#### Critérios de Aceitação

1. WHEN uma mensagem inbound do Lead é recebida em um turno, THE Engagement_Classifier SHALL classificar o Engagement_Intent desse turno em exatamente um valor dentre {`interesse_normal`, `nao_agora`, `opt_out`} a partir de análise contextual do LLM aplicada ao Turn_Context.
2. THE Engagement_Classifier SHALL determinar o Engagement_Intent utilizando o Turn_Context, que inclui a última pergunta ou mensagem outbound do bot e a mensagem inbound do Lead que a respondeu.
3. THE Engagement_Classifier SHALL determinar o Engagement_Intent sem utilizar listas de palavras-chave fixas como critério de classificação.
4. THE Engagement_Classifier SHALL classificar o Engagement_Intent como `nao_agora` apenas quando o Lead expressa explicitamente intenção de ser contatado mais tarde, e como `opt_out` apenas quando o Lead expressa explicitamente intenção de parar de ser contatado.
5. IF a mensagem inbound do Lead, no Turn_Context, descreve um fato do negócio do Lead (por exemplo, como os clientes dele interagem com ele) em resposta a uma pergunta do bot, THEN THE Engagement_Classifier SHALL classificar o Engagement_Intent como `interesse_normal`, mesmo que a mensagem contenha negações.
6. WHEN o grau de confiança da classificação do LLM é inferior a 0,70 ou há empate entre classes, THE Engagement_Classifier SHALL classificar o Engagement_Intent como `interesse_normal`.
7. WHEN o bot pergunta como os clientes do Lead o acionam e o Lead responde que os clientes não o chamam e que é ele quem chama os clientes, THE Engagement_Classifier SHALL classificar o Engagement_Intent como `interesse_normal`.
8. THE Follow_Up_Service SHALL tratar o Disengagement_Signal de um turno como insuficiente, por si só, para encaminhar a Conversation ao time humano.
9. IF a análise contextual do LLM falha ou excede 10 segundos, THEN THE Engagement_Classifier SHALL classificar o Engagement_Intent como `interesse_normal` e SHALL registrar uma indicação da falha de classificação.

### Requisito 11: Follow-up adiado por pedido de adiamento

**História do usuário:** Como operador comercial, quero que um lead que pede para ser chamado depois receba um follow-up adiado no prazo certo, para respeitar o tempo do lead sem perder o contato.

#### Critérios de Aceitação

1. WHEN o Engagement_Intent de um turno é `nao_agora`, THE Follow_Up_Service SHALL agendar um Deferred_Followup em substituição ao Follow_Up_Level 1 dessa Conversation, em vez de agendar o Follow_Up_Level 1 para 1 hora após o Inactivity_Anchor.
2. WHEN o Engagement_Intent de um turno é `nao_agora` e o Lead não indica prazo, THE Follow_Up_Service SHALL definir o Deferral_Offset como o Default_Deferral_Offset, cujo valor padrão é 5 horas.
3. WHEN o Engagement_Intent de um turno é `nao_agora` e o Lead indica um prazo, THE Follow_Up_Service SHALL definir o Deferral_Offset como o Inferred_Deferral inferido pelo LLM a partir do prazo indicado pelo Lead, limitado a um valor mínimo de 1 hora e sem aplicar limite superior.
4. IF o Engagement_Intent de um turno é `nao_agora` e o Lead indica um prazo, mas o LLM não retorna um Inferred_Deferral válido (falha de inferência, tempo de inferência acima de 30 segundos, ou valor inferido menor que 1 hora), THEN THE Follow_Up_Service SHALL definir o Deferral_Offset como o Default_Deferral_Offset de 5 horas e registrar a Conversation como elegível para o Deferred_Followup.
5. WHEN um Deferred_Followup é disparado sem que o Lead registre mensagem inbound, THE Follow_Up_Service SHALL retomar a cadência normal agendando o Follow_Up_Level seguinte para 24 horas após o disparo do Deferred_Followup e o Follow_Up_Level subsequente para 48 horas após o disparo do Deferred_Followup.
6. WHEN o Engagement_Intent de um turno é `nao_agora`, THE Follow_Up_Service SHALL enviar ao Lead, em até 30 segundos após a classificação do turno, uma mensagem de reconhecimento que confirma o adiamento e informa que o contato será retomado no prazo definido pelo Deferral_Offset, mantendo a Conversation sem encaminhamento ao time humano.
7. IF o Lead registra uma mensagem inbound antes do disparo do Deferred_Followup agendado, THEN THE Follow_Up_Service SHALL cancelar o Deferred_Followup agendado e remover a classificação de elegibilidade para o Deferred_Followup dessa Conversation.
8. WHILE o Engagement_Intent corrente de uma Conversation é `nao_agora`, THE Follow_Up_Service SHALL manter a Conversation classificada como elegível para o Deferred_Followup.

### Requisito 12: Opt-out definitivo

**História do usuário:** Como operador comercial, quero que um lead que pede explicitamente para parar de receber mensagens não receba mais follow-ups, para respeitar a decisão do lead e evitar contato indesejado.

#### Critérios de Aceitação

1. WHEN o Engagement_Intent de um turno é `opt_out`, THE Follow_Up_Service SHALL cancelar todos os Follow_Up_Level pendentes da Conversation em até 5 segundos após o registro da mensagem inbound e SHALL não reiniciar o ciclo de follow-up em decorrência dessa mensagem inbound.
2. WHEN o Engagement_Intent de um turno é `opt_out`, THE Follow_Up_Service SHALL persistir a Conversation no estado Opt_Out e SHALL classificá-la como não elegível para qualquer novo Follow_Up_Level enquanto permanecer nesse estado.
3. WHEN o Engagement_Intent de um turno é `opt_out`, THE Follow_Up_Service SHALL NOT classificar a mensagem inbound como pedido nem como aceitação de atendimento humano e SHALL não encaminhar a Conversation ao time humano.
4. IF uma Conversation está no estado Opt_Out e o Lead envia posteriormente uma mensagem inbound cujo Engagement_Intent é `interesse_normal`, THEN THE Follow_Up_Service SHALL remover o estado Opt_Out, redefinir o Inactivity_Anchor para o instante dessa mensagem inbound e reiniciar o ciclo normal de follow-up a partir do Follow_Up_Level 1 conforme o Requisito 3.
5. WHEN um ciclo de follow-up é cancelado por opt-out, THE Follow_Up_Service SHALL registrar exatamente um Follow_Up_Event do tipo `followup_cancelled` contendo o `conversationId`, o `leadId`, o motivo `opt_out` e o instante de ocorrência com precisão de milissegundos.
6. WHILE a Conversation está no estado Opt_Out, THE Follow_Up_Service SHALL processar turnos repetidos de `opt_out` de forma idempotente, sem cancelar novamente nem duplicar o Follow_Up_Event de cancelamento.
7. IF a persistência do estado Opt_Out ou do cancelamento falha, THEN THE Follow_Up_Service SHALL preservar os Follow_Up_Level pendentes, suprimir novos envios e registrar um Follow_Up_Event de erro.

### Requisito 13: Roteamento de intenção sem escalonamento indevido

**História do usuário:** Como operador comercial, quero que pedidos de adiamento ou de parar não sejam confundidos com pedido de atendimento humano, para que o bot não escale o lead por engano no mesmo turno.

#### Critérios de Aceitação

1. IF o Engagement_Intent de um turno é `nao_agora` ou `opt_out`, THEN THE Follow_Up_Service SHALL NOT classificar a mensagem inbound como pedido de atendimento humano.
2. IF o Engagement_Intent de um turno é `nao_agora` ou `opt_out`, THEN THE Follow_Up_Service SHALL NOT classificar a mensagem inbound como aceitação de encaminhamento ao time humano.
3. THE Engagement_Classifier SHALL concluir e disponibilizar o Engagement_Intent do turno antes da geração da resposta desse turno.
4. WHEN a resposta de um turno é gerada, THE Follow_Up_Service SHALL aplicar o Engagement_Intent do turno corrente à decisão de resposta, sem depender exclusivamente da análise assíncrona de CRM executada após o turno.
5. IF o Engagement_Intent não pode ser determinado no turno, THEN THE Follow_Up_Service SHALL tratar o turno como `interesse_normal` e preservar a garantia de não escalonar a Conversation ao time humano com base em desengajamento.
