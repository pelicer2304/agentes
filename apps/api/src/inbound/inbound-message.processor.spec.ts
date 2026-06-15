import { Test, TestingModule } from '@nestjs/testing';
import { InboundMessageProcessor } from './inbound-message.processor';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationService } from '../conversation/conversation.service';
import { ChannelAdapterRegistry } from '../channel/channel-adapter.registry';
import { AppConfigService } from '../config/config.service';
import { RateLimiterService } from '../common/rate-limiter';
import { EvolutionService } from '../modules/channels/evolution/evolution.service';
import { TranscriptionService } from '../transcription/transcription.service';
import { FollowUpService } from '../followup/followup.service';

/**
 * Focused unit tests for {@link InboundMessageProcessor.applyHandoffSideEffects}
 * (task 8.1, Req 10.3, 11.1, 11.2, 11.3) and the internal admin summary delivery
 * + Dashboard handoff alert (task 8.2, Req 11.4, 11.5, 11.6, 11.7). The method
 * is private; we exercise it directly to keep the test scoped to the handoff
 * transition without standing up the whole webhook pipeline.
 */
describe('InboundMessageProcessor - applyHandoffSideEffects', () => {
  let processor: InboundMessageProcessor;

  const mockPrisma = {
    lead: { update: jest.fn(), findUnique: jest.fn() },
    conversation: { update: jest.fn() },
    agentAnalysis: { findFirst: jest.fn() },
    botEvent: { create: jest.fn() },
  };

  const mockConversationService = { handleInboundMessage: jest.fn() };
  const mockChannelRegistry = { get: jest.fn() };
  const mockEvolution = { sendTextMessage: jest.fn() };

  // Mutable config so individual tests can flip BOT_PAUSE_ON_HANDOFF and the
  // configured admin WhatsApp numbers.
  const mockConfig: { botPauseOnHandoff: boolean; adminWhatsappNumbers: string[] } = {
    botPauseOnHandoff: true,
    adminWhatsappNumbers: [],
  };

  const baseContext = () => ({
    leadId: 'lead-1',
    conversation: {
      id: 'conv-1',
      botPaused: false,
      handoffCompleted: false,
    },
  });

  const invoke = (context: unknown, qualification: unknown): Promise<void> =>
    (processor as unknown as {
      applyHandoffSideEffects: (c: unknown, q: unknown) => Promise<void>;
    }).applyHandoffSideEffects(context, qualification);

  beforeEach(async () => {
    mockConfig.botPauseOnHandoff = true;
    mockConfig.adminWhatsappNumbers = [];
    // Default: a complete lead so the summary builder produces content.
    mockPrisma.lead.findUnique.mockResolvedValue({
      phone: '5511999999999',
      segment: 'varejo',
      whatsappUsage: 'atendimento',
      mainPain: 'demora no atendimento',
      secondaryPains: ['perda de leads'],
      estimatedVolume: '500/mês',
      summary: 'Lead quente de varejo',
      nextStep: 'agendar call',
    });
    mockPrisma.agentAnalysis.findFirst.mockResolvedValue(null);
    mockEvolution.sendTextMessage.mockResolvedValue({
      ok: true,
      data: { externalMessageId: 'admin-msg-1' },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InboundMessageProcessor,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConversationService, useValue: mockConversationService },
        { provide: ChannelAdapterRegistry, useValue: mockChannelRegistry },
        { provide: AppConfigService, useValue: mockConfig },
        { provide: RateLimiterService, useValue: new RateLimiterService() },
        { provide: EvolutionService, useValue: mockEvolution },
        { provide: TranscriptionService, useValue: { isEnabled: false, transcribe: jest.fn() } },
        {
          provide: FollowUpService,
          useValue: {
            ensureScheduled: jest.fn().mockResolvedValue(undefined),
            onInboundReceived: jest.fn().mockResolvedValue(undefined),
            onLeadLost: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    processor = module.get(InboundMessageProcessor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('escalates lead and completes handoff when shouldHandoff is true (Req 11.1)', async () => {
    const context = baseContext();

    await invoke(context, { shouldHandoff: true, status: 'qualificando' });

    expect(mockPrisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: { status: 'chamar_humano', temperature: 'quente' },
    });
    expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: expect.objectContaining({
        handoffAccepted: true,
        handoffCompleted: true,
      }),
    });
  });

  it('treats status=chamar_humano as acceptance even without shouldHandoff (Req 11.1)', async () => {
    const context = baseContext();

    await invoke(context, { shouldHandoff: false, status: 'chamar_humano' });

    expect(mockPrisma.lead.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.conversation.update).toHaveBeenCalledTimes(1);
  });

  it('NÃO pausa o bot no handoff — segue ativo até um humano assumir', async () => {
    // O handoff não silencia mais o bot: o cliente pode ter novas dúvidas e o
    // agente continua respondendo até o /assumir do inbox setar botPaused.
    mockConfig.botPauseOnHandoff = true;
    const context = baseContext();

    await invoke(context, { shouldHandoff: true, status: 'chamar_humano' });

    const updateArg = mockPrisma.conversation.update.mock.calls[0][0];
    expect(updateArg.data).not.toHaveProperty('botPaused');
    expect(context.conversation.botPaused).toBe(false);
  });

  it('does not pause the bot when BOT_PAUSE_ON_HANDOFF is false (Req 11.2)', async () => {
    mockConfig.botPauseOnHandoff = false;
    const context = baseContext();

    await invoke(context, { shouldHandoff: true, status: 'chamar_humano' });

    const updateArg = mockPrisma.conversation.update.mock.calls[0][0];
    expect(updateArg.data).not.toHaveProperty('botPaused');
    expect(context.conversation.botPaused).toBe(false);
  });

  it('emits handoff_requested and handoff_completed Bot_Events (Req 11.3)', async () => {
    const context = baseContext();

    await invoke(context, { shouldHandoff: true, status: 'chamar_humano' });

    const eventTypes = mockPrisma.botEvent.create.mock.calls.map(
      (call) => call[0].data.type,
    );
    expect(eventTypes).toEqual(['handoff_requested', 'handoff_completed']);
  });

  it('is a no-op when the engine does not report handoff acceptance', async () => {
    const context = baseContext();

    await invoke(context, { shouldHandoff: false, status: 'qualificando' });

    expect(mockPrisma.lead.update).not.toHaveBeenCalled();
    expect(mockPrisma.conversation.update).not.toHaveBeenCalled();
    expect(mockPrisma.botEvent.create).not.toHaveBeenCalled();
  });

  it('does not re-emit when the conversation is already handoffCompleted', async () => {
    const context = baseContext();
    context.conversation.handoffCompleted = true;

    await invoke(context, { shouldHandoff: true, status: 'chamar_humano' });

    expect(mockPrisma.lead.update).not.toHaveBeenCalled();
    expect(mockPrisma.conversation.update).not.toHaveBeenCalled();
    expect(mockPrisma.botEvent.create).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Task 8.2 — internal admin summary delivery + Dashboard alert
  // -------------------------------------------------------------------------

  /** Find the recorded handoff_completed Bot_Event payload, if any. */
  const handoffCompletedPayload = (): Record<string, unknown> | undefined =>
    mockPrisma.botEvent.create.mock.calls
      .map((call) => call[0].data)
      .find((data) => data.type === 'handoff_completed')?.payload;

  it('sends exactly one summary per configured admin number (Req 11.5)', async () => {
    mockConfig.adminWhatsappNumbers = ['551133334444', '551155556666'];
    const context = baseContext();

    await invoke(context, { shouldHandoff: true, status: 'chamar_humano' });

    expect(mockEvolution.sendTextMessage).toHaveBeenCalledTimes(2);
    const recipients = mockEvolution.sendTextMessage.mock.calls.map((c) => c[0]);
    expect(recipients).toEqual(['551133334444', '551155556666']);
  });

  it('includes all required summary fields in the admin message (Req 11.5)', async () => {
    mockConfig.adminWhatsappNumbers = ['551133334444'];
    const context = baseContext();

    await invoke(context, { shouldHandoff: true, status: 'chamar_humano' });

    const summaryText: string = mockEvolution.sendTextMessage.mock.calls[0][1];
    expect(summaryText).toContain('Telefone: 5511999999999');
    expect(summaryText).toContain('Segmento: varejo');
    expect(summaryText).toContain('Uso do WhatsApp: atendimento');
    expect(summaryText).toContain('Dores: demora no atendimento; perda de leads');
    expect(summaryText).toContain('Volume: 500/mês');
    expect(summaryText).toContain('Resumo: Lead quente de varejo');
    expect(summaryText).toContain('Próximo passo: agendar call');
  });

  it('falls back to the latest analysis for resumo/próximo passo (Req 11.5)', async () => {
    mockConfig.adminWhatsappNumbers = ['551133334444'];
    mockPrisma.lead.findUnique.mockResolvedValue({
      phone: '5511999999999',
      segment: null,
      whatsappUsage: null,
      mainPain: null,
      secondaryPains: null,
      estimatedVolume: null,
      summary: null,
      nextStep: null,
    });
    mockPrisma.agentAnalysis.findFirst.mockResolvedValue({
      commercialSummary: 'Resumo da análise',
      nextBestQuestion: 'Qual o orçamento?',
    });
    const context = baseContext();

    await invoke(context, { shouldHandoff: true, status: 'chamar_humano' });

    const summaryText: string = mockEvolution.sendTextMessage.mock.calls[0][1];
    expect(summaryText).toContain('Resumo: Resumo da análise');
    expect(summaryText).toContain('Próximo passo: Qual o orçamento?');
  });

  it('never sends a summary when no admin numbers are configured (Req 11.5)', async () => {
    mockConfig.adminWhatsappNumbers = [];
    const context = baseContext();

    await invoke(context, { shouldHandoff: true, status: 'chamar_humano' });

    expect(mockEvolution.sendTextMessage).not.toHaveBeenCalled();
    expect(handoffCompletedPayload()).toMatchObject({ summarySentTo: 0 });
  });

  it('suppresses all delivery when the summary cannot be generated (Req 11.6)', async () => {
    mockConfig.adminWhatsappNumbers = ['551133334444'];
    // No lead and no analysis → essential data missing → nothing is sent.
    mockPrisma.lead.findUnique.mockResolvedValue(null);
    mockPrisma.agentAnalysis.findFirst.mockResolvedValue(null);
    const context = baseContext();

    await invoke(context, { shouldHandoff: true, status: 'chamar_humano' });

    expect(mockEvolution.sendTextMessage).not.toHaveBeenCalled();
    expect(handoffCompletedPayload()).toMatchObject({ summarySentTo: 0 });
  });

  it('suppresses all delivery when loading the lead throws (Req 11.6)', async () => {
    mockConfig.adminWhatsappNumbers = ['551133334444'];
    mockPrisma.lead.findUnique.mockRejectedValue(new Error('db down'));
    const context = baseContext();

    // Must not throw — a summary failure never breaks the inbound flow.
    await expect(
      invoke(context, { shouldHandoff: true, status: 'chamar_humano' }),
    ).resolves.toBeUndefined();
    expect(mockEvolution.sendTextMessage).not.toHaveBeenCalled();
  });

  it('records evolution_error and tolerates a per-admin send failure', async () => {
    mockConfig.adminWhatsappNumbers = ['551133334444', '551155556666'];
    mockEvolution.sendTextMessage
      .mockResolvedValueOnce({ ok: false, error: 'send failed' })
      .mockResolvedValueOnce({ ok: true, data: { externalMessageId: 'm2' } });
    const context = baseContext();

    await invoke(context, { shouldHandoff: true, status: 'chamar_humano' });

    const eventTypes = mockPrisma.botEvent.create.mock.calls.map(
      (call) => call[0].data.type,
    );
    expect(eventTypes).toContain('evolution_error');
    // Only the successful send counts toward summarySentTo.
    expect(handoffCompletedPayload()).toMatchObject({ summarySentTo: 1 });
  });

  it('surfaces the Dashboard handoff alert on the handoff_completed event (Req 11.4)', async () => {
    mockConfig.adminWhatsappNumbers = ['551133334444'];
    const context = baseContext();

    await invoke(context, { shouldHandoff: true, status: 'chamar_humano' });

    expect(handoffCompletedPayload()).toMatchObject({
      dashboardAlert: true,
      summarySentTo: 1,
    });
  });
});

/**
 * Tests for {@link InboundMessageProcessor.handleControlCommand} — typed
 * control commands (/clear, /reset, /help) received over WhatsApp. These run
 * regardless of gating (they are invoked before {@link applyGating} in
 * `process`), so a paused conversation can still be reset from WhatsApp.
 */
describe('InboundMessageProcessor - handleControlCommand', () => {
  let processor: InboundMessageProcessor;

  const sendMessage = jest.fn();
  const mockPrisma = {
    webhookLog: { update: jest.fn().mockResolvedValue({}) },
    message: { create: jest.fn().mockResolvedValue({ id: 'm-out' }) },
    botEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const mockConversationService = {
    clearConversation: jest.fn(),
    handleInboundMessage: jest.fn(),
  };
  const mockChannelRegistry = { get: jest.fn(() => ({ sendMessage })) };
  const mockConfig = { botPauseOnHandoff: false, adminWhatsappNumbers: [] as string[] };
  const mockEvolution = { sendTextMessage: jest.fn() };

  const inbound = (content: string) => ({
    channel: 'whatsapp' as const,
    instance: 'inst-1',
    externalMessageId: 'EXT1',
    from: '5511999999999',
    to: null,
    contactName: 'Pelicer',
    content,
    messageType: 'text' as const,
    timestamp: new Date(0),
    rawPayload: {},
  });

  const context = () => ({
    leadId: 'lead-1',
    conversation: { id: 'conv-1', botPaused: true, handoffCompleted: false },
  });

  const invoke = (
    webhookLogId: string,
    msg: unknown,
    ctx: unknown,
    command: unknown,
  ): Promise<{ httpStatus: number; action: string }> =>
    (processor as unknown as {
      handleControlCommand: (
        w: string,
        m: unknown,
        c: unknown,
        cmd: unknown,
      ) => Promise<{ httpStatus: number; action: string }>;
    }).handleControlCommand(webhookLogId, msg, ctx, command);

  beforeEach(async () => {
    sendMessage.mockResolvedValue(undefined);
    mockConversationService.clearConversation.mockResolvedValue({
      messages: [
        { content: 'Olá. Sou o DecodificaIA, atendente inteligente da Decodifica.' },
      ],
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InboundMessageProcessor,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConversationService, useValue: mockConversationService },
        { provide: ChannelAdapterRegistry, useValue: mockChannelRegistry },
        { provide: AppConfigService, useValue: mockConfig },
        { provide: RateLimiterService, useValue: new RateLimiterService() },
        { provide: EvolutionService, useValue: mockEvolution },
        { provide: TranscriptionService, useValue: { isEnabled: false, transcribe: jest.fn() } },
        {
          provide: FollowUpService,
          useValue: {
            ensureScheduled: jest.fn().mockResolvedValue(undefined),
            onInboundReceived: jest.fn().mockResolvedValue(undefined),
            onLeadLost: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    processor = module.get(InboundMessageProcessor);
  });

  afterEach(() => jest.clearAllMocks());

  it('/clear wipes the conversation and sends the fresh greeting (bypasses gating, no engine call)', async () => {
    const ctx = context();
    const result = await invoke('whl-1', inbound('/clear'), ctx, {
      isCommand: true,
      name: 'clear',
      confirmationReply: 'Pronto, limpei o histórico.',
      action: 'clear',
    });

    expect(mockConversationService.clearConversation).toHaveBeenCalledWith('conv-1');
    // The frozen engine is never invoked for a command.
    expect(mockConversationService.handleInboundMessage).not.toHaveBeenCalled();
    // The fresh greeting (already persisted by clearConversation) is delivered.
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '5511999999999',
        content: 'Olá. Sou o DecodificaIA, atendente inteligente da Decodifica.',
        conversationId: 'conv-1',
      }),
    );
    expect(mockPrisma.webhookLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'whl-1' },
        data: expect.objectContaining({ eventType: 'command:clear' }),
      }),
    );
    expect(result).toEqual({ httpStatus: 200, action: 'replied' });
  });

  it('/reset also maps to clearConversation (same WhatsApp conversation reused)', async () => {
    const ctx = context();
    await invoke('whl-2', inbound('/reset'), ctx, {
      isCommand: true,
      name: 'reset',
      confirmationReply: 'Pronto, reiniciei nossa conversa.',
      action: 'reset',
    });

    expect(mockConversationService.clearConversation).toHaveBeenCalledWith('conv-1');
    expect(mockPrisma.webhookLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'command:reset' }),
      }),
    );
  });

  it('/help lists commands without resetting any state', async () => {
    const ctx = context();
    await invoke('whl-3', inbound('/help'), ctx, {
      isCommand: true,
      name: 'help',
      confirmationReply: 'Esses são os comandos que eu reconheço: /clear /reset /help',
      action: 'none',
    });

    expect(mockConversationService.clearConversation).not.toHaveBeenCalled();
    // Inbound saved + outbound persisted (two message.create calls).
    expect(mockPrisma.message.create).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('comandos'),
      }),
    );
  });

  it('tolerates a send failure on /clear and still returns 200', async () => {
    sendMessage.mockRejectedValueOnce(new Error('evolution down'));
    const ctx = context();

    const result = await invoke('whl-4', inbound('/clear'), ctx, {
      isCommand: true,
      name: 'clear',
      confirmationReply: 'Pronto, limpei o histórico.',
      action: 'clear',
    });

    // State change still applied; webhook still 200.
    expect(mockConversationService.clearConversation).toHaveBeenCalledWith('conv-1');
    expect(result).toEqual({ httpStatus: 200, action: 'replied' });
    const eventTypes = mockPrisma.botEvent.create.mock.calls.map(
      (call) => call[0].data.type,
    );
    expect(eventTypes).toContain('evolution_error');
  });
});

/**
 * Tests for the message-debounce path (humanized replies). Successive inbound
 * messages within the quiet window are concatenated into a SINGLE engine turn
 * and produce ONE reply. We drive the private enqueue/flush methods directly so
 * the test stays scoped to the buffering behavior.
 */
describe('InboundMessageProcessor - message debounce', () => {
  let processor: InboundMessageProcessor;
  let followUpService: {
    ensureScheduled: jest.Mock;
    onInboundReceived: jest.Mock;
    onLeadLost: jest.Mock;
  };

  const sendMessage = jest.fn();
  const mockPrisma = {
    webhookLog: { update: jest.fn().mockResolvedValue({}) },
    message: {
      create: jest.fn().mockResolvedValue({ id: 'm-out' }),
      update: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue({ id: 'engine-inbound' }),
    },
    botEvent: { create: jest.fn().mockResolvedValue({}) },
    conversation: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ botPaused: false, handoffCompleted: false }),
      update: jest.fn().mockResolvedValue({}),
    },
    lead: { update: jest.fn().mockResolvedValue({}) },
  };
  const mockConversationService = {
    clearConversation: jest.fn(),
    handleInboundMessage: jest.fn(),
  };
  const mockChannelRegistry = { get: jest.fn(() => ({ sendMessage })) };
  const mockConfig = {
    botPauseOnHandoff: false,
    botAutoReplyEnabled: true,
    adminWhatsappNumbers: [] as string[],
    messageDebounceMs: 10000,
    // Disable the typing pause so flush resolves without timer juggling.
    typingIndicatorEnabled: false,
    typingMsPerChar: 0,
    typingMinMs: 0,
    typingMaxMs: 0,
  };
  const mockEvolution = {
    sendTextMessage: jest.fn(),
    sendTypingOrPresence: jest.fn().mockResolvedValue({ ok: true }),
  };

  const inbound = (content: string, externalMessageId: string) => ({
    channel: 'whatsapp' as const,
    instance: 'inst-1',
    externalMessageId,
    from: '5511999999999',
    to: null,
    contactName: 'Pelicer',
    content,
    messageType: 'text' as const,
    timestamp: new Date(0),
    rawPayload: {},
  });

  const context = () => ({
    leadId: 'lead-1',
    conversation: { id: 'conv-1', botPaused: false, handoffCompleted: false },
  });

  const enqueue = (
    msg: ReturnType<typeof inbound>,
    content: string,
  ): Promise<{ httpStatus: number; action: string }> =>
    (processor as unknown as {
      enqueueDebounced: (
        w: string,
        m: unknown,
        c: unknown,
        content: string,
      ) => Promise<{ httpStatus: number; action: string }>;
    }).enqueueDebounced('whl-1', msg, context(), content);

  const flush = (conversationId: string): Promise<void> =>
    (processor as unknown as {
      flushDebouncedTurn: (id: string) => Promise<void>;
    }).flushDebouncedTurn(conversationId);

  beforeEach(async () => {
    jest.useFakeTimers();
    sendMessage.mockResolvedValue(undefined);
    mockConversationService.handleInboundMessage.mockResolvedValue({
      message: { id: 'out-1', content: 'Resposta única.' },
      qualification: { shouldHandoff: false, status: 'qualificando' },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InboundMessageProcessor,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConversationService, useValue: mockConversationService },
        { provide: ChannelAdapterRegistry, useValue: mockChannelRegistry },
        { provide: AppConfigService, useValue: mockConfig },
        { provide: RateLimiterService, useValue: new RateLimiterService() },
        { provide: EvolutionService, useValue: mockEvolution },
        { provide: TranscriptionService, useValue: { isEnabled: false, transcribe: jest.fn() } },
        {
          provide: FollowUpService,
          useValue: {
            ensureScheduled: jest.fn().mockResolvedValue(undefined),
            onInboundReceived: jest.fn().mockResolvedValue(undefined),
            onLeadLost: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    processor = module.get(InboundMessageProcessor);
    followUpService = module.get(FollowUpService) as unknown as typeof followUpService;
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('concatenates rapid messages into ONE engine turn and ONE reply', async () => {
    await enqueue(inbound('oi', 'EXT1'), 'oi');
    await enqueue(inbound('tudo bem?', 'EXT2'), 'tudo bem?');
    await enqueue(inbound('queria saber dos valores', 'EXT3'), 'queria saber dos valores');

    // Engine not invoked yet — still within the quiet window.
    expect(mockConversationService.handleInboundMessage).not.toHaveBeenCalled();

    await flush('conv-1');

    expect(mockConversationService.handleInboundMessage).toHaveBeenCalledTimes(1);
    const [, combined] =
      mockConversationService.handleInboundMessage.mock.calls[0];
    expect(combined).toBe('oi\ntudo bem?\nqueria saber dos valores');

    // Exactly one reply delivered.
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ to: '5511999999999', conversationId: 'conv-1' }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Task 12.4 — follow-up hook wiring on a REAL bot turn (lead-followup
  // R3.1, R1.1). Flushing a debounced turn persists a real inbound from the
  // lead (emits `message_inbound_saved`) AND a real outbound from the bot
  // (after `persistOutbound`). Both observable hooks must fire with the
  // conversationId: `onInboundReceived` (cancel/restart) and `ensureScheduled`
  // (schedule level 1 from the last outbound).
  // ─────────────────────────────────────────────────────────────────────────
  it('fires onInboundReceived and ensureScheduled with the conversationId on a real flushed turn (R3.1, R1.1)', async () => {
    await enqueue(inbound('quero saber dos valores', 'EXT1'), 'quero saber dos valores');

    // Nothing fired yet — still buffering inside the quiet window.
    expect(followUpService.onInboundReceived).not.toHaveBeenCalled();
    expect(followUpService.ensureScheduled).not.toHaveBeenCalled();

    await flush('conv-1');

    // Inbound hook: the real inbound from the lead was saved → cancel/restart.
    expect(followUpService.onInboundReceived).toHaveBeenCalledWith(
      'conv-1',
      expect.any(Date),
    );
    // Outbound hook: the bot answered → (re)schedule the follow-up cycle.
    expect(followUpService.ensureScheduled).toHaveBeenCalledWith('conv-1');
  });

  it('does NOT call ensureScheduled when the turn is gated (no real bot outbound)', async () => {
    // The conversation became paused mid-window → the combined inbound is still
    // persisted, but the bot sends NO reply, so the outbound hook
    // (ensureScheduled) must not fire.
    mockPrisma.conversation.findUnique.mockResolvedValueOnce({
      botPaused: true,
      handoffCompleted: false,
    });

    await enqueue(inbound('oi', 'EXT1'), 'oi');
    await flush('conv-1');

    expect(sendMessage).not.toHaveBeenCalled();
    expect(followUpService.ensureScheduled).not.toHaveBeenCalled();
  });

  it('sends a "digitando" presence when a message is buffered', async () => {
    mockConfig.typingIndicatorEnabled = true;
    await enqueue(inbound('oi', 'EXT1'), 'oi');
    expect(mockEvolution.sendTypingOrPresence).toHaveBeenCalledWith(
      '5511999999999',
      expect.any(Number),
    );
    mockConfig.typingIndicatorEnabled = false;
  });

  it('deduplicates a re-delivered message (same externalMessageId) within the window', async () => {
    await enqueue(inbound('oi', 'EXT1'), 'oi');
    await enqueue(inbound('oi', 'EXT1'), 'oi'); // duplicate webhook

    await flush('conv-1');

    const [, combined] =
      mockConversationService.handleInboundMessage.mock.calls[0];
    expect(combined).toBe('oi');
  });

  it('drops the turn without replying when the conversation got paused mid-window', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValueOnce({
      botPaused: true,
      handoffCompleted: false,
    });

    await enqueue(inbound('oi', 'EXT1'), 'oi');
    await flush('conv-1');

    expect(mockConversationService.handleInboundMessage).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    // The combined inbound is still persisted so history is not lost.
    expect(mockPrisma.message.create).toHaveBeenCalled();
  });
});

/**
 * Task 12.4 — follow-up INBOUND hook wiring (lead-followup R3.1).
 *
 * `message_inbound_saved` is the single canonical signal that a REAL inbound
 * message from the lead was just persisted (direct, debounce, unsupported
 * media and gating paths all emit it). It is the ONLY Bot_Event that triggers
 * `FollowUpService.onInboundReceived` (cancel pending levels / restart cycle).
 * System events and bot outbound events MUST NOT trigger it. These tests pin
 * that wiring by driving the private `recordBotEvent` directly, so the
 * verification stays scoped to the hook dispatch decision.
 */
describe('InboundMessageProcessor - follow-up inbound hook wiring', () => {
  let processor: InboundMessageProcessor;
  let followUpService: {
    ensureScheduled: jest.Mock;
    onInboundReceived: jest.Mock;
    onLeadLost: jest.Mock;
  };

  const mockPrisma = {
    botEvent: { create: jest.fn().mockResolvedValue({}) },
  };

  const recordBotEvent = (
    type: string,
    args: { conversationId: string | null; leadId: string | null; payload: Record<string, unknown> },
  ): Promise<void> =>
    (processor as unknown as {
      recordBotEvent: (t: string, a: unknown) => Promise<void>;
    }).recordBotEvent(type, args);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InboundMessageProcessor,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConversationService, useValue: { handleInboundMessage: jest.fn() } },
        { provide: ChannelAdapterRegistry, useValue: { get: jest.fn() } },
        { provide: AppConfigService, useValue: { botPauseOnHandoff: false, adminWhatsappNumbers: [] } },
        { provide: RateLimiterService, useValue: new RateLimiterService() },
        { provide: EvolutionService, useValue: { sendTextMessage: jest.fn() } },
        { provide: TranscriptionService, useValue: { isEnabled: false, transcribe: jest.fn() } },
        {
          provide: FollowUpService,
          useValue: {
            ensureScheduled: jest.fn().mockResolvedValue(undefined),
            onInboundReceived: jest.fn().mockResolvedValue(undefined),
            onLeadLost: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    processor = module.get(InboundMessageProcessor);
    followUpService = module.get(FollowUpService) as unknown as typeof followUpService;
  });

  afterEach(() => jest.clearAllMocks());

  it('calls onInboundReceived with the conversationId when a real inbound is saved (R3.1)', async () => {
    await recordBotEvent('message_inbound_saved', {
      conversationId: 'conv-42',
      leadId: 'lead-42',
      payload: { externalMessageId: 'EXT1' },
    });

    expect(followUpService.onInboundReceived).toHaveBeenCalledTimes(1);
    expect(followUpService.onInboundReceived).toHaveBeenCalledWith(
      'conv-42',
      expect.any(Date),
    );
    // The inbound hook never schedules — that is the outbound hook's job.
    expect(followUpService.ensureScheduled).not.toHaveBeenCalled();
  });

  it('does NOT call onInboundReceived for non-inbound Bot_Events (bot outbound / system)', async () => {
    await recordBotEvent('message_outbound_sent', {
      conversationId: 'conv-42',
      leadId: 'lead-42',
      payload: { phone: '5511999999999' },
    });
    await recordBotEvent('webhook_received', {
      conversationId: null,
      leadId: null,
      payload: { received: true },
    });
    await recordBotEvent('evolution_error', {
      conversationId: 'conv-42',
      leadId: 'lead-42',
      payload: { stage: 'send_reply' },
    });
    await recordBotEvent('handoff_completed', {
      conversationId: 'conv-42',
      leadId: 'lead-42',
      payload: {},
    });

    expect(followUpService.onInboundReceived).not.toHaveBeenCalled();
  });

  it('does NOT call onInboundReceived when message_inbound_saved lacks a conversationId', async () => {
    await recordBotEvent('message_inbound_saved', {
      conversationId: null,
      leadId: null,
      payload: {},
    });

    expect(followUpService.onInboundReceived).not.toHaveBeenCalled();
  });
});
