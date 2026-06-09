/**
 * Conteúdo inicial do negócio (base de conhecimento + settings + pricing).
 *
 * Fonte ÚNICA usada por dois caminhos:
 *  - `prisma/seed.ts` (dev: `prisma db seed`), e
 *  - o bootstrap no boot da API (`AdminBootstrapService`), que popula isto em
 *    PRODUÇÃO caso ainda não exista — sem sobrescrever o que o admin editar no
 *    painel.
 *
 * Tudo aqui é CONHECIMENTO/CONFIGURAÇÃO do negócio (não comportamento): o tom,
 * o que a empresa faz, o que não prometer e o preço. O "como conversar" vive no
 * prompt do agente (a mente), não aqui.
 */

export interface SeedKnowledgeItem {
  category: string;
  title: string;
  content: string;
}

export const SEED_PRICING_CONFIG = {
  pricingRangeEnabled: true,
  pricingStartingAt: 2500,
  pricingText:
    'Projetos começam a partir de R$ 2.500. O valor final depende do volume de atendimento, das integrações e do nível de personalização — a equipe fecha o número certo após um diagnóstico rápido.',
};

export const SEED_AGENT_SETTINGS = {
  agentName: 'DecodificaIA',
  // Saudação de abertura completa (só aparece UMA vez; um "oi" seguinte cai no
  // LLM, que lê o histórico e conduz sem repetir).
  initialMessage:
    'Olá. Sou o DecodificaIA, atendente inteligente da Decodifica. Vou te ajudar a entender quais partes do seu atendimento podem ser automatizadas com IA de forma humanizada. Para começar, me conta qual é o seu negócio e como vocês usam o WhatsApp hoje.',
  toneOfVoice:
    'Humano e direto, linguagem de WhatsApp. Conversa como uma pessoa experiente: ouve, reage ao que foi dito, responde primeiro o que o cliente perguntou e faz no máximo uma pergunta por vez. Sem emoji, sem exclamação, sem textão, sem soar formulário nem vendedor insistente.',
  services: [
    'Agente de IA sob medida para WhatsApp, treinado no jeito de atender do negócio',
    'Atendimento inicial e resposta a dúvidas frequentes',
    'Qualificação automática de leads',
    'Suporte automatizado de primeiro nível',
    'Agendamento e confirmação',
    'Coleta de informações para orçamento',
    'Encaminhamento para um humano quando o caso exige',
    'Integração com CRM, planilhas, agendas, APIs e sistemas internos (após avaliação técnica)',
  ],
  doNotPromise: [
    'teste grátis',
    'integração garantida com qualquer sistema sem avaliação técnica',
    'prazo fechado sem diagnóstico',
    'preço fechado sem entender o escopo',
    '100% de acerto da IA ou que ela nunca erra',
    'que a IA substitui totalmente as pessoas',
    'cases, números ou clientes inventados',
  ],
  handoffCriteria: [
    'Cliente pede para falar com alguém / ser encaminhado',
    'Cliente demonstra interesse claro em proposta, preço ou reunião',
    'Já há contexto suficiente do negócio e da dor para a equipe avaliar',
    'Dúvida técnica complexa que precisa de um humano',
  ],
};

export const SEED_KNOWLEDGE_BASE: SeedKnowledgeItem[] = [
  {
    category: 'empresa',
    title: 'O que a Decodifica faz',
    content:
      'A Decodifica desenvolve um agente de IA sob medida pro WhatsApp de cada cliente — treinado nas regras e no jeito de atender da empresa dele — que cuida do atendimento repetitivo e passa pra uma pessoa quando o caso pede. Não é um robô de prateleira: é feito pro negócio do cliente.',
  },
  {
    category: 'empresa',
    title: 'Por que é sob medida',
    content:
      'Cada empresa tem um fluxo, volume, integrações e necessidades próprias. Por isso a Decodifica faz um diagnóstico antes de propor a solução, em vez de entregar um chatbot genérico.',
  },
  {
    category: 'servico',
    title: 'O que dá para automatizar',
    content:
      'Dúvidas frequentes, coleta de dados iniciais, qualificação de leads, agendamento e confirmação, envio de catálogo/cardápio, triagem do atendimento e encaminhamento para um humano quando necessário.',
  },
  {
    category: 'implantacao',
    title: 'Como funciona a implantação',
    content:
      'Começa com um diagnóstico rápido para entender o que precisa ser automatizado. Depois a equipe cria um fluxo inicial enxuto, que evolui conforme os atendimentos reais mostram o que ajustar.',
  },
  {
    category: 'preco',
    title: 'Preço',
    content:
      'Os projetos começam a partir de R$ 2.500. O valor final depende do volume de atendimento, das integrações e do nível de personalização. A equipe fecha um número certo após o diagnóstico; nunca prometer um valor fechado antes disso.',
  },
  {
    category: 'preco',
    title: 'Prazo',
    content:
      'O prazo depende do tamanho do fluxo e das integrações. Projetos podem começar com um fluxo inicial mais enxuto e evoluir. Não prometer prazo exato sem avaliar o escopo.',
  },
  {
    category: 'integracao',
    title: 'Integrações',
    content:
      'A integração depende do sistema do cliente. A equipe avalia se é possível via API, webhook ou planilha. Não prometer integração antes de avaliar a viabilidade técnica.',
  },
  {
    category: 'objecao',
    title: 'A IA vai substituir meus atendentes?',
    content:
      'Não substitui. A IA cuida do repetitivo — dúvidas frequentes, primeiro atendimento, coleta de informações — e passa pra uma pessoa quando o caso precisa. O time fica para os atendimentos que realmente exigem gente.',
  },
  {
    category: 'objecao',
    title: 'E se a IA errar / falar besteira?',
    content:
      'A IA responde dentro das regras e da base de conhecimento do negócio; quando foge do que foi definido, ela não inventa — encaminha para um humano. Por isso o projeto tem limites claros, base de conhecimento e acompanhamento.',
  },
  {
    category: 'objecao',
    title: 'Já tenho um chatbot',
    content:
      'A equipe avalia como complementar, otimizar ou integrar com o que o cliente já usa, conforme as dificuldades atuais — não é necessariamente jogar fora o que já existe.',
  },
];
