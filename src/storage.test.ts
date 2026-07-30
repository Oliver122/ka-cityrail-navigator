import { beforeEach, describe, expect, it } from "vitest";
import {
  loadDisplaySettings,
  loadManualCoords,
  loadStarred,
  saveDisplaySettings,
} from "./storage";

describe("storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns empty starred list for corrupt JSON", () => {
    localStorage.setItem("ka_starred_stops", "{not-json");
    expect(loadStarred()).toEqual([]);
  });

  it("returns default coords when missing", () => {
    expect(loadManualCoords()).toEqual({ lat: 49.009, lon: 8.404 });
  });

  it("merges display settings with defaults including table viewer", () => {
    localStorage.setItem("ka_display_settings", JSON.stringify({ nearbyStopsLimit: 3 }));
    expect(loadDisplaySettings()).toEqual({
      nearbyStopsLimit: 3,
      timeWindowMinutes: 60,
      stationViewerKind: "table",
    });
  });

  it("loads compact station viewer kind", () => {
    localStorage.setItem(
      "ka_display_settings",
      JSON.stringify({ stationViewerKind: "compact" }),
    );
    expect(loadDisplaySettings().stationViewerKind).toBe("compact");
  });

  it("falls back weird station viewer kind to table", () => {
    localStorage.setItem(
      "ka_display_settings",
      JSON.stringify({ stationViewerKind: "weird" }),
    );
    expect(loadDisplaySettings().stationViewerKind).toBe("table");
  });

  it("round-trips station viewer kind via save/load", () => {
    saveDisplaySettings({
      nearbyStopsLimit: 5,
      timeWindowMinutes: 45,
      stationViewerKind: "board",
    });
    expect(loadDisplaySettings()).toEqual({
      nearbyStopsLimit: 5,
      timeWindowMinutes: 45,
      stationViewerKind: "board",
    });
  });
});
