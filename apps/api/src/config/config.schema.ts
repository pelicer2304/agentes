import * as Joi from 'joi';

const SUPPORTED_LLM_PROVIDERS = ['openrouter', 'openai'] as const;

export const configValidationSchema = Joi.object({
  DATABASE_URL: Joi.string().uri().required().messages({
    'any.required': 'DATABASE_URL is required. Set it to your PostgreSQL connection string.',
    'string.empty': 'DATABASE_URL cannot be empty.',
  }),

  // --- LLM provider configuration ---
  LLM_PROVIDER: Joi.string()
    .valid(...SUPPORTED_LLM_PROVIDERS)
    .default('openrouter')
    .messages({
      'any.only': `LLM_PROVIDER must be one of the supported providers: ${SUPPORTED_LLM_PROVIDERS.join(', ')}. Received "{{#value}}".`,
    }),

  OPENROUTER_API_KEY: Joi.string().messages({
    'string.empty': 'OPENROUTER_API_KEY cannot be empty.',
  }),

  OPENROUTER_BASE_URL: Joi.string().uri().optional().messages({
    'string.uri': 'OPENROUTER_BASE_URL must be a valid URI.',
  }),

  OPENAI_API_KEY: Joi.string().messages({
    'string.empty': 'OPENAI_API_KEY cannot be empty.',
  }),

  OPENAI_BASE_URL: Joi.string().uri().optional().messages({
    'string.uri': 'OPENAI_BASE_URL must be a valid URI.',
  }),

  MODEL_NAME: Joi.string().default('gpt-4o-mini'),

  LLM_MODEL_FALLBACK: Joi.string().default('google/gemini-2.5-flash'),

  // --- Evolution API configuration ---
  EVOLUTION_API_URL: Joi.string().uri().required().messages({
    'any.required': 'EVOLUTION_API_URL is required. Set it to your Evolution API base URL.',
    'string.empty': 'EVOLUTION_API_URL cannot be empty.',
    'string.uri': 'EVOLUTION_API_URL must be a valid URI.',
  }),

  EVOLUTION_API_KEY: Joi.string().required().messages({
    'any.required': 'EVOLUTION_API_KEY is required. Provide your Evolution API key.',
    'string.empty': 'EVOLUTION_API_KEY cannot be empty.',
  }),

  EVOLUTION_INSTANCE_NAME: Joi.string().required().messages({
    'any.required': 'EVOLUTION_INSTANCE_NAME is required. Set it to your Evolution instance name.',
    'string.empty': 'EVOLUTION_INSTANCE_NAME cannot be empty.',
  }),

  EVOLUTION_WEBHOOK_SECRET: Joi.string().allow('').optional(),

  PUBLIC_API_URL: Joi.string().uri().required().messages({
    'any.required':
      'PUBLIC_API_URL is required. Set it to the publicly reachable base URL of this API.',
    'string.empty': 'PUBLIC_API_URL cannot be empty.',
    'string.uri': 'PUBLIC_API_URL must be a valid URI.',
  }),

  // --- Bot behavior toggles ---
  BOT_AUTO_REPLY_ENABLED: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(true)
    .messages({
      'boolean.base': 'BOT_AUTO_REPLY_ENABLED must be either "true" or "false".',
    }),

  BOT_PAUSE_ON_HANDOFF: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(true)
    .messages({
      'boolean.base': 'BOT_PAUSE_ON_HANDOFF must be either "true" or "false".',
    }),

  ADMIN_WHATSAPP_NUMBERS: Joi.string().allow('').default(''), // comma-separated

  // --- Pricing configuration ---
  PRICING_RANGE_ENABLED: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(true)
    .messages({
      'boolean.base': 'PRICING_RANGE_ENABLED must be either "true" or "false".',
    }),

  PRICING_STARTING_AT: Joi.number()
    .min(0)
    .max(999999999.99)
    .default(2500)
    .messages({
      'number.base': 'PRICING_STARTING_AT is invalid. It must be a number between 0 and 999999999.99.',
      'number.min': 'PRICING_STARTING_AT is invalid. It must be a number between 0 and 999999999.99.',
      'number.max': 'PRICING_STARTING_AT is invalid. It must be a number between 0 and 999999999.99.',
    }),

  PRICING_TEXT: Joi.string().allow('').optional(),

  // --- Auth ---
  JWT_SECRET: Joi.string().min(16).required().messages({
    'any.required': 'JWT_SECRET is required. Set it to a secret string of at least 16 characters.',
    'string.empty': 'JWT_SECRET cannot be empty.',
    'string.min': 'JWT_SECRET must be at least 16 characters long.',
  }),

  // --- Runtime environment ---
  APP_ENV: Joi.string()
    .valid('development', 'staging', 'production')
    .required()
    .messages({
      'any.required': 'APP_ENV is required. Set it to development, staging, or production.',
      'string.empty': 'APP_ENV cannot be empty.',
      'any.only':
        'APP_ENV must be one of: development, staging, production. Received "{{#value}}".',
    }),

  FRONTEND_URL: Joi.string().uri().required().messages({
    'any.required': 'FRONTEND_URL is required. Set it to the frontend origin for CORS.',
    'string.empty': 'FRONTEND_URL cannot be empty.',
  }),
})
  // The frozen engine uses OpenAIProviderService for BOTH "openai" and
  // "openrouter" (it reads OPENAI_API_KEY / OPENAI_BASE_URL). So at least one
  // LLM key must be provided; OPENAI_API_KEY is preferred and OPENROUTER_API_KEY
  // is accepted as an alias (see AppConfigService.openaiApiKey).
  .or('OPENAI_API_KEY', 'OPENROUTER_API_KEY')
  .messages({
    'object.missing':
      'An LLM API key is required: set OPENAI_API_KEY (used for both "openai" and "openrouter" providers) or OPENROUTER_API_KEY.',
  });
