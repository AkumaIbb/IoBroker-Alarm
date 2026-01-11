import React from 'react';
import {
  Box,
  Checkbox,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import { I18n } from '@iobroker/adapter-react-v5';
import type { SensorConfig, SensorGuideline, SensorType } from '../types';

interface SensorsTableProps {
  sensors: SensorConfig[];
  errors: string[];
  sensorTypeOptions: readonly SensorType[];
  guidelineOptions: readonly SensorGuideline[];
  onAdd: (index?: number) => void;
  onDelete: (index: number) => void;
  onDuplicate: (index: number) => void;
  onOpenSelect: (index: number) => void;
  onUpdateSensor: (index: number, patch: Partial<SensorConfig>) => void;
}

const SensorsTable: React.FC<SensorsTableProps> = ({
  sensors,
  errors,
  sensorTypeOptions,
  guidelineOptions,
  onAdd,
  onDelete,
  onDuplicate,
  onOpenSelect,
  onUpdateSensor,
}) => {
  if (!sensors.length) {
    return (
      <Box sx={{ textAlign: 'center', py: 4 }}>
        <Typography variant="body1" sx={{ mb: 1 }}>
          {I18n.t('No sensors configured yet')}
        </Typography>
        <IconButton color="primary" onClick={() => onAdd()}>
          <AddIcon />
        </IconButton>
      </Box>
    );
  }

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{I18n.t('Name')}</TableCell>
            <TableCell>{I18n.t('State ID')}</TableCell>
            <TableCell>{I18n.t('Sensor Type')}</TableCell>
            <TableCell>{I18n.t('Guideline')}</TableCell>
            <TableCell>{I18n.t('Debounce override (ms)')}</TableCell>
            <TableCell>{I18n.t('Invert')}</TableCell>
            <TableCell align="right">
              <IconButton color="primary" onClick={() => onAdd()}>
                <AddIcon />
              </IconButton>
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sensors.map((sensor, index) => {
            const error = errors[index];
            return (
              <TableRow key={`sensor-${index}`}>
                <TableCell sx={{ minWidth: 160 }}>
                  <TextField
                    fullWidth
                    size="small"
                    value={sensor.name}
                    onChange={(e) => onUpdateSensor(index, { name: e.target.value })}
                  />
                </TableCell>
                <TableCell sx={{ minWidth: 240 }}>
                  <Tooltip title={error || ''} disableHoverListener={!error}>
                    <TextField
                      fullWidth
                      size="small"
                      value={sensor.id}
                      error={Boolean(error)}
                      placeholder="hm-rpc.0..."
                      onChange={(e) => onUpdateSensor(index, { id: e.target.value })}
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton edge="end" onClick={() => onOpenSelect(index)}>
                              <SearchIcon />
                            </IconButton>
                          </InputAdornment>
                        ),
                      }}
                    />
                  </Tooltip>
                </TableCell>
                <TableCell sx={{ minWidth: 150 }}>
                  <TextField
                    select
                    fullWidth
                    size="small"
                    value={sensor.type}
                    onChange={(e) => onUpdateSensor(index, { type: e.target.value as SensorType })}
                  >
                    {sensorTypeOptions.map((type) => (
                      <MenuItem key={type} value={type}>
                        {I18n.t(`sensor_type_${type}`)}
                      </MenuItem>
                    ))}
                  </TextField>
                </TableCell>
                <TableCell sx={{ minWidth: 140 }}>
                  <TextField
                    select
                    fullWidth
                    size="small"
                    value={sensor.guideline}
                    onChange={(e) => onUpdateSensor(index, { guideline: e.target.value as SensorGuideline })}
                  >
                    {guidelineOptions.map((guideline) => (
                      <MenuItem key={guideline} value={guideline}>
                        {I18n.t(`guideline_${guideline}`)}
                      </MenuItem>
                    ))}
                  </TextField>
                </TableCell>
                <TableCell sx={{ minWidth: 140 }}>
                  <TextField
                    fullWidth
                    size="small"
                    type="number"
                    value={sensor.debounceMs ?? ''}
                    inputProps={{ min: 0, max: 5000 }}
                    onChange={(e) => {
                      const value = e.target.value;
                      onUpdateSensor(index, {
                        debounceMs: value === '' ? undefined : Number(value),
                      });
                    }}
                  />
                </TableCell>
                <TableCell align="center">
                  <Checkbox
                    checked={sensor.invert}
                    onChange={(e) => onUpdateSensor(index, { invert: e.target.checked })}
                  />
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  <IconButton onClick={() => onAdd(index)}>
                    <AddIcon />
                  </IconButton>
                  <IconButton onClick={() => onDuplicate(index)}>
                    <ContentCopyIcon />
                  </IconButton>
                  <IconButton color="error" onClick={() => onDelete(index)}>
                    <DeleteIcon />
                  </IconButton>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default SensorsTable;
