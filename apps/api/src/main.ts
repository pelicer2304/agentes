import { NestFactory } from '@nestjs/core';
import {
  ValidationPipe,
  UnprocessableEntityException,
  ValidationError,
} from '@nestjs/common';
import { AppModule } from './app.module';
import { AppConfigService } from './config/config.service';
import { HttpExceptionFilterGlobal } from './common/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(AppConfigService);

  // Normalize allowed origins: strip trailing slashes so a FRONTEND_URL like
  // "https://app.example.com/" still matches the browser's Origin header
  // ("https://app.example.com", which never has a trailing slash). Supports a
  // comma-separated FRONTEND_URL for multiple allowed origins.
  const normalizeOrigin = (value: string): string =>
    value.trim().replace(/\/+$/, '');
  const allowedOrigins = new Set(
    (configService.frontendUrl ?? '')
      .split(',')
      .map(normalizeOrigin)
      .filter((value) => value.length > 0),
  );

  app.enableCors({
    origin: (origin, callback) => {
      // Allow non-browser clients (no Origin header) and any configured origin.
      if (!origin || allowedOrigins.has(normalizeOrigin(origin))) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors: ValidationError[]) => {
        const messages = errors.map((err) => {
          const constraints = err.constraints
            ? Object.values(err.constraints)
            : ['Invalid value'];
          return {
            field: err.property,
            errors: constraints,
          };
        });
        return new UnprocessableEntityException({
          statusCode: 422,
          message: messages,
          error: 'Unprocessable Entity',
        });
      },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilterGlobal());

  // Bind explicitly to all IPv4 interfaces so the container healthcheck
  // (wget http://127.0.0.1:3001/health) reliably reaches the server.
  await app.listen(3001, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log('API listening on http://0.0.0.0:3001');
}

bootstrap().catch((error: unknown) => {
  // Configuration validation (Joi) runs while the Nest application is being
  // created, which is before the HTTP port is bound above. If a required
  // environment variable is missing or invalid, halt startup, report the
  // offending variable's name, and exit non-zero. (Requirement 4.3)
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(`Startup aborted due to invalid configuration: ${message}`);
  process.exit(1);
});
