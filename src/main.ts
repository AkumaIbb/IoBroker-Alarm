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

type OutputActiveIn = ControlMode | "beep";

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
  outputs?: Array<{
    stateId: string;
    name: string;
    activeIn: OutputActiveIn[];
    value?: boolean;
  }>;
}

type OutputConfig = NonNullable<SmarthomeAlarmConfig["outputs"]>[number];

type EventSeverity = "info" | "warning" | "alarm";

class SmarthomeAlarm extends utils.Adapter {
  private exitTimeout: ReturnType<typeof setTimeout> | null = null;
  private exitInterval: ReturnType<typeof setInterval> | null = null;
  private entryTimeout: ReturnType<typeof setTimeout> | null = null;
  private entryInterval: ReturnType<typeof setInterval> | null = null;
  private preAlarmTimeout: ReturnType<typeof setTimeout> | null = null;
  private alarmDurationTimeout: ReturnType<typeof setTimeout> | null = null;
  private silentEventTimeout: ReturnType<typeof setTimeout> | null = null;
  private sensorsByStateId = new Map<string, SmarthomeAlarmConfig["sensors"][number]>();
  private troubleSensors = new Set<string>();
  private lastEventTimestamp = new Map<string, number>();
  private lastSensorValue = new Map<string, boolean>();
  private baselineSnapshot = new Map<string, boolean>();
  private runtimeBypass = new Set<string>();
  private initializingSensors = false;
  private lastOutputValues = new Map<string, boolean>();
  private beepInterval: ReturnType<typeof setInterval> | null = null;
  private beepState = true;

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
      name: { de: "Modus", en: "Mode" },
      type: "string",
      role: "state",
      read: true,
      write: true,
      def: "disarmed",
      states: CONTROL_MODE_VALUES.join(";"),
    }, "disarmed");

    await this.ensureState("control.armFull", {
      name: { de: "Voll scharfschalten", en: "Arm full" },
      type: "boolean",
      role: "button",
      read: true,
      write: true,
      def: false,
    }, false);

    await this.ensureState("control.armPerimeter", {
      name: { de: "Teilscharf schalten", en: "Arm perimeter" },
      type: "boolean",
      role: "button",
      read: true,
      write: true,
      def: false,
    }, false);

    await this.ensureState("control.disarm", {
      name: { de: "Unscharf schalten", en: "Disarm" },
      type: "boolean",
      role: "button",
      read: true,
      write: true,
      def: false,
    }, false);

    await this.ensureState("alarm.active", {
      name: { de: "Alarm aktiv", en: "Alarm active" },
      type: "boolean",
      role: "indicator.alarm",
      read: true,
      write: false,
      def: false,
    }, false);

    await this.ensureState("alarm.outputsActive", {
      name: { de: "Alarm-Ausgänge aktiv", en: "Alarm outputs active" },
      type: "boolean",
      role: "indicator.alarm",
      read: true,
      write: false,
      def: false,
    }, false);

    await this.ensureState("alarm.silenced", {
      name: { de: "Alarm stumm", en: "Alarm silenced" },
      type: "boolean",
      role: "switch",
      read: true,
      write: true,
      def: false,
    }, false);

    await this.ensureState("alarm.silentEvent", {
      name: { de: "Stilles Ereignis", en: "Silent event" },
      type: "boolean",
      role: "indicator",
      read: true,
      write: false,
      def: false,
    }, false);

    await this.ensureState("timers.exitRemaining", {
      name: { de: "Verbleibende Ausgangszeit", en: "Exit time remaining" },
      type: "number",
      role: "value.interval",
      read: true,
      write: false,
      unit: "s",
      def: 0,
    }, 0);

    await this.ensureState("timers.entryRemaining", {
      name: { de: "Verbleibende Eintrittszeit", en: "Entry time remaining" },
      type: "number",
      role: "value.interval",
      read: true,
      write: false,
      unit: "s",
      def: 0,
    }, 0);

    await this.ensureState("last.triggerSensor", {
      name: { de: "Letzter Auslösesensor", en: "Last trigger sensor" },
      type: "string",
      role: "text",
      read: true,
      write: false,
      def: "",
    }, "");

    await this.ensureState("last.triggerTime", {
      name: { de: "Letzter Auslösezeitpunkt", en: "Last trigger time" },
      type: "string",
      role: "text",
      read: true,
      write: false,
      def: "",
    }, "");

    await this.ensureState("last.reason", {
      name: { de: "Letzter Grund", en: "Last reason" },
      type: "string",
      role: "text",
      read: true,
      write: false,
      def: "",
    }, "");

    await this.ensureState("trouble.active", {
      name: { de: "Störung aktiv", en: "Trouble active" },
      type: "boolean",
      role: "indicator.maintenance",
      read: true,
      write: false,
      def: false,
    }, false);

    await this.ensureState("trouble.list", {
      name: { de: "Störungsliste", en: "Trouble list" },
      type: "string",
      role: "json",
      read: true,
      write: false,
      def: "[]",
    }, "[]");

    await this.ensureState("arming.openList", {
      name: { de: "Offene Sensoren", en: "Open sensors" },
      type: "string",
      role: "json",
      read: true,
      write: false,
      def: "[]",
    }, "[]");

    await this.ensureState("arming.bypassedList", {
      name: { de: "Bypass-Sensoren", en: "Bypassed sensors" },
      type: "string",
      role: "json",
      read: true,
      write: false,
      def: "[]",
    }, "[]");

    await this.ensureState("outputs.status", {
      name: { de: "Ausgangsstatus", en: "Outputs status" },
      type: "string",
      role: "json",
      read: true,
      write: false,
      def: "{}",
    }, "{}");

    await this.ensureState("events.last", {
      name: { de: "Letztes Ereignis", en: "Last event" },
      type: "string",
      role: "json",
      read: true,
      write: false,
      def: "{}",
    }, "{}");

    await this.ensureState("events.counter", {
      name: { de: "Ereigniszähler", en: "Event counter" },
      type: "number",
      role: "value",
      read: true,
      write: false,
      def: 0,
    }, 0);

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

    await this.updateOutputsForMode(await this.getControlMode());
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
        await this.setControlMode(state.val as ControlMode);
      } else {
        this.log.warn(`Unsupported mode value: ${state.val}`);
      }
    }
  }

  private async handleArm(targetMode: ControlMode): Promise<void> {
    const config = this.config as SmarthomeAlarmConfig;
    const delaySec = Math.max(0, config.exitDelaySec || 0);

    await this.clearExitTimers();
    await this.clearEntryTimers();
    await this.clearPreAlarmTimer();
    await this.clearAlarmDurationTimer();
    await this.clearSilentEventTimer();

    const openSensors = await this.getOpenSensorsForMode(targetMode);
    await this.setStateAsync("arming.openList", { val: JSON.stringify(openSensors), ack: true });

    let bypassedSensors: string[] = [];
    if (openSensors.length > 0) {
      if (config.blockArmingIfOpen) {
        await this.setControlMode("disarmed");
        await this.updateLastEvent("arming_blocked_open");
        await this.emitEvent({
          type: "arming_blocked",
          mode: "disarmed",
          severity: "warning",
          message: `Arming blocked: open sensors (${openSensors.length})`,
        });
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
    await this.setControlMode("arming");
    await this.emitEvent({
      type: "arming_started",
      mode: "arming",
      severity: "info",
      message: `Arming started (${targetMode})`,
    });

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
    await this.setControlMode(targetMode);
    await this.updateLastEvent("armed", undefined, targetMode);
    await this.emitEvent({
      type: "armed",
      mode: targetMode,
      severity: "info",
      message: `System armed (${targetMode})`,
    });
  }

  private async handleDisarm(): Promise<void> {
    await this.clearExitTimers();
    await this.clearEntryTimers();
    await this.clearPreAlarmTimer();
    await this.clearAlarmDurationTimer();
    await this.clearSilentEventTimer();
    await this.setControlMode("disarmed");
    await this.setStateAsync("timers.exitRemaining", { val: 0, ack: true });
    await this.setStateAsync("timers.entryRemaining", { val: 0, ack: true });
    await this.setStateAsync("alarm.active", { val: false, ack: true });
    await this.setStateAsync("alarm.outputsActive", { val: false, ack: true });
    await this.setStateAsync("alarm.silenced", { val: false, ack: true });
    await this.setStateAsync("alarm.silentEvent", { val: false, ack: true });
    this.runtimeBypass.clear();
    this.baselineSnapshot.clear();
    await this.setStateAsync("arming.openList", { val: "[]", ack: true });
    await this.setStateAsync("arming.bypassedList", { val: "[]", ack: true });
    await this.updateLastEvent("disarmed");
    await this.emitEvent({
      type: "disarmed",
      mode: "disarmed",
      severity: "info",
      message: "System disarmed",
    });
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

  private async clearEntryTimers(): Promise<void> {
    if (this.entryTimeout) {
      clearTimeout(this.entryTimeout);
      this.entryTimeout = null;
    }
    if (this.entryInterval) {
      clearInterval(this.entryInterval);
      this.entryInterval = null;
    }
  }

  private async clearPreAlarmTimer(): Promise<void> {
    if (this.preAlarmTimeout) {
      clearTimeout(this.preAlarmTimeout);
      this.preAlarmTimeout = null;
    }
  }

  private async clearAlarmDurationTimer(): Promise<void> {
    if (this.alarmDurationTimeout) {
      clearTimeout(this.alarmDurationTimeout);
      this.alarmDurationTimeout = null;
    }
  }

  private async clearSilentEventTimer(): Promise<void> {
    if (this.silentEventTimeout) {
      clearTimeout(this.silentEventTimeout);
      this.silentEventTimeout = null;
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

    if (sensor.bypass) {
      return;
    }

    const previousValue = this.lastSensorValue.get(id);
    this.lastSensorValue.set(id, normalized);
    if (previousValue === undefined) {
      return;
    }
    if (previousValue === normalized) {
      return;
    }
    if (normalized !== sensor.triggerValue) {
      return;
    }

    const currentMode = await this.getControlMode();
    await this.handleSensorTrigger(sensor, id, currentMode);
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
      return sensor.role === "perimeter" || sensor.role === "entry" || sensor.role === "24h";
    }
    if (targetMode === "armed_full") {
      return sensor.role === "perimeter" || sensor.role === "entry" || sensor.role === "interior" || sensor.role === "24h";
    }
    return false;
  }

  private async getControlMode(): Promise<ControlMode> {
    const currentModeState = await this.getStateAsync("control.mode");
    const currentMode = currentModeState?.val;
    if (CONTROL_MODE_VALUES.includes(currentMode as ControlMode)) {
      return currentMode as ControlMode;
    }
    return "disarmed";
  }

  private async handleSensorTrigger(
    sensor: SmarthomeAlarmConfig["sensors"][number],
    stateId: string,
    mode: ControlMode,
  ): Promise<void> {
    if (sensor.policy === "silent") {
      await this.handleSilentEvent(sensor);
      return;
    }

    if (mode === "arming" || mode === "disarmed") {
      return;
    }

    if (mode === "armed_perimeter" && sensor.role === "interior") {
      return;
    }

    if (mode === "entry_delay") {
      if (sensor.policy === "instant") {
        await this.triggerAlarm(sensor, stateId, "instant_during_entry");
      }
      return;
    }

    if (mode === "alarm_pre" || mode === "alarm_full") {
      await this.updateLastEvent("alarm_triggered", sensor, mode);
      return;
    }

    if (sensor.policy === "entryDelay" && sensor.role === "entry") {
      await this.startEntryDelay(sensor, stateId);
      return;
    }

    if (sensor.policy === "instant") {
      await this.triggerAlarm(sensor, stateId, "instant_trigger");
    }
  }

  private async startEntryDelay(
    sensor: SmarthomeAlarmConfig["sensors"][number],
    stateId: string,
  ): Promise<void> {
    const config = this.config as SmarthomeAlarmConfig;
    const delaySec = Math.max(0, config.entryDelaySec || 0);
    await this.clearEntryTimers();
    await this.setControlMode("entry_delay");
    await this.updateLastEvent("entry_delay", sensor);
    await this.emitEvent({
      type: "entry_delay_started",
      mode: "entry_delay",
      severity: "info",
      sensorId: stateId,
      sensorName: sensor.name,
      message: `Entry delay started (${sensor.name || stateId})`,
    });

    if (delaySec === 0) {
      await this.triggerAlarm(sensor, stateId, "entry_delay_elapsed");
      return;
    }

    let remaining = delaySec;
    await this.setStateAsync("timers.entryRemaining", { val: remaining, ack: true });

    this.entryInterval = setInterval(async () => {
      remaining -= 1;
      await this.setStateAsync("timers.entryRemaining", { val: Math.max(remaining, 0), ack: true });
    }, 1000);

    this.entryTimeout = setTimeout(async () => {
      await this.triggerAlarm(sensor, stateId, "entry_delay_elapsed");
    }, delaySec * 1000);
  }

  private async triggerAlarm(
    sensor: SmarthomeAlarmConfig["sensors"][number],
    stateId: string,
    reason: string,
  ): Promise<void> {
    const config = this.config as SmarthomeAlarmConfig;
    await this.clearEntryTimers();
    await this.setStateAsync("timers.entryRemaining", { val: 0, ack: true });

    if (config.preAlarmSec && config.preAlarmSec > 0) {
      await this.startPreAlarm(sensor, reason);
      return;
    }

    await this.startFullAlarm(sensor, reason);
  }

  private async startPreAlarm(
    sensor: SmarthomeAlarmConfig["sensors"][number],
    reason: string,
  ): Promise<void> {
    const config = this.config as SmarthomeAlarmConfig;
    await this.clearPreAlarmTimer();
    await this.setControlMode("alarm_pre");
    await this.updateLastEvent(reason, sensor, "alarm_pre");
    await this.emitEvent({
      type: "alarm_pre_started",
      mode: "alarm_pre",
      severity: "warning",
      sensorId: sensor.stateId,
      sensorName: sensor.name,
      message: `Pre-alarm started (${sensor.name || sensor.stateId})`,
    });

    const delaySec = Math.max(0, config.preAlarmSec || 0);
    this.preAlarmTimeout = setTimeout(async () => {
      await this.startFullAlarm(sensor, "alarm_pre_elapsed");
    }, delaySec * 1000);
  }

  private async startFullAlarm(
    sensor: SmarthomeAlarmConfig["sensors"][number],
    reason: string,
  ): Promise<void> {
    const config = this.config as SmarthomeAlarmConfig;
    await this.clearPreAlarmTimer();
    await this.clearAlarmDurationTimer();
    await this.setControlMode("alarm_full");
    await this.setStateAsync("alarm.active", { val: true, ack: true });
    await this.setStateAsync("alarm.outputsActive", { val: true, ack: true });
    await this.updateLastEvent(reason, sensor, "alarm_full");
    await this.emitEvent({
      type: "alarm_full_started",
      mode: "alarm_full",
      severity: "alarm",
      sensorId: sensor.stateId,
      sensorName: sensor.name,
      message: `Full alarm started (${sensor.name || sensor.stateId})`,
    });

    const durationSec = Math.max(0, config.alarmDurationSec || 0);
    if (durationSec > 0) {
      this.alarmDurationTimeout = setTimeout(async () => {
        await this.setStateAsync("alarm.outputsActive", { val: false, ack: true });
      }, durationSec * 1000);
    }
  }

  private async handleSilentEvent(
    sensor: SmarthomeAlarmConfig["sensors"][number],
  ): Promise<void> {
    const mode = await this.getControlMode();
    await this.updateLastEvent("silent_trigger", sensor);
    await this.emitEvent({
      type: "silent_event",
      mode,
      severity: "info",
      sensorId: sensor.stateId,
      sensorName: sensor.name,
      message: `Silent event (${sensor.name || sensor.stateId})`,
    });
    await this.setStateAsync("alarm.silentEvent", { val: true, ack: true });
    await this.clearSilentEventTimer();
    this.silentEventTimeout = setTimeout(async () => {
      await this.setStateAsync("alarm.silentEvent", { val: false, ack: true });
    }, 10_000);
  }

  private async updateLastEvent(
    reason: string,
    sensor?: SmarthomeAlarmConfig["sensors"][number],
    mode?: ControlMode,
  ): Promise<void> {
    const triggerSensor = sensor?.name || sensor?.stateId || "";
    const timestamp = new Date().toISOString();
    await this.setStateAsync("last.triggerSensor", { val: triggerSensor, ack: true });
    await this.setStateAsync("last.triggerTime", { val: timestamp, ack: true });
    const reasonParts = [reason];
    if (mode) {
      reasonParts.push(mode);
    }
    await this.setStateAsync("last.reason", { val: reasonParts.join(":"), ack: true });
  }

  private async addTroubleSensor(sensorId: string): Promise<void> {
    if (!this.troubleSensors.has(sensorId)) {
      this.troubleSensors.add(sensorId);
      await this.updateTroubleStates();
      await this.emitEvent({
        type: "trouble_added",
        severity: "warning",
        sensorId,
        sensorName: this.getSensorName(sensorId),
        message: `Trouble detected (${this.getSensorName(sensorId)})`,
      });
    }
  }

  private async removeTroubleSensor(sensorId: string): Promise<void> {
    if (this.troubleSensors.delete(sensorId)) {
      await this.updateTroubleStates();
      await this.emitEvent({
        type: "trouble_removed",
        severity: "info",
        sensorId,
        sensorName: this.getSensorName(sensorId),
        message: `Trouble cleared (${this.getSensorName(sensorId)})`,
      });
    }
  }

  private async updateTroubleStates(): Promise<void> {
    await this.setStateAsync("trouble.list", {
      val: JSON.stringify(Array.from(this.troubleSensors)),
      ack: true,
    });
    await this.setStateAsync("trouble.active", { val: this.troubleSensors.size > 0, ack: true });
  }

  private async setControlMode(mode: ControlMode): Promise<void> {
    await this.setStateAsync("control.mode", { val: mode, ack: true });
    await this.updateOutputsForMode(mode);
  }

  private async updateOutputsForMode(mode: ControlMode): Promise<void> {
    const outputs = (this.config as SmarthomeAlarmConfig).outputs ?? [];
    await this.stopBeepPattern();
    this.lastOutputValues.clear();

    for (const output of outputs) {
      if (!output.stateId) {
        continue;
      }
      const activeValue = output.value ?? true;
      const isBeepOutput = output.activeIn?.includes("beep");
      if ((mode === "entry_delay" || mode === "arming") && isBeepOutput) {
        await this.setOutputValue(output.stateId, activeValue);
        continue;
      }

      const isActive = output.activeIn?.includes(mode);
      const targetValue = isActive ? activeValue : !activeValue;
      await this.setOutputValue(output.stateId, targetValue);
    }

    await this.updateOutputsStatus();

    const beepOutputs = outputs.filter((output) => output.stateId && output.activeIn?.includes("beep"));
    if ((mode === "entry_delay" || mode === "arming") && beepOutputs.length > 0) {
      await this.startBeepPattern(beepOutputs);
    }
  }

  private async setOutputValue(stateId: string, value: boolean): Promise<void> {
    await this.setForeignStateAsync(stateId, { val: value, ack: true });
    this.lastOutputValues.set(stateId, value);
  }

  private async updateOutputsStatus(): Promise<void> {
    await this.setStateAsync("outputs.status", {
      val: JSON.stringify(Object.fromEntries(this.lastOutputValues)),
      ack: true,
    });
  }

  private async startBeepPattern(outputs: OutputConfig[]): Promise<void> {
    if (outputs.length === 0) {
      return;
    }
    this.beepState = true;
    await this.applyBeepPattern(outputs);
    this.beepInterval = setInterval(() => {
      this.beepState = !this.beepState;
      void this.applyBeepPattern(outputs);
    }, 1000);
  }

  private async applyBeepPattern(outputs: OutputConfig[]): Promise<void> {
    for (const output of outputs) {
      if (!output?.stateId) {
        continue;
      }
      const activeValue = output.value ?? true;
      const targetValue = this.beepState ? activeValue : !activeValue;
      await this.setOutputValue(output.stateId, targetValue);
    }
    await this.updateOutputsStatus();
  }

  private async stopBeepPattern(): Promise<void> {
    if (this.beepInterval) {
      clearInterval(this.beepInterval);
      this.beepInterval = null;
    }
  }

  private getSensorName(sensorId: string): string {
    return this.sensorsByStateId.get(sensorId)?.name || sensorId;
  }

  private async emitEvent(event: {
    type: string;
    mode?: ControlMode;
    sensorId?: string;
    sensorName?: string;
    severity: EventSeverity;
    message: string;
  }): Promise<void> {
    const timestamp = new Date().toISOString();
    const resolvedMode = event.mode ?? await this.getControlMode();
    const payload = {
      type: event.type,
      mode: resolvedMode,
      sensorId: event.sensorId ?? null,
      sensorName: event.sensorName ?? null,
      time: timestamp,
      severity: event.severity,
      message: event.message,
    };

    const counterState = await this.getStateAsync("events.counter");
    const currentCounter = typeof counterState?.val === "number" ? counterState.val : 0;
    await this.setStateAsync("events.last", { val: JSON.stringify(payload), ack: true });
    await this.setStateAsync("events.counter", { val: currentCounter + 1, ack: true });
  }

  private onUnload(callback: () => void): void {
    this.clearExitTimers()
      .then(() => this.clearEntryTimers())
      .then(() => this.clearPreAlarmTimer())
      .then(() => this.clearAlarmDurationTimer())
      .then(() => this.clearSilentEventTimer())
      .then(() => this.stopBeepPattern())
      .then(() => callback())
      .catch(() => callback());
  }
}

if (module.parent) {
  module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new SmarthomeAlarm(options);
} else {
  (() => new SmarthomeAlarm())();
}
