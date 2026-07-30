import { describe, expect, it } from "vitest";
import * as lib from "./index";

describe("app component lib barrel", () => {
  it("exports Phase-1 public components", () => {
    expect(lib.LoadingScreen).toBeTypeOf("function");
    expect(lib.AppHeader).toBeTypeOf("function");
    expect(lib.SearchBar).toBeTypeOf("function");
    expect(lib.ErrorBanner).toBeTypeOf("function");
    expect(lib.ManualModeBanner).toBeTypeOf("function");
    expect(lib.StationCard).toBeTypeOf("function");
    expect(lib.StationDeparturesTable).toBeTypeOf("function");
    expect(lib.StationDeparturesCompact).toBeTypeOf("function");
    expect(lib.StationDeparturesBoard).toBeTypeOf("function");
    expect(lib.getStationViewer).toBeTypeOf("function");
    expect(lib.NetworkStatusCard).toBeTypeOf("function");
    expect(lib.ProximityMapCard).toBeTypeOf("function");
    expect(lib.groupByPlatform).toBeTypeOf("function");
    expect(lib.RouteTimeline).toBeTypeOf("function");
    expect(lib.DetailsHeader).toBeTypeOf("function");
    expect(lib.RouteInfoCard).toBeTypeOf("function");
    expect(lib.DisruptionBanner).toBeTypeOf("function");
    expect(lib.ManualCoordsSection).toBeTypeOf("function");
    expect(lib.DisplaySettingsSection).toBeTypeOf("function");
    expect(lib.SavedTerminalsSection).toBeTypeOf("function");
    expect(lib.KnownNetworksSection).toBeTypeOf("function");
    expect(lib.FactoryResetSection).toBeTypeOf("function");
    expect(lib.BottomNav).toBeTypeOf("function");
    expect(lib.LineBadge).toBeTypeOf("function");
    expect(lib.ProximityMap).toBeTypeOf("function");
    expect(lib.RouteMap).toBeTypeOf("function");
  });
});
