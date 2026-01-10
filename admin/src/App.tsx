import React from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Checkbox,
  FormControlLabel,
  Grid,
  Paper,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  GenericApp,
  I18n,
  Utils,
  DialogSelectID,
  type GenericAppProps,
  type GenericAppState,
} from '@iobroker/adapter-react-v5';
import SensorsTable from './components/SensorsTable';
import type { NativeConfig, SensorConfig } from './types';

type AppState = GenericAppState & {
  activeTab: number;
  sensorErrors: string[];
  selectDialogIndex: number | null;
  isSaveDisabled: boolean;
};

const roleOptions = ['perimeter', 'entry', 'interior', '24h'] as const;
const policyOptions = ['instant', 'entryDelay', 'silent'] as const;

class App extends GenericApp<GenericAppProps, AppState> {
  constructor(props: GenericAppProps) {
    super(props, {
      adapterName: 'smarthome-alarm',
    });

    this.state = {
      ...this.state,
      activeTab: 0,
      sensorErrors: [],
      selectDialogIndex: null,
      isSaveDisabled: false,
    };
  }

  componentDidUpdate(prevProps: GenericAppProps, prevState: AppState): void {
    if (this.state.loaded && !prevState.loaded) {
      const native = this.getNative();
      if (native) {
        this.updateValidation(native);
      }
    }
  }

  private getNative(): NativeConfig | null {
    if (!this.state.native) {
      return null;
    }

    return this.state.native as NativeConfig;
  }

  private updateNativeValue<K extends keyof NativeConfig>(key: K, value: NativeConfig[K]): void {
    const native = this.getNative();
    if (!native) {
      return;
    }

    const nextNative = {
      ...native,
      [key]: value,
    };

    this.setState({ native: nextNative, changed: true }, () => this.updateValidation(nextNative));
  }

  private updateSensor(index: number, patch: Partial<SensorConfig>): void {
    const native = this.getNative();
    if (!native) {
      return;
    }

    const sensors = native.sensors ? [...native.sensors] : [];
    const nextSensor = {
      ...sensors[index],
      ...patch,
    };
    sensors[index] = nextSensor;

    this.updateNativeValue('sensors', sensors);

    if (patch.stateId) {
      void this.applyAutoName(index, patch.stateId);
    }
  }

  private addSensor(afterIndex?: number): void {
    const native = this.getNative();
    if (!native) {
      return;
    }

    const sensors = native.sensors ? [...native.sensors] : [];
    const newSensor: SensorConfig = {
      stateId: '',
      name: '',
      role: 'perimeter',
      invert: false,
      triggerValue: true,
      policy: 'instant',
      bypass: false,
      debounceMs: undefined,
    };

    if (afterIndex === undefined || afterIndex === null || afterIndex < 0) {
      sensors.push(newSensor);
    } else {
      sensors.splice(afterIndex + 1, 0, newSensor);
    }

    this.updateNativeValue('sensors', sensors);
  }

  private deleteSensor(index: number): void {
    const native = this.getNative();
    if (!native) {
      return;
    }

    const sensors = native.sensors ? [...native.sensors] : [];
    sensors.splice(index, 1);
    this.updateNativeValue('sensors', sensors);
  }

  private duplicateSensor(index: number): void {
    const native = this.getNative();
    if (!native) {
      return;
    }

    const sensors = native.sensors ? [...native.sensors] : [];
    const copy = Utils.clone(sensors[index]);
    sensors.splice(index + 1, 0, copy);
    this.updateNativeValue('sensors', sensors);
  }

  private updateValidation(native: NativeConfig): void {
    const errors = this.getSensorErrors(native.sensors || []);
    const hasErrors = errors.some(Boolean);
    const errorsChanged = errors.join('|') !== this.state.sensorErrors.join('|');
    if (errorsChanged || this.state.isSaveDisabled !== hasErrors) {
      this.setState({ sensorErrors: errors, isSaveDisabled: hasErrors });
    }
  }

  private getSensorErrors(sensors: SensorConfig[]): string[] {
    const trimmedIds = sensors.map((sensor) => sensor.stateId.trim());
    const counts = new Map<string, number>();
    trimmedIds.forEach((id) => {
      if (!id) {
        return;
      }
      counts.set(id, (counts.get(id) ?? 0) + 1);
    });

    return sensors.map((sensor) => {
      const trimmed = sensor.stateId.trim();
      if (!trimmed) {
        return I18n.t('State ID is required');
      }
      if ((counts.get(trimmed) ?? 0) > 1) {
        return I18n.t('Duplicate State ID');
      }
      return '';
    });
  }

  private async applyAutoName(index: number, stateId: string): Promise<void> {
    const native = this.getNative();
    if (!native) {
      return;
    }

    const sensors = native.sensors ? [...native.sensors] : [];
    const sensor = sensors[index];
    if (!sensor || sensor.name) {
      return;
    }

    if (!this.socket?.getObject) {
      return;
    }

    try {
      const obj = await this.socket.getObject(stateId);
      const name = Utils.getObjectName(obj, I18n.getLanguage());
      if (name) {
        sensors[index] = {
          ...sensor,
          name,
        };
        this.updateNativeValue('sensors', sensors);
      }
    } catch {
      // ignore
    }
  }

  private handleSelectStateId(index: number, stateId: string): void {
    this.updateSensor(index, { stateId });
    void this.applyAutoName(index, stateId);
  }

  private renderGlobalTab(native: NativeConfig): React.ReactNode {
    return (
      <Box sx={{ p: 2 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              type="number"
              label={I18n.t('Exit delay (sec)')}
              value={native.exitDelaySec}
              inputProps={{ min: 0, max: 600 }}
              onChange={(e) => this.updateNativeValue('exitDelaySec', Number(e.target.value))}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              type="number"
              label={I18n.t('Entry delay (sec)')}
              value={native.entryDelaySec}
              inputProps={{ min: 0, max: 600 }}
              onChange={(e) => this.updateNativeValue('entryDelaySec', Number(e.target.value))}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              type="number"
              label={I18n.t('Chirp duration (sec)')}
              value={native.chirpSec}
              inputProps={{ min: 0, max: 60 }}
              onChange={(e) => this.updateNativeValue('chirpSec', Number(e.target.value))}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              type="number"
              label={I18n.t('Pre-alarm (sec)')}
              value={native.preAlarmSec}
              inputProps={{ min: 0, max: 120 }}
              onChange={(e) => this.updateNativeValue('preAlarmSec', Number(e.target.value))}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              type="number"
              label={I18n.t('Alarm duration (sec)')}
              value={native.alarmDurationSec}
              inputProps={{ min: 0, max: 3600 }}
              onChange={(e) => this.updateNativeValue('alarmDurationSec', Number(e.target.value))}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              type="number"
              label={I18n.t('Default debounce (ms)')}
              value={native.debounceMsDefault}
              inputProps={{ min: 0, max: 5000 }}
              onChange={(e) => this.updateNativeValue('debounceMsDefault', Number(e.target.value))}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={native.blockArmingIfOpen}
                  onChange={(e) => this.updateNativeValue('blockArmingIfOpen', e.target.checked)}
                />
              }
              label={I18n.t('Block arming if open')}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={native.autoBypassOpenOnArming}
                  onChange={(e) => this.updateNativeValue('autoBypassOpenOnArming', e.target.checked)}
                />
              }
              label={I18n.t('Auto-bypass open sensors on arming')}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={native.useBaselineSnapshot}
                  onChange={(e) => this.updateNativeValue('useBaselineSnapshot', e.target.checked)}
                />
              }
              label={I18n.t('Use baseline snapshot')}
            />
          </Grid>
        </Grid>

        <Box sx={{ mt: 3 }}>
          <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography>{I18n.t('Help & behavior')}</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography variant="body2" paragraph>
                {I18n.t(
                  'Exit/Entry delays define the grace period when arming or entering. Pre-alarm is an intermediate warning before the full alarm, and alarm duration controls how long the full alarm stays active.'
                )}
              </Typography>
              <Typography variant="body2" paragraph>
                {I18n.t(
                  'Baseline snapshot tolerates sensors that are already open when arming (e.g. tilted windows) by treating them as the reference state.'
                )}
              </Typography>
              <Typography variant="body2">
                {I18n.t(
                  'Block arming stops arming when any sensor is open. Auto-bypass allows arming but automatically bypasses currently open sensors.'
                )}
              </Typography>
            </AccordionDetails>
          </Accordion>
        </Box>
      </Box>
    );
  }

  private renderSensorsTab(native: NativeConfig): React.ReactNode {
    return (
      <Box sx={{ p: 2 }}>
        <SensorsTable
          sensors={native.sensors || []}
          errors={this.state.sensorErrors}
          roleOptions={roleOptions}
          policyOptions={policyOptions}
          onAdd={(index) => this.addSensor(index)}
          onDelete={(index) => this.deleteSensor(index)}
          onDuplicate={(index) => this.duplicateSensor(index)}
          onOpenSelect={(index) => this.setState({ selectDialogIndex: index })}
          onUpdateSensor={(index, patch) => this.updateSensor(index, patch)}
        />
      </Box>
    );
  }

  render(): React.ReactNode {
    if (!this.state.loaded) {
      return <div style={{ padding: 16 }}>{I18n.t('Loading...')}</div>;
    }

    const native = this.getNative();
    if (!native) {
      return <div style={{ padding: 16 }}>{I18n.t('No config available')}</div>;
    }

    const DialogSelectIDAny = DialogSelectID as unknown as React.ComponentType<any>;

    return (
      <Paper sx={{ m: 2 }}>
        <Tabs
          value={this.state.activeTab}
          onChange={(_, value) => this.setState({ activeTab: value })}
          indicatorColor="primary"
          textColor="primary"
        >
          <Tab label={I18n.t('Global')} />
          <Tab label={I18n.t('Sensors')} />
        </Tabs>
        {this.state.activeTab === 0 && this.renderGlobalTab(native)}
        {this.state.activeTab === 1 && this.renderSensorsTab(native)}

        <DialogSelectIDAny
          key={this.state.selectDialogIndex ?? 'dialog'}
          socket={this.socket}
          theme={this.state.theme}
          title={I18n.t('Select state')}
          open={this.state.selectDialogIndex !== null}
          selected={
            this.state.selectDialogIndex !== null
              ? native.sensors[this.state.selectDialogIndex]?.stateId
              : ''
          }
          showAllObjects={false}
          types={['state']}
          onClose={() => this.setState({ selectDialogIndex: null })}
          onSelect={(stateId: string) => {
            if (this.state.selectDialogIndex === null) {
              return;
            }
            this.handleSelectStateId(this.state.selectDialogIndex, stateId);
            this.setState({ selectDialogIndex: null });
          }}
        />
      </Paper>
    );
  }
}

export default App;
