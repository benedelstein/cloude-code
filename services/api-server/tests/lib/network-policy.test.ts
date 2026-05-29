import { describe, expect, it } from "vitest";
import {
  buildBootstrapNetworkPolicy,
  buildFinalNetworkPolicy,
  getProviderNetworkPolicyRules,
} from "../../src/shared/integrations/sprites/network-policy";

describe("Sprite network policies", () => {
  it("builds bootstrap policy from default policy plus worker host", () => {
    const policy = buildBootstrapNetworkPolicy({ workerHostname: "worker.test" });

    expect(policy).toContainEqual({ domain: "worker.test", action: "allow" });
    expect(policy.at(-1)).toEqual({ domain: "*", action: "deny" });
    expect(policy).toContainEqual({ domain: "github.com", action: "allow" });
  });

  it("uses default policy plus extras for default_plus_extras", () => {
    const policy = buildFinalNetworkPolicy({
      workerHostname: "worker.test",
      providerId: "openai-codex",
      network: {
        mode: "default_plus_extras",
        extraAllowlist: ["api.stripe.com"],
      },
    });

    expect(policy).toContainEqual({ domain: "worker.test", action: "allow" });
    expect(policy).toContainEqual({ domain: "api.stripe.com", action: "allow" });
    expect(policy).toContainEqual({ domain: "github.com", action: "allow" });
    expect(policy.at(-1)).toEqual({ domain: "*", action: "deny" });
  });

  it("locks final policy to worker and provider hosts", () => {
    const policy = buildFinalNetworkPolicy({
      workerHostname: "worker.test",
      providerId: "claude-code",
      network: { mode: "locked" },
    });

    expect(policy).toContainEqual({ domain: "worker.test", action: "allow" });
    expect(policy).toContainEqual({ domain: "api.anthropic.com", action: "allow" });
    expect(policy).not.toContainEqual({ domain: "github.com", action: "allow" });
    expect(policy.at(-1)).toEqual({ domain: "*", action: "deny" });
  });

  it("allows all outbound for open mode", () => {
    expect(buildFinalNetworkPolicy({
      workerHostname: "worker.test",
      providerId: "openai-codex",
      network: { mode: "open" },
    })).toEqual([{ domain: "*", action: "allow" }]);
  });

  it("selects OpenAI Codex provider hosts", () => {
    expect(getProviderNetworkPolicyRules("openai-codex")).toContainEqual({
      domain: "api.openai.com",
      action: "allow",
    });
  });
});
