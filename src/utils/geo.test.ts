import { describe, expect, it } from "vitest";
import { formatDist, haversineKm } from "./geo";

describe("formatDist", () => {
  it("formats under 1 km as meters", () => {
    expect(formatDist(0.5)).toBe("500m");
  });

  it("formats 1.2 km with one decimal", () => {
    expect(formatDist(1.2)).toBe("1.2km");
  });
});

describe("haversineKm", () => {
  it("returns a finite positive distance for nearby points", () => {
    const d = haversineKm(49.009, 8.404, 49.01, 8.405);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThan(0);
  });
});
