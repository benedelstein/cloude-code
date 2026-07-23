import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import proxy from "@/proxy";

describe("web proxy public routes", () => {
  it("allows the privacy policy while signed out", async () => {
    const response = await proxy(new NextRequest("https://www.mymachines.dev/privacy"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects a protected route while signed out", async () => {
    const response = await proxy(new NextRequest("https://www.mymachines.dev/settings"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://www.mymachines.dev/");
  });
});
