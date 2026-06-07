import { Injectable } from '@nestjs/common';
import { ConversationMessage } from './dto/agent-settings.dto';

/**
 * Extracts known facts from conversation history WITHOUT calling LLM.
 * Runs synchronously before the LLM call to build context.
 */
export interface KnownFacts {
  segment: string | null;
  businessDescription: string | null;
  whatsappUsage: string | null;
  volume: string | null;
  systems: string | null;
  decisionRole: string | null;
  knownPains: string[];
  mainPain: string | null;
  priceAskedCount: number;
  handoffOffered: boolean;
  handoffAccepted: boolean;
  handoffCompleted: boolean;
  painMappingAsked: boolean;
  secondaryPainsAsked: boolean;
  volumeAsked: boolean;
  messageCount: number;
}

@Injectable()
export class FactExtractorService {
  /**
   * Builds KnownFacts from lead data + conversation history.
   * This is the single source of truth for what we know about the lead.
   */
  extract(
    lead: {
      segment?: string | null;
      businessDescription?: string | null;
      whatsappUsage?: string | null;
      estimatedVolume?: string | null;
      decisionRole?: string | null;
      mainPain?: string | null;
      secondaryPains?: string[] | null;
      status?: string;
    },
    conversation: {
      stage: string;
      handoffRequired: boolean;
    },
    history: ConversationMessage[],
  ): KnownFacts {
    return {
      segment: lead.segment || this.extractSegment(history),
      businessDescription: lead.businessDescription || null,
      whatsappUsage: lead.whatsappUsage || this.extractWhatsappUsage(history),
      volume: lead.estimatedVolume || this.extractVolume(history),
      systems: this.extractSystems(history),
      decisionRole: lead.decisionRole || this.extractRole(history),
      knownPains: this.extractPains(lead, history),
      mainPain: lead.mainPain || this.extractMainPainFromHistory(history),
      priceAskedCount: this.countPriceQuestions(history),
      handoffOffered: conversation.handoffRequired || this.detectHandoffOfferedInHistory(history),
      handoffAccepted: lead.status === 'chamar_humano',
      handoffCompleted: conversation.stage === 'handoff_humano' && lead.status === 'chamar_humano',
      painMappingAsked: this.checkPainMappingAsked(history),
      secondaryPainsAsked: this.checkSecondaryPainsAsked(history),
      volumeAsked: this.checkVolumeAsked(history),
      messageCount: history.length,
    };
  }

  private extractSegment(history: ConversationMessage[]): string | null {
    // Look for business mentions in user messages
    const businessKeywords = [
      'clínica', 'clinica', 'loja', 'restaurante', 'academia', 'escola',
      'escritório', 'escritorio', 'imobiliária', 'imobiliaria', 'pet shop',
      'consultoria', 'fábrica', 'fabrica', 'e-commerce', 'ecommerce',
    ];
    for (const msg of history) {
      if (msg.role !== 'user') continue;
      const lower = msg.content.toLowerCase();
      for (const kw of businessKeywords) {
        if (lower.includes(kw)) return kw;
      }
    }
    return null;
  }

  private extractWhatsappUsage(history: ConversationMessage[]): string | null {
    const usageKeywords = ['whatsapp', 'zap', 'wpp'];
    const actionKeywords = ['vendo', 'atendo', 'respondo', 'agendo', 'recebo pedido', 'mando'];
    for (const msg of history) {
      if (msg.role !== 'user') continue;
      const lower = msg.content.toLowerCase();
      const hasWhatsapp = usageKeywords.some((k) => lower.includes(k));
      const hasAction = actionKeywords.some((k) => lower.includes(k));
      if (hasWhatsapp && hasAction) return msg.content;
    }
    return null;
  }

  private extractVolume(history: ConversationMessage[]): string | null {
    const volumePattern = /(\d+)\s*(por dia|mensagens|pedidos|atendimentos|por semana|clientes)/i;
    for (const msg of history) {
      if (msg.role !== 'user') continue;
      const match = msg.content.match(volumePattern);
      if (match) return msg.content;
    }
    return null;
  }

  private extractSystems(history: ConversationMessage[]): string | null {
    const systems = [
      'dental office', 'google calendar', 'erp', 'crm', 'excel', 'planilha',
      'sistema', 'software', 'ifood', 'rappi', 'shopify', 'woocommerce',
    ];
    for (const msg of history) {
      if (msg.role !== 'user') continue;
      const lower = msg.content.toLowerCase();
      for (const sys of systems) {
        if (lower.includes(sys)) return sys;
      }
    }
    return null;
  }

  private extractRole(history: ConversationMessage[]): string | null {
    const roles: Record<string, string> = {
      'sou o dono': 'dono', 'sou dono': 'dono', 'sou dona': 'dono',
      'sou o gestor': 'gestor', 'sou gestor': 'gestor', 'sou gerente': 'gestor',
      'sou o sócio': 'dono', 'sou sócio': 'dono',
    };
    for (const msg of history) {
      if (msg.role !== 'user') continue;
      const lower = msg.content.toLowerCase();
      for (const [phrase, role] of Object.entries(roles)) {
        if (lower.includes(phrase)) return role;
      }
    }
    return null;
  }

  private extractPains(
    lead: { mainPain?: string | null; secondaryPains?: string[] | null },
    history: ConversationMessage[],
  ): string[] {
    const pains: string[] = [];
    if (lead.mainPain) pains.push(lead.mainPain);
    if (lead.secondaryPains && Array.isArray(lead.secondaryPains)) {
      pains.push(...lead.secondaryPains);
    }
    // Also extract pains from history if not in lead yet
    if (pains.length === 0) {
      const painKeywords = [
        'não dá conta', 'nao da conta', 'demora', 'perde tempo', 'perco tempo',
        'desiste', 'perda de', 'sobrecarregad', 'não consigo', 'nao consigo',
        'repetitiv', 'mesmas perguntas', 'curiosos', 'loucura', 'caos',
      ];
      for (const msg of history) {
        if (msg.role !== 'user') continue;
        const lower = msg.content.toLowerCase();
        if (painKeywords.some((k) => lower.includes(k))) {
          pains.push(msg.content.slice(0, 80));
          break; // Just one extracted pain from history
        }
      }
    }
    return pains;
  }

  private countPriceQuestions(history: ConversationMessage[]): number {
    const priceKeywords = ['preço', 'preco', 'valor', 'custa', 'custo', 'quanto'];
    return history.filter(
      (msg) => msg.role === 'user' && priceKeywords.some((kw) => msg.content.toLowerCase().includes(kw)),
    ).length;
  }

  private extractMainPainFromHistory(history: ConversationMessage[]): string | null {
    // Look for pain-related mentions in user messages
    const painIndicators = [
      'não dá conta', 'nao da conta', 'demora', 'perde tempo',
      'perco tempo', 'desiste', 'perda', 'sobrecarregada', 'sobrecarregado',
      'não consigo', 'nao consigo', 'repetitiv', 'mesmas perguntas',
      'curiosos', 'não responde rápido', 'não dá conta',
    ];
    for (const msg of history) {
      if (msg.role !== 'user') continue;
      const lower = msg.content.toLowerCase();
      if (painIndicators.some((p) => lower.includes(p))) {
        return msg.content.slice(0, 120);
      }
    }
    return null;
  }

  /**
   * Detects if the assistant has offered handoff in history
   * (e.g., "Posso encaminhar?", "Quer que eu encaminhe?", "Deseja o contato?")
   */
  private detectHandoffOfferedInHistory(history: ConversationMessage[]): boolean {
    const offerPhrases = [
      'posso encaminhar', 'quer que eu encaminhe', 'quer que encaminhe',
      'deseja o contato', 'deseja o encaminhamento', 'posso conectar você',
      'posso pedir', 'quer que a equipe', 'quer seguir',
      'interessa', 'posso encaminhar para', 'posso encaminhar seu',
    ];
    return history.some(
      (msg) => msg.role === 'assistant' && offerPhrases.some((p) => msg.content.toLowerCase().includes(p)),
    );
  }

  private checkPainMappingAsked(history: ConversationMessage[]): boolean {
    const phrases = ['outras dores', 'outras dificuldades', 'outros problemas', 'mais algum ponto', 'além desse'];
    return history.some(
      (msg) => msg.role === 'assistant' && phrases.some((p) => msg.content.toLowerCase().includes(p)),
    );
  }

  /**
   * Checks if secondary pains question was already asked
   */
  private checkSecondaryPainsAsked(history: ConversationMessage[]): boolean {
    const phrases = [
      'além desse ponto', 'além dessa dor', 'outras dificuldades',
      'mais alguma dificuldade', 'outros problemas', 'perguntas repetidas, perda',
      'demora para responder, perguntas repetidas',
    ];
    return history.some(
      (msg) => msg.role === 'assistant' && phrases.some((p) => msg.content.toLowerCase().includes(p)),
    );
  }

  /**
   * Checks if volume/quantity question was already asked by the assistant
   */
  private checkVolumeAsked(history: ConversationMessage[]): boolean {
    const phrases = [
      'quantas mensagens', 'quantos pedidos', 'quantos orçamentos',
      'quantas por dia', 'volume de mensagens', 'recebem por dia',
      'recebe por dia', 'mensagens diárias', 'por dia, em média',
    ];
    return history.some(
      (msg) => msg.role === 'assistant' && phrases.some((p) => msg.content.toLowerCase().includes(p)),
    );
  }
}
