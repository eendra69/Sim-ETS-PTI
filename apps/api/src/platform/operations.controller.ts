import { Controller, Get, Header } from '@nestjs/common';
import { Public } from './auth.decorators';
import { MetricsService } from './metrics.service';
import { OperationsService } from './operations.service';

@Controller()
export class OperationsController {
  constructor(
    private readonly operations: OperationsService,
    private readonly metrics: MetricsService,
  ) {}

  @Public()
  @Get('health/live')
  live() {
    return { status: 'alive', service: 'sim-ets-api' };
  }

  @Public()
  @Get('health/ready')
  ready() {
    return this.operations.readiness();
  }

  @Public()
  @Get('metrics')
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  metricsText(): string {
    return this.metrics.render();
  }
}
