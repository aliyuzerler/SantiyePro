import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

/**
 * Merkezi hata zarfı (docs/05-api-contracts.md):
 * { error: { code, message, details? }, traceId }
 *
 * Kod kalitesi kuralı: loglarda parola/token/kişisel veri tutulmaz.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<{ traceId?: string; url?: string; method?: string }>();
    const traceId = req.traceId ?? 'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Beklenmeyen bir sunucu hatası oluştu.';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as
        | string
        | { message?: string | string[]; code?: string; details?: unknown; error?: string };

      if (typeof body === 'string') {
        message = body;
      } else {
        const validationMessages = Array.isArray(body.message) ? body.message.join('; ') : body.message;
        message = validationMessages ?? exception.message;
        details = body.details;
      }

      code = mapStatusToCode(status);
      if (status >= 500) {
        this.logger.error(`${req.method} ${req.url} -> ${status} (${code}) traceId=${traceId}`, undefined);
      }
    } else {
      this.logger.error(
        `${req.method ?? '?'} ${req.url ?? '?'} -> 500 (INTERNAL_ERROR) traceId=${traceId} hata=${String(
          exception instanceof Error ? exception.message : exception,
        )}`,
      );
    }

    res.status(status).json({
      error: { code, message, ...(details !== undefined ? { details } : {}) },
      traceId,
    });
  }
}

function mapStatusToCode(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'VALIDATION_ERROR';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHORIZED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'RATE_LIMITED';
    case HttpStatus.SERVICE_UNAVAILABLE:
      return 'SERVICE_UNAVAILABLE';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR';
  }
}
