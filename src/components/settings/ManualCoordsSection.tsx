import { LocationIcon } from "../Icons";

type Props = {
  lat: string;
  lon: string;
  saved: boolean;
  onLatChange: (value: string) => void;
  onLonChange: (value: string) => void;
  onSave: () => void;
};

export default function ManualCoordsSection({
  lat,
  lon,
  saved,
  onLatChange,
  onLonChange,
  onSave,
}: Props) {
  return (
    <section className="config-section">
      <div className="section-header">
        <LocationIcon className="section-icon" />
        <h2>Manual Coordinates</h2>
      </div>
      <p className="section-hint">Used when GPS is unavailable or denied.</p>

      <div className="coords-form">
        <div className="coord-input-group">
          <label>Latitude</label>
          <input
            type="number"
            step="any"
            value={lat}
            onChange={(e) => onLatChange(e.currentTarget.value)}
            placeholder="49.0090"
          />
        </div>
        <div className="coord-input-group">
          <label>Longitude</label>
          <input
            type="number"
            step="any"
            value={lon}
            onChange={(e) => onLonChange(e.currentTarget.value)}
            placeholder="8.4040"
          />
        </div>
      </div>
      <button className={`primary-button${saved ? " success" : ""}`} onClick={onSave}>
        {saved ? "✓ Saved" : "Update Location"}
      </button>
    </section>
  );
}
