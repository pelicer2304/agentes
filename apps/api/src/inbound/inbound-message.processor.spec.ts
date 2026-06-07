import { Test, TestingModule } from '@nestjs/testing';
import { InboundMessageProcessor } from './inbound-message.processor';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationService } from '../conversation/conversation.service';
import { ChannelAdapterRegistry } from '../channel/channel-adapter.registry';
import { AppConfigService } from '../config/config.service';
import { RateLimiterService } from '../common/rate-limiter';
import { EvolutionService } from '../modules/channels/evolution/evolution.service';

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

  it('pauses the bot when BOT_PAUSE_ON_HANDOFF is true (Req 10.3, 11.2)', async () => {
    mockConfig.botPauseOnHandoff = true;
    const context = baseContext();

    await invoke(context, { shouldHandoff: true, status: 'chamar_humano' });

    expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: expect.objectContaining({ botPaused: true }),
    });
    expect(context.conversation.botPaused).toBe(true);
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
