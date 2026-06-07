# Documento de Requisitos

## Introduction

Esta funcionalidade redefine o motor de conversa do agente de pré-vendas da Decodifica no WhatsApp (o "DecodificaIA") para corrigir falhas graves de qualidade observadas em uma conversa real. No transcript analisado o agente: respondeu uma pergunta direta de preço com uma frase enlatada e sem relação ("A IA responde com base em regras e limites definidos..."); tratou o comando `/clear` como uma mensagem comum e devolveu um texto de erro confuso; repetiu de forma evasiva convites como "quer ver na prática?" sem ajudar; ignorou a intenção explícita do cliente ("quero falar com você", "quero saber no que você pode me ajudar"); e manteve um tom robótico, oposto ao "atendimento humanizado com IA" que o produto promete.

O objetivo é definir requisitos para um motor de conversa que: responda perguntas diretas (em especial sobre preço) de forma pertinente, trate comandos de controle corretamente, preserve o contexto da conversa, evite respostas repetitivas e fora de script, mantenha tom humanizado e útil, aplique regras claras de encaminhamento para humano (handoff) e tenha fallback robusto que continue relevante ao que o cliente perguntou.

O escopo cobre o comportamento do motor de conversa implementado em `apps/api/src/agent` (classificação de intenção, geração de resposta, análise) e a orquestração em `apps/api/src/conversation`. Não cobre a infraestrutura de mensageria do WhatsApp, o provedor de LLM em si, nem a interface administrativa de configuração do agente, exceto onde essas configurações influenciam o comportamento de resposta.

## Glossary

- **Motor_de_Conversa**: Subsistema responsável por receber a mensagem do cliente, decidir a resposta e devolver o texto e o estado da conversa. Corresponde ao fluxo orquestrado por `ConversationService` e `AgentReplyService`.
- **Classificador_de_Intencao**: Componente determinístico que classifica a mensagem do cliente em uma intenção conhecida ou indica que a mensagem precisa do modelo de linguagem. Corresponde a `intent-classifier.ts`.
- **Manipulador_de_Comandos**: Componente que detecta e executa comandos de controle iniciados por barra (por exemplo `/clear`) antes de qualquer processamento conversacional.
- **Gerador_de_Resposta**: Componente que produz o texto da resposta ao cliente, podendo usar regra local determinística ou o modelo de linguagem. Corresponde a `AgentReplyService`.
- **Modelo_de_Linguagem**: Provedor de LLM usado para gerar respostas quando nenhuma regra determinística se aplica.
- **Gerenciador_de_Contexto**: Componente que mantém e disponibiliza os fatos já coletados do lead e o histórico recente da conversa. Corresponde a `FactExtractorService` e à carga de histórico.
- **Regra_de_Handoff**: Conjunto de critérios que decide quando o atendimento deve ser encaminhado para um atendente humano.
- **Resposta_de_Fallback**: Resposta gerada quando o Modelo_de_Linguagem falha ou retorna conteúdo inválido, preservando o contexto coletado.
- **Pergunta_de_Preco**: Mensagem do cliente cujo objetivo principal é obter valor, preço, custo ou faixa de investimento.
- **Comando_de_Controle**: Mensagem do cliente iniciada por `/` destinada a controlar a sessão (por exemplo `/clear`), não a conversar.
- **Intencao_Explicita**: Pedido direto do cliente que expressa o que ele quer naquele momento (por exemplo "quero falar com você", "quero saber no que pode me ajudar").
- **Fato_Coletado**: Informação confirmada sobre o lead (segmento, dor principal, uso do WhatsApp, volume, papel de decisão, etc.).
- **Faixa_de_Preco_Configurada**: Valor ou faixa de preço de referência habilitado na configuração comercial (`pricingRangeEnabled` / `pricingStartingAtText`).
- **Tom_Humanizado**: Estilo de redação natural, cordial e direto em português do Brasil, sem repetição de fórmulas, sem aberturas proibidas e sem soar robótico.

## Requirements

### Requirement 1: Resposta pertinente a perguntas diretas

**User Story:** Como cliente em pré-venda, quero que minhas perguntas diretas sejam respondidas de forma pertinente, para que eu obtenha a informação que pedi em vez de uma frase genérica e sem relação.

#### Acceptance Criteria

1. WHEN o cliente envia uma mensagem que contém uma pergunta direta, THE Motor_de_Conversa SHALL produzir uma resposta cujo conteúdo trata o tópico dessa pergunta.
2. IF a resposta gerada não contém conteúdo relacionado ao tópico da pergunta do cliente, THEN THE Gerador_de_Resposta SHALL descartar essa resposta e gerar uma resposta relacionada ao tópico da pergunta.
3. THE Gerador_de_Resposta SHALL usar a explicação "A IA responde com base em regras e limites definidos. Quando foge do esperado, encaminha para humano." somente quando a mensagem do cliente questiona a confiabilidade ou o comportamento da IA.
4. WHEN o cliente faz uma pergunta cujo tópico não está coberto pela base de conhecimento, THE Motor_de_Conversa SHALL declarar que não possui essa informação e indicar o próximo passo para obtê-la.

### Requirement 2: Tratamento de perguntas de preço

**User Story:** Como cliente, quero uma resposta clara quando pergunto sobre valores, para que eu entenda o investimento ou saiba exatamente como obter um valor.

#### Acceptance Criteria

1. WHEN o cliente envia uma Pergunta_de_Preco, THE Motor_de_Conversa SHALL produzir uma resposta que aborda explicitamente o tema de preço.
2. WHERE a Faixa_de_Preco_Configurada está habilitada, WHEN o cliente envia uma Pergunta_de_Preco, THE Gerador_de_Resposta SHALL apresentar o valor de referência configurado.
3. WHERE a Faixa_de_Preco_Configurada está desabilitada, WHEN o cliente envia uma Pergunta_de_Preco, THE Gerador_de_Resposta SHALL explicar que o valor depende do escopo e oferecer o encaminhamento para a equipe obter uma estimativa.
4. IF o cliente envia uma Pergunta_de_Preco pela segunda vez ou mais na mesma conversa, THEN THE Gerador_de_Resposta SHALL oferecer o encaminhamento direto para a equipe sem solicitar novas informações de qualificação.
5. WHEN o cliente envia uma Pergunta_de_Preco antes de qualquer Fato_Coletado, THE Motor_de_Conversa SHALL responder ao tema de preço sem condicionar a resposta ao fornecimento prévio de segmento ou dor.

### Requirement 3: Tratamento de comandos de controle

**User Story:** Como usuário do playground, quero que comandos como `/clear` sejam executados como comandos, para que a sessão se comporte de forma previsível em vez de devolver uma mensagem de erro.

#### Acceptance Criteria

1. WHEN o cliente envia uma mensagem iniciada por `/`, THE Manipulador_de_Comandos SHALL interpretar a mensagem como Comando_de_Controle antes de qualquer geração de resposta conversacional.
2. WHEN o cliente envia o comando `/clear`, THE Manipulador_de_Comandos SHALL limpar o histórico da conversa e reiniciar a sessão ao estado inicial.
3. WHEN o comando `/clear` é executado com sucesso, THE Motor_de_Conversa SHALL apresentar a mensagem inicial de saudação configurada.
4. IF o cliente envia um Comando_de_Controle não reconhecido, THEN THE Manipulador_de_Comandos SHALL apresentar uma mensagem que identifica o comando como inválido e lista os comandos disponíveis.
5. WHEN o cliente envia um Comando_de_Controle, THE Motor_de_Conversa SHALL evitar acionar o Modelo_de_Linguagem para gerar a resposta desse comando.

### Requirement 4: Preservação de contexto e não repetição

**User Story:** Como cliente, quero que o agente lembre o que eu já disse e não repita as mesmas perguntas ou convites, para que a conversa avance.

#### Acceptance Criteria

1. WHEN o Gerador_de_Resposta produz uma resposta, THE Gerenciador_de_Contexto SHALL disponibilizar todos os Fato_Coletado da conversa ao Gerador_de_Resposta.
2. IF um dado já consta como Fato_Coletado, THEN THE Gerador_de_Resposta SHALL gerar uma resposta que não solicita novamente esse mesmo dado.
3. WHILE a conversa está ativa, THE Gerador_de_Resposta SHALL evitar repetir uma pergunta ou um convite de ação que já tenha sido enviado nas três últimas respostas do agente.
4. WHEN o agente já enviou cinco perguntas de qualificação na conversa, THE Gerador_de_Resposta SHALL parar de fazer novas perguntas de qualificação e oferecer um próximo passo contextualizado.

### Requirement 5: Atendimento à intenção explícita do cliente

**User Story:** Como cliente, quero que o agente atenda ao que eu peço diretamente, para que eu não seja forçado de volta ao roteiro do bot.

#### Acceptance Criteria

1. WHEN o cliente expressa uma Intencao_Explicita, THE Motor_de_Conversa SHALL produzir uma resposta que atende a essa intenção.
2. WHEN o cliente pede para falar com um atendente humano, THE Regra_de_Handoff SHALL marcar a conversa para encaminhamento humano.
3. WHEN o cliente pergunta no que o agente pode ajudar, THE Gerador_de_Resposta SHALL descrever as formas de ajuda disponíveis antes de fazer uma nova pergunta.
4. IF a Intencao_Explicita do cliente conflita com a próxima ação prevista no roteiro, THEN THE Gerador_de_Resposta SHALL priorizar a Intencao_Explicita do cliente.

### Requirement 6: Tom humanizado

**User Story:** Como cliente, quero conversar com um atendente que soa natural e cordial, para que a experiência corresponda ao atendimento humanizado prometido.

#### Acceptance Criteria

1. THE Gerador_de_Resposta SHALL redigir as respostas em português do Brasil com Tom_Humanizado.
2. THE Gerador_de_Resposta SHALL limitar cada resposta a no máximo 250 caracteres.
3. THE Gerador_de_Resposta SHALL incluir no máximo uma pergunta por resposta.
4. THE Gerador_de_Resposta SHALL gerar respostas que não iniciam com os termos "Entendo", "Perfeito", "Ótimo", "Show", "Certo", "Legal", "Ok", "Compreendo" ou "Claro".
5. THE Gerador_de_Resposta SHALL gerar respostas sem emoji.

### Requirement 7: Regras de encaminhamento para humano (handoff)

**User Story:** Como pré-vendedor, quero que o encaminhamento para humano siga critérios claros, para que leads qualificados cheguem à equipe no momento certo e sem promessas indevidas.

#### Acceptance Criteria

1. WHEN o cliente aceita explicitamente o encaminhamento oferecido, THE Regra_de_Handoff SHALL marcar a conversa para encaminhamento humano.
2. WHILE a dor principal e o volume ainda não constam como Fato_Coletado, THE Gerador_de_Resposta SHALL evitar oferecer encaminhamento de forma proativa, exceto quando o cliente pede preço ou demonstra frustração.
3. WHEN o Gerador_de_Resposta oferece encaminhamento, THE Gerador_de_Resposta SHALL incluir um resumo do cenário do cliente na mesma resposta.
4. IF a conversa já está marcada para encaminhamento humano, THEN THE Regra_de_Handoff SHALL manter esse estado, exceto quando o cliente desiste do atendimento.
5. WHEN o cliente confirma desistência do atendimento, THE Regra_de_Handoff SHALL marcar a conversa como perdida e remover a marcação de encaminhamento humano.

### Requirement 8: Fallback robusto e relevante

**User Story:** Como cliente, quero que mesmo quando o sistema tem dificuldade ele continue relevante ao que perguntei, para que eu não receba mensagens de erro confusas.

#### Acceptance Criteria

1. IF o Modelo_de_Linguagem falha ou retorna conteúdo vazio ou inválido, THEN THE Motor_de_Conversa SHALL gerar uma Resposta_de_Fallback não vazia.
2. WHEN o Motor_de_Conversa gera uma Resposta_de_Fallback, THE Resposta_de_Fallback SHALL preservar os Fato_Coletado da conversa.
3. WHEN o cliente fez uma Pergunta_de_Preco e o Modelo_de_Linguagem falha, THE Resposta_de_Fallback SHALL abordar o tema de preço.
4. THE Resposta_de_Fallback SHALL evitar texto que descreva dificuldade técnica do sistema ao cliente.
5. WHEN o Motor_de_Conversa gera uma Resposta_de_Fallback, THE Resposta_de_Fallback SHALL incluir um próximo passo útil para o cliente.

### Requirement 9: Restrições de conteúdo das respostas

**User Story:** Como responsável pela Decodifica, quero que o agente não faça promessas indevidas, para que a empresa não assuma compromissos que não pode cumprir.

#### Acceptance Criteria

1. WHERE a Faixa_de_Preco_Configurada está desabilitada, THE Gerador_de_Resposta SHALL gerar respostas que não citam valores monetários específicos.
2. THE Gerador_de_Resposta SHALL gerar respostas que não prometem teste gratuito, ativação imediata, integração garantida ou prazo de entrega.
3. THE Gerador_de_Resposta SHALL gerar respostas que não afirmam ausência absoluta de erros da IA.
4. WHEN o cliente pergunta sobre integração com outros sistemas, THE Gerador_de_Resposta SHALL informar que a equipe precisa avaliar o caminho técnico.
