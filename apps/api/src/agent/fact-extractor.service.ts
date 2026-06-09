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
      segment: this.cleanStoredFact(lead.segment) || this.extractSegment(history),
      businessDescription: lead.businessDescription || null,
      whatsappUsage: lead.whatsappUsage || this.extractWhatsappUsage(history),
      volume: this.cleanStoredFact(lead.estimatedVolume) || this.extractVolume(history),
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

  /**
   * Clean a fact value stored on the Lead (possibly written by the async
   * analysis LLM) before use: reduce a multi-value classification to its first
   * token and reject placeholder/unknown values so "desconhecido" (and pipe-
   * delimited segment classifications) never surface as real facts.
   */
  private cleanStoredFact(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const value = String(raw).split(/[|/;]/)[0].trim();
    const normalized = value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const placeholders = new Set([
      'desconhecido', 'desconhecida', 'nao informado', 'null', 'none',
      'n/a', 'na', '-', 'indefinido', 'nenhum', 'nenhuma',
    ]);
    if (!value || placeholders.has(normalized)) return null;
    return value;
  }

  /**
   * Clean a captured segment phrase: lowercase, cut at the first connector or
   * punctuation, trim, and bound the length. Returns null when nothing
   * meaningful remains.
   */
  private cleanSegmentPhrase(raw: string): string | null {
    let phrase = raw
      .toLowerCase()
      .split(/[,.;:!?]/)[0]
      .split(/\s+(?:e|mas|porque|por que|que|para|pra|pois|com|sem|onde|quando)\s+/)[0]
      .trim();
    if (phrase.length > 30) {
      phrase = phrase.slice(0, 30).trim();
    }
    if (phrase.length < 3) return null;
    return phrase;
  }

  private extractSegment(history: ConversationMessage[]): string | null {
    // 1) Direct keyword match against common business segments.
    const businessKeywords = [
      'clínica', 'clinica', 'loja', 'restaurante', 'lanchonete', 'pizzaria',
      'academia', 'fitness', 'escola', 'curso', 'escritório', 'escritorio',
      'imobiliária', 'imobiliaria', 'corretor', 'pet shop', 'petshop', 'pet',
      'veterinár', 'veterinar', 'consultoria', 'contabil', 'contábil',
      'fábrica', 'fabrica', 'e-commerce', 'ecommerce', 'etiqueta',
      // Automotive
      'carro', 'carros', 'veículo', 'veiculo', 'veículos', 'veiculos',
      'automóvel', 'automovel', 'automóveis', 'automoveis', 'concessionária',
      'concessionaria', 'revenda', 'autopeça', 'autopeças', 'autopeca',
      'oficina', 'mecânica', 'mecanica', 'seminovos',
      // Other common ones
      'salão', 'salao', 'barbearia', 'estética', 'estetica', 'farmácia',
      'farmacia', 'mercado', 'distribuidora', 'atacado', 'varejo',
      'moda', 'roupa', 'roupas', 'calçado', 'calcados', 'joalheria',
      'advocacia', 'advogad', 'odonto', 'dentista', 'hotel', 'pousada',
    ];
    for (const msg of history) {
      if (msg.role !== 'user') continue;
      const lower = msg.content.toLowerCase();
      for (const kw of businessKeywords) {
        if (lower.includes(kw)) return kw;
      }
    }

    // 2) Pattern capture: "vendo X", "venda de X", "trabalho com X",
    //    "negócio de X", "loja de X", "tenho uma X", etc. Captures the noun
    //    phrase the user used to describe their business even when it is not in
    //    the keyword list above (e.g. "venda de carros").
    const patterns: RegExp[] = [
      /\bvend[ae]s?\s+de\s+([a-zà-ú][a-zà-ú\s]{2,30})/i,
      /\bvend[oe]\s+([a-zà-ú][a-zà-ú\s]{2,30})/i,
      /\btrabalh[oa]\s+com\s+([a-zà-ú][a-zà-ú\s]{2,30})/i,
      /\b(?:neg[óo]cio|ramo|setor|área|area)\s+(?:de\s+|é\s+(?:de\s+)?)?([a-zà-ú][a-zà-ú\s]{2,30})/i,
      /\b(?:loja|empresa|f[áa]brica|revenda|com[ée]rcio|oficina|concession[áa]ria|distribuidora)\s+de\s+([a-zà-ú][a-zà-ú\s]{2,30})/i,
      /\btenho\s+(?:uma|um)\s+([a-zà-ú][a-zà-ú\s]{2,30})/i,
    ];
    for (const msg of history) {
      if (msg.role !== 'user') continue;
      for (const re of patterns) {
        const match = msg.content.match(re);
        if (match && match[1]) {
          const cleaned = this.cleanSegmentPhrase(match[1]);
          if (cleaned) return cleaned;
        }
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
      // Oferta determinística do pedido da lista (REPLY_HANDOFF_OFFER_LIST):
      // sem isto o estado nunca virava 'suggested' e o handoff não fechava.
      // Frases específicas dessa oferta (evita falso positivo em preço etc.).
      'antes de te encaminhar', 'te conectar com o nosso time',
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
      'além d', 'alem d', // "além do/da/de/desse/dessa ..." — deepening openers
      'outras dificuldades', 'mais alguma dificuldade', 'outros problemas',
      'outras dores', 'mais algum ponto', 'perguntas repetidas, perda',
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
