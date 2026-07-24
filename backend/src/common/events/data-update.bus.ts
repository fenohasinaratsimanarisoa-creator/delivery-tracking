import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

export interface DataUpdateEvent {
  companyId: string;
  entity: string;
  action: string;
  payload?: Record<string, unknown>;
}

@Injectable()
export class DataUpdateBus extends EventEmitter {
  emitUpdate(event: DataUpdateEvent) {
    this.emit('dataUpdate', event);
  }
}
