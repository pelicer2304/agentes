import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  SEED_AGENT_SETTINGS,
  SEED_KNOWLEDGE_BASE,
  SEED_PRICING_CONFIG,
} from './seed-content';

/**
 * Popula o conteúdo inicial do negócio (base de conhecimento, settings do agente
 * e pricing) no boot da API. A imagem de produção roda `prisma migrate deploy`
 * mas NÃO o `prisma db seed` (que depende de ts-node, ausente em prod), então
 * sem isto a base de conhecimento de produção fica vazia e o agente perde a
 * inteligência sobre o negócio.
 *
 * Idempotente e CONSERVADOR: só cria o que está faltando — itens de KB por
 * título, e settings/pricing apenas se ainda não existirem. NUNCA sobrescreve
 * registros já presentes, preservando o que o admin ajustar pelo painel.
 * Falhas são logadas e nunca bloqueiam o boot.
 */
@Injectable()
export class ContentBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(ContentBootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureKnowledgeBase();
      await this.ensureAgentSettings();
      await this.ensurePricing();
    } catch (err) {
      this.logger.error(
        `Content bootstrap failed (non-fatal): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async ensureKnowledgeBase(): Promise<void> {
    let created = 0;
    for (const item of SEED_KNOWLEDGE_BASE) {
      const existing = await this.prisma.knowledgeBase.findFirst({
        where: { title: item.title },
      });
      if (existing) continue;
      await this.prisma.knowledgeBase.create({
        data: { ...item, active: true },
      });
      created++;
    }
    if (created > 0) {
      this.logger.log(`Seeded ${created} knowledge base item(s) on boot.`);
    }
  }

  private async ensureAgentSettings(): Promise<void> {
    const existing = await this.prisma.agentSettings.findFirst();
    if (existing) return;
    await this.prisma.agentSettings.create({ data: SEED_AGENT_SETTINGS });
    this.logger.log('Seeded default agent settings on boot.');
  }

  private async ensurePricing(): Promise<void> {
    const existing = await this.prisma.pricingConfig.findFirst();
    if (existing) return;
    await this.prisma.pricingConfig.create({ data: SEED_PRICING_CONFIG });
    this.logger.log('Seeded default pricing config on boot.');
  }
}
