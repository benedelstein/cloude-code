import { vi } from "vitest";

vi.mock("agents", () => ({
  Agent: class {},
  getAgentByName: vi.fn(),
}));
