import { Injectable, NestMiddleware } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

interface Counter { windowStart: number; count: number }

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private readonly counters = new Map<string, Counter>();

  use(request: Request, response: Response, next: NextFunction): void {
    const limit = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 0);
    if (!Number.isFinite(limit) || limit <= 0 || request.path.includes('/health/')) return next();
    const keyMaterial = request.header('x-api-key') ?? request.ip ?? 'unknown';
    const key = createHash('sha256').update(keyMaterial).digest('hex');
    const now = Date.now();
    const current = this.counters.get(key);
    const counter = !current || now - current.windowStart >= 60_000
      ? { windowStart: now, count: 0 }
      : current;
    counter.count += 1;
    this.counters.set(key, counter);
    response.setHeader('x-ratelimit-limit', limit);
    response.setHeader('x-ratelimit-remaining', Math.max(0, limit - counter.count));
    if (counter.count > limit) {
      response.status(429).json({ statusCode: 429, message: 'Rate limit exceeded' });
      return;
    }
    next();
  }
}
