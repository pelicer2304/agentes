import { PromptBuilderService } from './prompt-builder.service';
import { AgentSettingsInput, KnowledgeBaseItem, ConversationMessage } from './dto/agent-settings.dto';

describe('PromptBuilderService', () => {
  let service: PromptBuilderService;

  beforeEach(() => {
    service = new PromptBuilderService();
  });

  const defaultSettings: AgentSettingsInput = {
    agentName: 'Assistente Decodifica',
    initialMessage: 'Olá! Como posso ajudar?',
    toneOfVoice: 'Profissional e consultivo',
    services: ['Chatbot WhatsApp', 'Automação de atendimento'],
    doNotPromise: ['Preços fixos', 'Prazos específicos'],
    handoffCriteria: ['Score >= 70', 'Cliente pede humano'],
  };

  const defaultKnowledgeBase: KnowledgeBaseItem[] = [
    { category: 'empresa', title: 'Sobre a Decodifica', content: 'Empresa de automação' },
    { category: 'servicos', title: 'Chatbot', content: 'Chatbot para WhatsApp' },
  ];

  const defaultHistory: ConversationMessage[] = [
    { role: 'user', content: 'Olá, tenho uma clínica' },
    { role: 'assistant', content: 'Que legal! Me conta mais sobre sua clínica?' },
  ];

  describe('buildPrompt', () => {
    it('should return a request with system message as first message', () => {
      const result = service.buildPrompt(defaultSettings, defaultKnowledgeBase, defaultHistory);

      expect(result.messages[0].role).toBe('system');
      expect(result.messages[0].content).toBeTruthy();
    });

    it('should include conversation history after system message', () => {
      const result = service.buildPrompt(defaultSettings, defaultKnowledgeBase, defaultHistory);

      expect(result.messages.length).toBe(3); // system + 2 history messages
      expect(result.messages[1]).toEqual({ role: 'user', content: 'Olá, tenho uma clínica' });
      expect(result.messages[2]).toEqual({ role: 'assistant', content: 'Que legal! Me conta mais sobre sua clínica?' });
    });

    it('should set responseFormat to json', () => {
      const result = service.buildPrompt(defaultSettings, defaultKnowledgeBase, defaultHistory);
      expect(result.responseFormat).toBe('json');
    });

    it('should include agent name in system prompt', () => {
      const result = service.buildPrompt(defaultSettings, defaultKnowledgeBase, defaultHistory);
      expect(result.messages[0].content).toContain('Assistente Decodifica');
    });

    it('should include tone of voice in system prompt', () => {
      const result = service.buildPrompt(defaultSettings, defaultKnowledgeBase, defaultHistory);
      expect(result.messages[0].content).toContain('Profissional e consultivo');
    });

    it('should include services in system prompt', () => {
      const result = service.buildPrompt(defaultSettings, defaultKnowledgeBase, defaultHistory);
      expect(result.messages[0].content).toContain('Chatbot WhatsApp');
      expect(result.messages[0].content).toContain('Automação de atendimento');
    });

    it('should include do-not-promise rules in system prompt', () => {
      const result = service.buildPrompt(defaultSettings, defaultKnowledgeBase, defaultHistory);
      expect(result.messages[0].content).toContain('Preços fixos');
      expect(result.messages[0].content).toContain('Prazos específicos');
    });

    it('should include handoff criteria in system prompt', () => {
      const result = service.buildPrompt(defaultSettings, defaultKnowledgeBase, defaultHistory);
      expect(result.messages[0].content).toContain('Score >= 70');
      expect(result.messages[0].content).toContain('Cliente pede humano');
    });

    it('should include knowledge base content in system prompt', () => {
      const result = service.buildPrompt(defaultSettings, defaultKnowledgeBase, defaultHistory);
      expect(result.messages[0].content).toContain('Sobre a Decodifica');
      expect(result.messages[0].content).toContain('Empresa de automação');
      expect(result.messages[0].content).toContain('Chatbot para WhatsApp');
    });

    it('should include JSON response format specification', () => {
      const result = service.buildPrompt(defaultSettings, defaultKnowledgeBase, defaultHistory);
      const systemPrompt = result.messages[0].content;
      expect(systemPrompt).toContain('reply');
      expect(systemPrompt).toContain('stage');
      expect(systemPrompt).toContain('leadScore');
      expect(systemPrompt).toContain('shouldHandoff');
    });

    it('should include scoring criteria in system prompt', () => {
      const result = service.buildPrompt(defaultSettings, defaultKnowledgeBase, defaultHistory);
      const systemPrompt = result.messages[0].content;
      expect(systemPrompt).toContain('+15');
      expect(systemPrompt).toContain('+20');
      expect(systemPrompt).toContain('+10');
      expect(systemPrompt).toContain('scoreReasons');
    });

    it('should not include knowledge base section header when knowledge base is empty', () => {
      const result = service.buildPrompt(defaultSettings, [], defaultHistory);
      expect(result.messages[0].content).not.toContain('## Base de Conhecimento');
    });

    it('should handle null optional settings', () => {
      const settings: AgentSettingsInput = {
        agentName: 'Test Agent',
        initialMessage: 'Hello',
        toneOfVoice: null,
        services: null,
        doNotPromise: null,
        handoffCriteria: null,
      };
      const result = service.buildPrompt(settings, [], []);
      expect(result.messages[0].content).toContain('Test Agent');
      expect(result.messages[0].content).not.toContain('Tom de Voz');
      expect(result.messages[0].content).not.toContain('Serviços Oferecidos');
    });

    it('should handle empty conversation history', () => {
      const result = service.buildPrompt(defaultSettings, defaultKnowledgeBase, []);
      expect(result.messages.length).toBe(1); // only system message
    });
  });
});
