import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const BCRYPT_SALT_ROUNDS = 10;

const defaultPricingConfig = {
  pricingRangeEnabled: true,
  pricingStartingAt: 2500,
  pricingText:
    'Projetos simples começam a partir de R$ 2.500. Fluxos com integrações, regras comerciais e maior volume precisam de escopo.',
};

const adminEmail = process.env.ADMIN_EMAIL || 'admin@decodifica.com';
const adminPassword = process.env.ADMIN_PASSWORD || 'changeme123';

const knowledgeBaseItems = [
  {
    category: 'empresa',
    title: 'O que a Decodifica faz',
    content:
      'A Decodifica cria assistentes de IA para WhatsApp que automatizam atendimento, qualificação de leads, suporte, vendas, agendamento e integrações com sistemas.',
  },
  {
    category: 'servicos',
    title: 'Serviços oferecidos',
    content:
      'Assistente de IA para WhatsApp, chatbot de atendimento inicial, qualificação automática de leads, atendimento de dúvidas frequentes, suporte automatizado, automação de vendas, agendamento, coleta de informações para orçamento, encaminhamento para atendimento humano, integração com CRM/planilhas/agendas/APIs/sistemas internos, relatórios e organização do funil, recuperação de oportunidades, pós-venda automatizada.',
  },
  {
    category: 'automacao',
    title: 'O que dá para automatizar',
    content:
      'Respostas a dúvidas frequentes, coleta de dados iniciais, qualificação de leads, agendamento, confirmação de consultas, envio de cardápio/catálogo, triagem de atendimento, encaminhamento para humano quando necessário.',
  },
  {
    category: 'automacao',
    title: 'O que não é recomendado',
    content:
      'Não automatizar spam ou disparo em massa sem consentimento. Não substituir totalmente o atendimento humano. Não prometer 100% de acerto da IA. Não automatizar processos que exigem julgamento humano complexo.',
  },
  {
    category: 'implantacao',
    title: 'Como funciona a implantação',
    content:
      'A Decodifica faz um diagnóstico rápido para entender o que precisa ser automatizado. Depois cria um fluxo inicial enxuto que evolui conforme os atendimentos reais mostram o que precisa melhorar.',
  },
  {
    category: 'objecoes',
    title: 'Como responder sobre preço',
    content:
      'O valor depende do fluxo, integrações, volume de atendimento e nível de personalização. Antes de passar uma proposta, a Decodifica faz um diagnóstico rápido para entender o que precisa ser automatizado e evitar vender algo maior ou menor do que o necessário.',
  },
  {
    category: 'objecoes',
    title: 'Como responder sobre prazo',
    content:
      'O prazo depende do tamanho do fluxo e das integrações. Projetos simples podem começar com um fluxo inicial mais enxuto, e depois evoluir conforme os atendimentos reais mostram o que precisa melhorar.',
  },
  {
    category: 'objecoes',
    title: 'Como responder sobre integração',
    content:
      'A integração depende do sistema do cliente. Normalmente avaliamos se o sistema permite integração via API, webhook ou planilha. Não prometemos integração sem antes avaliar a viabilidade técnica.',
  },
  {
    category: 'objecoes',
    title: 'Como responder sobre atendimento humano',
    content:
      'A ideia não é prender o cliente em um robô. O assistente pode resolver dúvidas iniciais, coletar informações e encaminhar para uma pessoa quando o caso precisar de atendimento humano.',
  },
  {
    category: 'objecoes',
    title: 'Como responder sobre IA errando',
    content:
      'A IA pode errar se não tiver contexto, regras e acompanhamento. Por isso o projeto precisa ter limites claros, base de conhecimento, revisão e opção de encaminhar para humano quando necessário.',
  },
  {
    category: 'implantacao',
    title: 'Como explicar que o projeto é sob medida',
    content:
      'Cada projeto é diferente porque cada empresa tem um fluxo de atendimento, volume, integrações e necessidades específicas. Por isso a Decodifica faz um diagnóstico antes de propor uma solução.',
  },
  {
    category: 'conversao',
    title: 'Como converter para diagnóstico',
    content:
      'Quando houver contexto suficiente sobre o negócio, dor e uso do WhatsApp, oferecer encaminhamento para um diagnóstico com a equipe Decodifica. Usar a mensagem: "Acho que já tenho contexto suficiente para alguém da Decodifica avaliar seu caso com mais precisão. Posso encaminhar seu atendimento com um resumo do que você precisa?"',
  },
];

const defaultAgentSettings = {
  agentName: 'DecodificaIA',
  initialMessage:
    'Olá. Sou o DecodificaIA, atendente inteligente da Decodifica. Vou te ajudar a entender quais partes do seu atendimento podem ser automatizadas com IA de forma humanizada. Para começar, me conta qual é o seu negócio e como vocês usam o WhatsApp hoje.',
  toneOfVoice:
    'Consultor educado, humanizado, claro, profissional, direto, sem exagero, sem emojis, sem gírias excessivas, sem ficar repetindo expressões de preenchimento, sem textão, uma pergunta por vez, com linguagem natural, sem parecer formulário, sem parecer vendedor insistente',
  services: [
    'Assistente de IA para WhatsApp',
    'Chatbot de atendimento inicial',
    'Qualificação automática de leads',
    'Atendimento de dúvidas frequentes',
    'Suporte automatizado',
    'Automação de vendas',
    'Agendamento',
    'Coleta de informações para orçamento',
    'Encaminhamento para atendimento humano',
    'Integração com CRM, planilhas, agendas, APIs e sistemas internos',
    'Relatórios e organização do funil',
    'Recuperação de oportunidades',
    'Pós-venda automatizada',
  ],
  doNotPromise: [
    'Não prometer preço fechado sem diagnóstico',
    'Não prometer 100% de acerto da IA',
    'Não prometer automação de spam ou disparo em massa sem consentimento',
    'Não dizer que substitui totalmente pessoas',
    'Não prometer integração sem avaliar se o sistema do cliente permite',
    'Não fingir que é humano',
    'Não inventar cases, números ou clientes',
  ],
  handoffCriteria: [
    'Score >= 70',
    'Cliente pedir para falar com alguém',
    'Cliente perguntar sobre proposta, preço, implantação ou reunião com intenção clara',
    'Cliente disser que quer seguir',
    'Dúvida técnica complexa que precisa de humano',
  ],
};

async function main() {
  console.log('Seeding database...');

  // Seed KnowledgeBase items - use findFirst + create/update to avoid duplicates on re-run
  for (const item of knowledgeBaseItems) {
    const existing = await prisma.knowledgeBase.findFirst({
      where: {
        category: item.category,
        title: item.title,
      },
    });

    if (existing) {
      await prisma.knowledgeBase.update({
        where: { id: existing.id },
        data: {
          content: item.content,
          active: true,
        },
      });
    } else {
      await prisma.knowledgeBase.create({
        data: {
          category: item.category,
          title: item.title,
          content: item.content,
          active: true,
        },
      });
    }
  }

  console.log(`Seeded ${knowledgeBaseItems.length} KnowledgeBase items.`);

  // Seed default AgentSettings - upsert based on agentName
  const existingSettings = await prisma.agentSettings.findFirst({
    where: { agentName: defaultAgentSettings.agentName },
  });

  if (existingSettings) {
    await prisma.agentSettings.update({
      where: { id: existingSettings.id },
      data: defaultAgentSettings,
    });
    console.log('Updated existing AgentSettings record.');
  } else {
    await prisma.agentSettings.create({
      data: defaultAgentSettings,
    });
    console.log('Created default AgentSettings record.');
  }

  // Seed PricingConfig defaults (Requirement 17.2) - single row, upsert on re-run
  const existingPricing = await prisma.pricingConfig.findFirst();

  if (existingPricing) {
    await prisma.pricingConfig.update({
      where: { id: existingPricing.id },
      data: defaultPricingConfig,
    });
    console.log('Updated existing PricingConfig record.');
  } else {
    await prisma.pricingConfig.create({
      data: defaultPricingConfig,
    });
    console.log('Created default PricingConfig record.');
  }

  // Seed initial admin User (Requirement 20.3) - upsert by unique email
  const passwordHash = await bcrypt.hash(adminPassword, BCRYPT_SALT_ROUNDS);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { role: 'admin' },
    create: {
      email: adminEmail,
      passwordHash,
      role: 'admin',
    },
  });

  console.log(`Seeded initial admin User (${adminEmail}).`);

  console.log('Seeding complete.');
}

main()
  .catch((e) => {
    console.error('Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
