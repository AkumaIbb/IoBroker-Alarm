export type SensorRole = 'perimeter' | 'entry' | 'interior' | '24h';
export type SensorPolicy = 'instant' | 'entryDelay' | 'silent';

export interface SensorConfig {
  stateId: string;
  name: string;
  role: SensorRole;
  invert: boolean;
  triggerValue: boolean;
  policy: SensorPolicy;
  bypass: boolean;
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
