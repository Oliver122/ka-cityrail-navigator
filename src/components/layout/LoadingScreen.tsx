import { RefreshIcon } from "../Icons";
import "./LoadingScreen.css";

type Props = {
  message?: string;
};

export default function LoadingScreen({
  message = "Loading nearby stations...",
}: Props) {
  return (
    <div className="loading-screen">
      <div className="loading-logo">
        <span className="logo-text">K2V</span>
        <span className="logo-subtitle">CityRail</span>
      </div>
      <div className="loading-spinner">
        <RefreshIcon />
      </div>
      <p className="loading-text">{message}</p>
    </div>
  );
}
