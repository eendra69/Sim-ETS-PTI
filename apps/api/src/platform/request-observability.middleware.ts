import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AuthenticatedRequest } from './auth.types';
import { MetricsService } from './metrics.service';

@Injectable()
export class RequestObservabilityMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(request: AuthenticatedRequest, response: Response, next: NextFunction): void {
    const provided = request.header('x-correlation-id');
    request.correlationId = provided && /^[a-zA-Z0-9._:-]{8,100}$/.test(provided) ? provided : randomUUID();
    response.setHeader('x-correlation-id', request.correlationId);
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('x-frame-options', 'DENY');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    const started = process.hrtime.bigint();
    response.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      this.metrics.observe(response.statusCode, durationMs);
      if (process.env.NODE_ENV !== 'test') {
        console.log(JSON.stringify({
          type: 'http_request',
          correlationId: request.correlationId,
          actorId: request.identity?.actorId,
          method: request.method,
          path: request.originalUrl,
          statusCode: response.statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
        }));
      }
    });
    next();
  }
}
