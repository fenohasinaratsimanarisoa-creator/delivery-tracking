import { Global, Module } from '@nestjs/common';
import { DataUpdateBus } from './data-update.bus';

@Global()
@Module({
  providers: [DataUpdateBus],
  exports: [DataUpdateBus],
})
export class DataUpdateModule {}
