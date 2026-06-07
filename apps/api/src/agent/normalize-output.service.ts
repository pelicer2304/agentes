import { Injectable, Logger } from '@nestjs/common';
import { AgentResponse } from './dto/agent-response.dto';

/**
 * Handoff state machine:
 * - handoffSuggested: LLM thinks it's time to handoff (score high, context enough)
 * - handoffOffered: The assistant ASKED the client if they want to be forwarded
 * - handoffAccepted: The client CLEARLY accepted the forwarding
 * - handoffCompleted: The system confirmed and the conversation is done
 */
export interface ConversationContext {
  lastUserMessage: string;
  previousLeadScore: number;
  previousStatus: string;
  previousTemperature: string | null;
  handoffOffered: boolean;
  handoffAccepted: boolean;
  handoffCompleted: boolean;
  priceAskedCount: number;
  hasBusinessIdentified: boolean;
  hasPainIdentified: boolean;
  hasWhatsappUsageIdentified: boolean;
}

// Phrases that indicate CLEAR acceptance of handoff
const ACCEPT_PHRASES = [
  'sim, pode', 'pode encaminhar', 'manda', 'manda sim',
  'pode mandar para a equipe', 'quero falar com alguém',
  'pode seguir', 'quero proposta', 'pode mandar',
  'manda pra equipe', 'encaminha', 'quero sim',
  'sim por favor', 'pode sim',
];

// Phrases that look like acceptance but are actually objections/questions
const NOT_ACCEPT_PHRASES = [
  'sim, mas', 'mas não sei', 'quero entender', 'quanto custa',
  'depende do valor', 'vou pensar', 'pode ser', 'vamos ver',
  'não sei se tenho budget', 'não sei se vale', 'preciso pensar',
  'tenho que ver', 'vou avaliar',
];

// Phrases that indicate the client wants human/proposal explicitly
const EXPLICIT_HUMAN_PHRASES = [
  'quero falar com alguém', 'quero proposta', 'quero vendedor',
  'manda pra equipe', 'quero seguir', 'quero falar com humano',
  'quero atendente', 'quero reunião', 'me passa pra alguém',
  'quero contratar', 'pode encaminhar',
];

// Simple acknowledgment phrases (post-handoff)
const SIMPLE_ACK_PHRASES = [
  'sim', 'ok', 'obrigado', 'obrigada', 'valeu', 'beleza',
  'blz', 'vlw', 'brigado', 'thanks', 'tá', 'ta',
];

@Injectable()
export class NormalizeOutputService {
  private readonly logger = new Logger(NormalizeOutputService.name);

  normalize(
    llmOutput: AgentResponse,
    context: ConversationContext,
  ): AgentResponse {
    let output = { ...llmOutput };

    this.logger.debug(
      `BEFORE: score=${output.leadScore}, status=${output.status}, handoff=${output.shouldHandoff}, stage=${output.stage}`,
    );

    // Step 0: Handle post-handoff messages
    if (context.handoffCompleted) {
      output = this.handlePostHandoff(output, context);
      this.logger.debug(`AFTER (post-handoff): status=${output.status}`);
      return output;
    }

    // Step 1: Classify user message intent
    const userIntent = this.classifyUserMessage(context);

    // Step 2: Apply handoff acceptance if clear acceptance detected
    if (userIntent === 'accept_handoff' && context.handoffOffered) {
      output = this.confirmHandoff(output);
    }
    // Step 3: Apply explicit human request
    else if (userIntent === 'explicit_human') {
      output = this.handleExplicitHumanRequest(output, context);
    }
    // Step 4: If user has objection/question, DON'T trigger handoff
    else if (userIntent === 'objection_or_question') {
      output = this.handleObjectionOrQuestion(output, context);
    }

    // Step 5: Score accumulation (never decrease)
    output = this.applyScoreAccumulation(output, context);

    // Step 6: Temperature based on score
    output = this.applyTemperatureNormalization(output);

    // Step 7: Status normalization (strict rules)
    output = this.applyStatusNormalization(output);

    // Step 8: Prevent premature handoff offer
    output = this.applyPreventPrematureHandoff(output, context);

    // Step 9: Consistency checks
    output = this.applyConsistencyChecks(output);

    // Step 10: Sanitize internal data leaks from reply
    output = this.applySanitization(output);

    // Step 11: Tone cleanup
    output = this.applyToneCleanup(output);

    this.logger.debug(
      `AFTER: score=${output.leadScore}, status=${output.status}, handoff=${output.shouldHandoff}, temp=${output.temperature}`,
    );

    return output;
  }

  /**
   * Classify what the user's message means in the context of handoff.
   */
  private classifyUserMessage(
    context: ConversationContext,
  ): 'accept_handoff' | 'explicit_human' | 'objection_or_question' | 'normal' {
    const msg = context.lastUserMessage.toLowerCase().trim();

    // Check if it's NOT an acceptance first (has qualifiers)
    const isNotAcceptance = NOT_ACCEPT_PHRASES.some((p) => msg.includes(p));
    if (isNotAcceptance) {
      return 'objection_or_question';
    }

    // Check for explicit human request
    const isExplicitHuman = EXPLICIT_HUMAN_PHRASES.some((p) => msg.includes(p));
    if (isExplicitHuman) {
      return 'explicit_human';
    }

    // Check for clear acceptance (only if handoff was offered)
    if (context.handoffOffered) {
      const isAcceptance = ACCEPT_PHRASES.some(
        (p) => msg === p || msg.startsWith(p + ',') || msg.startsWith(p + '.') || msg.startsWith(p + ' ')
      );
      // Also check simple "sim" or "pode" alone
      if (isAcceptance || msg === 'sim' || msg === 'pode' || msg === 'manda') {
        return 'accept_handoff';
      }
    }

    return 'normal';
  }

  /**
   * Handle messages after handoff is completed.
   * Only show "já foi encaminhado" for simple acks.
   * For new questions, answer and remind about the team.
   */
  private handlePostHandoff(
    output: AgentResponse,
    context: ConversationContext,
  ): AgentResponse {
    const msg = context.lastUserMessage.toLowerCase().trim();
    const isSimpleAck = SIMPLE_ACK_PHRASES.some((p) => msg === p);

    if (isSimpleAck) {
      return {
        ...output,
        reply: 'Seu atendimento já foi encaminhado para a equipe da Decodifica com o resumo do cenário.',
        status: 'chamar_humano',
        temperature: 'quente',
        shouldHandoff: true,
        stage: 'handoff_humano',
        leadScore: context.previousLeadScore,
      };
    }

    // Client is asking a new question after handoff — answer it and remind
    const replyWithReminder = output.reply.endsWith('.')
      ? `${output.reply} A equipe da Decodifica também poderá detalhar isso quando entrar em contato.`
      : `${output.reply}. A equipe da Decodifica também poderá detalhar isso quando entrar em contato.`;

    return {
      ...output,
      reply: replyWithReminder,
      status: 'chamar_humano',
      temperature: 'quente',
      shouldHandoff: true,
      stage: 'handoff_humano',
      leadScore: context.previousLeadScore,
    };
  }

  /**
   * Confirm handoff — client clearly accepted.
   */
  private confirmHandoff(output: AgentResponse): AgentResponse {
    return {
      ...output,
      reply: 'Vou encaminhar para a equipe da Decodifica com um resumo do seu cenário. Assim alguém consegue avaliar o melhor caminho e te retornar com mais precisão.',
      status: 'chamar_humano',
      temperature: 'quente',
      shouldHandoff: true,
      handoffReason: output.handoffReason || 'Cliente aceitou encaminhamento',
      stage: 'handoff_humano',
    };
  }

  /**
   * Handle explicit human request.
   */
  private handleExplicitHumanRequest(
    output: AgentResponse,
    context: ConversationContext,
  ): AgentResponse {
    if (context.hasBusinessIdentified) {
      return this.confirmHandoff(output);
    }
    // Need minimum context — ask ONE question
    return {
      ...output,
      reply: 'Consigo encaminhar. Para enviar com contexto, me diz só qual é o principal objetivo da automação?',
      shouldHandoff: true,
      handoffReason: 'Cliente solicitou humano - coletando informação mínima',
    };
  }

  /**
   * Handle objection or question — DON'T trigger handoff.
   * If LLM set shouldHandoff or chamar_humano, override it.
   */
  private handleObjectionOrQuestion(
    output: AgentResponse,
    context: ConversationContext,
  ): AgentResponse {
    // Remove any handoff that the LLM incorrectly set
    let corrected = { ...output };

    if (corrected.status === 'chamar_humano') {
      corrected.status = corrected.leadScore >= 70 ? 'quente' : 'qualificando';
    }

    // Don't show "já foi encaminhado" for questions
    const encaminhado = corrected.reply.toLowerCase().includes('já foi encaminhado');
    if (encaminhado) {
      corrected.reply = 'O valor depende do escopo, mas pelo que você descreveu seria um projeto de atendimento inicial e qualificação. A equipe pode te dar uma estimativa com base no seu volume e fluxo.';
    }

    return corrected;
  }

  /**
   * Score never decreases.
   */
  private applyScoreAccumulation(
    output: AgentResponse,
    context: ConversationContext,
  ): AgentResponse {
    if (context.previousStatus === 'perdido') return output;
    const finalScore = Math.max(context.previousLeadScore, output.leadScore);
    return { ...output, leadScore: finalScore };
  }

  /**
   * Temperature strictly based on score.
   */
  private applyTemperatureNormalization(output: AgentResponse): AgentResponse {
    let temperature = output.temperature;
    if (output.leadScore >= 70) temperature = 'quente';
    else if (output.leadScore >= 40) temperature = 'morno';
    else temperature = 'frio';
    return { ...output, temperature };
  }

  /**
   * Status normalization — strict rules.
   * score >= 70 sets status=quente, NOT chamar_humano.
   * chamar_humano ONLY when handoff is confirmed in the reply or stage is handoff_humano.
   */
  private applyStatusNormalization(output: AgentResponse): AgentResponse {
    let { status } = output;

    // Detect if reply confirms handoff
    const replyLower = output.reply.toLowerCase();
    const confirmPhrases = ['vou encaminhar', 'encaminhando para a equipe', 'encaminhar seu atendimento'];
    const isConfirmingHandoff = confirmPhrases.some((p) => replyLower.includes(p));
    const stageIsHandoff = (output.stage as string) === 'handoff_humano';

    if (isConfirmingHandoff || stageIsHandoff) {
      status = 'chamar_humano';
      return { ...output, status, shouldHandoff: true, temperature: 'quente' };
    }

    // score >= 70 => status = quente (NOT chamar_humano)
    if (output.leadScore >= 70 && status !== 'chamar_humano') {
      status = 'quente';
    }

    // If LLM set chamar_humano without confirmation, downgrade
    if (status === 'chamar_humano' && !isConfirmingHandoff && !stageIsHandoff) {
      status = output.leadScore >= 70 ? 'quente' : output.leadScore >= 40 ? 'qualificando' : 'qualificando';
    }

    return { ...output, status };
  }

  /**
   * Prevent premature handoff offer when context is insufficient.
   */
  private applyPreventPrematureHandoff(
    output: AgentResponse,
    context: ConversationContext,
  ): AgentResponse {
    const hasMinContext = context.hasBusinessIdentified && (context.hasPainIdentified || context.hasWhatsappUsageIdentified);

    const offerPhrases = ['posso encaminhar', 'quer que eu encaminhe', 'acho que já tenho contexto'];
    const isOffering = offerPhrases.some((p) => output.reply.toLowerCase().includes(p));

    if (isOffering && !hasMinContext && output.leadScore < 50) {
      return { ...output, shouldHandoff: false };
    }

    return output;
  }

  /**
   * Final consistency checks — never allow invalid state combinations.
   */
  private applyConsistencyChecks(output: AgentResponse): AgentResponse {
    let corrected = { ...output };

    // status=chamar_humano requires shouldHandoff=true
    if (corrected.status === 'chamar_humano' && !corrected.shouldHandoff) {
      corrected.status = corrected.leadScore >= 70 ? 'quente' : 'qualificando';
    }

    // temperature=quente requires score >= 70
    if (corrected.temperature === 'quente' && corrected.leadScore < 70 && corrected.status !== 'chamar_humano') {
      corrected.temperature = corrected.leadScore >= 40 ? 'morno' : 'frio';
    }

    // shouldHandoff=true with status=novo is invalid
    if (corrected.shouldHandoff && corrected.status === 'novo') {
      corrected.status = 'qualificando';
    }

    return corrected;
  }

  /**
   * Rule: Sanitize internal data leaks from reply.
   * Remove phrases that look like raw field values leaking into the response.
   */
  private applySanitization(output: AgentResponse): AgentResponse {
    let reply = output.reply;

    // Remove patterns like "Pelo que você descreveu sobre [internal_field]..."
    // where internal_field looks like a raw database value
    const leakPatterns = [
      /Pelo que você descreveu sobre\s+[a-z]{2,15}\.\.\./gi,
      /com\s+[A-Z][a-záéíóú]+\s+d[aoe]\s+[a-záéíóú]+\.\.\./g,
      /erros são raros/gi,
    ];

    for (const pattern of leakPatterns) {
      if (pattern.test(reply)) {
        // Replace with a generic version
        reply = reply.replace(pattern, '');
      }
    }

    // Replace "erros são raros" with proper phrasing
    reply = reply.replace(
      /erros são raros/gi,
      'a IA reduz erros quando tem regras, base de conhecimento e limites claros',
    );

    // Remove double spaces and trim
    reply = reply.replace(/\s{2,}/g, ' ').trim();

    // Fix exclamation at start (Olá! -> Olá.)
    if (reply.startsWith('Olá!')) {
      reply = 'Olá.' + reply.slice(4);
    }

    return { ...output, reply };
  }

  /**
   * Clean filler words from reply start.
   */
  private applyToneCleanup(output: AgentResponse): AgentResponse {
    const fillerStarts = [
      'entendo.', 'entendo,', 'perfeito.', 'perfeito,',
      'ótimo.', 'ótimo,', 'compreendo.', 'compreendo,',
      'claro.', 'claro,', 'show.', 'show,',
      'ok.', 'ok,', 'certo.', 'certo,', 'legal.', 'legal,',
    ];

    let reply = output.reply;
    const replyLower = reply.toLowerCase().trimStart();

    for (const filler of fillerStarts) {
      if (replyLower.startsWith(filler)) {
        reply = reply.slice(filler.length).trimStart();
        if (reply.length > 0) {
          reply = reply.charAt(0).toUpperCase() + reply.slice(1);
        }
        break;
      }
    }

    reply = reply.replace(/!/g, '.');

    return { ...output, reply };
  }
}
