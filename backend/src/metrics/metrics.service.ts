import { Injectable, OnModuleDestroy } from '@nestjs/common';
import * as promClient from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleDestroy {
  private registry: promClient.Registry;

  public httpRequestDuration: promClient.Histogram<string>;
  public httpRequestTotal: promClient.Counter<string>;
  public httpRequestErrors: promClient.Counter<string>;

  constructor() {
    this.registry = new promClient.Registry();
    promClient.collectDefaultMetrics({ register: this.registry });

    this.httpRequestDuration = new promClient.Histogram({
      name: 'http_request_duration_ms',
      help: 'Duration of HTTP requests in ms',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
      registers: [this.registry],
    });

    this.httpRequestTotal = new promClient.Counter({
      name: 'http_request_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.httpRequestErrors = new promClient.Counter({
      name: 'http_request_errors_total',
      help: 'Total number of HTTP request errors (5xx)',
      labelNames: ['method', 'route'],
      registers: [this.registry],
    });
  }

  getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  onModuleDestroy() {
    this.registry.clear();
  }
}
