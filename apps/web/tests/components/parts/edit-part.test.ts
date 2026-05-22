import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EditPart } from "@/components/parts/edit-part";

describe("EditPart", () => {
  it("renders inline diff stats in the summary", () => {
    render(React.createElement(EditPart, {
      action: {
        path: "/repo/schema.ts",
        diff: "@@ -1,2 +1,3 @@\n old\n-removed\n+added\n+another",
      },
    }));

    expect(screen.getByRole("button", { name: /Edited schema\.ts \+2 -1/i })).toBeTruthy();
  });
});
