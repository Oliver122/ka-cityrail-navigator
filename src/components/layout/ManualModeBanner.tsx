import { LocationIcon } from "../Icons";
import "./ManualModeBanner.css";

type Props = {
  onChangeLocation: () => void;
};

export default function ManualModeBanner({ onChangeLocation }: Props) {
  return (
    <div className="manual-mode-banner">
      <LocationIcon />
      <span>Using manual location</span>
      <button type="button" onClick={onChangeLocation}>
        Change
      </button>
    </div>
  );
}
