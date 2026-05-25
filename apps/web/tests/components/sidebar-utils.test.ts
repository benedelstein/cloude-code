import { describe, expect, it } from "vitest";
import { formatCompactRelativeTime } from "@/components/sidebar/utils";

const NOW = new Date("2026-05-24T20:00:00.000Z").getTime();

describe("formatCompactRelativeTime", () => {
  it("formats compact relative timestamps", () => {
    expect(formatCompactRelativeTime("2026-05-24T19:59:55.000Z", NOW)).toBe("5s");
    expect(formatCompactRelativeTime("2026-05-24T19:55:00.000Z", NOW)).toBe("5m");
    expect(formatCompactRelativeTime("2026-05-24T15:00:00.000Z", NOW)).toBe("5h");
    expect(formatCompactRelativeTime("2026-05-19T20:00:00.000Z", NOW)).toBe("5d");
    expect(formatCompactRelativeTime("2026-05-03T20:00:00.000Z", NOW)).toBe("3w");
    expect(formatCompactRelativeTime("2026-03-25T20:00:00.000Z", NOW)).toBe("2mo");
  });

  it("clamps future timestamps to now", () => {
    expect(formatCompactRelativeTime("2026-05-24T20:01:00.000Z", NOW)).toBe("now");
  });

  it("formats current timestamps as now", () => {
    expect(formatCompactRelativeTime("2026-05-24T20:00:00.000Z", NOW)).toBe("now");
  });
});
