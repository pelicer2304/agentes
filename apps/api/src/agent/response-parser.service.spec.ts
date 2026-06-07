import { ResponseParserService, ResponseParseError } from './response-parser.service';
import { AgentResponse } from './dto/agent-response.dto';

describe('ResponseParserService', () => {
  let service: ResponseParserService;

  beforeEach(() => {
    service = new ResponseParserService();
  });

  const validResponse: AgentResponse = {
    reply: 'Olá! Me conta qual é o seu negócio?',
    stage: 'abertura',
    detectedSegment: null,
    businessDescription: null,
    detectedIntent: 'curiosidade',
    whatsappUsage: null,
    mainPain: null,
    secondaryPains: [],
    desiredOutcome: null,
    estimatedVolume: 'desconhecido',
    urgency: 'desconhecida',
    decisionRole: 'desconhecido',
    budgetSignal: 'desconhecido',
    objections: [],
    recommendedService: null,
    leadScore: 0,
    scoreReasons: [],
    temperature: 'frio',
    status: 'novo',
    shouldHandoff: false,
    handoffReason: null,
    commercialSummary: null,
    nextBestQuestion: 'Qual é o seu negócio?',
  };

  describe('parse - valid responses', () => {
    it('should parse a valid JSON response', () => {
      const result = service.parse(JSON.stringify(validResponse));
      expect(result).toEqual(validResponse);
    });

    it('should parse response with all nullable fields set', () => {
      const response: AgentResponse = {
        ...validResponse,
        detectedSegment: 'restaurante',
        businessDescription: 'Restaurante de comida japonesa',
        whatsappUsage: 'Usa para pedidos',
        mainPain: 'Demora no atendimento',
        secondaryPains: ['Perda de clientes', 'Falta de organização'],
        desiredOutcome: 'Automatizar pedidos',
        recommendedService: 'Chatbot de atendimento',
        handoffReason: null,
        commercialSummary: 'Lead interessado em automação',
        nextBestQuestion: 'Quantos pedidos recebe por dia?',
      };
      const result = service.parse(JSON.stringify(response));
      expect(result).toEqual(response);
    });

    it('should parse response with shouldHandoff true and valid handoffReason', () => {
      const response: AgentResponse = {
        ...validResponse,
        shouldHandoff: true,
        handoffReason: 'Lead score atingiu 70 pontos',
        leadScore: 75,
        temperature: 'quente',
        status: 'chamar_humano',
        stage: 'handoff_humano',
      };
      const result = service.parse(JSON.stringify(response));
      expect(result).toEqual(response);
    });
  });

  describe('parse - invalid JSON', () => {
    it('should throw on invalid JSON string', () => {
      expect(() => service.parse('not json')).toThrow(ResponseParseError);
      expect(() => service.parse('not json')).toThrow('Invalid JSON');
    });

    it('should throw on JSON array', () => {
      expect(() => service.parse('[]')).toThrow(ResponseParseError);
    });

    it('should throw on null JSON', () => {
      expect(() => service.parse('null')).toThrow(ResponseParseError);
    });
  });

  describe('parse - field validation', () => {
    it('should reject empty reply', () => {
      const response = { ...validResponse, reply: '' };
      expect(() => service.parse(JSON.stringify(response))).toThrow(
        ResponseParseError,
      );
    });

    it('should reject reply exceeding 1000 characters', () => {
      const response = { ...validResponse, reply: 'a'.repeat(1001) };
      expect(() => service.parse(JSON.stringify(response))).toThrow(
        ResponseParseError,
      );
    });

    it('should reject invalid stage enum', () => {
      const response = { ...validResponse, stage: 'invalid_stage' };
      expect(() => service.parse(JSON.stringify(response))).toThrow(
        ResponseParseError,
      );
    });

    it('should reject invalid detectedIntent enum', () => {
      const response = { ...validResponse, detectedIntent: 'invalid' };
      expect(() => service.parse(JSON.stringify(response))).toThrow(
        ResponseParseError,
      );
    });

    it('should reject invalid estimatedVolume enum', () => {
      const response = { ...validResponse, estimatedVolume: 'huge' };
      expect(() => service.parse(JSON.stringify(response))).toThrow(
        ResponseParseError,
      );
    });

    it('should reject invalid urgency enum', () => {
      const response = { ...validResponse, urgency: 'critical' };
      expect(() => service.parse(JSON.stringify(response))).toThrow(
        ResponseParseError,
      );
    });

    it('should reject invalid decisionRole enum', () => {
      const response = { ...validResponse, decisionRole: 'ceo' };
      expect(() => service.parse(JSON.stringify(response))).toThrow(
        ResponseParseError,
      );
    });

    it('should reject invalid budgetSignal enum', () => {
      const response = { ...validResponse, budgetSignal: 'unlimited' };
      expect(() => service.parse(JSON.stringify(response))).toThrow(
        ResponseParseError,
      );
    });

    it('should reject invalid temperature enum', () => {
      const response = { ...validResponse, temperature: 'hot' };
      expect(() => service.parse(JSON.stringify(response))).toThrow(
        ResponseParseError,
      );
    });

    it('should reject invalid status enum', () => {
      const response = { ...validResponse, status: 'active' };
      expect(() => service.parse(JSON.stringify(response))).toThrow(
        ResponseParseError,
      );
    });

    it('should reject leadScore below 0', () => {
      const response = { ...validResponse, leadScore: -1 };
      expect(() => service.parse(JSON.stringify(response))).toThrow(
        ResponseParseError,
      );
    });

    it('should reject leadScore above 100', () => {
      const response = { ...validResponse, leadScore: 101 };
      expect(() => service.parse(JSON.stringify(response))).toThrow(
        ResponseParseError,
      );
    });

    it('should reject non-integer leadScore', () => {
      const response = { ...validResponse, leadScore: 50.5 };
      expect(() => service.parse(JSON.stringify(response))).toThrow(
        ResponseParseError,
      );
    });

    it('should reject secondaryPains with more than 10 items', () => {
      const response = {
        ...validResponse,
        secondaryPains: Array(11).fill('pain'),
      };
      expect(() => service.parse(JSON.stringify(response))).toThrow(
        ResponseParseError,
      );
    });

    it('should reject objections with more than 10 items', () => {
      const response = {
        ...validResponse,
        objections: Array(11).fill('objection'),
      };
      expect(() => service.parse(JSON.stringify(response))).toThrow(
        ResponseParseError,
      );
    });

    it('should reject scoreReasons with more than 10 items', () => {
      const response = {
        ...validResponse,
        scoreReasons: Array(11).fill('reason'),
      };
      expect(() => service.parse(JSON.stringify(response))).toThrow(
        ResponseParseError,
      );
    });

    it('should reject non-boolean shouldHandoff', () => {
      const response = { ...validResponse, shouldHandoff: 'true' };
      expect(() => service.parse(JSON.stringify(response))).toThrow(
        ResponseParseError,
      );
    });

    it('should reject empty handoffReason when shouldHandoff is true', () => {
      const response = {
        ...validResponse,
        shouldHandoff: true,
        handoffReason: '',
      };
      expect(() => service.parse(JSON.stringify(response))).toThrow(
        ResponseParseError,
      );
    });

    it('should reject null handoffReason when shouldHandoff is true', () => {
      const response = {
        ...validResponse,
        shouldHandoff: true,
        handoffReason: null,
      };
      expect(() => service.parse(JSON.stringify(response))).toThrow(
        ResponseParseError,
      );
    });

    it('should reject commercialSummary exceeding 2000 characters', () => {
      const response = {
        ...validResponse,
        commercialSummary: 'a'.repeat(2001),
      };
      expect(() => service.parse(JSON.stringify(response))).toThrow(
        ResponseParseError,
      );
    });

    it('should collect multiple validation errors', () => {
      const response = {
        ...validResponse,
        reply: '',
        stage: 'invalid',
        leadScore: -5,
      };
      try {
        service.parse(JSON.stringify(response));
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ResponseParseError);
        expect((error as ResponseParseError).details.length).toBeGreaterThan(1);
      }
    });
  });
});
