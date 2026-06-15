import { configValidationSchema } from './config.schema';

describe('configValidationSchema', () => {
  const validEnv = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    LLM_PROVIDER: 'openrouter',
    OPENROUTER_API_KEY: 'or-test-key-123',
    MODEL_NAME: 'gpt-4o-mini',
    EVOLUTION_API_URL: 'https://evolution.example.com',
    EVOLUTION_API_KEY: 'evo-test-key-123',
    EVOLUTION_INSTANCE_NAME: 'decodifica',
    PUBLIC_API_URL: 'https://api.example.com',
    JWT_SECRET: 'a-very-long-jwt-secret-value',
    APP_ENV: 'development',
    FRONTEND_URL: 'http://localhost:3000',
  };

  it('should accept valid environment variables', () => {
    const { error } = configValidationSchema.validate(validEnv);
    expect(error).toBeUndefined();
  });

  it('should default MODEL_NAME to "gpt-4o-mini" if not set', () => {
    const { MODEL_NAME, ...envWithoutModel } = validEnv;
    const { error, value } = configValidationSchema.validate(envWithoutModel);
    expect(error).toBeUndefined();
    expect(value.MODEL_NAME).toBe('gpt-4o-mini');
  });

  it('should default LLM_MODEL_FALLBACK to "google/gemini-2.5-flash" if not set', () => {
    const { error, value } = configValidationSchema.validate(validEnv);
    expect(error).toBeUndefined();
    expect(value.LLM_MODEL_FALLBACK).toBe('google/gemini-2.5-flash');
  });

  describe('defaults (Requirement 4.2)', () => {
    it('should default LLM_PROVIDER to "openrouter" when absent', () => {
      const { LLM_PROVIDER, ...env } = validEnv;
      const { error, value } = configValidationSchema.validate(env);
      expect(error).toBeUndefined();
      expect(value.LLM_PROVIDER).toBe('openrouter');
    });

    it('should default BOT_AUTO_REPLY_ENABLED to true when absent', () => {
      const { error, value } = configValidationSchema.validate(validEnv);
      expect(error).toBeUndefined();
      expect(value.BOT_AUTO_REPLY_ENABLED).toBe(true);
    });

    it('should default BOT_PAUSE_ON_HANDOFF to true when absent', () => {
      const { error, value } = configValidationSchema.validate(validEnv);
      expect(error).toBeUndefined();
      expect(value.BOT_PAUSE_ON_HANDOFF).toBe(true);
    });

    it('should default PRICING_RANGE_ENABLED to true when absent', () => {
      const { error, value } = configValidationSchema.validate(validEnv);
      expect(error).toBeUndefined();
      expect(value.PRICING_RANGE_ENABLED).toBe(true);
    });

    it('should default PRICING_STARTING_AT to 2500 when absent', () => {
      const { error, value } = configValidationSchema.validate(validEnv);
      expect(error).toBeUndefined();
      expect(value.PRICING_STARTING_AT).toBe(2500);
    });

    it('should default ADMIN_WHATSAPP_NUMBERS to an empty string when absent', () => {
      const { error, value } = configValidationSchema.validate(validEnv);
      expect(error).toBeUndefined();
      expect(value.ADMIN_WHATSAPP_NUMBERS).toBe('');
    });
  });

  describe('required variables (Requirement 4.3)', () => {
    it.each([
      'DATABASE_URL',
      'EVOLUTION_API_URL',
      'EVOLUTION_API_KEY',
      'EVOLUTION_INSTANCE_NAME',
      'PUBLIC_API_URL',
      'JWT_SECRET',
      'APP_ENV',
      'FRONTEND_URL',
    ])('should fail and name the variable when %s is missing', (key) => {
      const env = { ...validEnv } as Record<string, unknown>;
      delete env[key];
      const { error } = configValidationSchema.validate(env, { abortEarly: false });
      expect(error).toBeDefined();
      expect(error!.message).toContain(key);
    });
  });

  describe('LLM_PROVIDER validation (Requirement 4.4)', () => {
    it('should accept "openrouter"', () => {
      const env = { ...validEnv, LLM_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'or-key' };
      const { error } = configValidationSchema.validate(env);
      expect(error).toBeUndefined();
    });

    it('should accept "openai"', () => {
      const { OPENROUTER_API_KEY, ...rest } = validEnv;
      const env = { ...rest, LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-key' };
      const { error } = configValidationSchema.validate(env);
      expect(error).toBeUndefined();
    });

    it('should fail if LLM_PROVIDER is an unsupported value', () => {
      const env = { ...validEnv, LLM_PROVIDER: 'anthropic' };
      const { error } = configValidationSchema.validate(env);
      expect(error).toBeDefined();
      expect(error!.message).toContain('supported providers');
      expect(error!.message).toContain('LLM_PROVIDER');
    });

    it('should require OPENROUTER_API_KEY when LLM_PROVIDER is "openrouter"', () => {
      const { OPENROUTER_API_KEY, ...env } = validEnv;
      const { error } = configValidationSchema.validate(env, { abortEarly: false });
      expect(error).toBeDefined();
      expect(error!.message).toContain('OPENROUTER_API_KEY');
    });

    it('should require OPENAI_API_KEY when LLM_PROVIDER is "openai"', () => {
      const { OPENROUTER_API_KEY, ...rest } = validEnv;
      const env = { ...rest, LLM_PROVIDER: 'openai' };
      const { error } = configValidationSchema.validate(env, { abortEarly: false });
      expect(error).toBeDefined();
      expect(error!.message).toContain('OPENAI_API_KEY');
    });
  });

  describe('boolean configuration validation (Requirement 4.5)', () => {
    it.each(['BOT_AUTO_REPLY_ENABLED', 'BOT_PAUSE_ON_HANDOFF', 'PRICING_RANGE_ENABLED'])(
      'should reject a non-boolean value for %s and name it',
      (key) => {
        const env = { ...validEnv, [key]: 'yes' };
        const { error } = configValidationSchema.validate(env);
        expect(error).toBeDefined();
        expect(error!.message).toContain(key);
      },
    );

    it.each(['BOT_AUTO_REPLY_ENABLED', 'BOT_PAUSE_ON_HANDOFF', 'PRICING_RANGE_ENABLED'])(
      'should accept "true"/"false" string for %s',
      (key) => {
        const trueEnv = { ...validEnv, [key]: 'true' };
        const falseEnv = { ...validEnv, [key]: 'false' };
        expect(configValidationSchema.validate(trueEnv).error).toBeUndefined();
        expect(configValidationSchema.validate(falseEnv).error).toBeUndefined();
      },
    );
  });

  describe('PRICING_STARTING_AT range validation (Requirement 4.6)', () => {
    it('should accept the lower bound 0', () => {
      const env = { ...validEnv, PRICING_STARTING_AT: 0 };
      expect(configValidationSchema.validate(env).error).toBeUndefined();
    });

    it('should accept the upper bound 999999999.99', () => {
      const env = { ...validEnv, PRICING_STARTING_AT: 999999999.99 };
      expect(configValidationSchema.validate(env).error).toBeUndefined();
    });

    it('should reject a value below 0', () => {
      const env = { ...validEnv, PRICING_STARTING_AT: -1 };
      const { error } = configValidationSchema.validate(env);
      expect(error).toBeDefined();
      expect(error!.message).toContain('PRICING_STARTING_AT');
    });

    it('should reject a value above the maximum', () => {
      const env = { ...validEnv, PRICING_STARTING_AT: 1000000000 };
      const { error } = configValidationSchema.validate(env);
      expect(error).toBeDefined();
      expect(error!.message).toContain('PRICING_STARTING_AT');
    });

    it('should reject a non-numeric value', () => {
      const env = { ...validEnv, PRICING_STARTING_AT: 'free' };
      const { error } = configValidationSchema.validate(env);
      expect(error).toBeDefined();
      expect(error!.message).toContain('PRICING_STARTING_AT');
    });
  });

  it('should fail if JWT_SECRET is shorter than 16 characters', () => {
    const env = { ...validEnv, JWT_SECRET: 'short' };
    const { error } = configValidationSchema.validate(env);
    expect(error).toBeDefined();
    expect(error!.message).toContain('JWT_SECRET');
  });

  it('should fail if APP_ENV is an invalid value', () => {
    const env = { ...validEnv, APP_ENV: 'test' };
    const { error } = configValidationSchema.validate(env);
    expect(error).toBeDefined();
    expect(error!.message).toContain('APP_ENV');
  });

  it('should fail with descriptive errors when multiple required vars are missing', () => {
    const { error } = configValidationSchema.validate({}, { abortEarly: false, allowUnknown: true });
    expect(error).toBeDefined();
    const message = error!.message;
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('EVOLUTION_API_URL');
    expect(message).toContain('JWT_SECRET');
    expect(message).toContain('APP_ENV');
    expect(message).toContain('FRONTEND_URL');
  });

  it('should allow unknown environment variables', () => {
    const env = { ...validEnv, SOME_OTHER_VAR: 'value' };
    const { error } = configValidationSchema.validate(env, { allowUnknown: true });
    expect(error).toBeUndefined();
  });

  describe('follow-up defaults (Requirement 9.2)', () => {
    it('should default FOLLOWUP_LEVEL1_HOURS to 1 when absent', () => {
      const { error, value } = configValidationSchema.validate(validEnv);
      expect(error).toBeUndefined();
      expect(value.FOLLOWUP_LEVEL1_HOURS).toBe(1);
    });

    it('should default FOLLOWUP_LEVEL2_HOURS to 24 when absent', () => {
      const { error, value } = configValidationSchema.validate(validEnv);
      expect(error).toBeUndefined();
      expect(value.FOLLOWUP_LEVEL2_HOURS).toBe(24);
    });

    it('should default FOLLOWUP_LEVEL3_HOURS to 48 when absent', () => {
      const { error, value } = configValidationSchema.validate(validEnv);
      expect(error).toBeUndefined();
      expect(value.FOLLOWUP_LEVEL3_HOURS).toBe(48);
    });

    it('should default FOLLOWUP_COMPLETION_WINDOW_HOURS to 24 when absent', () => {
      const { error, value } = configValidationSchema.validate(validEnv);
      expect(error).toBeUndefined();
      expect(value.FOLLOWUP_COMPLETION_WINDOW_HOURS).toBe(24);
    });

    it('should default FOLLOWUP_SEND_WINDOW to "08:00-20:00" when absent', () => {
      const { error, value } = configValidationSchema.validate(validEnv);
      expect(error).toBeUndefined();
      expect(value.FOLLOWUP_SEND_WINDOW).toBe('08:00-20:00');
    });

    it('should default FOLLOWUP_RETRY_BACKOFF_SECONDS to 60 when absent', () => {
      const { error, value } = configValidationSchema.validate(validEnv);
      expect(error).toBeUndefined();
      expect(value.FOLLOWUP_RETRY_BACKOFF_SECONDS).toBe(60);
    });

    it('should default FOLLOWUP_MAX_DEFERRALS to 10 when absent', () => {
      const { error, value } = configValidationSchema.validate(validEnv);
      expect(error).toBeUndefined();
      expect(value.FOLLOWUP_MAX_DEFERRALS).toBe(10);
    });

    it('should default FOLLOWUP_POLL_INTERVAL_MS to 30000 when absent', () => {
      const { error, value } = configValidationSchema.validate(validEnv);
      expect(error).toBeUndefined();
      expect(value.FOLLOWUP_POLL_INTERVAL_MS).toBe(30000);
    });
  });

  describe('FOLLOWUP_SEND_WINDOW format validation (Requirement 9.3)', () => {
    it.each(['08:00-20:00', '00:00-23:59', '09:30-18:45'])(
      'should accept the valid window "%s"',
      (window) => {
        const env = { ...validEnv, FOLLOWUP_SEND_WINDOW: window };
        expect(configValidationSchema.validate(env).error).toBeUndefined();
      },
    );

    it.each([
      '8:00-20:00', // hour not zero-padded
      '08:00 - 20:00', // spaces around dash
      '08:00', // missing end
      '08:00-24:00', // hour out of range
      '08:60-20:00', // minute out of range
      '0800-2000', // missing colons
      'morning', // not a time at all
    ])('should reject the invalid window "%s" and name it', (window) => {
      const env = { ...validEnv, FOLLOWUP_SEND_WINDOW: window };
      const { error } = configValidationSchema.validate(env);
      expect(error).toBeDefined();
      expect(error!.message).toContain('FOLLOWUP_SEND_WINDOW');
    });
  });

  describe('FOLLOWUP_RETRY_BACKOFF_SECONDS minimum validation (Requirement 9.5)', () => {
    it('should accept the lower bound 60', () => {
      const env = { ...validEnv, FOLLOWUP_RETRY_BACKOFF_SECONDS: 60 };
      expect(configValidationSchema.validate(env).error).toBeUndefined();
    });

    it('should reject a value below 60 and name it', () => {
      const env = { ...validEnv, FOLLOWUP_RETRY_BACKOFF_SECONDS: 59 };
      const { error } = configValidationSchema.validate(env);
      expect(error).toBeDefined();
      expect(error!.message).toContain('FOLLOWUP_RETRY_BACKOFF_SECONDS');
    });
  });

  describe('FOLLOWUP_POLL_INTERVAL_MS maximum validation (Requirement 9.5)', () => {
    it('should accept the upper bound 60000', () => {
      const env = { ...validEnv, FOLLOWUP_POLL_INTERVAL_MS: 60000 };
      expect(configValidationSchema.validate(env).error).toBeUndefined();
    });

    it('should reject a value above 60000 and name it', () => {
      const env = { ...validEnv, FOLLOWUP_POLL_INTERVAL_MS: 60001 };
      const { error } = configValidationSchema.validate(env);
      expect(error).toBeDefined();
      expect(error!.message).toContain('FOLLOWUP_POLL_INTERVAL_MS');
    });
  });
});
