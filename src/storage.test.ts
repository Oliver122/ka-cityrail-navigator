import { beforeEach, describe, expect, it } from "vitest";
import {
  loadDisplaySettings,
  loadManualCoords,
  loadStarred,
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

  it("merges display settings with defaults", () => {
    localStorage.setItem("ka_display_settings", JSON.stringify({ nearbyStopsLimit: 3 }));
    expect(loadDisplaySettings()).toEqual({
      nearbyStopsLimit: 3,
      timeWindowMinutes: 60,
    });
  });
});
