import "./NetworkStatusCard.css";

type Props = {
  label: string;
  ssid: string;
  pinnedCount: number;
};

export default function NetworkStatusCard({ label, ssid, pinnedCount }: Props) {
  return (
    <div className="network-status-card">
      <div className="network-status-header">
        <span className="network-status-title">Network Status</span>
        <span className="network-status-live">● Live</span>
      </div>
      <div className="network-status-info">
        <span className="network-name">{label}</span>
        <span className="network-ssid">{ssid}</span>
      </div>
      {pinnedCount > 0 && (
        <div className="network-pinned-count">
          {pinnedCount} pinned station{pinnedCount !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}
