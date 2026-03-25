import { describe, expect, it } from "vitest";
import { dedent } from "../../src/utils/dedent";

describe("dedent", () => {
  it("dedents template strings with interpolation", () => {
    const name = "world";
    const result = dedent`
      hello ${name}
      from test
    `;

    expect(result).toBe("hello world\nfrom test");
  });

  it("removes common indentation while preserving relative indentation", () => {
    const result = dedent(`
        root
          child
        sibling
    `);

    expect(result).toBe("root\n  child\nsibling");
  });

  it("trims surrounding blank lines and preserves internal blanks", () => {
    const result = dedent(`
      line1

      line3
    `);

    expect(result).toBe("line1\n\nline3");
  });

  it("normalizes CRLF newlines", () => {
    const result = dedent("\r\n    one\r\n    two\r\n");
    expect(result).toBe("one\ntwo");
  });
});
