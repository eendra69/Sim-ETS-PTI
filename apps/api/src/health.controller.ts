import { Controller, Get } from '@nestjs/common';
import { Public } from './platform/auth.decorators';

@Public()
@Controller('health')
export class HealthController {
  @Get()
  getHealth(): { status: string; service: string } {
    return { status: 'ok', service: 'sim-ets-api' };
  }
}
