declare const Accelerometer: new (opts: { frequency: number }) => {
  x: number; y: number; z: number;
  addEventListener: (event: string, handler: () => void) => void;
  start: () => void;
};
declare const LinearAccelerationSensor: typeof Accelerometer;
declare const Gyroscope: typeof Accelerometer;

type MotionSensor = 'accelerometer' | 'gyroscope' | 'linear-acceleration';

interface SensorReading {
  x: number;
  y: number;
  z: number;
  timestamp: number;
}

export class SensorFusion {
  private accel: SensorReading | null = null;
  private gyro: SensorReading | null = null;
  private linearAccel: SensorReading | null = null;
  private sensorsAvailable: boolean | null = null;

  private stationaryThreshold = 0.3;
  private stationaryCounter = 0;
  private movingCounter = 0;
  private readonly STATIONARY_SAMPLES = 3;
  private readonly MOVING_SAMPLES = 2;

  async init(): Promise<boolean> {
    if (this.sensorsAvailable !== null) return this.sensorsAvailable;

    if (!navigator.permissions) {
      this.sensorsAvailable = false;
      return false;
    }

    try {
      const hasAccel = await this.checkSensor('accelerometer');
      const hasGyro = await this.checkSensor('gyroscope');
      const hasLinearAccel = await this.checkSensor('linear-acceleration');

      if (!hasAccel && !hasLinearAccel) {
        this.sensorsAvailable = false;
        return false;
      }

      if (hasAccel) {
        try {
          const sensor = new Accelerometer({ frequency: 10 });
          sensor.addEventListener('reading', () => {
            this.accel = { x: sensor.x, y: sensor.y, z: sensor.z, timestamp: Date.now() };
          });
          sensor.start();
        } catch {}
      }

      if (hasLinearAccel) {
        try {
          const sensor = new LinearAccelerationSensor({ frequency: 10 });
          sensor.addEventListener('reading', () => {
            this.linearAccel = { x: sensor.x, y: sensor.y, z: sensor.z, timestamp: Date.now() };
          });
          sensor.start();
        } catch {}
      }

      if (hasGyro) {
        try {
          const sensor = new Gyroscope({ frequency: 10 });
          sensor.addEventListener('reading', () => {
            this.gyro = { x: sensor.x, y: sensor.y, z: sensor.z, timestamp: Date.now() };
          });
          sensor.start();
        } catch {}
      }

      this.sensorsAvailable = hasAccel || hasLinearAccel || hasGyro;
      return this.sensorsAvailable;
    } catch {
      this.sensorsAvailable = false;
      return false;
    }
  }

  private async checkSensor(type: MotionSensor): Promise<boolean> {
    const sensorCtor = this.getSensorConstructor(type);
    if (!sensorCtor) {
      return false;
    }
    try {
      const result = await navigator.permissions.query({
        name: type as PermissionName,
      });
      return result.state !== 'denied';
    } catch {
      return true;
    }
  }

  private getSensorConstructor(type: MotionSensor): typeof Accelerometer | undefined {
    switch (type) {
      case 'accelerometer': return Accelerometer;
      case 'gyroscope': return Gyroscope;
      case 'linear-acceleration': return LinearAccelerationSensor;
    }
  }

  isStationary(threshold?: number): boolean | null {
    const th = threshold ?? this.stationaryThreshold;

    const accel = this.linearAccel ?? this.accel;
    if (!accel) {
      if (this.sensorsAvailable === false) return null;
      return false;
    }

    const magnitude = Math.sqrt(accel.x * accel.x + accel.y * accel.y + accel.z * accel.z);
    const isStill = magnitude < th;

    if (isStill) {
      this.stationaryCounter++;
      this.movingCounter = 0;
    } else {
      this.movingCounter++;
      this.stationaryCounter = 0;
    }

    if (this.stationaryCounter >= this.STATIONARY_SAMPLES) return true;
    if (this.movingCounter >= this.MOVING_SAMPLES) return false;
    return null;
  }

  getAngularMotion(): number | null {
    if (!this.gyro) return null;
    return Math.sqrt(
      this.gyro.x * this.gyro.x +
      this.gyro.y * this.gyro.y +
      this.gyro.z * this.gyro.z,
    );
  }

  isAvailable(): boolean {
    return this.sensorsAvailable === true;
  }
}

export const sensorFusion = new SensorFusion();

// Dev fallback: simulate sensor based on GPS speed
export function simulateStationaryFromSpeed(speedMs: number | undefined): boolean {
  if (speedMs === undefined) return false;
  return speedMs < 0.1;
}