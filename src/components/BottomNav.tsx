import { TrainIcon, SettingsIcon } from "./Icons";
import type { AppPage } from "../types";
import "./BottomNav.css";

interface Props {
  currentPage: AppPage;
  onNavigate: (page: AppPage) => void;
}

export default function BottomNav({ currentPage, onNavigate }: Props) {
  return (
    <nav className="bottom-nav">
      <button
        className={`nav-item${currentPage === "departures" || currentPage === "details" ? " active" : ""}`}
        onClick={() => onNavigate("departures")}
      >
        <TrainIcon />
        <span>Departures</span>
      </button>
      <button
        className={`nav-item${currentPage === "settings" ? " active" : ""}`}
        onClick={() => onNavigate("settings")}
      >
        <SettingsIcon />
        <span>Settings</span>
      </button>
    </nav>
  );
}
