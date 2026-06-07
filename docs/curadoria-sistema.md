# Curadoria do Sistema DecodificaIA

> Documento gerado automaticamente a partir do código-fonte do projeto.
> Última atualização: Julho 2025

---

## 1. Visão Geral

### O que é o sistema

O DecodificaIA é um assistente de IA para WhatsApp da empresa **Decodifica**. Ele atua como um atendente inteligente que qualifica leads, mapeia dores do cliente no atendimento via WhatsApp, e encaminha para a equipe humana quando o lead está pronto para uma proposta comercial.

O objetivo principal é: **mapear TODAS as dores do cliente no atendimento via WhatsApp para que a equipe consiga montar um orçamento preciso.**

### Stack Técnica

- **Backend:** NestJS (TypeScript)
- **Banco de Dados:** PostgreSQL + Prisma ORM
- **LLM Provider:** OpenRouter (modelo principal: `qwen/qwen3-235b-a22b-2507`, fallback: `google/gemini-2.5-flash`)
- **Canal:** WhatsApp via Evolution API + Playground web
- **Arquitetura:** Monorepo com `apps/api`

### Arquitetura (Reply Rápido + Análise Async)

O sistema usa uma arquitetura de **duas fases**:

1. **Reply Rápido (< 8s):** Responde ao cliente imediatamente usando classificação determinística local OU chamada LLM leve
2. **Análise Assíncrona (background):** Roda análise profunda do lead sem bloquear a resposta ao cliente

Isso garante que o cliente nunca espera mais que ~8 segundos por uma resposta.

---

## 2. Fluxo de Mensagem

### Passo a passo quando o cliente envia uma mensagem

1. **Recepção:** `ConversationService.handleInboundMessage()` recebe a mensagem
2. **Validação:** Verifica se conteúdo tem entre 1-4000 caracteres e se a conversa existe/está ativa
3. **Persistência:** Salva a mensagem do usuário no banco (`Message` com role=user, direction=inbound)
4. **Carrega histórico:** Busca todas as mensagens da conversa ordenadas por data
5. **Monta LeadSummary:** Compila dados do lead (segmento, dores, score anterior, estado de handoff, etc.)
6. **Classificação Determinística:** `classifyIntent()` tenta resolver localmente (greeting, handoff_accept, desistance)
7. **Se alta confiança local:** Retorna resposta fixa sem chamar LLM (0ms)
8. **Se precisa LLM:** Chama o LLM com prompt reduzido + últimas 8 mensagens (temperature=0.3, maxTokens=400)
9. **Fallback contextual:** Se LLM falhar, gera resposta baseada nos dados do lead
10. **Salva resposta:** Persiste mensagem do assistente no banco
11. **Handoff local:** Se aceite de handoff, atualiza conversa e lead imediatamente
12. **Análise async (fire-and-forget):** Se `needsAsyncAnalysis=true`, dispara `AgentAnalysisService.runAsync()` em background
13. **Retorna:** Resposta imediata ao cliente com qualificação parcial

### Diagrama Textual do Fluxo

```
Cliente envia mensagem
        │
        ▼
┌─────────────────────┐
│ ConversationService  │
│ handleInboundMessage │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Salva msg no banco  │
│  Carrega histórico   │
│  Monta LeadSummary   │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────────────┐
│  AgentReplyService           │
│  generateQuickReply()        │
└─────────┬───────────────────┘
          │
          ▼
┌─────────────────────────────┐
│  classifyIntent()            │
│  (determinístico)            │
└─────────┬───────────────────┘
          │
    ┌─────┴─────┐
    │           │
    ▼           ▼
 HIGH        LOW/needs_llm
confidence      │
    │           ▼
    │   ┌───────────────┐
    │   │  Chama LLM    │
    │   │  (< 8s)       │
    │   └───────┬───────┘
    │           │
    │     ┌─────┴─────┐
    │     │           │
    │   Sucesso     Falha
    │     │           │
    │     │           ▼
    │     │   ┌─────────────────┐
    │     │   │ Fallback        │
    │     │   │ contextual      │
    │     │   └────────┬────────┘
    │     │            │
    ▼     ▼            ▼
┌─────────────────────────────┐
│  Salva resposta no banco     │
│  Atualiza handoff se aceito  │
└─────────┬───────────────────┘
          │
          ├──── Retorna resposta ao cliente (síncrono)
          │
          ▼
┌─────────────────────────────┐
│  AgentAnalysisService        │
│  runAsync() (background)     │
│  - Analisa conversa completa │
│  - Atualiza Lead             │
│  - Salva AgentAnalysis       │
│  - Atualiza Conversation     │
└─────────────────────────────┘
```

---

## 3. Classificador de Intenção (Determinístico)

Arquivo: `apps/api/src/agent/intent-classifier.ts`

O classificador determinístico resolve intenções **sem chamar o LLM**. Só retorna `high confidence` para casos inequívocos.

### Tipos de Intenção

```typescript
export type DeterministicIntent =
  | 'handoff_completed_ack'    // cliente diz ok/obrigado após handoff feito
  | 'handoff_accept'           // cliente aceita claramente o encaminhamento
  | 'desistance'              // cliente desiste
  | 'greeting_no_context'     // saudação simples sem dados do lead
  | 'greeting_with_context'   // saudação simples MID-conversa (já tem segmento)
  | 'price_question'          // cliente pergunta explicitamente sobre preço
  | 'frustration'            // cliente irritado / quer pular perguntas
  | 'needs_llm';             // qualquer outra coisa → envia ao LLM
```

### Quais intenções são resolvidas localmente (sem LLM)

| Intenção | Condição | Resposta |
|----------|----------|----------|
| `handoff_completed_ack` | Handoff já completado + mensagem é ack simples | "Seu atendimento já foi encaminhado para a equipe da Decodifica com o resumo do cenário." |
| `handoff_accept` | Handoff foi oferecido + frase de aceite + sem qualificadores | "Vou encaminhar para a equipe da Decodifica com um resumo do seu cenário..." |
| `desistance` | Frase de desistência detectada | "Sem problema. Se o WhatsApp estiver gerando perda de venda..." |
| `greeting_no_context` | Saudação simples + lead sem segmento identificado | Mensagem curta de abertura (não repete intro completa se já foi enviada) |
| `greeting_with_context` | Saudação simples + lead JÁ tem segmento | "Oi. Pode continuar, estou aqui." |
| `price_question` | Frase explícita de preço + tem segmento + sem qualificador | "Não consigo passar valor antes da análise do escopo. Mas posso encaminhar para a equipe..." |
| `frustration` | Frase de irritação/pressa | "Vou encaminhar seu caso para a equipe te passar uma proposta direta, sem mais perguntas." (ativa handoff) |

### Quais vão para o LLM

Tudo que retorna `{ intent: 'needs_llm', confidence: 'low' }`:
- Mensagens com conteúdo substantivo
- Perguntas sobre preço, prazo, integração
- Descrições de negócio
- Objeções
- Qualquer mensagem com qualificadores (mas, porém, quanto, etc.)
- Saudações quando já tem contexto do lead

### Lista de frases de aceite de handoff (HANDOFF_ACCEPT_EXACT)

```typescript
const HANDOFF_ACCEPT_EXACT = [
  'sim, pode', 'pode encaminhar', 'pode encaminhar sim',
  'pode mandar', 'tá bom, manda', 'ta bom, manda',
  'ok, pode', 'ok, pode encaminhar', 'quero proposta',
  'quero falar com alguém', 'quero falar com alguem',
  'manda pra equipe', 'manda para equipe', 'pode seguir',
  'quero sim', 'sim por favor', 'pode sim', 'manda sim',
  'encaminha', 'sim, pode encaminhar',
];
```

### Frases curtas de aceite (HANDOFF_ACCEPT_SHORT)

```typescript
const HANDOFF_ACCEPT_SHORT = ['sim', 'pode', 'manda'];
```

> **Nota:** As frases curtas só são aceitas se `handoffOffered === true` (o assistente já ofereceu o encaminhamento).

### Lista de frases que NÃO são aceite (NOT_ACCEPT_QUALIFIERS)

```typescript
const NOT_ACCEPT_QUALIFIERS = [
  'mas', 'porém', 'porem', 'não sei', 'nao sei', 'depende',
  'quanto', 'valor', 'preço', 'preco', 'budget', 'orçamento',
  'entender melhor', 'pensar', 'ver depois',
];
```

> Se a mensagem contém qualquer um desses qualificadores, **NÃO** é tratada como aceite, mesmo que contenha "sim" ou "pode".

### Lista de frases de desistência (DESISTANCE_PHRASES)

```typescript
const DESISTANCE_PHRASES = [
  'deixa pra lá', 'deixa pra la', 'esquece', 'não quero mais',
  'não preciso', 'nao preciso', 'vou procurar outro',
  'não tenho interesse', 'nao tenho interesse',
];
```

### Saudações simples (GREETINGS)

```typescript
const GREETINGS = ['oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'hey', 'eae', 'e aí'];
```

### Acks simples (SIMPLE_ACK) — usados pós-handoff

```typescript
const SIMPLE_ACK = ['ok', 'obrigado', 'obrigada', 'valeu', 'beleza', 'blz', 'vlw', 'brigado'];
```

### Ordem de avaliação

1. Se `handoffCompleted` → verifica se é ack simples → `handoff_completed_ack`
2. Verifica se tem qualificadores (NOT_ACCEPT) → bloqueia aceite
3. Se `handoffOffered` e sem qualificador → verifica frases de aceite → `handoff_accept`
4. Se tem contexto (`hasSegment`) e sem qualificador → verifica pedido explícito de humano → `handoff_accept`
5. Verifica frases de desistência → `desistance`
6. Verifica frases de frustração → `frustration`
7. Se tem contexto (`hasSegment`) e sem qualificador → verifica frase explícita de preço → `price_question`
8. Se NÃO tem contexto → verifica saudação → `greeting_no_context`
9. Se TEM contexto → verifica saudação → `greeting_with_context`
10. Tudo mais → `needs_llm`

---

## 4. Prompt Completo do LLM

O sistema tem **dois prompts** diferentes:

### 4.1 Prompt do Reply Rápido (AgentReplyService)

Usado para gerar respostas rápidas ao cliente. Montado dinamicamente com os fatos conhecidos do lead:

```
Você é ${agentName}, pré-vendedor da Decodifica. Solução = atendimento humanizado com IA para WhatsApp.

FATOS JÁ COLETADOS (NUNCA perguntar de novo):
Negócio: ${facts.segment}
Descrição: ${facts.businessDescription}
WhatsApp: ${facts.whatsappUsage}
Dor principal: ${facts.mainPain}
Dores mapeadas: ${facts.knownPains.join(', ')}
Volume: ${facts.volume}
Sistema: ${facts.systems}
Papel: ${facts.decisionRole}

QUESTÕES PROIBIDAS: negócio/segmento (já informou), volume/mensagens por dia (já informou), como usa WhatsApp (já informou), principal desafio/dor (já informou), sistema usado (já informou), quem decide (já informou)

Se o fato já está acima, NÃO pergunte sobre ele. Faça uma pergunta DIFERENTE ou ofereça encaminhamento.

ATENÇÃO: Já fez 4+ perguntas. NÃO faça mais perguntas. Ofereça encaminhar para a equipe.

REGRAS ABSOLUTAS:
- Max 250 chars na resposta
- 1 pergunta por resposta (ou nenhuma se já coletou dados suficientes)
- Sem emoji
- NÃO comece com "Entendo", "Perfeito", "Ótimo", "Show", "Certo", "Legal", "Ok", "Compreendo"
- NÃO pergunte o que já sabe (LEIA os fatos acima). Se segmento JÁ FOI INFORMADO, NÃO pergunte "qual é seu negócio". Se volume JÁ FOI INFORMADO, NÃO pergunte quantas mensagens recebe. Se dor JÁ FOI INFORMADA, NÃO pergunte "qual é o principal desafio".
- NUNCA mencione preço, valor, custo, faixa de preço ou qualquer número monetário. Se perguntarem preço, diga que a equipe pode passar proposta e pergunte se quer encaminhamento.
- NUNCA prometa teste gratuito, ativação imediata, integração garantida ou prazo
- NUNCA diga "sem erros", "zero erros", "livre de falhas" ou promessas absolutas sobre IA
- Se cliente perguntar integração: diga que a equipe precisa avaliar o caminho técnico
- Foque em entender a dor do cliente e oferecer encaminhamento para a equipe

JSON:
{"reply":"texto","stage":"abertura|descoberta|mapeamento_de_dores|diagnostico_operacional|explicacao_solucao|conversao|handoff_humano","intent":"vendas|suporte|agendamento|duvidas|orcamento|integracao|curiosidade|outro"}
```

**Parâmetros LLM:** temperature=0.3, maxTokens=200, responseFormat=json, últimas 6 mensagens do histórico.

### 4.2 Prompt Completo da Análise (PromptBuilderService)

Este é o prompt completo enviado ao LLM para análise profunda. Montado pelo `PromptBuilderService`:

```
## Identidade
Você é DecodificaIA, o atendente inteligente da Decodifica.
Seu objetivo é mapear TODAS as dores do cliente no atendimento via WhatsApp para que a equipe consiga montar um orçamento preciso.
A proposta da Decodifica não é colocar um robô genérico. É criar um atendimento humanizado com IA, sob medida para o processo do cliente.

## Tom de Voz
Consultor educado, humanizado, claro, profissional, direto, sem exagero, sem emojis, sem gírias excessivas, sem ficar repetindo expressões de preenchimento, sem textão, uma pergunta por vez, com linguagem natural, sem parecer formulário, sem parecer vendedor insistente

## Serviços
- Assistente de IA para WhatsApp
- Chatbot de atendimento inicial
- Qualificação automática de leads
- Atendimento de dúvidas frequentes
- Suporte automatizado
- Automação de vendas
- Agendamento
- Coleta de informações para orçamento
- Encaminhamento para atendimento humano
- Integração com CRM, planilhas, agendas, APIs e sistemas internos
- Relatórios e organização do funil
- Recuperação de oportunidades
- Pós-venda automatizada

## NÃO Prometer
- Não prometer preço fechado sem diagnóstico
- Não prometer 100% de acerto da IA
- Não prometer automação de spam ou disparo em massa sem consentimento
- Não dizer que substitui totalmente pessoas
- Não prometer integração sem avaliar se o sistema do cliente permite
- Não fingir que é humano
- Não inventar cases, números ou clientes

## Base de Conhecimento
[Injetada dinamicamente do banco — ver seção 7]

## Regras de Conversa

### Formato
- Máximo 300 caracteres por resposta (exceto explicações técnicas)
- UMA pergunta por resposta
- Sem emojis, sem exclamação
- NÃO iniciar com "Entendo", "Perfeito", "Ótimo", "Show", "Certo", "Ok", "Legal"
- Tom consultivo, educado, natural, direto
- Chamar a solução de "atendimento humanizado com IA" ou "DecodificaIA", nunca apenas "chatbot" ou "robô"

### Stages da Conversa
Siga esta ordem:
1. abertura — saudação e primeira pergunta
2. descoberta — entender negócio e uso do WhatsApp
3. mapeamento_de_dores — OBRIGATÓRIO: coletar TODAS as dores antes de propor solução
4. diagnostico_operacional — entender impacto, volume, sistemas
5. explicacao_solucao — explicar como a Decodifica resolve
6. priorizacao — priorizar dores e sugerir escopo
7. tratamento_objecao — tratar preço, prazo, budget
8. conversao — oferecer encaminhamento
9. handoff_humano — confirmar encaminhamento

### Mapeamento de Dores (CRÍTICO)
Depois de identificar a PRIMEIRA dor, NÃO pule para solução.
Pergunte: "Além desse ponto, quais outras dificuldades vocês sentem no WhatsApp hoje?"
Se o cliente responder pouco, dê exemplos: "Vocês também sofrem com demora para responder, perguntas repetidas, perda de clientes, falta de organização, dificuldade para fazer orçamento, suporte pós-venda ou atendimento fora do horário?"
Se o cliente disser "é só isso", confirme: "Só para confirmar: hoje a principal dor é essa, e não há outros problemas relevantes com vendas, suporte, organização ou pós-venda pelo WhatsApp?"
Mapeie pelo menos 2-5 dores antes de sugerir proposta.
Dores possíveis: demora, perda de vendas, perda de agendamentos, falta de organização, falta de padrão, equipe sobrecarregada, fora do horário, coleta de dados para orçamento, dúvidas repetidas, suporte pós-venda, status de pedido, integração com sistema, falta de funil, falta de histórico, demora para passar preço, encaminhamento errado, retrabalho, erros humanos, falta de relatórios, falta de acompanhamento.

### Handoff
- NÃO ofereça handoff antes de mapear pelo menos 2 dores (exceto se cliente pedir explicitamente)
- Se quoteReadinessScore < 70, dizer: "Já tenho uma boa visão inicial, mas ainda faltam alguns pontos para uma proposta mais precisa. Posso encaminhar mesmo assim com esse resumo, ou você prefere me contar mais sobre as outras dores?"
- Se cliente aceitar encaminhamento, confirmar direto sem perguntar de novo

### Preço
- O valor depende do conjunto de dores e do escopo
- Responder: "O valor depende principalmente do que precisa ser resolvido. Só responder dúvidas é um escopo; responder dúvidas, qualificar leads, coletar dados, integrar com sistema e encaminhar para humano já é outro. Por isso preciso entender todas as dores antes de indicar o melhor tipo de projeto."
- Depois perguntar: "Além da dor que você já comentou, quais outros problemas aparecem no WhatsApp hoje?"
- NUNCA inventar valores

### Objeção de Budget
- NÃO encaminhar automaticamente
- Responder: "Faz sentido. O ideal é começar por um fluxo menor, focado no maior gargalo. Assim você valida o retorno antes de investir em algo mais completo."
- Perguntar: "Quer que a equipe avalie uma versão inicial mais enxuta?"

### Integração
- NÃO afirmar que integra diretamente com sistemas específicos
- Dizer: "A integração com [sistema] pode ser avaliada. Primeiro verificamos se existe API, webhook ou outro caminho técnico seguro."

### Cliente Pronto
- Se já tem nicho + objetivo + pedido explícito de proposta, confirmar encaminhamento direto
- Se faltar contexto, pedir UMA informação essencial

### Perguntas Duplicadas (CRÍTICO)
- NÃO repetir perguntas já respondidas no histórico
- Ler o histórico antes de formular a próxima pergunta

### Claims sobre IA
- NÃO dizer "erros são raros"
- Dizer: "A IA reduz erros quando tem regras, base de conhecimento e limites claros. O ideal é manter revisão e encaminhamento para humano quando necessário."

## Scores

### Lead Score (0-100)
- Negócio identificado: +15
- Uso do WhatsApp explicado: +15
- Dor identificada: +20
- Volume/impacto revelado: +15
- Urgência/intenção expressa: +10
- Papel de decisão identificado: +10
- Aceita diagnóstico/humano: +15
Temperatura: 0-39=frio, 40-69=morno, 70-100=quente

### Quote Readiness Score (0-100)
- Negócio identificado: +10
- Uso do WhatsApp entendido: +10
- Dor principal identificada: +15
- Lista de dores coletada (2+ dores): +20
- Volume ou frequência identificado: +10
- Impacto no negócio identificado: +15
- Integrações/sistemas identificados: +10
- Objetivo desejado identificado: +10
Só considerar pronto para orçamento quando quoteReadinessScore >= 70.

## Formato de Resposta JSON
IMPORTANTE: Responda APENAS com JSON puro. Sem markdown, sem ```, sem texto antes ou depois.

{
  "reply": "string (resposta ao cliente, máximo 1000 chars)",
  "stage": "abertura | descoberta | mapeamento_de_dores | diagnostico_operacional | explicacao_solucao | priorizacao | tratamento_objecao | conversao | handoff_humano",
  "detectedSegment": "string | null",
  "businessDescription": "string | null",
  "detectedIntent": "vendas | suporte | agendamento | duvidas | orcamento | integracao | curiosidade | outro",
  "whatsappUsage": "string | null",
  "mainPain": "string | null",
  "secondaryPains": [],
  "allPains": [],
  "painDetails": [{"pain": "string", "impact": "baixo|medio|alto|desconhecido", "frequency": "diario|semanal|mensal|desconhecido", "businessImpact": "perda de venda|perda de tempo|sobrecarga|erro operacional|insatisfacao|outro"}],
  "painSummary": "string | null",
  "desiredOutcome": "string | null",
  "estimatedVolume": "baixo | medio | alto | desconhecido",
  "urgency": "baixa | media | alta | desconhecida",
  "decisionRole": "dono | gestor | funcionario | desconhecido",
  "budgetSignal": "baixo | medio | alto | desconhecido",
  "objections": [],
  "recommendedService": "string | null",
  "solutionScope": {"needsFAQ": false, "needsLeadQualification": false, "needsScheduling": false, "needsBudgetCollection": false, "needsSalesFlow": false, "needsSupportFlow": false, "needsIntegration": false, "needsHumanHandoff": true, "needsReports": false},
  "leadScore": 0,
  "quoteReadinessScore": 0,
  "missingInfoForQuote": [],
  "scoreReasons": [],
  "temperature": "frio | morno | quente",
  "status": "novo | qualificando | frio | morno | quente | chamar_humano | convertido | perdido",
  "shouldHandoff": false,
  "handoffReason": "string | null",
  "commercialSummary": "string | null",
  "nextBestQuestion": "string | null"
}

REGRA ABSOLUTA: Retorne SOMENTE o JSON. Nenhum texto adicional.
```

**Parâmetros LLM (análise completa):** temperature=0.3, maxTokens=1200, responseFormat=json.

### 4.3 Prompt da Análise Assíncrona (AgentAnalysisService)

Usado para análise profunda em background:

```
Analise esta conversa e retorne um JSON com a análise completa do lead.

CONVERSA:
${conversation}

STAGE ATUAL: ${stage}

Retorne JSON puro:
{
  "leadScore": 0,
  "temperature": "frio | morno | quente",
  "status": "novo | qualificando | morno | quente | chamar_humano",
  "allPains": ["lista de todas as dores identificadas"],
  "painSummary": "resumo das dores",
  "primaryPain": "dor principal",
  "secondaryPains": ["dores secundárias"],
  "quoteReadinessScore": 0,
  "missingInfoForQuote": ["informações que faltam para orçamento"],
  "commercialSummary": "resumo comercial completo para a equipe",
  "nextBestQuestion": "próxima melhor pergunta",
  "detectedSegment": "segmento do negócio ou null",
  "detectedIntent": "vendas | suporte | agendamento | duvidas | orcamento | integracao | curiosidade | outro",
  "whatsappUsage": "como usa WhatsApp ou null",
  "estimatedVolume": "baixo | medio | alto | desconhecido",
  "urgency": "baixa | media | alta | desconhecida",
  "decisionRole": "dono | gestor | funcionario | desconhecido",
  "budgetSignal": "baixo | medio | alto | desconhecido",
  "objections": [],
  "recommendedService": "serviço recomendado ou null"
}

Lead Score (0-100): negócio(+15), whatsapp(+15), dor(+20), volume(+15), urgência(+10), decisor(+10), aceite(+15)
Quote Readiness (0-100): negócio(+10), whatsapp(+10), dor principal(+15), lista dores(+20), volume(+10), impacto(+15), sistemas(+10), objetivo(+10)
```

**Parâmetros LLM:** temperature=0.2, maxTokens=1200, responseFormat=json.

---

## 5. Regras de Negócio

### 5.1 Handoff States (Máquina de Estados)

```
handoffOffered   → O assistente PERGUNTOU ao cliente se quer ser encaminhado
                   (detectado por frases como "Posso encaminhar?", "Quer que eu encaminhe?")
handoffAccepted  → O cliente CLARAMENTE aceitou o encaminhamento
                   (detectado pelo intent classifier OU user accept phrases OU affirm phrases na resposta LLM)
handoffCompleted → O sistema confirmou e a conversa está no stage handoff_humano
```

**Detecção de handoff no reply (ConversationService):**

1. **Handoff QUESTIONS (NÃO ativam handoff):**
   - "Posso encaminhar?", "Quer que eu encaminhe?", "Deseja o contato?"
   - Apenas marcam `handoffOffered = true` no context para próxima mensagem

2. **Handoff AFFIRMATIONS (ATIVAM handoff):**
   - "Vou encaminhar", "Estou encaminhando", "Equipe entrará em contato"
   - Se a resposta do LLM contém essas frases → `handoffSignal = 'accepted'`

3. **User accept phrases (ATIVAM handoff):**
   - **Fortes** (ativam com segment OU handoffOffered): "pode encaminhar", "quero proposta", "tá bom, manda"
   - **Fracas** (ativam SOMENTE com handoffOffered): "sim, quero", "sim, pode", "quero sim"

4. **Detecção de handoffOffered no FactExtractor:**
   - `conversation.handoffRequired = true` (já foi aceito antes) OU
   - Qualquer mensagem do assistente no histórico contém: "posso encaminhar", "quer que eu encaminhe", "interessa", etc.

**Sinais de handoff no QuickReplyResult:**
- `'none'` — sem sinal de handoff
- `'suggested'` — LLM sugeriu handoff (pergunta)
- `'accepted'` — cliente aceitou (classificação local)
- `'completed'` — handoff já foi feito, cliente mandou ack

### 5.2 Score e Temperature

**Lead Score (0-100) — calculado pelo `ScoreCalculator` (puro, determinístico, sem LLM):**

| Critério | Pontos |
|----------|--------|
| Segmento informado | +20 |
| Dor identificada (mainPain ou knownPains > 0) | +20 |
| Volume informado | +15 |
| Uso do WhatsApp explicado | +15 |
| Sistema identificado | +15 |
| Decisor identificado | +20 |
| Perguntou preço (priceAskedCount > 0) | +30 |
| Handoff aceito (handoffAccepted) | score = max(score, 80) |

**Temperature (derivada do score):**
| Score | Temperature |
|-------|-------------|
| 0-39 | frio |
| 40-69 | morno |
| 70-100 | quente |

**Regras ABSOLUTAS:**
- Score NUNCA diminui: `finalScore = Math.max(scoreAtual, scoreAnterior)`
- Score NUNCA passa de 100: `finalScore = Math.min(score, 100)`
- Se handoff = true: score mínimo 80, temperatura quente, status chamar_humano
- Se desistência: status perdido, temperatura frio (score não zera)

### 5.3 Status Permitidos

```typescript
// Status do Lead (determinístico, definido no ConversationService)
const LEAD_STATUSES = [
  'novo',           // Lead acabou de chegar
  'qualificando',   // Em processo de qualificação (score < 70, sem handoff)
  'chamar_humano',  // Handoff confirmado (score >= 80, temperatura quente)
  'perdido',        // Desistiu explicitamente
];
```

**Regras de status (ConversationService - lógica determinística):**

1. **Se desistência detectada:**
   - `status = 'perdido'`
   - `handoff = false`
   - `temperatura = 'frio'`

2. **Se handoff aceito OU previousHandoff era true (MONOTONICITY):**
   - `status = 'chamar_humano'`
   - `handoff = true`
   - `temperatura = 'quente'`
   - `score = Math.min(Math.max(scoreAtual, scoreAnterior, 80), 100)`

3. **Caso contrário:**
   - `status = 'qualificando'`
   - `score = Math.min(Math.max(scoreAtual, scoreAnterior), 100)`
   - `temperatura = score >= 70 ? 'quente' : score >= 40 ? 'morno' : 'frio'`
   - `handoff = false`

**REGRA CRÍTICA - MONOTONICITY:**
- Uma vez que `handoff = true` e `status = 'chamar_humano'`, o sistema **NUNCA** volta para `handoff = false` ou `status = qualificando`.
- **ÚNICA exceção:** desistência explícita do cliente (intent = 'desistance').
- Score NUNCA diminui (usa `Math.max(scoreAtual, scoreAnterior)`).
- Score NUNCA passa de 100 (usa `Math.min(..., 100)`).

### 5.4 Regras de Preço

- **NUNCA** mencionar preço, valor, custo, faixa de preço ou qualquer número monetário
- **NUNCA** inventar valores (R$399, R$97, etc.)
- Se o cliente pedir preço: dizer que a equipe pode passar proposta precisa e perguntar se quer encaminhamento
- Resposta padrão (via intent classifier local): "Não consigo passar valor antes da análise do escopo. Mas posso encaminhar para a equipe te passar uma proposta com base no que você já me contou. Quer que eu encaminhe?"
- O sanitizador de resposta (`sanitizeReply`) remove automaticamente qualquer menção de R$ que o LLM eventualmente gere
- Se cliente insiste em preço (frustration intent): encaminha direto para equipe sem mais perguntas

### 5.5 Regras de Integração

- **NUNCA** afirmar que integra diretamente com sistemas específicos
- Resposta padrão: "A integração com [sistema] pode ser avaliada. Primeiro verificamos se existe API, webhook ou outro caminho técnico seguro."
- Não prometer integração sem avaliar viabilidade técnica

### 5.6 Mapeamento de Dores

**Dores possíveis (lista completa):**
- demora
- perda de vendas
- perda de agendamentos
- falta de organização
- falta de padrão
- equipe sobrecarregada
- fora do horário
- coleta de dados para orçamento
- dúvidas repetidas
- suporte pós-venda
- status de pedido
- integração com sistema
- falta de funil
- falta de histórico
- demora para passar preço
- encaminhamento errado
- retrabalho
- erros humanos
- falta de relatórios
- falta de acompanhamento

**Regra:** Mapear pelo menos 2-5 dores antes de sugerir proposta.

### 5.7 Sanitização de Resposta (sanitizeReply)

Toda resposta gerada pelo LLM passa por um sanitizador antes de ser enviada ao usuário:

1. **Remove filler words no início:** "Perfeito,", "Ótimo,", "Entendo,", "Entendi,", "Show,", "Certo,", "Legal,", "Ok,", "Compreendo,"
2. **Remove claims proibidos:** "sem erros", "com zero erros", "sem falhas", "livre de erros"
3. **Remove menções de preço:** Qualquer padrão R$XXX, "reais", "a partir de R$"
4. **Detecta texto corrompido:** Palavras fora de contexto (combustível, fóssil, quântic) → substitui por fallback
5. **Capitaliza primeira letra** após remoção do filler

Se após sanitização a resposta ficar vazia → usa fallback contextual.

### 5.8 Prevenção de Handoff Prematuro

O `NormalizeOutputService` bloqueia handoff prematuro:
- Se a resposta oferece handoff (`posso encaminhar`, `quer que eu encaminhe`, etc.)
- E NÃO tem contexto mínimo (`hasBusinessIdentified` + `hasPainIdentified` ou `hasWhatsappUsageIdentified`)
- E score < 50
- → Remove `shouldHandoff`

---

## 6. Formato de Resposta JSON

### Campos Completos (AgentResponse)

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `reply` | string | ✅ | Resposta ao cliente (máx 1000 chars) |
| `stage` | ConversationStage | ✅ | Stage atual da conversa |
| `detectedSegment` | string \| null | ✅ | Segmento do negócio detectado |
| `businessDescription` | string \| null | ✅ | Descrição do negócio |
| `detectedIntent` | DetectedIntent | ✅ | Intenção detectada |
| `whatsappUsage` | string \| null | ✅ | Como usa WhatsApp |
| `mainPain` | string \| null | ✅ | Dor principal |
| `secondaryPains` | string[] | ✅ | Dores secundárias |
| `allPains` | string[] | ❌ | Todas as dores (incluindo principal) |
| `painDetails` | PainDetail[] | ❌ | Detalhes de cada dor |
| `painSummary` | string \| null | ❌ | Resumo das dores |
| `desiredOutcome` | string \| null | ✅ | Resultado desejado pelo cliente |
| `estimatedVolume` | VolumeLevel | ✅ | Volume estimado |
| `urgency` | UrgencyLevel | ✅ | Urgência |
| `decisionRole` | DecisionRole | ✅ | Papel de decisão |
| `budgetSignal` | BudgetSignal | ✅ | Sinal de budget |
| `objections` | string[] | ✅ | Objeções levantadas |
| `recommendedService` | string \| null | ✅ | Serviço recomendado |
| `solutionScope` | SolutionScope | ❌ | Escopo da solução |
| `leadScore` | number | ✅ | Score do lead (0-100) |
| `quoteReadinessScore` | number | ❌ | Score de prontidão para orçamento (0-100) |
| `missingInfoForQuote` | string[] | ❌ | Info faltante para orçamento |
| `scoreReasons` | string[] | ✅ | Razões do score |
| `temperature` | Temperature | ✅ | Temperatura do lead |
| `status` | LeadStatus | ✅ | Status do lead |
| `shouldHandoff` | boolean | ✅ | Se deve encaminhar para humano |
| `handoffReason` | string \| null | ✅ | Razão do handoff |
| `commercialSummary` | string \| null | ✅ | Resumo comercial |
| `nextBestQuestion` | string \| null | ✅ | Próxima melhor pergunta |

### Enums

**ConversationStage:**
```typescript
'abertura' | 'descoberta' | 'mapeamento_de_dores' | 'diagnostico_operacional' |
'explicacao_solucao' | 'priorizacao' | 'tratamento_objecao' | 'conversao' | 'handoff_humano'
```

**DetectedIntent:**
```typescript
'vendas' | 'suporte' | 'agendamento' | 'duvidas' | 'orcamento' | 'integracao' | 'curiosidade' | 'outro'
```

**VolumeLevel:**
```typescript
'baixo' | 'medio' | 'alto' | 'desconhecido'
```

**UrgencyLevel:**
```typescript
'baixa' | 'media' | 'alta' | 'desconhecida'
```

**DecisionRole:**
```typescript
'dono' | 'gestor' | 'funcionario' | 'desconhecido'
```

**BudgetSignal:**
```typescript
'baixo' | 'medio' | 'alto' | 'desconhecido'
```

**Temperature:**
```typescript
'frio' | 'morno' | 'quente'
```

**LeadStatus:**
```typescript
'novo' | 'qualificando' | 'frio' | 'morno' | 'quente' | 'chamar_humano' | 'convertido' | 'perdido'
```

### PainDetail (objeto)

```typescript
interface PainDetail {
  pain: string;
  impact?: 'baixo' | 'medio' | 'alto' | 'desconhecido';
  frequency?: 'diario' | 'semanal' | 'mensal' | 'desconhecido';
  businessImpact?: 'perda de venda' | 'perda de tempo' | 'sobrecarga' | 'erro operacional' | 'insatisfacao' | 'outro';
}
```

### SolutionScope (objeto)

```typescript
interface SolutionScope {
  needsFAQ?: boolean;
  needsLeadQualification?: boolean;
  needsScheduling?: boolean;
  needsBudgetCollection?: boolean;
  needsSalesFlow?: boolean;
  needsSupportFlow?: boolean;
  needsIntegration?: boolean;
  needsHumanHandoff?: boolean;
  needsReports?: boolean;
}
```

---

## 7. Base de Conhecimento (Seed)

Os 12 itens da base de conhecimento, organizados por categoria:

### Categoria: empresa

**1. O que a Decodifica faz**
> A Decodifica cria assistentes de IA para WhatsApp que automatizam atendimento, qualificação de leads, suporte, vendas, agendamento e integrações com sistemas.

### Categoria: servicos

**2. Serviços oferecidos**
> Assistente de IA para WhatsApp, chatbot de atendimento inicial, qualificação automática de leads, atendimento de dúvidas frequentes, suporte automatizado, automação de vendas, agendamento, coleta de informações para orçamento, encaminhamento para atendimento humano, integração com CRM/planilhas/agendas/APIs/sistemas internos, relatórios e organização do funil, recuperação de oportunidades, pós-venda automatizada.

### Categoria: automacao

**3. O que dá para automatizar**
> Respostas a dúvidas frequentes, coleta de dados iniciais, qualificação de leads, agendamento, confirmação de consultas, envio de cardápio/catálogo, triagem de atendimento, encaminhamento para humano quando necessário.

**4. O que não é recomendado**
> Não automatizar spam ou disparo em massa sem consentimento. Não substituir totalmente o atendimento humano. Não prometer 100% de acerto da IA. Não automatizar processos que exigem julgamento humano complexo.

### Categoria: implantacao

**5. Como funciona a implantação**
> A Decodifica faz um diagnóstico rápido para entender o que precisa ser automatizado. Depois cria um fluxo inicial enxuto que evolui conforme os atendimentos reais mostram o que precisa melhorar.

**6. Como explicar que o projeto é sob medida**
> Cada projeto é diferente porque cada empresa tem um fluxo de atendimento, volume, integrações e necessidades específicas. Por isso a Decodifica faz um diagnóstico antes de propor uma solução.

### Categoria: objecoes

**7. Como responder sobre preço**
> O valor depende do fluxo, integrações, volume de atendimento e nível de personalização. Antes de passar uma proposta, a Decodifica faz um diagnóstico rápido para entender o que precisa ser automatizado e evitar vender algo maior ou menor do que o necessário.

**8. Como responder sobre prazo**
> O prazo depende do tamanho do fluxo e das integrações. Projetos simples podem começar com um fluxo inicial mais enxuto, e depois evoluir conforme os atendimentos reais mostram o que precisa melhorar.

**9. Como responder sobre integração**
> A integração depende do sistema do cliente. Normalmente avaliamos se o sistema permite integração via API, webhook ou planilha. Não prometemos integração sem antes avaliar a viabilidade técnica.

**10. Como responder sobre atendimento humano**
> A ideia não é prender o cliente em um robô. O assistente pode resolver dúvidas iniciais, coletar informações e encaminhar para uma pessoa quando o caso precisar de atendimento humano.

**11. Como responder sobre IA errando**
> A IA pode errar se não tiver contexto, regras e acompanhamento. Por isso o projeto precisa ter limites claros, base de conhecimento, revisão e opção de encaminhar para humano quando necessário.

### Categoria: conversao

**12. Como converter para diagnóstico**
> Quando houver contexto suficiente sobre o negócio, dor e uso do WhatsApp, oferecer encaminhamento para um diagnóstico com a equipe Decodifica. Usar a mensagem: "Acho que já tenho contexto suficiente para alguém da Decodifica avaliar seu caso com mais precisão. Posso encaminhar seu atendimento com um resumo do que você precisa?"

---

## 8. Configurações do Agente (Seed)

### Dados do AgentSettings

| Campo | Valor |
|-------|-------|
| **agentName** | `DecodificaIA` |
| **initialMessage** | "Olá. Sou o DecodificaIA, atendente inteligente da Decodifica. Vou te ajudar a entender quais partes do seu atendimento podem ser automatizadas com IA de forma humanizada. Para começar, me conta qual é o seu negócio e como vocês usam o WhatsApp hoje." |
| **toneOfVoice** | "Consultor educado, humanizado, claro, profissional, direto, sem exagero, sem emojis, sem gírias excessivas, sem ficar repetindo expressões de preenchimento, sem textão, uma pergunta por vez, com linguagem natural, sem parecer formulário, sem parecer vendedor insistente" |

### Serviços Oferecidos

1. Assistente de IA para WhatsApp
2. Chatbot de atendimento inicial
3. Qualificação automática de leads
4. Atendimento de dúvidas frequentes
5. Suporte automatizado
6. Automação de vendas
7. Agendamento
8. Coleta de informações para orçamento
9. Encaminhamento para atendimento humano
10. Integração com CRM, planilhas, agendas, APIs e sistemas internos
11. Relatórios e organização do funil
12. Recuperação de oportunidades
13. Pós-venda automatizada

### Regras do que NÃO Prometer

1. Não prometer preço fechado sem diagnóstico
2. Não prometer 100% de acerto da IA
3. Não prometer automação de spam ou disparo em massa sem consentimento
4. Não dizer que substitui totalmente pessoas
5. Não prometer integração sem avaliar se o sistema do cliente permite
6. Não fingir que é humano
7. Não inventar cases, números ou clientes

### Critérios de Handoff

1. Score >= 70
2. Cliente pedir para falar com alguém
3. Cliente perguntar sobre proposta, preço, implantação ou reunião com intenção clara
4. Cliente disser que quer seguir
5. Dúvida técnica complexa que precisa de humano

---

## 9. Banco de Dados

### Diagrama de Relacionamentos

```
Lead (1) ──── (N) Conversation (1) ──── (N) Message
  │                    │
  │                    │
  └──── (N) AgentAnalysis ────┘

KnowledgeBase (independente)
AgentSettings (independente)
```

### Tabela: leads

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID (PK) | Identificador único |
| name | VARCHAR(200) | Nome do lead |
| phone | VARCHAR(20) | Telefone |
| email | VARCHAR(254)? | Email (opcional) |
| company_name | VARCHAR(200)? | Nome da empresa |
| segment | VARCHAR(100)? | Segmento do negócio |
| business_description | VARCHAR(2000)? | Descrição do negócio |
| whatsapp_usage | VARCHAR(500)? | Como usa WhatsApp |
| main_pain | VARCHAR(1000)? | Dor principal |
| secondary_pains | JSONB? | Dores secundárias (array) |
| desired_outcome | VARCHAR(1000)? | Resultado desejado |
| estimated_volume | VARCHAR(100)? | Volume estimado |
| urgency | VARCHAR(50)? | Urgência |
| decision_role | VARCHAR(100)? | Papel de decisão |
| budget_signal | VARCHAR(500)? | Sinal de budget |
| objections | JSONB? | Objeções (array) |
| recommended_service | VARCHAR(200)? | Serviço recomendado |
| lead_score | SMALLINT? | Score (0-100) |
| temperature | VARCHAR(20)? | frio/morno/quente |
| status | VARCHAR(50) | Status atual |
| summary | VARCHAR(5000)? | Resumo comercial |
| next_step | VARCHAR(1000)? | Próximo passo |
| created_at | TIMESTAMP | Data de criação |
| updated_at | TIMESTAMP | Última atualização |

### Tabela: conversations

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID (PK) | Identificador único |
| lead_id | UUID (FK → leads) | Lead associado |
| channel | VARCHAR(50) | Canal (playground, whatsapp) |
| stage | VARCHAR(50) | Stage atual da conversa |
| status | VARCHAR(50) | active/inactive |
| last_intent | VARCHAR(100)? | Última intenção detectada |
| handoff_required | BOOLEAN | Se handoff foi solicitado |
| handoff_reason | VARCHAR(500)? | Razão do handoff |
| created_at | TIMESTAMP | Data de criação |
| updated_at | TIMESTAMP | Última atualização |

### Tabela: messages

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID (PK) | Identificador único |
| conversation_id | UUID (FK → conversations) | Conversa associada |
| role | VARCHAR(50) | user/assistant/system |
| direction | VARCHAR(20) | inbound/outbound |
| content | VARCHAR(10000) | Conteúdo da mensagem |
| metadata | JSONB? | Metadados extras |
| created_at | TIMESTAMP | Data de criação |

### Tabela: agent_analyses

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID (PK) | Identificador único |
| conversation_id | UUID (FK → conversations) | Conversa analisada |
| lead_id | UUID (FK → leads) | Lead analisado |
| detected_segment | VARCHAR(100)? | Segmento detectado |
| detected_intent | VARCHAR(100)? | Intenção detectada |
| main_pain | VARCHAR(1000)? | Dor principal |
| recommended_service | VARCHAR(200)? | Serviço recomendado |
| score | SMALLINT? | Score calculado |
| temperature | VARCHAR(20)? | Temperatura |
| status | VARCHAR(50)? | Status sugerido |
| should_handoff | BOOLEAN? | Se deve encaminhar |
| handoff_reason | VARCHAR(500)? | Razão do handoff |
| commercial_summary | VARCHAR(5000)? | Resumo comercial |
| next_best_question | VARCHAR(1000)? | Próxima pergunta |
| score_reasons | JSONB? | Razões do score |
| raw_json | JSONB? | JSON completo da análise |
| created_at | TIMESTAMP | Data de criação |

### Tabela: knowledge_base

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID (PK) | Identificador único |
| category | VARCHAR(50) | Categoria (empresa, servicos, automacao, implantacao, objecoes, conversao) |
| title | VARCHAR(100) | Título do item |
| content | VARCHAR(5000) | Conteúdo |
| active | BOOLEAN | Se está ativo |
| created_at | TIMESTAMP | Data de criação |
| updated_at | TIMESTAMP | Última atualização |

### Tabela: agent_settings

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID (PK) | Identificador único |
| agent_name | VARCHAR(100) | Nome do agente |
| initial_message | VARCHAR(500) | Mensagem inicial |
| tone_of_voice | VARCHAR(300)? | Tom de voz |
| services | JSONB? | Lista de serviços |
| do_not_promise | JSONB? | Lista de restrições |
| handoff_criteria | JSONB? | Critérios de handoff |
| created_at | TIMESTAMP | Data de criação |
| updated_at | TIMESTAMP | Última atualização |

---

## 10. Variáveis de Ambiente

| Variável | Descrição | Obrigatória |
|----------|-----------|-------------|
| `DATABASE_URL` | String de conexão PostgreSQL | ✅ |
| `LLM_PROVIDER` | Provider do LLM (`openai` ou `openrouter`) | ✅ |
| `OPENAI_API_KEY` | Chave de API do OpenAI/OpenRouter | ✅ |
| `OPENAI_BASE_URL` | URL base para API compatível com OpenAI (OpenRouter, Azure, etc.) | ✅ |
| `MODEL_NAME` | Nome do modelo para completions do LLM | ✅ |
| `LLM_MODEL_FALLBACK` | Modelo de fallback (usado quando o primário falha) | ✅ |
| `APP_ENV` | Ambiente da aplicação (`development`, `staging`, `production`) | ✅ |
| `FRONTEND_URL` | URL do frontend para configuração de CORS | ✅ |
| `POSTGRES_USER` | Usuário PostgreSQL (usado pelo docker-compose) | ✅ |
| `POSTGRES_PASSWORD` | Senha PostgreSQL (usado pelo docker-compose) | ✅ |
| `POSTGRES_DB` | Nome do banco PostgreSQL (usado pelo docker-compose) | ✅ |
| `EVOLUTION_API_URL` | URL base da Evolution API para integração WhatsApp | ❌ (futuro) |
| `EVOLUTION_API_KEY` | Chave de autenticação da Evolution API | ❌ (futuro) |
| `EVOLUTION_INSTANCE_NAME` | Nome da instância na Evolution API | ❌ (futuro) |

---

## 11. Problemas Conhecidos e Decisões

### Decisões de Arquitetura

1. **Reply rápido + análise async:** Decisão de separar a resposta ao cliente (< 8s) da análise profunda (background). Isso garante UX responsiva mesmo com modelos lentos.

2. **Classificador determinístico antes do LLM:** Intenções de alta confiança (aceite de handoff, desistência, saudação) são resolvidas localmente sem custo de LLM. Reduz latência e custo.

3. **Score nunca diminui:** O `NormalizeOutputService` garante que o score do lead só acumula. Isso evita que o LLM "esqueça" informações já coletadas.

4. **Handoff como máquina de estados:** O handoff passa por estados claros (offered → accepted → completed) para evitar encaminhamentos prematuros ou duplicados.

5. **Fallback contextual (não genérico):** Quando o LLM falha, o sistema gera uma resposta baseada nos dados já conhecidos do lead, não uma mensagem genérica de erro.

6. **NormalizeOutputService como guardrail:** Pós-processamento que corrige inconsistências do LLM (status inválido, handoff prematuro, score inconsistente com temperature).

7. **Prompt reduzido para reply rápido:** O reply rápido usa um prompt menor (280 chars max, últimas 8 msgs) vs. o prompt completo da análise (1200 tokens, histórico completo).

8. **Modelo principal via OpenRouter:** Permite trocar de modelo sem alterar código. Fallback automático para outro modelo se o primário falhar.

### O que já foi testado e não funcionou

1. **LLM único para tudo:** Latência alta (> 15s) tornava a experiência ruim. Solução: separar em reply rápido + análise async.

2. **Confiar no LLM para handoff:** O LLM frequentemente setava `shouldHandoff=true` ou `status=chamar_humano` prematuramente. Solução: `NormalizeOutputService` com regras estritas.

3. **Score calculado apenas pelo LLM:** O LLM às vezes diminuía o score entre mensagens. Solução: regra de acumulação no normalize.

4. **Palavras de preenchimento no início:** O LLM insistia em começar com "Entendo", "Perfeito", "Ótimo". Solução: `applyToneCleanup()` remove automaticamente.

5. **LLM dizendo "erros são raros":** Claim perigoso. Solução: `applySanitization()` substitui por frase segura.

6. **Exclamações e emojis:** O LLM adicionava mesmo com instrução contrária. Solução: pós-processamento remove `!` e substitui por `.`.

### Pontos Pendentes

1. **Integração real com Evolution API:** Variáveis de ambiente existem mas a integração WhatsApp real ainda não está ativa (apenas playground).

2. **Persistência do quoteReadinessScore:** O campo existe no DTO mas não tem coluna dedicada no banco (salvo dentro do `rawJson` da análise).

3. **Multi-tenant:** O sistema atual assume um único agente/empresa. Não há separação por tenant.

4. **Histórico de análises:** Múltiplas `AgentAnalysis` são salvas por conversa, mas apenas a última é usada no retorno.

5. **Webhook de handoff:** Quando o handoff é aceito, o sistema atualiza o banco mas não notifica nenhum sistema externo (CRM, email, etc.).

6. **Rate limiting:** Não há rate limiting nas chamadas ao LLM ou na API.

7. **Validação de `painDetails`:** O campo `painDetails` com `impact`, `frequency` e `businessImpact` existe no DTO mas nem sempre é preenchido pelo LLM.
