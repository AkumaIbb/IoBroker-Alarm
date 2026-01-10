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

    await this.subscribeStatesAsync("control.*");

    if (config.exitDelaySec < 0) {
      this.log.warn("exitDelaySec is negative; forcing to 0");
    }
  }

  private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
    if (!state || state.ack) {
      return;
    }

    const localId = id.replace(`${this.namespace}.`, "");

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
    await this.clearExitTimers();
    await this.setStateAsync("timers.exitRemaining", { val: 0, ack: true });
    await this.setStateAsync("control.mode", { val: targetMode, ack: true });
  }

  private async handleDisarm(): Promise<void> {
    await this.clearExitTimers();
    await this.setStateAsync("control.mode", { val: "disarmed", ack: true });
    await this.setStateAsync("timers.exitRemaining", { val: 0, ack: true });
    await this.setStateAsync("alarm.active", { val: false, ack: true });
    await this.setStateAsync("alarm.silenced", { val: false, ack: true });
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
