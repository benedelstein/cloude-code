import { describe, expect, it } from "vitest";
import { failure, success } from "../../src/types/errors";

describe("result helpers", () => {
  it("creates success shape", () => {
    expect(success(123)).toEqual({ ok: true, value: 123 });
  });

  it("creates failure shape", () => {
    expect(failure({ code: "BAD" })).toEqual({ ok: false, error: { code: "BAD" } });
  });

  it("has discriminant ok", () => {
    const yes = success("value");
    const no = failure("error");
    expect(yes.ok).toBe(true);
    expect(no.ok).toBe(false);
  });
});
