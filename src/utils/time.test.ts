import { describe, expect, it } from "vitest";
import { formatCountdown, kvDateTimeToDisplay } from "./time";

describe("formatCountdown", () => {
  it("shows now when countdown is zero or less", () => {
    expect(formatCountdown(0, "14:30")).toEqual({ text: "now", className: "eta-now" });
  });

  it("shows minutes when within display window", () => {
    expect(formatCountdown(5, "14:30")).toEqual({ text: "5 min", className: "eta-soon" });
  });

  it("shows real time when beyond display window", () => {
    expect(formatCountdown(21, "14:30")).toEqual({ text: "14:30", className: "eta-later" });
  });
});

describe("kvDateTimeToDisplay", () => {
  it("extracts HH:MM from datetime string", () => {
    expect(kvDateTimeToDisplay("2024-01-01 14:30:00")).toBe("14:30");
  });

  it("returns empty string for bad input", () => {
    expect(kvDateTimeToDisplay("nope")).toBe("");
  });
});
