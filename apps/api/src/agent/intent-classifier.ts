/**
 * Deterministic intent classifier.
 * Only returns high-confidence intents that can be resolved without LLM.
 * Everything else returns 'needs_llm'.
 */

export type DeterministicIntent =
  | 'handoff_completed_ack'    // client says ok/obrigado after handoff done
  | 'handoff_accept'           // client clearly accepts forwarding
  | 'desistance'              // client gives up
  | 'greeting_no_context'     // simple greeting with no lead data
  | 'greeting_with_context'   // simple greeting AFTER conversation started
  | 'price_question'          // client asks about price/value
  | 'frustration'            // client is irritated / wants to skip questions
  | 'needs_llm';             // anything else → send to LLM

export interface ClassificationResult {
  intent: DeterministicIntent;
  confidence: 'high' | 'low';
}

// Only these can be resolved locally
const HANDOFF_ACCEPT_EXACT = [
  'sim, pode', 'pode encaminhar', 'pode encaminhar sim',
  'pode mandar', 'tá bom, manda', 'ta bom, manda',
  'ok, pode', 'ok, pode encaminhar', 'quero proposta',
  'quero falar com alguém', 'quero falar com alguem',
  'manda pra equipe', 'manda para equipe', 'pode seguir',
  'quero sim', 'sim por favor', 'pode sim', 'manda sim',
  'encaminha', 'sim, pode encaminhar', 'pode ser, vamos ver',
  'vamos ver', 'pode ser', 'sim, quero', 'sim quero',
  'quero uma proposta', 'sim, quero uma proposta',
  'quero orçamento', 'quero orcamento', 'quero contratar',
  'quero que alguém me ligue', 'quero uma call', 'quero reunião',
  'pode me chamar', 'chama alguém', 'quero seguir',
];

const HANDOFF_ACCEPT_SHORT = ['sim', 'pode', 'manda'];

const DESISTANCE_PHRASES = [
  'deixa pra lá', 'deixa pra la', 'esquece', 'não quero mais',
  'não preciso', 'nao preciso', 'vou procurar outro',
  'não tenho interesse', 'nao tenho interesse',
];

const SIMPLE_ACK = ['ok', 'obrigado', 'obrigada', 'valeu', 'beleza', 'blz', 'vlw', 'brigado'];

const GREETINGS = ['oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'hey', 'eae', 'e aí'];

// Phrases that LOOK like acceptance but are NOT
const NOT_ACCEPT_QUALIFIERS = [
  'mas', 'porém', 'porem', 'não sei', 'nao sei', 'depende',
  'budget', 'orçamento',
  'entender melhor', 'pensar',
];

// Price-related keywords (HIGH confidence only when message is short/focused)
const PRICE_KEYWORDS = ['preço', 'preco', 'valor', 'custa', 'custo', 'quanto custa'];

// Frustration phrases (HIGH confidence)
const FRUSTRATION_PHRASES = [
  'já falei', 'ja falei', 'para de perguntar', 'só quero preço',
  'so quero preco', 'não tenho tempo', 'nao tenho tempo',
  'só quero o valor', 'so quero o valor', 'já contei tudo',
  'ja contei tudo', 'para de enrolar', 'só me passa o preço',
  'so me passa o preco',
];

export function classifyIntent(
  message: string,
  context: {
    hasSegment: boolean;
    handoffOffered: boolean;
    handoffCompleted: boolean;
  },
): ClassificationResult {
  const msg = message.toLowerCase().trim();

  // 1. Handoff already completed — simple ack or repeated acceptance
  if (context.handoffCompleted) {
    const isAck = SIMPLE_ACK.some((p) => msg === p) || msg === 'sim';
    const isRepeatedAccept = HANDOFF_ACCEPT_EXACT.some((p) => msg === p || msg.startsWith(p + ','))
      || HANDOFF_ACCEPT_SHORT.some((p) => msg === p);
    if (isAck || isRepeatedAccept) {
      return { intent: 'handoff_completed_ack', confidence: 'high' };
    }
    // Any other message after handoff → let LLM handle (might be a new question)
    return { intent: 'needs_llm', confidence: 'low' };
  }

  // 2. Check for NOT_ACCEPT qualifiers first (prevents false handoff_accept)
  const hasQualifier = NOT_ACCEPT_QUALIFIERS.some((q) => msg.includes(q));

  // 3. Handoff acceptance (only if handoff was offered AND no qualifier)
  if (context.handoffOffered && !hasQualifier) {
    const isExactAccept = HANDOFF_ACCEPT_EXACT.some((p) => msg === p || msg.startsWith(p + ','));
    const isShortAccept = HANDOFF_ACCEPT_SHORT.some((p) => msg === p);
    if (isExactAccept || isShortAccept) {
      return { intent: 'handoff_accept', confidence: 'high' };
    }
  }

  // 4. Explicit handoff request with context (even without handoffOffered)
  if (!hasQualifier && context.hasSegment) {
    const explicitHandoff = [
      'quero proposta', 'quero falar com alguém', 'quero falar com alguem',
      'manda pra equipe', 'manda para equipe', 'pode encaminhar',
      'pode encaminhar sim', 'quero falar com a equipe',
    ];
    if (explicitHandoff.some((p) => msg.includes(p))) {
      return { intent: 'handoff_accept', confidence: 'high' };
    }
  }

  // 5. Desistance
  const isDesistance = DESISTANCE_PHRASES.some((p) => msg.includes(p));
  if (isDesistance) {
    return { intent: 'desistance', confidence: 'high' };
  }

  // 6. Frustration detection (HIGH confidence only for clear frustration phrases)
  // Must check BEFORE price_question since some frustration phrases contain price words
  const isFrustration = FRUSTRATION_PHRASES.some((p) => msg.includes(p));
  if (isFrustration) {
    return { intent: 'frustration', confidence: 'high' };
  }

  // 7. Price question detection (HIGH confidence only for VERY explicit price phrases)
  // Only trigger for exact/near-exact price phrases to avoid false positives.
  // Messages like "Quanto custa?" or "depende do valor" are too ambiguous — send to LLM.
  // We only handle locally when the phrasing is unmistakably about price AND has no qualifier.
  if (context.hasSegment && !hasQualifier) {
    const EXPLICIT_PRICE_PHRASES = [
      'qual o preço', 'qual o preco', 'qual é o preço', 'qual e o preco',
      'me passa o valor', 'me passa o preço', 'me passa o preco',
      'quanto fica', 'qual valor', 'me diz o preço', 'me diz o preco',
      'quanto é', 'quanto e',
    ];
    const isExplicitPrice = EXPLICIT_PRICE_PHRASES.some((p) => msg.includes(p));
    if (isExplicitPrice) {
      return { intent: 'price_question', confidence: 'high' };
    }
  }

  // 8. Simple greeting with no context
  if (!context.hasSegment) {
    const isGreeting = GREETINGS.some((p) => msg === p || msg === p + '!');
    if (isGreeting) {
      return { intent: 'greeting_no_context', confidence: 'high' };
    }
  }

  // 8b. Simple greeting WITH context (mid-conversation "Oi")
  if (context.hasSegment) {
    const isGreeting = GREETINGS.some((p) => msg === p || msg === p + '!');
    if (isGreeting) {
      return { intent: 'greeting_with_context', confidence: 'high' };
    }
  }

  // Everything else → LLM
  return { intent: 'needs_llm', confidence: 'low' };
}
