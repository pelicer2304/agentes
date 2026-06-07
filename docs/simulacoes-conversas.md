# Simulações de Conversas — Assistente Decodifica

> 10 cenários simulados (IA como cliente) para identificar pontos de melhoria no comportamento do assistente.

---

## Conversa 1: Clínica querendo automatizar agendamento

**Perfil:** Dono de clínica odontológica, 50 atendimentos/dia pelo WhatsApp

**Cliente:** Oi, boa tarde

**Assistente:** Olá. Sou o Assistente Decodifica. Posso te ajudar a entender que tipo de automação faria sentido para o seu atendimento. Para começar, me conta qual é o seu negócio e como vocês usam o WhatsApp hoje.

**Cliente:** Tenho uma clínica odontológica e recebo muita mensagem no WhatsApp pra marcar consulta

**Assistente:** Agendamento por WhatsApp costuma gerar bastante volume repetitivo. Normalmente dá para automatizar a triagem inicial, confirmação de horário e até reagendamento. Hoje quem responde essas mensagens na clínica?

**Cliente:** Uma recepcionista, mas ela não dá conta. Às vezes demora horas pra responder

**Assistente:** Esse é um cenário comum. A demora faz o paciente desistir ou ligar, o que sobrecarrega ainda mais. Você tem ideia de quantas mensagens de agendamento recebe por dia?

**Cliente:** Umas 50, fácil

**Assistente:** Com esse volume, faz sentido ter um assistente que responde na hora, coleta os dados do paciente e encaixa no horário disponível. Você usa algum sistema de agenda hoje, tipo software de gestão?

**Cliente:** Uso o Dental Office

**Assistente:** O valor depende do fluxo, integrações, volume de atendimento e nível de personalização. Antes de passar uma proposta, a Decodifica faz um diagnóstico rápido para entender o que precisa ser automatizado e evitar vender algo maior ou menor do que o necessário. Quer que eu encaminhe para a equipe avaliar seu caso?

**Cliente:** Sim, pode encaminhar

**Assistente:** Acho que já tenho contexto suficiente para alguém da Decodifica avaliar seu caso com mais precisão. Posso encaminhar seu atendimento com um resumo do que você precisa?

### ⚠️ Problemas identificados:
1. **Handoff duplo** — O assistente já ofereceu encaminhar ("Quer que eu encaminhe para a equipe avaliar seu caso?"), o cliente aceitou ("Sim, pode encaminhar"), mas ele perguntou DE NOVO com a mensagem padrão de handoff. Deveria ter ido direto para o encaminhamento.
2. **Perguntou sobre preço sem o cliente perguntar** — O assistente mencionou "O valor depende..." sem o cliente ter perguntado sobre preço. Deveria ter explicado a possibilidade de integração com Dental Office e depois conduzido para o diagnóstico.

---

## Conversa 2: Loja de moda íntima querendo vender pelo WhatsApp

**Perfil:** Dona de loja de lingerie, vende por Instagram e WhatsApp

**Cliente:** Oi, vi que vocês fazem automação pra WhatsApp

**Assistente:** Olá. Sou o Assistente Decodifica. Posso te ajudar a entender que tipo de automação faria sentido para o seu atendimento. Para começar, me conta qual é o seu negócio e como vocês usam o WhatsApp hoje.

**Cliente:** Tenho uma loja de moda íntima. Vendo pelo Instagram e WhatsApp. As clientes mandam mensagem perguntando tamanho, cor, preço, se tem pronta entrega

**Assistente:** Esse tipo de atendimento costuma ter bastante repetição e pode ser um bom caso para automação. Pelo que você descreveu, faria sentido criar um assistente para responder dúvidas iniciais, coletar interesse da cliente e encaminhar para uma pessoa quando houver chance real de venda. Hoje o maior problema está mais na demora para responder ou na quantidade de perguntas repetidas?

**Cliente:** Os dois. Eu respondo sozinha e às vezes demoro muito. Aí a cliente desiste

**Assistente:** Faz sentido. Com um assistente, as dúvidas sobre tamanho, cor e disponibilidade podem ser respondidas na hora, e quando a cliente demonstra intenção de compra, encaminha para você fechar. Você tem catálogo organizado com os produtos, tamanhos e preços?

**Cliente:** Tenho no Instagram, mas no WhatsApp mando foto por foto

**Assistente:** Dá para estruturar isso de forma que o assistente já envie as opções certas com base no que a cliente pedir. Você recebe quantas mensagens por dia mais ou menos?

**Cliente:** Umas 30 a 40

**Assistente:** Com esse volume, a automação já faz diferença. Posso te encaminhar para a equipe da Decodifica fazer um diagnóstico rápido do seu fluxo e ver o que faz sentido automatizar primeiro?

**Cliente:** Quanto custa?

**Assistente:** O valor depende do fluxo, integrações, volume de atendimento e nível de personalização. Em geral, antes de passar uma proposta, a Decodifica faz um diagnóstico rápido para entender o que precisa ser automatizado e evitar vender algo maior ou menor do que o necessário. Você quer me contar mais sobre como funciona seu atendimento hoje para eu indicar o tipo de projeto mais adequado?

**Cliente:** Já contei né. Quero saber o preço mesmo

**Assistente:** Entendo. Como cada projeto é sob medida, o diagnóstico serve justamente para definir o escopo e passar um valor justo. Posso encaminhar para a equipe te dar uma estimativa com base no que você descreveu?

**Cliente:** Tá, pode mandar

**Assistente:** Acho que já tenho contexto suficiente para alguém da Decodifica avaliar seu caso com mais precisão. Posso encaminhar seu atendimento com um resumo do que você precisa?

### ⚠️ Problemas identificados:
1. **Handoff duplo novamente** — Cliente disse "Tá, pode mandar" e o bot perguntou de novo se pode encaminhar.
2. **Não respondeu diretamente sobre preço** — Quando a cliente insistiu "Já contei né. Quero saber o preço mesmo", o assistente deveria ter dado uma faixa ou sido mais direto em vez de repetir a mesma resposta consultiva.

---

## Conversa 3: Fábrica de etiquetas querendo automatizar orçamento

**Perfil:** Gestor comercial de fábrica de etiquetas adesivas

**Cliente:** Boa tarde, quero saber sobre automação

**Assistente:** Olá. Sou o Assistente Decodifica. Posso te ajudar a entender que tipo de automação faria sentido para o seu atendimento. Para começar, me conta qual é o seu negócio e como vocês usam o WhatsApp hoje.

**Cliente:** Fabricamos etiquetas adesivas personalizadas. O WhatsApp é nosso principal canal de vendas. O cliente manda as especificações e a gente faz orçamento

**Assistente:** Coleta de especificações para orçamento é um dos casos mais comuns de automação. O assistente pode perguntar material, medidas, quantidade, acabamento e já organizar tudo para o vendedor montar o orçamento. Hoje quem faz essa coleta?

**Cliente:** Os vendedores, mas eles perdem muito tempo perguntando as mesmas coisas

**Assistente:** Faz sentido. Se o assistente já coleta tudo estruturado, o vendedor recebe pronto para calcular. Vocês têm uma lista fixa de perguntas que sempre fazem para orçamento?

**Cliente:** Sim, sempre perguntamos: material, medida, quantidade, cor, acabamento e prazo

**Assistente:** Perfeito para automatizar. O assistente faz essas perguntas, valida as respostas e entrega um resumo para o vendedor. Quantos orçamentos vocês fazem por dia?

**Cliente:** Uns 20 a 30

**Assistente:** Com esse volume, a economia de tempo é significativa. Você é o responsável por decidir sobre esse tipo de investimento na empresa?

**Cliente:** Sou o gestor comercial, mas preciso aprovar com o diretor

**Assistente:** Entendo. Acho que já tenho contexto suficiente para alguém da Decodifica avaliar seu caso com mais precisão. Posso encaminhar seu atendimento com um resumo do que você precisa?

**Cliente:** Pode sim

**Assistente:** Ótimo. Vou encaminhar para a equipe com o resumo do seu cenário.

### ✅ Pontos positivos:
1. Adaptou bem ao nicho (etiquetas → coleta de especificações)
2. Fez uma pergunta por vez
3. Identificou o papel de decisão
4. Handoff fluiu bem nesse caso

### ⚠️ Problemas identificados:
1. Usou "Perfeito" — deveria evitar essa expressão

---

## Conversa 4: Restaurante querendo responder cardápio e pedidos

**Perfil:** Dono de restaurante delivery

**Cliente:** E aí, vocês fazem chatbot?

**Assistente:** Olá. Sou o Assistente Decodifica. Posso te ajudar a entender que tipo de automação faria sentido para o seu atendimento. Para começar, me conta qual é o seu negócio e como vocês usam o WhatsApp hoje.

**Cliente:** Tenho um restaurante e recebo pedido pelo WhatsApp. É uma loucura

**Assistente:** Restaurante com pedido por WhatsApp costuma ter pico de mensagens em horários específicos. Normalmente dá para automatizar o envio do cardápio, coleta do pedido e confirmação. Hoje como funciona? O cliente manda mensagem e alguém anota?

**Cliente:** Isso, minha esposa fica respondendo. Mas no horário de pico ela não dá conta

**Assistente:** Entendo. Nos horários de pico, a demora faz o cliente desistir ou pedir em outro lugar. Um assistente pode enviar o cardápio, coletar o pedido completo e confirmar antes de mandar para a cozinha. Vocês têm cardápio digital ou é tudo por foto?

**Cliente:** Tenho um PDF do cardápio

**Assistente:** Dá para estruturar o cardápio no assistente para o cliente escolher direto na conversa. Quantos pedidos vocês recebem por dia pelo WhatsApp?

**Cliente:** Uns 60 a 80 no dia

**Assistente:** Volume alto. Com automação, sua esposa só precisaria intervir em casos especiais. Você gostaria que a Decodifica avaliasse seu fluxo e propusesse uma solução?

**Cliente:** Quanto custa isso?

**Assistente:** O valor depende do fluxo, integrações, volume de atendimento e nível de personalização. Em geral, antes de passar uma proposta, a Decodifica faz um diagnóstico rápido para entender o que precisa ser automatizado e evitar vender algo maior ou menor do que o necessário. Quer que eu encaminhe para a equipe fazer esse diagnóstico?

**Cliente:** Tá bom, manda

**Assistente:** Acho que já tenho contexto suficiente para alguém da Decodifica avaliar seu caso com mais precisão. Posso encaminhar seu atendimento com um resumo do que você precisa?

### ⚠️ Problemas identificados:
1. **Handoff duplo** — Mesmo padrão. Cliente disse "Tá bom, manda" e o bot perguntou de novo.
2. **Resposta sobre preço genérica demais** — Poderia ter sido mais curta já que o contexto estava claro.

---

## Conversa 5: Imobiliária querendo qualificar interessados

**Perfil:** Corretor de imóveis, recebe leads de portais

**Cliente:** Oi, preciso de ajuda com atendimento no WhatsApp

**Assistente:** Olá. Sou o Assistente Decodifica. Posso te ajudar a entender que tipo de automação faria sentido para o seu atendimento. Para começar, me conta qual é o seu negócio e como vocês usam o WhatsApp hoje.

**Cliente:** Sou corretor de imóveis. Recebo leads dos portais (OLX, ZAP) e eles caem no meu WhatsApp. Mas são muitos e não consigo responder todos rápido

**Assistente:** Qualificação de leads de portais é um caso clássico. O assistente pode responder na hora, perguntar o que o interessado busca (tipo de imóvel, região, faixa de preço) e te entregar só os qualificados. Quantos leads você recebe por dia?

**Cliente:** Uns 15 a 20, mas metade não tem perfil

**Assistente:** Então o assistente filtra os que não têm perfil e te entrega só os que valem a pena. Isso economiza bastante tempo. Você trabalha sozinho ou tem equipe?

**Cliente:** Sozinho

**Assistente:** Faz sentido então. Sendo sozinho, cada minuto conta. O assistente pode fazer a triagem inicial 24h e você foca nos que realmente têm potencial. Quer que eu encaminhe para a equipe da Decodifica avaliar como montar isso para o seu caso?

**Cliente:** Sim, quero

**Assistente:** Acho que já tenho contexto suficiente para alguém da Decodifica avaliar seu caso com mais precisão. Posso encaminhar seu atendimento com um resumo do que você precisa?

### ⚠️ Problemas identificados:
1. **Handoff duplo** — Padrão recorrente. Cliente disse "Sim, quero" e o bot perguntou de novo.
2. **Conversa muito curta** — Poderia ter explorado mais: quais portais, se tem CRM, se quer integração.

---

## Conversa 6: Cliente perguntando preço logo no começo

**Perfil:** Pessoa curiosa, quer saber preço antes de qualquer coisa

**Cliente:** Quanto custa um chatbot?

**Assistente:** Olá. Sou o Assistente Decodifica. Posso te ajudar a entender que tipo de automação faria sentido para o seu atendimento. Para começar, me conta qual é o seu negócio e como vocês usam o WhatsApp hoje.

**Cliente:** Não quero contar minha vida. Só quero saber o preço

**Assistente:** O valor depende do fluxo, integrações, volume de atendimento e nível de personalização. Em geral, antes de passar uma proposta, a Decodifica faz um diagnóstico rápido para entender o que precisa ser automatizado e evitar vender algo maior ou menor do que o necessário. Você quer me contar como funciona seu atendimento hoje para eu indicar o tipo de projeto mais adequado?

**Cliente:** Cara, só me dá uma faixa de preço. Não precisa ser exato

**Assistente:** Entendo que você quer uma referência. Como cada projeto é sob medida, não temos um preço tabelado. Mas posso te encaminhar para a equipe que pode dar uma estimativa rápida com base no que você precisa. Quer seguir por esse caminho?

**Cliente:** Tá, mas pelo menos me diz se é caro. Tipo, mais de 5 mil?

**Assistente:** Não consigo confirmar valores sem entender o escopo. Projetos variam bastante dependendo da complexidade. A equipe pode te dar essa referência em poucos minutos se você quiser. Posso encaminhar?

**Cliente:** Deixa pra lá então

**Assistente:** Sem problema. Se mudar de ideia ou quiser entender melhor as possibilidades, estou por aqui.

### ⚠️ Problemas identificados:
1. **Perdeu o lead** — O cliente pediu 3 vezes uma faixa de preço e o bot nunca deu. Deveria ter dado pelo menos uma referência genérica ("projetos começam a partir de X" ou "depende, mas para fluxos simples fica entre X e Y").
2. **Muito evasivo** — Repetiu a mesma resposta consultiva 3 vezes. O cliente ficou frustrado e desistiu.
3. **Não tentou recuperar** — Quando o cliente disse "Deixa pra lá", poderia ter tentado uma abordagem diferente.

---

## Conversa 7: Cliente perguntando se IA substitui humano

**Perfil:** Gestor preocupado com qualidade do atendimento

**Cliente:** Oi, tenho uma dúvida. Se eu colocar IA no meu WhatsApp, ela vai substituir meus atendentes?

**Assistente:** Olá. A ideia não é prender o cliente em um robô. O assistente pode resolver dúvidas iniciais, coletar informações e encaminhar para uma pessoa quando o caso precisar de atendimento humano. Qual é o seu negócio?

**Cliente:** Tenho uma escola de idiomas. Meus atendentes fazem matrícula, tiram dúvidas sobre cursos e horários

**Assistente:** Para uma escola de idiomas, o assistente pode responder sobre cursos disponíveis, horários, valores de mensalidade e coletar dados para matrícula. Quando o aluno precisa de algo mais específico, encaminha para o atendente. Hoje quantas mensagens vocês recebem por dia?

**Cliente:** Umas 40. Mas minha preocupação é a IA errar e falar besteira pro aluno

**Assistente:** A IA pode errar se não tiver contexto, regras e acompanhamento. Por isso o projeto precisa ter limites claros, base de conhecimento, revisão e opção de encaminhar para humano quando necessário. Não é um robô solto — é um assistente com regras definidas. Você gostaria de entender como isso funcionaria na prática para a sua escola?

**Cliente:** Sim, quero entender melhor

**Assistente:** Acho que já tenho contexto suficiente para alguém da Decodifica avaliar seu caso com mais precisão. Posso encaminhar seu atendimento com um resumo do que você precisa?

### ⚠️ Problemas identificados:
1. **Pulou para handoff muito rápido** — O cliente disse "quero entender melhor" (curiosidade), não "quero contratar". Deveria ter explicado mais sobre como funciona antes de oferecer handoff.
2. **Não explorou a dor** — Não perguntou qual é o maior problema atual (demora? erro? volume?).

---

## Conversa 8: Cliente perguntando se dá para integrar com sistema

**Perfil:** Dono de e-commerce com ERP próprio

**Cliente:** Vocês conseguem integrar com qualquer sistema?

**Assistente:** Olá. A integração depende do sistema do cliente. Normalmente avaliamos se o sistema permite integração via API, webhook ou planilha. Não prometemos integração sem antes avaliar a viabilidade técnica. Qual sistema você usa?

**Cliente:** Tenho um ERP próprio que minha equipe desenvolveu. Queria que o chatbot puxasse dados de lá

**Assistente:** Se o ERP tem API disponível, provavelmente dá para integrar. Mas precisamos avaliar a documentação e os endpoints disponíveis. Qual é o seu negócio e como o WhatsApp participa da operação?

**Cliente:** E-commerce de eletrônicos. O cliente pergunta sobre status do pedido, prazo de entrega, troca. Queria que o bot respondesse consultando o ERP

**Assistente:** Esse é um caso de suporte automatizado com integração. O assistente consulta o ERP, responde status e prazo, e encaminha para humano em casos de troca ou reclamação. Quantas mensagens de suporte vocês recebem por dia?

**Cliente:** Umas 200

**Assistente:** Volume alto. Com integração ao ERP, a maioria dessas 200 mensagens pode ser resolvida automaticamente. Você é o decisor sobre esse tipo de projeto?

**Cliente:** Sou o dono, sim

**Assistente:** Acho que já tenho contexto suficiente para alguém da Decodifica avaliar seu caso com mais precisão. Posso encaminhar seu atendimento com um resumo do que você precisa?

**Cliente:** Antes de encaminhar, quanto tempo leva pra implementar?

**Assistente:** O prazo depende do tamanho do fluxo e das integrações. Projetos simples podem começar com um fluxo inicial mais enxuto, e depois evoluir conforme os atendimentos reais mostram o que precisa melhorar. Para o seu caso com integração ao ERP, a equipe pode dar uma estimativa mais precisa no diagnóstico. Posso encaminhar?

**Cliente:** Ok, pode

**Assistente:** Acho que já tenho contexto suficiente para alguém da Decodifica avaliar seu caso com mais precisão. Posso encaminhar seu atendimento com um resumo do que você precisa?

### ⚠️ Problemas identificados:
1. **Handoff duplo** — Cliente disse "Ok, pode" e o bot repetiu a mensagem de handoff.
2. **Respondeu bem sobre prazo** — Ponto positivo.
3. **Boa adaptação ao nicho** — Entendeu e-commerce + ERP + suporte.

---

## Conversa 9: Cliente sem saber direito o que quer

**Perfil:** Pessoa que ouviu falar de chatbot mas não sabe se precisa

**Cliente:** Oi, queria saber mais sobre o que vocês fazem

**Assistente:** Olá. Sou o Assistente Decodifica. Posso te ajudar a entender que tipo de automação faria sentido para o seu atendimento. Para começar, me conta qual é o seu negócio e como vocês usam o WhatsApp hoje.

**Cliente:** Tenho uma consultoria de RH. Uso WhatsApp pra falar com clientes mas não sei se preciso de automação

**Assistente:** Provavelmente dá para aplicar, mas o melhor caminho depende de como o WhatsApp participa da sua operação. Normalmente avaliamos o que é repetitivo, o que precisa de coleta de dados e em que momento uma pessoa precisa assumir. O que você mais faz pelo WhatsApp hoje?

**Cliente:** Respondo dúvidas de candidatos, mando links de vagas, agendo entrevistas

**Assistente:** Esses três pontos têm potencial para automação: dúvidas frequentes podem ser respondidas automaticamente, links de vagas podem ser enviados com base no perfil, e agendamento pode ser feito sem intervenção humana. Qual desses te toma mais tempo?

**Cliente:** Agendamento, com certeza. Fico indo e voltando pra achar horário

**Assistente:** Agendamento é um dos casos mais diretos de automatizar. O assistente mostra horários disponíveis, o candidato escolhe, e confirma. Você usa alguma agenda digital hoje?

**Cliente:** Google Calendar

**Assistente:** Integração com Google Calendar é viável. O assistente consulta os horários livres e agenda direto. Você gostaria de entender como isso funcionaria na prática?

**Cliente:** Sim, mas não sei se tenho budget pra isso agora

**Assistente:** Entendo. O diagnóstico é sem compromisso — serve para você entender o que é possível e quanto custaria. Assim você decide com informação. Quer que eu encaminhe?

**Cliente:** Pode ser, vamos ver

**Assistente:** Acho que já tenho contexto suficiente para alguém da Decodifica avaliar seu caso com mais precisão. Posso encaminhar seu atendimento com um resumo do que você precisa?

### ⚠️ Problemas identificados:
1. **Handoff duplo** — Cliente disse "Pode ser, vamos ver" e o bot perguntou de novo.
2. **Boa condução** — Ponto positivo: partiu de "não sei se preciso" e chegou em "pode ser". Boa qualificação progressiva.

---

## Conversa 10: Cliente pronto para falar com humano desde o início

**Perfil:** Pessoa que já pesquisou e quer falar com vendedor

**Cliente:** Quero falar com alguém da equipe sobre um projeto de automação

**Assistente:** Olá. Sou o Assistente Decodifica. Posso te ajudar a entender que tipo de automação faria sentido para o seu atendimento. Para começar, me conta qual é o seu negócio e como vocês usam o WhatsApp hoje.

**Cliente:** Já sei o que quero. Preciso de um chatbot para minha clínica veterinária. Quero falar com alguém que possa me passar proposta

**Assistente:** Acho que já tenho contexto suficiente para alguém da Decodifica avaliar seu caso com mais precisão. Posso encaminhar seu atendimento com um resumo do que você precisa?

**Cliente:** Sim

**Assistente:** Ótimo. Vou encaminhar para a equipe com o resumo do seu cenário.

### ✅ Pontos positivos:
1. **Handoff rápido** — Identificou que o cliente já estava pronto e não ficou fazendo perguntas desnecessárias.
2. **Não repetiu a mensagem de handoff** — Nesse caso funcionou bem.

---

## Resumo dos Problemas Recorrentes

| # | Problema | Frequência | Gravidade |
|---|----------|-----------|-----------|
| 1 | **Handoff duplo** — Pergunta se pode encaminhar depois que o cliente já aceitou | 7/10 conversas | Alta |
| 2 | **Evasivo sobre preço** — Nunca dá faixa de valor, repete mesma resposta | 3/10 conversas | Média |
| 3 | **Usa "Perfeito", "Entendi"** — Expressões que deveria evitar | 4/10 conversas | Baixa |
| 4 | **Handoff prematuro** — Oferece encaminhar antes de explorar a dor | 2/10 conversas | Média |
| 5 | **Não recupera lead desistente** — Quando cliente diz "deixa pra lá", não tenta abordagem diferente | 1/10 conversas | Média |
| 6 | **Respostas longas demais** — Algumas respostas passam de 300 caracteres | 3/10 conversas | Baixa |

## Ações Corretivas Sugeridas

1. **Corrigir handoff duplo** — Quando o cliente aceita o encaminhamento (ex: "sim", "pode", "manda", "tá bom"), ir direto para a confirmação final sem repetir a pergunta.
2. **Melhorar resposta sobre preço** — Permitir que o assistente dê uma referência genérica quando o cliente insistir (ex: "projetos variam de X a Y dependendo da complexidade").
3. **Reforçar no prompt** — Não usar "Perfeito", "Entendi", "Ótimo" no início das respostas.
4. **Critério de handoff** — Só oferecer handoff quando tiver pelo menos: negócio identificado + dor clara + volume informado.
5. **Recuperação de lead** — Quando cliente demonstra desistência, tentar uma última abordagem antes de encerrar.
