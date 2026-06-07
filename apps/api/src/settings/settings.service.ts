import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

export interface AgentSettingsResponse {
  id: string;
  agentName: string;
  initialMessage: string;
  toneOfVoice: string | null;
  services: string[] | null;
  doNotPromise: string[] | null;
  handoffCriteria: string[] | null;
  createdAt: Date;
  updatedAt: Date;
}

const DEFAULT_SETTINGS = {
  agentName: 'Assistente Decodifica',
  initialMessage:
    'Olá. Sou o Assistente Decodifica. Posso te ajudar a entender que tipo de automação faria sentido para o seu atendimento. Para começar, me conta qual é o seu negócio e como vocês usam o WhatsApp hoje.',
  toneOfVoice:
    'Consultor educado, humanizado, claro, profissional, direto, sem exagero, sem emojis, sem gírias excessivas',
  services: [
    'Chatbot inteligente para WhatsApp',
    'Automação de atendimento',
    'Qualificação automática de leads',
    'Integração com CRM',
    'Fluxos de nutrição por WhatsApp',
    'Disparo de mensagens em massa',
    'Atendimento multicanal',
  ],
  doNotPromise: [
    'Não prometer prazos específicos sem diagnóstico',
    'Não prometer resultados numéricos garantidos',
    'Não prometer funcionalidades não existentes',
    'Não prometer preços sem avaliação técnica',
  ],
  handoffCriteria: [
    'Lead com score >= 70',
    'Cliente solicita falar com humano',
    'Pedido direto de proposta ou preço',
    'Intenção afirmativa de contratar',
    'Pergunta fora da base de conhecimento',
  ],
};

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(): Promise<AgentSettingsResponse> {
    const settings = await this.prisma.agentSettings.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    if (!settings) {
      return {
        id: '',
        agentName: DEFAULT_SETTINGS.agentName,
        initialMessage: DEFAULT_SETTINGS.initialMessage,
        toneOfVoice: DEFAULT_SETTINGS.toneOfVoice,
        services: DEFAULT_SETTINGS.services,
        doNotPromise: DEFAULT_SETTINGS.doNotPromise,
        handoffCriteria: DEFAULT_SETTINGS.handoffCriteria,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    return {
      id: settings.id,
      agentName: settings.agentName,
      initialMessage: settings.initialMessage,
      toneOfVoice: settings.toneOfVoice,
      services: settings.services as string[] | null,
      doNotPromise: settings.doNotPromise as string[] | null,
      handoffCriteria: settings.handoffCriteria as string[] | null,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    };
  }

  async updateSettings(dto: UpdateSettingsDto): Promise<AgentSettingsResponse> {
    const existing = await this.prisma.agentSettings.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    const data = {
      agentName: dto.agentName,
      initialMessage: dto.initialMessage,
      toneOfVoice: dto.toneOfVoice ?? null,
      services: dto.services ?? Prisma.JsonNull,
      doNotPromise: dto.doNotPromise ?? Prisma.JsonNull,
      handoffCriteria: dto.handoffCriteria ?? Prisma.JsonNull,
    };

    let settings;

    if (existing) {
      settings = await this.prisma.agentSettings.update({
        where: { id: existing.id },
        data,
      });
    } else {
      settings = await this.prisma.agentSettings.create({
        data,
      });
    }

    return {
      id: settings.id,
      agentName: settings.agentName,
      initialMessage: settings.initialMessage,
      toneOfVoice: settings.toneOfVoice,
      services: settings.services as string[] | null,
      doNotPromise: settings.doNotPromise as string[] | null,
      handoffCriteria: settings.handoffCriteria as string[] | null,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    };
  }
}
