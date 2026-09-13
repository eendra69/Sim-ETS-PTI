import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiKeyAuthGuard } from './api-key-auth.guard';
import { MetricsService } from './metrics.service';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { RequestObservabilityMiddleware } from './request-observability.middleware';
import { RateLimitMiddleware } from './rate-limit.middleware';

@Module({
  controllers: [OperationsController],
  providers: [
    MetricsService,
    OperationsService,
    RequestObservabilityMiddleware,
    RateLimitMiddleware,
    { provide: APP_GUARD, useClass: ApiKeyAuthGuard },
  ],
})
export class PlatformModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestObservabilityMiddleware, RateLimitMiddleware).forRoutes({
      path: '{*path}',
      method: RequestMethod.ALL,
    });
  }
}
