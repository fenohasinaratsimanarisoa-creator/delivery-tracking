export enum TrackerProtocol {
  GT06 = 'GT06',
  TELTONIKA = 'TELTONIKA',
  TK103 = 'TK103',
  H02 = 'H02',
  MEITRACK = 'MEITRACK',
  QUECLINK = 'QUECLINK',
  JIMI = 'JIMI',
  COBAN = 'COBAN',
  NAVTELECOM = 'NAVTELECOM',
  SINOTRACK = 'SINOTRACK',
  RUPTELA = 'RUPTELA',
  CALAMP = 'CALAMP',
  GALILEOSKY = 'GALILEOSKY',
  TRACCAR_BRIDGE = 'TRACCAR_BRIDGE',
}

export type DeviceCapability =
  | 'gps'
  | 'fuel'
  | 'ignition'
  | 'relay'
  | 'temperature'
  | 'sos'
  | 'battery'
  | 'engine_hours'
  | 'mileage'
  | 'gsm_signal'
  | 'satellites'
  | 'alarm_sound';

export interface UnifiedGpsEvent {
  deviceId: string;
  imei: string;
  protocol: TrackerProtocol;
  latitude: number;
  longitude: number;
  altitude?: number;
  speed?: number;
  heading?: number;
  accuracy?: number;
  timestamp: Date;
  ignitionStatus?: boolean;
  batteryLevel?: number;
  fuelLevel?: number;
  temperature?: number[];
  alarms?: string[];
  mileage?: number;
  engineHours?: number;
  satellites?: number;
  gsmSignal?: number;
  raw?: Record<string, unknown>;
}

export type DeviceCommandType =
  | 'reboot'
  | 'set_interval'
  | 'cut_engine'
  | 'activate_relay'
  | 'set_apn'
  | 'fetch_config'
  | 'set_report_mode';

export interface DeviceCommandRequest {
  command: DeviceCommandType;
  parameters?: Record<string, unknown>;
}

export interface DeviceCommandResult {
  success: boolean;
  result?: unknown;
  errorMsg?: string;
}
