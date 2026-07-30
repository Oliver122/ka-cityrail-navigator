import { describe, expect, it } from "vitest";
import { getStationViewer, STATION_VIEWERS } from "./getStationViewer";
import StationDeparturesTable from "./StationDeparturesTable";
import {
  DEFAULT_STATION_VIEWER_KIND,
  normalizeStationViewerKind,
} from "./StationViewerTypes";

describe("getStationViewer", () => {
  it("returns a component for every kind", () => {
    expect(getStationViewer("table")).toBe(STATION_VIEWERS.table);
    expect(getStationViewer("compact")).toBe(STATION_VIEWERS.compact);
    expect(getStationViewer("board")).toBe(STATION_VIEWERS.board);
  });

  it("falls back to table for unknown values", () => {
    expect(getStationViewer("nope" as never)).toBe(StationDeparturesTable);
    expect(getStationViewer(undefined)).toBe(StationDeparturesTable);
    expect(getStationViewer(null)).toBe(StationDeparturesTable);
  });

  it("default kind is table", () => {
    expect(DEFAULT_STATION_VIEWER_KIND).toBe("table");
    expect(normalizeStationViewerKind("weird")).toBe("table");
  });
});
