import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReadPart } from "@/components/parts/read-part";

describe("ReadPart", () => {
  it("renders read contents when expanded", () => {
    render(React.createElement(ReadPart, {
      action: {
        paths: ["/home/sprite/workspace/repo/MEMORY.md"],
        lineRange: { start: 1, end: 147 },
        content: "remember this\nsecond line",
      },
    }));

    fireEvent.click(screen.getByRole("button", { name: /Read MEMORY\.md/i }));

    expect(screen.getByText("(L1-147)")).toBeTruthy();
    expect(screen.getByText(/remember this/)).toBeTruthy();
    expect(screen.getByText(/second line/)).toBeTruthy();
  });
});
