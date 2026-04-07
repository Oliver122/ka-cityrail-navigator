import { describe, expect, it } from "vitest";
import { resolveActiveNetwork, resolveConnectionType, shouldUseManualLocation } from "./runtimeFallback";

describe("runtimeFallback", () => {
  it("prefers detected network when available", () => {
    const active = resolveActiveNetwork(false, { ssid: "HomeWiFi", label: "Home" }, "ManualSSID");
    expect(active).toEqual({ ssid: "HomeWiFi", label: "Home" });
  });

  it("uses manual network profile on unsupported detection platforms", () => {
    const active = resolveActiveNetwork(false, null, "OfficeWiFi");
    expect(active).toEqual({ ssid: "OfficeWiFi", label: "OfficeWiFi (manual)" });
  });

  it("stays offline if no detected or manual network exists", () => {
    const active = resolveActiveNetwork(false, null, null);
    expect(active).toBeNull();
  });

  it("keeps detected ethernet connection type", () => {
    expect(resolveConnectionType(true, { name: "LAN", conn_type: "ethernet" })).toBe("ethernet");
  });

  it("falls back to wifi icon when detection unavailable and no connection info", () => {
    expect(resolveConnectionType(false, null)).toBe("wifi");
  });

  it("switches to manual mode when permission denied", () => {
    expect(shouldUseManualLocation(false, false)).toBe(true);
  });

  it("switches to manual mode when gps fails despite granted permission", () => {
    expect(shouldUseManualLocation(true, false)).toBe(true);
  });

  it("keeps gps mode when permission granted and gps succeeds", () => {
    expect(shouldUseManualLocation(true, true)).toBe(false);
  });
});
