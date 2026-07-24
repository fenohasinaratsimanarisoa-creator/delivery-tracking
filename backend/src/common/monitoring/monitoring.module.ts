import { Module, Global } from '@nestjs/common';
import { initSentry } from './sentry.init';

@Global()
@Module({})
export class MonitoringModule {
  constructor() {
    initSentry();
  }
}
