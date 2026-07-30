import { describe, expect, it } from "vitest";
import { withTimeout } from "./async";

describe("withTimeout", () => {
  it("resolves when promise finishes before timeout", async () => {
    const value = await withTimeout(Promise.resolve(42), 1000, "fast");
    expect(value).toBe(42);
  });

  it("rejects with label when promise is too slow", async () => {
    const slow = new Promise<number>((resolve) => {
      setTimeout(() => resolve(1), 200);
    });
    await expect(withTimeout(slow, 20, "Route loading")).rejects.toThrow(
      "Route loading: timed out after 20ms",
    );
  });
});
