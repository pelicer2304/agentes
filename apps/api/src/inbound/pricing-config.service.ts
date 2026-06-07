import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Default Pricing_Config values per Requirement 17.2.
 */
export const DEFAULT_PRICING_RANGE_ENABLED = true;
export const DEFAULT_PRICING_STARTING_AT = 2500;
export const DEFAULT_PRICING_TEXT =
  'Projetos simples começam a partir de R$ 2.500. Fluxos com integrações, regras comerciais e maior volume precisam de escopo.';

export interface PricingConfigView {
  id: string;
  pricingRangeEnabled: boolean;
  pricingStartingAt: number;
  pricingText: string;
  /** Brazilian currency formatted value, e.g. `R$ 2.500`. */
  pricingStartingAtText: string;
  updatedAt: Date;
}

export interface UpdatePricingConfigInput {
  pricingRangeEnabled?: boolean;
  pricingStartingAt?: number;
  pricingText?: string;
}

@Injectable()
export class PricingConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the singleton Pricing_Config row, creating it with the defaults
   * defined in Requirement 17.2 if no row exists yet.
   */
  async get(): Promise<PricingConfigView> {
    const existing = await this.prisma.pricingConfig.findFirst({
      orderBy: { updatedAt: 'desc' },
    });

    const row =
      existing ??
      (await this.prisma.pricingConfig.create({
        data: {
          pricingRangeEnabled: DEFAULT_PRICING_RANGE_ENABLED,
          pricingStartingAt: new Prisma.Decimal(DEFAULT_PRICING_STARTING_AT),
          pricingText: DEFAULT_PRICING_TEXT,
        },
      }));

    return this.toView(row);
  }

  /**
   * Persists new Pricing_Config values. Creates the row first (with defaults)
   * if it does not yet exist, then applies the provided updates.
   */
  async update(input: UpdatePricingConfigInput): Promise<PricingConfigView> {
    const current = await this.get();

    const data: Prisma.PricingConfigUpdateInput = {};
    if (input.pricingRangeEnabled !== undefined) {
      data.pricingRangeEnabled = input.pricingRangeEnabled;
    }
    if (input.pricingStartingAt !== undefined) {
      data.pricingStartingAt = new Prisma.Decimal(input.pricingStartingAt);
    }
    if (input.pricingText !== undefined) {
      data.pricingText = input.pricingText;
    }

    if (Object.keys(data).length === 0) {
      return current;
    }

    const updated = await this.prisma.pricingConfig.update({
      where: { id: current.id },
      data,
    });

    return this.toView(updated);
  }

  private toView(row: {
    id: string;
    pricingRangeEnabled: boolean;
    pricingStartingAt: Prisma.Decimal;
    pricingText: string;
    updatedAt: Date;
  }): PricingConfigView {
    const startingAt = row.pricingStartingAt.toNumber();

    return {
      id: row.id,
      pricingRangeEnabled: row.pricingRangeEnabled,
      pricingStartingAt: startingAt,
      pricingText: row.pricingText,
      pricingStartingAtText: this.formatBrl(startingAt),
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Formats a numeric value as Brazilian currency. Round values omit the
   * decimal part (e.g. `R$ 2.500`); fractional values keep two decimals
   * (e.g. `R$ 2.500,50`).
   */
  private formatBrl(value: number): string {
    const isRound = Number.isInteger(value);
    const formatted = new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: isRound ? 0 : 2,
      maximumFractionDigits: isRound ? 0 : 2,
    }).format(value);

    return `R$ ${formatted}`;
  }
}
