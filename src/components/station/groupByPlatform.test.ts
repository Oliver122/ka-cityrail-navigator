import { describe, expect, it } from "vitest";
import type { Departure } from "../../types";
import { groupByPlatform } from "./groupByPlatform";

function dep(platform: string, line = "S1"): Departure {
  return {
    stop_name: "Test",
    stop_id: "1",
    direction: "City",
    line,
    line_type: "s",
    mot_type: "1",
    platform,
    planned_time: "12:00",
    real_time: "12:00",
    delay_minutes: 0,
    countdown: 5,
    trip_code: "",
    realtime_trip_id: "",
    avms_trip_id: "",
    line_stateless: "",
    service_date: "",
    service_time: "",
  };
}

describe("groupByPlatform", () => {
  it("returns empty for empty input", () => {
    expect(groupByPlatform([])).toEqual([]);
  });

  it("keeps one platform as one group", () => {
    const result = groupByPlatform([dep("1"), dep("1", "S2")]);
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe("1");
    expect(result[0][1]).toHaveLength(2);
  });

  it("buckets blank platforms together", () => {
    const result = groupByPlatform([dep(""), dep("  "), dep("3")]);
    const blank = result.find(([p]) => p === "");
    expect(blank?.[1]).toHaveLength(2);
  });

  it("sorts platforms numerically", () => {
    const keys = groupByPlatform([dep("10"), dep("2"), dep("1")]).map(([p]) => p);
    expect(keys).toEqual(["1", "2", "10"]);
  });
});
