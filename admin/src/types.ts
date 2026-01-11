export type SensorType = 'window' | 'motion' | 'door' | 'other';
export type SensorGuideline = 'perimeter' | 'entry' | 'all';

export interface SensorConfig {
  id: string;
  name: string;
  type: SensorType;
  guideline: SensorGuideline;
  invert: boolean;
  debounceMs?: number;
}

export interface NativeConfig {
  exitDelaySec: number;
  entryDelaySec: number;
  chirpSec: number;
  preAlarmSec: number;
  alarmDurationSec: number;
  blockArmingIfOpen: boolean;
  autoBypassOpenOnArming: boolean;
  useBaselineSnapshot: boolean;
  debounceMsDefault: number;
  sensors: SensorConfig[];
}
