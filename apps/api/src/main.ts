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

  app.enableCors({
    origin: configService.frontendUrl,
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

  await app.listen(3001);
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
