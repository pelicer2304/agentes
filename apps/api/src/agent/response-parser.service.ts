import { Injectable } from '@nestjs/common';
import {
  AgentResponse,
  BUDGET_SIGNALS,
  CONVERSATION_STAGES,
  DECISION_ROLES,
  DETECTED_INTENTS,
  LEAD_STATUSES,
  TEMPERATURES,
  URGENCY_LEVELS,
  VOLUME_LEVELS,
} from './dto/agent-response.dto';

export class ResponseParseError extends Error {
  constructor(
    message: string,
    public readonly details: string[],
  ) {
    super(message);
    this.name = 'ResponseParseError';
  }
}

@Injectable()
export class ResponseParserService {
  /**
   * Parses a JSON string into a validated AgentResponse.
   * Throws ResponseParseError if the JSON is invalid or fails validation.
   */
  parse(jsonString: string): AgentResponse {
    let parsed: unknown;

    // Strip markdown code block wrappers if present
    let cleaned = jsonString.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new ResponseParseError('Invalid JSON', [
        'Response is not valid JSON',
      ]);
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new ResponseParseError('Invalid response structure', [
        'Response must be a JSON object',
      ]);
    }

    const obj = parsed as Record<string, unknown>;
    const errors: string[] = [];

    // Validate reply
    if (typeof obj.reply !== 'string' || obj.reply.trim().length === 0) {
      errors.push('reply must be a non-empty string');
    } else if (obj.reply.length > 1000) {
      errors.push('reply must be at most 1000 characters');
    }

    // Validate stage
    if (!this.isValidEnum(obj.stage, CONVERSATION_STAGES)) {
      errors.push(
        `stage must be one of: ${CONVERSATION_STAGES.join(', ')}`,
      );
    }

    // Validate detectedSegment (string | null)
    if (!this.isNullableString(obj.detectedSegment)) {
      errors.push('detectedSegment must be a string or null');
    }

    // Validate businessDescription (string | null)
    if (!this.isNullableString(obj.businessDescription)) {
      errors.push('businessDescription must be a string or null');
    }

    // Validate detectedIntent
    if (!this.isValidEnum(obj.detectedIntent, DETECTED_INTENTS)) {
      errors.push(
        `detectedIntent must be one of: ${DETECTED_INTENTS.join(', ')}`,
      );
    }

    // Validate whatsappUsage (string | null)
    if (!this.isNullableString(obj.whatsappUsage)) {
      errors.push('whatsappUsage must be a string or null');
    }

    // Validate mainPain (string | null)
    if (!this.isNullableString(obj.mainPain)) {
      errors.push('mainPain must be a string or null');
    }

    // Validate secondaryPains (string[], max 10)
    if (!this.isStringArray(obj.secondaryPains, 10)) {
      errors.push('secondaryPains must be an array of strings with max 10 items');
    }

    // Validate desiredOutcome (string | null)
    if (!this.isNullableString(obj.desiredOutcome)) {
      errors.push('desiredOutcome must be a string or null');
    }

    // Validate estimatedVolume
    if (!this.isValidEnum(obj.estimatedVolume, VOLUME_LEVELS)) {
      errors.push(
        `estimatedVolume must be one of: ${VOLUME_LEVELS.join(', ')}`,
      );
    }

    // Validate urgency
    if (!this.isValidEnum(obj.urgency, URGENCY_LEVELS)) {
      errors.push(`urgency must be one of: ${URGENCY_LEVELS.join(', ')}`);
    }

    // Validate decisionRole
    if (!this.isValidEnum(obj.decisionRole, DECISION_ROLES)) {
      errors.push(
        `decisionRole must be one of: ${DECISION_ROLES.join(', ')}`,
      );
    }

    // Validate budgetSignal
    if (!this.isValidEnum(obj.budgetSignal, BUDGET_SIGNALS)) {
      errors.push(
        `budgetSignal must be one of: ${BUDGET_SIGNALS.join(', ')}`,
      );
    }

    // Validate objections (string[], max 10)
    if (!this.isStringArray(obj.objections, 10)) {
      errors.push('objections must be an array of strings with max 10 items');
    }

    // Validate recommendedService (string | null)
    if (!this.isNullableString(obj.recommendedService)) {
      errors.push('recommendedService must be a string or null');
    }

    // Validate leadScore (integer 0-100)
    if (!this.isValidLeadScore(obj.leadScore)) {
      errors.push('leadScore must be an integer between 0 and 100');
    }

    // Validate scoreReasons (string[], max 10)
    if (!this.isStringArray(obj.scoreReasons, 10)) {
      errors.push('scoreReasons must be an array of strings with max 10 items');
    }

    // Validate temperature
    if (!this.isValidEnum(obj.temperature, TEMPERATURES)) {
      errors.push(
        `temperature must be one of: ${TEMPERATURES.join(', ')}`,
      );
    }

    // Validate status
    if (!this.isValidEnum(obj.status, LEAD_STATUSES)) {
      errors.push(`status must be one of: ${LEAD_STATUSES.join(', ')}`);
    }

    // Validate shouldHandoff (boolean)
    if (typeof obj.shouldHandoff !== 'boolean') {
      errors.push('shouldHandoff must be a boolean');
    }

    // Validate handoffReason (string | null, required non-empty if shouldHandoff is true)
    if (!this.isNullableString(obj.handoffReason)) {
      errors.push('handoffReason must be a string or null');
    } else if (
      obj.shouldHandoff === true &&
      (typeof obj.handoffReason !== 'string' ||
        obj.handoffReason.trim().length === 0)
    ) {
      errors.push(
        'handoffReason must be a non-empty string when shouldHandoff is true',
      );
    }

    // Validate commercialSummary (string | null, max 2000)
    if (!this.isNullableString(obj.commercialSummary)) {
      errors.push('commercialSummary must be a string or null');
    } else if (
      typeof obj.commercialSummary === 'string' &&
      obj.commercialSummary.length > 2000
    ) {
      errors.push('commercialSummary must be at most 2000 characters');
    }

    // Validate nextBestQuestion (string | null)
    if (!this.isNullableString(obj.nextBestQuestion)) {
      errors.push('nextBestQuestion must be a string or null');
    }

    if (errors.length > 0) {
      throw new ResponseParseError('Validation failed', errors);
    }

    return obj as unknown as AgentResponse;
  }

  private isValidEnum(
    value: unknown,
    allowedValues: readonly string[],
  ): boolean {
    return typeof value === 'string' && allowedValues.includes(value);
  }

  private isNullableString(value: unknown): boolean {
    return value === null || typeof value === 'string';
  }

  private isStringArray(value: unknown, maxItems: number): boolean {
    if (!Array.isArray(value)) return false;
    if (value.length > maxItems) return false;
    return value.every((item) => typeof item === 'string');
  }

  private isValidLeadScore(value: unknown): boolean {
    if (typeof value !== 'number') return false;
    if (!Number.isInteger(value)) return false;
    return value >= 0 && value <= 100;
  }
}
