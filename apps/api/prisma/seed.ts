import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  SEED_AGENT_SETTINGS,
  SEED_KNOWLEDGE_BASE,
  SEED_PRICING_CONFIG,
} from '../src/common/seed-content';

const prisma = new PrismaClient();

const BCRYPT_SALT_ROUNDS = 10;

const adminEmail = process.env.ADMIN_EMAIL || 'admin@decodifica.com';
const adminPassword = process.env.ADMIN_PASSWORD || 'changeme123';

async function main() {
  console.log('Seeding database...');

  // KnowledgeBase — upsert por (category, title) para o dev poder re-rodar e
  // atualizar o conteúdo. (Em produção, o ContentBootstrapService só CRIA o que
  // falta, sem sobrescrever o que o admin editou no painel.)
  for (const item of SEED_KNOWLEDGE_BASE) {
    const existing = await prisma.knowledgeBase.findFirst({
      where: { category: item.category, title: item.title },
    });
    if (existing) {
      await prisma.knowledgeBase.update({
        where: { id: existing.id },
        data: { content: item.content, active: true },
      });
    } else {
      await prisma.knowledgeBase.create({ data: { ...item, active: true } });
    }
  }
  console.log(`Seeded ${SEED_KNOWLEDGE_BASE.length} KnowledgeBase items.`);

  // AgentSettings — upsert by agentName.
  const existingSettings = await prisma.agentSettings.findFirst({
    where: { agentName: SEED_AGENT_SETTINGS.agentName },
  });
  if (existingSettings) {
    await prisma.agentSettings.update({
      where: { id: existingSettings.id },
      data: SEED_AGENT_SETTINGS,
    });
    console.log('Updated existing AgentSettings record.');
  } else {
    await prisma.agentSettings.create({ data: SEED_AGENT_SETTINGS });
    console.log('Created default AgentSettings record.');
  }

  // PricingConfig — single row, upsert on re-run.
  const existingPricing = await prisma.pricingConfig.findFirst();
  if (existingPricing) {
    await prisma.pricingConfig.update({
      where: { id: existingPricing.id },
      data: SEED_PRICING_CONFIG,
    });
    console.log('Updated existing PricingConfig record.');
  } else {
    await prisma.pricingConfig.create({ data: SEED_PRICING_CONFIG });
    console.log('Created default PricingConfig record.');
  }

  // Initial admin User — upsert by unique email.
  const passwordHash = await bcrypt.hash(adminPassword, BCRYPT_SALT_ROUNDS);
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { role: 'admin' },
    create: { email: adminEmail, passwordHash, role: 'admin' },
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
