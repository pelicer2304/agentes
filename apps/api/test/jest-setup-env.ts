/**
 * Jest global env setup.
 *
 * Runs BEFORE any modules are imported (registered via `setupFiles` in
 * jest.config.ts). Several NestJS modules wire up `@nestjs/config`
 * `ConfigModule.forRoot({ validationSchema })`, which validates `process.env`
 * eagerly at import time. In the Jest environment the required variables are
 * absent, so we provide valid-looking defaults here.
 *
 * Defaults are only applied when the variable is unset, so a developer (or CI)
 * can still override any value via the real environment.
 */
const defaults: Record<string, string> = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  LLM_PROVIDER: 'openrouter',
  OPENROUTER_API_KEY: 'test-openrouter-api-key',
  MODEL_NAME: 'gpt-4o-mini',
  EVOLUTION_API_URL: 'https://evolution.example.com',
  EVOLUTION_API_KEY: 'test-evolution-api-key',
  EVOLUTION_INSTANCE_NAME: 'decodifica',
  PUBLIC_API_URL: 'https://api.example.com',
  JWT_SECRET: 'test-jwt-secret-at-least-16-chars',
  APP_ENV: 'development',
  FRONTEND_URL: 'https://app.example.com',
};

for (const [key, value] of Object.entries(defaults)) {
  if (process.env[key] === undefined || process.env[key] === '') {
    process.env[key] = value;
  }
}
