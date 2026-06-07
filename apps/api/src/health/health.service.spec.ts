import { Test } from '@nestjs/testing';
import { HealthService } from './health.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/config.service';

describe('HealthService', () => {
  const configuredEvolution = {
    evolutionApiUrl: 'https://evo.example.com',
    evolutionApiKey: 'evo-key',
    evolutionInstanceName: 'decodifica',
  };

  async function buildService(overrides: {
    queryRaw?: jest.Mock;
    config?: Partial<AppConfigService>;
  }) {
    const queryRaw =
      overrides.queryRaw ?? jest.fn().mockResolvedValue([{ '?column?': 1 }]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: PrismaService, useValue: { $queryRaw: queryRaw } },
        {
          provide: AppConfigService,
          useValue: {
            ...configuredEvolution,
            llmProvider: 'openrouter',
            openrouterApiKey: 'or-key',
            openaiApiKey: 'oa-key',
            ...overrides.config,
          },
        },
      ],
    }).compile();

    return moduleRef.get(HealthService);
  }

  it('reports healthy database and status ok on a successful probe', async () => {
    const service = await buildService({});

    const result = await service.check();

    expect(result.database).toBe('healthy');
    expect(result.status).toBe('ok');
    expect(result.evolutionConfigured).toBe(true);
    expect(result.llmConfigured).toBe(true);
  });

  it('reports unhealthy database and status degraded when the probe throws', async () => {
    const service = await buildService({
      queryRaw: jest.fn().mockRejectedValue(new Error('connection refused')),
    });

    const result = await service.check();

    expect(result.database).toBe('unhealthy');
    expect(result.status).toBe('degraded');
  });

  it('does not throw when the database probe fails', async () => {
    const service = await buildService({
      queryRaw: jest.fn().mockRejectedValue(new Error('boom')),
    });

    await expect(service.check()).resolves.toBeDefined();
  });

  it('reports evolutionConfigured false when a required value is missing', async () => {
    const service = await buildService({
      config: { evolutionApiKey: '' as unknown as string },
    });

    const result = await service.check();

    expect(result.evolutionConfigured).toBe(false);
  });

  it('reports llmConfigured false when no LLM key is set', async () => {
    const service = await buildService({
      config: { llmProvider: 'openrouter', openaiApiKey: '' as unknown as string },
    });

    const result = await service.check();

    expect(result.llmConfigured).toBe(false);
  });

  it('reports llmConfigured true when the LLM key is present', async () => {
    const service = await buildService({
      config: { llmProvider: 'openai', openaiApiKey: 'oa-key' },
    });

    const result = await service.check();

    expect(result.llmConfigured).toBe(true);
  });
});
