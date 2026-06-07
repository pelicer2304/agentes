import { Inject, Injectable, Logger } from '@nestjs/common';
import { LLM_PROVIDER_TOKEN, LLMProvider } from '../llm/llm-provider.interface';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { ConversationMessage, KnowledgeBaseItem } from './dto/agent-settings.dto';

export interface AnalysisResult {
  leadScore: number;
  temperature: string;
  status: string;
  allPains: string[];
  painSummary: string;
  primaryPain: string;
  secondaryPains: string[];
  quoteReadinessScore: number;
  missingInfoForQuote: string[];
  commercialSummary: string;
  nextBestQuestion: string | null;
  detectedSegment: string | null;
  detectedIntent: string | null;
  whatsappUsage: string | null;
  estimatedVolume: string | null;
  urgency: string | null;
  decisionRole: string | null;
  budgetSignal: string | null;
  objections: string[];
  recommendedService: string | null;
}

@Injectable()
export class AgentAnalysisService {
  private readonly logger = new Logger(AgentAnalysisService.name);

  constructor(
    @Inject(LLM_PROVIDER_TOKEN)
    private readonly llmProvider: LLMProvider,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Runs deep analysis in background. Does NOT block the client response.
   * Updates lead, saves AgentAnalysis record, updates conversation.
   */
  async runAsync(
    conversationId: string,
    leadId: string,
    conversationHistory: ConversationMessage[],
    currentStage: string,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const analysis = await this.analyzeConversation(conversationHistory, currentStage);
      const analysisMs = Date.now() - startTime;
      this.logger.debug(`[${conversationId}] Async analysis completed in ${analysisMs}ms`);

      // Save AgentAnalysis record
      await this.prisma.agentAnalysis.create({
        data: {
          conversationId,
          leadId,
          detectedSegment: analysis.detectedSegment,
          detectedIntent: analysis.detectedIntent,
          mainPain: analysis.primaryPain || null,
          recommendedService: analysis.recommendedService,
          score: analysis.leadScore,
          temperature: analysis.temperature,
          status: analysis.status,
          shouldHandoff: analysis.status === 'chamar_humano',
          handoffReason: analysis.status === 'chamar_humano' ? 'Lead qualificado para atendimento humano' : null,
          commercialSummary: analysis.commercialSummary || null,
          nextBestQuestion: analysis.nextBestQuestion,
          scoreReasons: analysis.missingInfoForQuote as unknown as Prisma.InputJsonValue,
          rawJson: analysis as unknown as Prisma.InputJsonValue,
        },
      });

      // Update Lead
      const leadUpdate: Record<string, unknown> = {};
      if (analysis.leadScore > 0) leadUpdate.leadScore = analysis.leadScore;
      if (analysis.temperature) leadUpdate.temperature = analysis.temperature;
      // The background analysis MUST NOT escalate the lead to a human handoff.
      // Handoff is owned exclusively by the deterministic pipeline (an explicit
      // user request or an accepted offer). If the analysis LLM were allowed to
      // write `chamar_humano`, the next turn would read `lead.status` as an
      // accepted handoff and — with BOT_PAUSE_ON_HANDOFF — silence the bot,
      // i.e. "transfer out of nowhere". So we never persist `chamar_humano`
      // here; a hot lead is recorded as `quente` instead.
      if (analysis.status && analysis.status !== 'novo' && analysis.status !== 'chamar_humano') {
        leadUpdate.status = analysis.status;
      } else if (analysis.status === 'chamar_humano') {
        leadUpdate.status = 'quente';
      }
      if (analysis.detectedSegment) leadUpdate.segment = analysis.detectedSegment;
      if (analysis.primaryPain) leadUpdate.mainPain = analysis.primaryPain;
      if (analysis.recommendedService) leadUpdate.recommendedService = analysis.recommendedService;
      if (analysis.whatsappUsage) leadUpdate.whatsappUsage = analysis.whatsappUsage;
      if (analysis.estimatedVolume) leadUpdate.estimatedVolume = analysis.estimatedVolume;
      if (analysis.urgency) leadUpdate.urgency = analysis.urgency;
      if (analysis.decisionRole) leadUpdate.decisionRole = analysis.decisionRole;
      if (analysis.commercialSummary) leadUpdate.summary = analysis.commercialSummary;
      if (analysis.secondaryPains?.length) leadUpdate.secondaryPains = analysis.secondaryPains;
      if (analysis.objections?.length) leadUpdate.objections = analysis.objections;

      if (Object.keys(leadUpdate).length > 0) {
        await this.prisma.lead.update({ where: { id: leadId }, data: leadUpdate });
      }

      // Update conversation stage. NOTE: `handoffRequired` is intentionally NOT
      // driven by the analysis — the deterministic pipeline owns the handoff
      // lifecycle. Letting the analysis force it here caused premature, unsolicited
      // transfers (and bot pausing) based purely on the LLM's opinion.
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          stage: currentStage,
          lastIntent: analysis.detectedIntent,
        },
      });
    } catch (error) {
      const elapsed = Date.now() - startTime;
      this.logger.error(
        `[${conversationId}] Async analysis failed after ${elapsed}ms: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
    }
  }

  private async analyzeConversation(
    history: ConversationMessage[],
    currentStage: string,
  ): Promise<AnalysisResult> {
    const prompt = this.buildAnalysisPrompt(history, currentStage);

    const response = await this.llmProvider.complete({
      messages: [{ role: 'system', content: prompt }],
      temperature: 0.2,
      maxTokens: 1200,
      responseFormat: 'json',
    });

    try {
      let content = response.content.trim();
      if (content.startsWith('```json')) content = content.slice(7);
      if (content.startsWith('```')) content = content.slice(3);
      if (content.endsWith('```')) content = content.slice(0, -3);
      content = content.trim();

      return JSON.parse(content) as AnalysisResult;
    } catch {
      this.logger.warn('Failed to parse analysis response, returning defaults');
      return this.defaultAnalysis();
    }
  }

  private buildAnalysisPrompt(history: ConversationMessage[], stage: string): string {
    const conversation = history.map((m) => `${m.role}: ${m.content}`).join('\n');

    return `Analise esta conversa e retorne um JSON com a análise completa do lead.

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
Quote Readiness (0-100): negócio(+10), whatsapp(+10), dor principal(+15), lista dores(+20), volume(+10), impacto(+15), sistemas(+10), objetivo(+10)`;
  }

  private defaultAnalysis(): AnalysisResult {
    return {
      leadScore: 0, temperature: 'frio', status: 'qualificando',
      allPains: [], painSummary: '', primaryPain: '', secondaryPains: [],
      quoteReadinessScore: 0, missingInfoForQuote: [], commercialSummary: '',
      nextBestQuestion: null, detectedSegment: null, detectedIntent: null,
      whatsappUsage: null, estimatedVolume: null, urgency: null,
      decisionRole: null, budgetSignal: null, objections: [], recommendedService: null,
    };
  }
}
