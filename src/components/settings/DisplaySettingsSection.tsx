import { SettingsIcon } from "../Icons";
import {
  STATION_VIEWER_KINDS,
  type StationViewerKind,
} from "../../stationViewerKind";

const VIEWER_LABELS: Record<StationViewerKind, string> = {
  table: "Table",
  compact: "Compact",
  board: "Board",
};

type Props = {
  nearbyLimit: string;
  timeWindow: string;
  stationViewerKind: StationViewerKind;
  saved: boolean;
  onNearbyLimitChange: (value: string) => void;
  onTimeWindowChange: (value: string) => void;
  onStationViewerKindChange: (value: StationViewerKind) => void;
  onNearbyLimitBlur: () => void;
  onTimeWindowBlur: () => void;
  onSave: () => void;
};

export default function DisplaySettingsSection({
  nearbyLimit,
  timeWindow,
  stationViewerKind,
  saved,
  onNearbyLimitChange,
  onTimeWindowChange,
  onStationViewerKindChange,
  onNearbyLimitBlur,
  onTimeWindowBlur,
  onSave,
}: Props) {
  return (
    <section className="config-section">
      <div className="section-header">
        <SettingsIcon className="section-icon" />
        <h2>Display Settings</h2>
      </div>
      <p className="section-hint">
        Control how many stops and departures are shown, and the departure list layout.
      </p>

      <div className="coords-form">
        <div className="coord-input-group">
          <label>Nearby Stops (1–20)</label>
          <input
            type="number"
            inputMode="numeric"
            min="1"
            max="20"
            value={nearbyLimit}
            onChange={(e) => onNearbyLimitChange(e.currentTarget.value)}
            onBlur={onNearbyLimitBlur}
          />
        </div>
        <div className="coord-input-group">
          <label>Time Window (15–180 min)</label>
          <input
            type="number"
            inputMode="numeric"
            min="15"
            max="180"
            value={timeWindow}
            onChange={(e) => onTimeWindowChange(e.currentTarget.value)}
            onBlur={onTimeWindowBlur}
          />
        </div>
        <div className="coord-input-group">
          <label>Station Viewer</label>
          <select
            value={stationViewerKind}
            onChange={(e) =>
              onStationViewerKindChange(e.currentTarget.value as StationViewerKind)
            }
          >
            {STATION_VIEWER_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {VIEWER_LABELS[kind]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <button className={`primary-button${saved ? " success" : ""}`} onClick={onSave}>
        {saved ? "✓ Saved" : "Update Settings"}
      </button>
    </section>
  );
}
