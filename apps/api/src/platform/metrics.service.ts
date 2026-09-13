import { Injectable } from '@nestjs/common';

@Injectable()
export class MetricsService {
  private requests = 0;
  private errors = 0;
  private totalDurationMs = 0;

  observe(statusCode: number, durationMs: number): void {
    this.requests += 1;
    if (statusCode >= 500) this.errors += 1;
    this.totalDurationMs += durationMs;
  }

  render(): string {
    return [
      '# HELP sim_ets_http_requests_total Total HTTP requests.',
      '# TYPE sim_ets_http_requests_total counter',
      `sim_ets_http_requests_total ${this.requests}`,
      '# HELP sim_ets_http_server_errors_total Total HTTP 5xx responses.',
      '# TYPE sim_ets_http_server_errors_total counter',
      `sim_ets_http_server_errors_total ${this.errors}`,
      '# HELP sim_ets_http_request_duration_ms_total Cumulative request duration.',
      '# TYPE sim_ets_http_request_duration_ms_total counter',
      `sim_ets_http_request_duration_ms_total ${this.totalDurationMs}`,
      '',
    ].join('\n');
  }
}
