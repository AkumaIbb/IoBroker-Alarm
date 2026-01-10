import * as utils from "@iobroker/adapter-core";

const CONTROL_MODE_VALUES = [
  "disarmed",
  "arming",
  "armed_full",
  "armed_perimeter",
  "entry_delay",
  "alarm_pre",
  "alarm_full",
] as const;

type ControlMode = (typeof CONTROL_MODE_VALUES)[number];

interface SmarthomeAlarmConfig {
  exitDelaySec: number;
  entryDelaySec: number;
  preAlarmSec: number;
  alarmDurationSec: number;
  blockArmingIfOpen: boolean;
  autoBypassOpenOnArming: boolean;
  useBaselineSnapshot: boolean;
  debounceMsDefault: number;
  sensors: Array<{
    stateId: string;
    name: string;
    role: "perimeter" | "entry" | "interior" | "24h";
    invert: boolean;
    triggerValue: boolean;
    policy: "instant" | "entryDelay" | "silent";
    bypass: boolean;
    debounceMs?: number;
  }>;
}

class SmarthomeAlarm extends utils.Adapter {
  private exitTimeout: ReturnType<typeof setTimeout> | null = null;
  private exitInterval: ReturnType<typeof setInterval> | null = null;
  private sensorsByStateId = new Map<string, SmarthomeAlarmConfig["sensors"][number]>();
  private troubleSensors = new Set<string>();
  private lastEventTimestamp = new Map<string, number>();
  private baselineSnapshot = new Map<string, boolean>();
  private runtimeBypass = new Set<string>();
  private initializingSensors = false;

  public constructor(options: Partial<utils.AdapterOptions> = {}) {
    super({
      ...options,
      name: "smarthome-alarm",
    });

    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }

  private async onReady(): Promise<void> {
    const config = this.config as SmarthomeAlarmConfig;

    await this.ensureState("control.mode", {
      type: "string",
      role: "state",
      read: true,
      write: true,
      def: "disarmed",
      states: CONTROL_MODE_VALUES.join(";"),
    }, "disarmed");

    await this.ensureState("control.armFull", {
      type: "boolean",
      role: "button",
      read: true,
      write: true,
      def: false,
    }, false);

    await this.ensureState("control.armPerimeter", {
      type: "boolean",
      role: "button",
      read: true,
      write: true,
      def: false,
    }, false);

    await this.ensureState("control.disarm", {
      type: "boolean",
      role: "button",
      read: true,
      write: true,
      def: false,
    }, false);

    await this.ensureState("alarm.active", {
      type: "boolean",
      role: "indicator.alarm",
      read: true,
      write: false,
      def: false,
    }, false);

    await this.ensureState("alarm.silenced", {
      type: "boolean",
      role: "switch",
      read: true,
      write: true,
      def: false,
    }, false);

    await this.ensureState("timers.exitRemaining", {
      type: "number",
      role: "value.interval",
      read: true,
      write: false,
      unit: "s",
      def: 0,
    }, 0);

    await this.ensureState("timers.entryRemaining", {
      type: "number",
      role: "value.interval",
      read: true,
      write: false,
      unit: "s",
      def: 0,
    }, 0);

    await this.ensureState("last.triggerSensor", {
      type: "string",
      role: "text",
      read: true,
      write: false,
      def: "",
    }, "");

    await this.ensureState("last.triggerTime", {
      type: "string",
      role: "text",
      read: true,
      write: false,
      def: "",
    }, "");

    await this.ensureState("last.reason", {
      type: "string",
      role: "text",
      read: true,
      write: false,
      def: "",
    }, "");

    await this.ensureState("trouble.active", {
      type: "boolean",
      role: "indicator.maintenance",
      read: true,
      write: false,
      def: false,
    }, false);

    await this.ensureState("trouble.list", {
      type: "string",
      role: "json",
      read: true,
      write: false,
      def: "[]",
    }, "[]");

    await this.ensureState("arming.openList", {
      type: "string",
      role: "json",
      read: true,
      write: false,
      def: "[]",
    }, "[]");

    await this.ensureState("arming.bypassedList", {
      type: "string",
      role: "json",
      read: true,
      write: false,
      def: "[]",
    }, "[]");

    await this.subscribeStatesAsync("control.*");

    await this.initializeSensors();

    const currentModeState = await this.getStateAsync("control.mode");
    const currentMode = currentModeState?.val;
    if (config.useBaselineSnapshot && (currentMode === "armed_full" || currentMode === "armed_perimeter")) {
      await this.captureBaselineSnapshot();
    }

    this.initializingSensors = false;

    if (config.exitDelaySec < 0) {
      this.log.warn("exitDelaySec is negative; forcing to 0");
    }
  }

  private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
    if (!state) {
      return;
    }

    const localId = id.replace(`${this.namespace}.`, "");

    if (this.sensorsByStateId.has(id)) {
      await this.handleSensorChange(id, state);
      return;
    }

    if (state.ack) {
      return;
    }

    if (localId === "control.armFull" && state.val === true) {
      await this.handleArm("armed_full");
      await this.setStateAsync("control.armFull", { val: false, ack: true });
      return;
    }

    if (localId === "control.armPerimeter" && state.val === true) {
      await this.handleArm("armed_perimeter");
      await this.setStateAsync("control.armPerimeter", { val: false, ack: true });
      return;
    }

    if (localId === "control.disarm" && state.val === true) {
      await this.handleDisarm();
      await this.setStateAsync("control.disarm", { val: false, ack: true });
      return;
    }

    if (localId === "control.mode" && typeof state.val === "string") {
      if (state.val === "disarmed") {
        await this.handleDisarm();
      } else if (CONTROL_MODE_VALUES.includes(state.val as ControlMode)) {
        await this.setStateAsync("control.mode", { val: state.val, ack: true });
      } else {
        this.log.warn(`Unsupported mode value: ${state.val}`);
      }
    }
  }

  private async handleArm(targetMode: ControlMode): Promise<void> {
    const config = this.config as SmarthomeAlarmConfig;
    const delaySec = Math.max(0, config.exitDelaySec || 0);

    await this.clearExitTimers();

    const openSensors = await this.getOpenSensorsForMode(targetMode);
    await this.setStateAsync("arming.openList", { val: JSON.stringify(openSensors), ack: true });

    let bypassedSensors: string[] = [];
    if (openSensors.length > 0) {
      if (config.blockArmingIfOpen) {
        await this.setStateAsync("control.mode", { val: "disarmed", ack: true });
        await this.setStateAsync("last.reason", { val: "arming_blocked_open", ack: true });
        await this.setStateAsync("arming.bypassedList", { val: "[]", ack: true });
        return;
      }

      if (config.autoBypassOpenOnArming) {
        openSensors.forEach((sensorId) => this.runtimeBypass.add(sensorId));
        bypassedSensors = openSensors;
      }
    }

    await this.setStateAsync("arming.bypassedList", { val: JSON.stringify(bypassedSensors), ack: true });

    await this.clearExitTimers();
    await this.setStateAsync("control.mode", { val: "arming", ack: true });

    if (delaySec === 0) {
      await this.finishArming(targetMode);
      return;
    }

    let remaining = delaySec;
    await this.setStateAsync("timers.exitRemaining", { val: remaining, ack: true });

    this.exitInterval = setInterval(async () => {
      remaining -= 1;
      await this.setStateAsync("timers.exitRemaining", { val: Math.max(remaining, 0), ack: true });
    }, 1000);

    this.exitTimeout = setTimeout(async () => {
      await this.finishArming(targetMode);
    }, delaySec * 1000);
  }

  private async finishArming(targetMode: ControlMode): Promise<void> {
    const config = this.config as SmarthomeAlarmConfig;
    await this.clearExitTimers();
    await this.setStateAsync("timers.exitRemaining", { val: 0, ack: true });
    if (config.useBaselineSnapshot) {
      await this.captureBaselineSnapshot();
    }
    await this.setStateAsync("control.mode", { val: targetMode, ack: true });
  }

  private async handleDisarm(): Promise<void> {
    await this.clearExitTimers();
    await this.setStateAsync("control.mode", { val: "disarmed", ack: true });
    await this.setStateAsync("timers.exitRemaining", { val: 0, ack: true });
    await this.setStateAsync("alarm.active", { val: false, ack: true });
    await this.setStateAsync("alarm.silenced", { val: false, ack: true });
    this.runtimeBypass.clear();
    this.baselineSnapshot.clear();
    await this.setStateAsync("arming.openList", { val: "[]", ack: true });
    await this.setStateAsync("arming.bypassedList", { val: "[]", ack: true });
  }

  private async clearExitTimers(): Promise<void> {
    if (this.exitTimeout) {
      clearTimeout(this.exitTimeout);
      this.exitTimeout = null;
    }
    if (this.exitInterval) {
      clearInterval(this.exitInterval);
      this.exitInterval = null;
    }
  }

  private async ensureState(
    id: string,
    common: ioBroker.StateCommon,
    defaultValue: ioBroker.StateValue,
  ): Promise<void> {
    await this.setObjectNotExistsAsync(id, {
      type: "state",
      common,
      native: {},
    });

    await this.extendObjectAsync(id, {
      type: "state",
      common,
      native: {},
    });

    const currentState = await this.getStateAsync(id);
    if (!currentState || currentState.val === null || currentState.val === undefined) {
      await this.setStateAsync(id, { val: defaultValue, ack: true });
    }
  }

  private async initializeSensors(): Promise<void> {
    const config = this.config as SmarthomeAlarmConfig;
    this.initializingSensors = true;
    this.sensorsByStateId.clear();

    for (const sensor of config.sensors || []) {
      if (!sensor.stateId) {
        continue;
      }
      if (this.sensorsByStateId.has(sensor.stateId)) {
        this.log.warn(`Duplicate sensor stateId in config: ${sensor.stateId}`);
      }
      this.sensorsByStateId.set(sensor.stateId, sensor);
      await this.subscribeForeignStatesAsync(sensor.stateId);
    }
  }

  private async handleSensorChange(id: string, state: ioBroker.State): Promise<void> {
    if (this.initializingSensors) {
      return;
    }

    const sensor = this.sensorsByStateId.get(id);
    if (!sensor) {
      return;
    }

    const debounceMs = sensor.debounceMs ?? (this.config as SmarthomeAlarmConfig).debounceMsDefault ?? 0;
    const lastTimestamp = this.lastEventTimestamp.get(id) ?? 0;
    const now = Date.now();
    if (debounceMs > 0 && now - lastTimestamp < debounceMs) {
      return;
    }

    const normalized = this.normalizeSensorValue(state.val, sensor);
    if (normalized === null) {
      await this.addTroubleSensor(id);
      return;
    }

    this.lastEventTimestamp.set(id, now);
    await this.removeTroubleSensor(id);

    if ((this.config as SmarthomeAlarmConfig).useBaselineSnapshot) {
      const currentModeState = await this.getStateAsync("control.mode");
      const currentMode = currentModeState?.val;
      if (currentMode === "armed_full" || currentMode === "armed_perimeter") {
        if (!this.baselineSnapshot.has(id)) {
          this.baselineSnapshot.set(id, normalized);
          return;
        }
        if (this.baselineSnapshot.get(id) === normalized) {
          return;
        }
      }
    }

    if (this.runtimeBypass.has(id)) {
      return;
    }
  }

  private normalizeSensorValue(
    value: ioBroker.StateValue,
    sensor: SmarthomeAlarmConfig["sensors"][number],
  ): boolean | null {
    if (value === null || value === undefined) {
      return null;
    }

    let normalized: boolean | null = null;
    if (typeof value === "boolean") {
      normalized = value;
    } else if (typeof value === "number") {
      if (value === 0 || value === 1) {
        normalized = value === 1;
      }
    } else if (typeof value === "string") {
      const lowered = value.trim().toLowerCase();
      if (lowered === "true") {
        normalized = true;
      } else if (lowered === "false") {
        normalized = false;
      }
    }

    if (normalized === null) {
      return null;
    }

    if (sensor.invert) {
      normalized = !normalized;
    }

    return normalized;
  }

  private async captureBaselineSnapshot(): Promise<void> {
    const entries = Array.from(this.sensorsByStateId.entries());
    for (const [stateId, sensor] of entries) {
      const state = await this.getForeignStateAsync(stateId);
      const normalized = state ? this.normalizeSensorValue(state.val, sensor) : null;
      if (normalized === null) {
        await this.addTroubleSensor(stateId);
        continue;
      }
      await this.removeTroubleSensor(stateId);
      this.baselineSnapshot.set(stateId, normalized);
    }
  }

  private async getOpenSensorsForMode(targetMode: ControlMode): Promise<string[]> {
    const openSensors: string[] = [];
    const sensors = Array.from(this.sensorsByStateId.entries());
    for (const [stateId, sensor] of sensors) {
      if (!this.isSensorRelevantForMode(sensor, targetMode)) {
        continue;
      }
      if (sensor.bypass || this.runtimeBypass.has(stateId)) {
        continue;
      }
      const state = await this.getForeignStateAsync(stateId);
      const normalized = state ? this.normalizeSensorValue(state.val, sensor) : null;
      if (normalized === null) {
        await this.addTroubleSensor(stateId);
        continue;
      }
      await this.removeTroubleSensor(stateId);
      if (normalized === sensor.triggerValue) {
        openSensors.push(stateId);
      }
    }
    return openSensors;
  }

  private isSensorRelevantForMode(
    sensor: SmarthomeAlarmConfig["sensors"][number],
    targetMode: ControlMode,
  ): boolean {
    if (targetMode === "armed_perimeter") {
      return sensor.role === "perimeter";
    }
    if (targetMode === "armed_full") {
      return sensor.role === "perimeter" || sensor.role === "entry";
    }
    return false;
  }

  private async addTroubleSensor(sensorId: string): Promise<void> {
    if (!this.troubleSensors.has(sensorId)) {
      this.troubleSensors.add(sensorId);
      await this.updateTroubleStates();
    }
  }

  private async removeTroubleSensor(sensorId: string): Promise<void> {
    if (this.troubleSensors.delete(sensorId)) {
      await this.updateTroubleStates();
    }
  }

  private async updateTroubleStates(): Promise<void> {
    await this.setStateAsync("trouble.list", {
      val: JSON.stringify(Array.from(this.troubleSensors)),
      ack: true,
    });
    await this.setStateAsync("trouble.active", { val: this.troubleSensors.size > 0, ack: true });
  }

  private onUnload(callback: () => void): void {
    this.clearExitTimers()
      .then(() => callback())
      .catch(() => callback());
  }
}

if (module.parent) {
  module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new SmarthomeAlarm(options);
} else {
  (() => new SmarthomeAlarm())();
}
