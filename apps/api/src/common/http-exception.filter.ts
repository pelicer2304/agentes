import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilterGlobal implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let statusCode: number;
    let message: string | string[] | Record<string, unknown>[];
    let error: string;

    if (exception instanceof NotFoundException) {
      statusCode = HttpStatus.NOT_FOUND;
      message = 'Resource not found';
      error = 'Not Found';
    } else if (exception instanceof UnprocessableEntityException) {
      statusCode = HttpStatus.UNPROCESSABLE_ENTITY;
      const exceptionResponse = exception.getResponse() as Record<string, unknown>;
      message =
        (exceptionResponse.message as string | string[] | Record<string, unknown>[]) ||
        'Validation failed';
      error = 'Unprocessable Entity';
    } else if (exception instanceof BadRequestException) {
      statusCode = HttpStatus.UNPROCESSABLE_ENTITY;
      const exceptionResponse = exception.getResponse() as Record<string, unknown>;
      message =
        (exceptionResponse.message as string | string[]) || 'Validation failed';
      error = 'Unprocessable Entity';
    } else if (exception instanceof ServiceUnavailableException) {
      statusCode = HttpStatus.SERVICE_UNAVAILABLE;
      const exceptionResponse = exception.getResponse() as Record<string, unknown>;
      message =
        (exceptionResponse.message as string) || 'Service temporarily unavailable';
      error = 'Service Unavailable';
    } else if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse() as Record<string, unknown>;
      message = (exceptionResponse.message as string | string[]) || exception.message;
      error = (exceptionResponse.error as string) || 'Error';
    } else {
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';
      error = 'Internal Server Error';
    }

    response.status(statusCode).json({
      statusCode,
      message,
      error,
    });
  }
}
