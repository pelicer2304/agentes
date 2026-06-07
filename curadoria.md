Preciso que você analise e corrija de forma definitiva o agente DecodificaIA de qualificação comercial no WhatsApp.

Não quero apenas melhorar texto de prompt. Quero que você investigue o fluxo completo: prompt, state machine, score, temperatura, handoff, geração de resposta, fallback, histórico da conversa, regras de decisão e qualquer lógica de backend/orquestração que possa estar causando falhas.

CONTEXTO

O DecodificaIA é um atendente inteligente da Decodifica para qualificar leads interessados em automação humanizada com IA para WhatsApp.

Ele deve conversar de forma natural, entender a dor do cliente, coletar informações úteis e encaminhar para humano quando o lead estiver pronto.

Hoje o agente está falhando nos testes de conversa.

PROBLEMAS IDENTIFICADOS NOS TESTES

1. O agente às vezes retorna “Sem resposta”.
Isso é crítico e não pode acontecer nunca.
Aconteceu em mensagens importantes como:
- Cliente informa volume de mensagens.
- Cliente informa volume de pedidos.
- Cliente diz que tem PDF/cardápio.
- Cliente demonstra preocupação com erro da IA.
- Cliente informa perguntas repetidas.

Toda mensagem do usuário precisa gerar uma resposta válida.

2. Score e temperatura estão inconsistentes.
Exemplo:
Cliente pede “pode encaminhar”, o sistema ativa handoff, mas mantém score baixo e temperatura fria.
Isso está errado.

Se houver pedido explícito de contato humano, proposta, orçamento ou encaminhamento:
- handoff deve ser true
- status deve ser chamar_humano
- score mínimo deve ser 80
- temperatura deve ser quente

3. O agente continua perguntando depois que o cliente já pediu proposta.
Isso não pode acontecer.
Quando o cliente diz:
- quero proposta
- pode encaminhar
- quero orçamento
- quero falar com alguém
- manda para equipe
- pode me chamar
- quero contratar
- sim, quero
- tá bom, manda

O agente deve parar a qualificação e encaminhar.

4. O agente pergunta coisas que já foram respondidas.
Antes de fazer qualquer pergunta, ele precisa verificar no histórico se já sabe:
- segmento do negócio
- dor principal
- volume aproximado
- quem atende hoje
- sistema usado
- se é decisor
- se pediu preço
- se pediu proposta/humano

Nunca repetir pergunta já respondida.

5. O agente insiste demais antes de falar preço.
Quando o cliente pede preço, ele não pode ficar enrolando.
Precisa responder com faixa ou valor inicial autorizado, de forma consistente.

Hoje apareceu preço diferente em testes:
- R$399/mês
- R$97/mês

Isso precisa ser padronizado. Usar somente um valor/faixa oficial configurável.

Sugestão de regra:
“Os projetos normalmente começam a partir de R$399/mês, mas o valor final depende do volume, integrações e complexidade. Pelo que você me contou, posso encaminhar para a equipe te passar uma proposta mais precisa.”

Se o preço oficial for outro, criar uma constante/configuração única e usar sempre a mesma.

6. O agente faz pitch genérico antes de entender o cliente.
Ele precisa primeiro reconhecer a dor, resumir o cenário e fazer no máximo uma pergunta útil.
Não deve parecer um bot seguindo roteiro.

7. O agente promete coisas que talvez não existam.
Exemplo: “teste gratuito de 7 dias”.
Remover qualquer promessa comercial que não esteja configurada oficialmente:
- teste grátis
- ativação imediata
- valor fechado sem análise
- integração garantida com qualquer sistema
- prazo exato sem avaliar integração

8. O handoff está inconsistente.
Às vezes status muda para chamar_humano, mas handoff fica false.
Às vezes handoff fica true, mas score fica frio.
Precisa haver uma regra centralizada e determinística.

OBJETIVO DA CORREÇÃO

Transformar o DecodificaIA em um pré-vendedor confiável.

Ele deve:
- responder sempre
- não travar
- não retornar “Sem resposta”
- qualificar sem cansar o cliente
- entender quando já tem informações suficientes
- encaminhar para humano no momento certo
- manter score coerente
- manter temperatura coerente
- não repetir perguntas
- não inventar promessas
- não dar preços diferentes
- gerar resumo útil para a equipe humana

REGRAS OBRIGATÓRIAS

REGRA 1 — NUNCA FICAR SEM RESPOSTA

Se o modelo, prompt, parser ou geração falhar, usar fallback seguro.

Fallback padrão:
“Entendi. Para te ajudar melhor, vou resumir o que já temos até aqui e encaminhar para a equipe da Decodifica avaliar o melhor caminho.”

Mas o fallback deve tentar preservar contexto.

Nunca exibir:
- “Sem resposta”
- null
- undefined
- resposta vazia
- erro técnico
- JSON quebrado

Implementar validação final antes de enviar mensagem ao usuário:
Se response.text estiver vazio, nulo ou inválido, gerar fallback.

REGRA 2 — HANDOFF IMEDIATO

Se a última mensagem do usuário indicar intenção clara de falar com humano, receber proposta, orçamento ou avançar, encerrar qualificação.

Frases e intenções equivalentes:
- quero proposta
- quero orçamento
- pode encaminhar
- manda
- pode mandar
- quero falar com alguém
- chama alguém
- quero contratar
- quero seguir
- sim, quero
- tá bom, manda
- pode me chamar
- manda para equipe
- quero que alguém me ligue
- quero uma call
- quero reunião

Ação:
- status = chamar_humano
- handoff = true
- score = max(scoreAtual, 80)
- temperatura = quente
- resposta curta confirmando encaminhamento
- gerar resumo interno com dados já coletados

Resposta exemplo:
“Perfeito. Já tenho um bom resumo do seu cenário e vou encaminhar para a equipe da Decodifica te passar uma proposta mais precisa.”

Não fazer nova pergunta depois disso.

REGRA 3 — SCORE

Criar cálculo de score baseado em sinais, não apenas no roteiro.

Sinais:
+20 se informou segmento
+20 se informou dor clara
+15 se informou volume
+15 se informou quem atende hoje/equipe sobrecarregada
+15 se informou sistema atual ou integração desejada
+20 se indicou ser dono, gestor, sócio, decisor ou responsável
+30 se pediu preço
+40 se pediu proposta/orçamento
+50 se pediu humano/encaminhamento/contratação

Temperatura:
0 a 39 = frio
40 a 69 = morno
70+ = quente

Mas se handoff = true:
score mínimo 80
temperatura quente
status chamar_humano

REGRA 4 — NÃO REPETIR PERGUNTAS

Manter um objeto de memória da conversa com campos extraídos:

leadContext = {
  segmento,
  canalAtual,
  dorPrincipal,
  volumeMensagens,
  quemAtendeHoje,
  sistemaAtual,
  integracaoDesejada,
  decisor,
  pediuPreco,
  pediuProposta,
  pediuHumano,
  objeções,
  materiaisDisponiveis,
  resumo
}

Antes de perguntar algo, verificar se o campo já existe.
Se já existe, não perguntar de novo.

Exemplo errado:
Cliente: “Tenho um restaurante e recebo 60 a 80 pedidos por dia.”
Agente depois: “Quantos pedidos vocês recebem por dia?”
Isso é proibido.

REGRA 5 — QUANTIDADE MÁXIMA DE PERGUNTAS

O agente não pode virar interrogatório.

Depois que tiver pelo menos:
- segmento
- dor principal
- volume aproximado OU quem atende hoje
- interesse em proposta/preço/humano

Ele deve oferecer encaminhamento.

Nunca fazer mais de 4 perguntas de qualificação antes de oferecer próximo passo.

REGRA 6 — PREÇO

Se o cliente pedir preço pela primeira vez:
Responder preço/faixa oficial e fazer uma única pergunta curta, se necessário.

Se pedir preço pela segunda vez ou demonstrar irritação:
Não fazer mais perguntas.
Dar faixa e oferecer encaminhar.

Usar preço configurável em uma constante:
MIN_PRICE = "R$399/mês"
ou buscar de variável de ambiente/config.

Resposta exemplo:
“Os projetos normalmente começam a partir de R$399/mês. O valor final depende do volume, integrações e complexidade. Pelo que você me contou, posso encaminhar para a equipe te passar uma proposta mais precisa.”

Nunca usar outro valor se não estiver configurado.

REGRA 7 — RESPOSTA PARA CLIENTE IRRITADO OU COM PRESSA

Se o cliente disser:
- não tenho tempo
- só quero preço
- já falei
- já contei tudo
- para de perguntar
- esquece
- vou procurar outro

Responder de forma objetiva, sem insistir.

Exemplo:
“Entendi. Para ser direto: os projetos normalmente começam a partir de R$399/mês, variando conforme volume e integrações. Se quiser, encaminho seu caso para a equipe te passar uma proposta sem mais perguntas.”

Se ele desistir:
“Entendo. Não vou insistir. Se quiser retomar depois, a Decodifica pode avaliar seu atendimento e te passar um caminho mais direto.”

REGRA 8 — INTEGRAÇÕES

Se o cliente falar de ERP, sistema próprio, Dental Office, Google Calendar, cardápio em PDF, e-commerce ou API:
- reconhecer o sistema/material citado
- perguntar no máximo uma coisa técnica útil
- não prometer integração garantida sem avaliação

Exemplo:
“Entendi. Como envolve integração com seu ERP, a equipe precisa avaliar a forma de acesso, como API, webhook ou banco. Vou encaminhar seu cenário com esse ponto destacado.”

REGRA 9 — RESUMO PARA HUMANO

Quando handoff for true, gerar resumo estruturado para equipe:

Resumo:
- Segmento:
- Dor principal:
- Volume:
- Quem atende hoje:
- Sistema/material citado:
- Interesse declarado:
- Nível de urgência:
- Observações:
- Próximo passo recomendado:

Esse resumo pode ser interno, mas precisa estar disponível no payload/log/handoff.

REGRA 10 — TOM DE VOZ

O DecodificaIA deve ser:
- humano
- direto
- consultivo
- sem enrolação
- sem emojis
- sem frases longas demais
- sem parecer vendedor forçado

Evitar:
“Posso te mostrar como?”
“Já pensou em automatizar?”
“Quer testar agora?”
quando o cliente já está pedindo proposta/preço/humano.

Preferir:
“Pelo que você descreveu, faz sentido automatizar essa parte.”
“Já tenho informação suficiente para encaminhar.”
“Esse é um bom caso para a equipe avaliar proposta.”

TAREFA TÉCNICA

1. Encontrar onde a resposta “Sem resposta” está sendo gerada.
Pode estar em:
- retorno vazio do LLM
- parser de JSON
- função de fallback
- timeout
- erro silencioso
- validação de resposta
- fluxo sem branch para determinada intenção

Corrigir a causa raiz e adicionar fallback final obrigatório.

2. Revisar state machine/status.
Estados sugeridos:
- novo
- qualificando
- pronto_para_handoff
- chamar_humano
- encerrado

Se status = chamar_humano, handoff precisa ser true.

3. Revisar cálculo de score.
O score precisa ser recalculado a cada mensagem com base no contexto acumulado.
Não pode voltar de 85 para 35 sem motivo.
Não pode ficar 0 quando cliente pediu proposta.
Não pode ficar frio quando handoff é true.

4. Criar detector de intenção.
Detectar intenções:
- saudacao
- pergunta_preco
- objeção_preco
- informa_segmento
- informa_dor
- informa_volume
- informa_sistema
- informa_decisor
- pede_proposta
- pede_humano
- desiste
- preocupação_ia_erro
- integração
- material_disponivel

5. Criar testes/regressão com os 15 cenários atuais.
Todos precisam passar sem:
- “Sem resposta”
- resposta vazia
- pergunta repetida
- score incoerente
- handoff falso quando cliente pediu encaminhamento
- preço divergente

CRITÉRIOS DE ACEITE

A correção só está aprovada se:

1. Nenhum cenário retorna “Sem resposta”.
2. Pedido de proposta/orçamento/humano sempre gera handoff true.
3. Handoff true sempre gera status chamar_humano, score >= 80 e temperatura quente.
4. O agente não pergunta novamente informações já ditas.
5. O preço aparece sempre igual e vindo de configuração única.
6. O agente não promete teste grátis, ativação imediata ou integração garantida.
7. O agente para de qualificar quando já tem dados suficientes.
8. Todos os 15 cenários de teste passam.
9. Adicionar logs claros para debug:
   - intenção detectada
   - contexto extraído
   - score anterior
   - score novo
   - status anterior
   - status novo
   - motivo do handoff
   - se fallback foi acionado

IMPORTANTE

Não faça uma mudança superficial apenas no prompt.
Se o problema estiver no backend, corrija o backend.
Se estiver no prompt, corrija o prompt.
Se estiver no parser, corrija o parser.
Se estiver na state machine, corrija a state machine.
Se estiver no score, corrija o score.
Se estiver no fallback, corrija o fallback.

Quero uma solução robusta para produção.

Ao final, me entregue:
1. Quais arquivos foram alterados.
2. Qual era a causa raiz mais provável.
3. Quais regras novas foram implementadas.
4. Como rodar os testes.
5. Resultado esperado dos 15 cenários. 