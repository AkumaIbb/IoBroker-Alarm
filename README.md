# IoBroker-Alarm

## Deutsch

### Installation

1. Adapter installieren:

   ```bash
   npm i https://github.com/AkumaIbb/IoBroker-Alarm/tarball/main
   ```

2. Dateien in ioBroker hochladen:

   ```bash
   iobroker upload smarthome-alarm
   ```

3. Adapterinstanz anlegen:

   ```bash
   iobroker add smarthome-alarm
   ```

### Beschreibung

IoBroker-Alarm ist eine flexible Alarmanlage mit frei konfigurierbaren Sensoren und Ausgängen. Sie unterstützt zwei Schutzmodi:

- **Vollschutz**: Alle Sensoren werden überwacht.
- **Hüllschutz**: Nur Hüllschutz-Sensoren werden überwacht.

Eingangssensoren lösen eine konfigurierbare Verzögerung aus. Wird die Alarmanlage in diesem Zeitraum nicht deaktiviert, wird der Vollalarm ausgelöst.

Zusätzlich stehen umfangreiche Statusmeldungen sowie eigene Ausgangs-States für individuelle Ankopplungen zur Verfügung.

### Anwendung

- Sensoren müssen in den Einstellungen ausgewählt werden.
- Sensoren erwarten den Zustand **"false" = OK**.
- Der Sensor-Typ ist rein informativ.

#### Richtlinien für Sensor-Typen

- **Hüllschutz / Nachtmodus**: Äußerer Sensor, der bei eingeschaltetem Hüllschutz überwacht werden soll.
- **Eingang**: Sensor, der beim Betreten des Hauses vor der Deaktivierung des Alarms auslöst.
- **Innen**: Sensor, der bei eingeschaltetem Hüllschutz seinen Zustand ändern darf, ohne Alarm auszulösen (z. B. Präsenzmelder im Innenraum).

### Ausgänge

- **Sirene (Lauter Alarm)**: Kann gemutet werden.
- **Licht (Leiser Alarm)**: Immer aktiv.
- **Benachrichtigung**: Immer aktiv und als Hook für eigene Integrationen gedacht.

### Objektstruktur

- Der Status der Sensoren wird beim Scharfschalten hier gespeichert:
  - `smarthome-alarm.0.arming`
- Die Alarmanlage wird über die Elemente in `smarthome-alarm.0.control` gesteuert.
- `smarthome-alarm.0.events` zeigt das letzte Event an.
- `smarthome-alarm.0.last` liefert zusätzliche Details, z. B. welcher Sensor ausgelöst hat.
- `smarthome-alarm.0.outputs` enthält Trigger-Punkte für eigene Automationen (z. B. Benachrichtigung beim Scharfschalten).
- `smarthome-alarm.0.trouble` wird derzeit nicht verwendet.

## English

### Installation

1. Install the adapter:

   ```bash
   npm i https://github.com/AkumaIbb/IoBroker-Alarm/tarball/main
   ```

2. Upload files to ioBroker:

   ```bash
   iobroker upload smarthome-alarm
   ```

3. Create the adapter instance:

   ```bash
   iobroker add smarthome-alarm
   ```

### Description

IoBroker-Alarm is a flexible alarm system with configurable sensors and outputs. It supports two protection modes:

- **Full protection**: All sensors are monitored.
- **Perimeter protection**: Only perimeter sensors are monitored.

Entry sensors trigger a configurable delay. If the alarm system is not disarmed within this time window, a full alarm is triggered.

It also provides extensive status messages and dedicated output states for custom integrations.

### Usage

- Sensors must be selected in the settings.
- Sensors expect **"false" = OK**.
- The sensor type is informational only.

#### Guidelines for sensor types

- **Perimeter / Night mode**: Outer sensor that should be monitored when perimeter mode is active.
- **Entry**: Sensor that triggers when entering the house before the alarm is disarmed.
- **Interior**: Sensor that may change state while perimeter mode is active without raising an alarm (e.g., motion sensor indoors).

### Outputs

- **Siren (loud alarm)**: Can be muted.
- **Light (quiet alarm)**: Always active.
- **Notification**: Always active and intended as a hook for custom integrations.

### Object structure

- The sensor status is stored on arming here:
  - `smarthome-alarm.0.arming`
- The alarm system is controlled via elements in `smarthome-alarm.0.control`.
- `smarthome-alarm.0.events` shows the last event.
- `smarthome-alarm.0.last` provides additional details, e.g., which sensor triggered.
- `smarthome-alarm.0.outputs` provides trigger points for custom automations (e.g., notification when arming).
- `smarthome-alarm.0.trouble` is currently unused.
