import { beforeEach, describe, expect, it, vi } from "vitest";
import { SpritesCoordinator } from "../../src/shared/integrations/sprites/sprites";

const mocks = vi.hoisted(() => ({
  constructorArgs: [] as unknown[][],
  createSprite: vi.fn(),
  getSprite: vi.fn(),
  deleteSprite: vi.fn(),
  listSessions: vi.fn(),
  sprite: vi.fn(),
}));

vi.mock("@fly/sprites", () => ({
  SpritesClient: class {
    constructor(...args: unknown[]) {
      mocks.constructorArgs.push(args);
    }

    createSprite = mocks.createSprite;
    getSprite = mocks.getSprite;
    deleteSprite = mocks.deleteSprite;
    sprite = mocks.sprite;
  },
}));

describe("SpritesCoordinator", () => {
  beforeEach(() => {
    mocks.constructorArgs.length = 0;
    mocks.createSprite.mockReset();
    mocks.getSprite.mockReset();
    mocks.deleteSprite.mockReset();
    mocks.listSessions.mockReset();
    mocks.sprite.mockReset();
  });

  it("passes the API key and timeout to the SDK client", () => {
    new SpritesCoordinator({ apiKey: "sprites-key", timeout: 5000 });

    expect(mocks.constructorArgs).toEqual([
      ["sprites-key", { timeout: 5000 }],
    ]);
  });

  it("creates a sprite with mapped config and returns a validated response", async () => {
    mocks.createSprite.mockResolvedValue({
      id: "sprite-id",
      name: "sprite-1",
      status: "cold",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    const coordinator = new SpritesCoordinator({ apiKey: "sprites-key" });

    const result = await coordinator.createSprite({
      name: "sprite-1",
      config: { ramMB: 1024, cpus: 2, storageGB: 10 },
    });

    expect(mocks.createSprite).toHaveBeenCalledWith("sprite-1", {
      ramMB: 1024,
      cpus: 2,
      storageGB: 10,
    });
    expect(result).toEqual({
      id: "sprite-id",
      name: "sprite-1",
      status: "cold",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("creates a sprite without config when none is provided", async () => {
    mocks.createSprite.mockResolvedValue({ name: "sprite-1" });
    const coordinator = new SpritesCoordinator({ apiKey: "sprites-key" });

    const result = await coordinator.createSprite({ name: "sprite-1" });

    expect(mocks.createSprite).toHaveBeenCalledWith("sprite-1", undefined);
    expect(result).toEqual({ name: "sprite-1" });
  });

  it("rejects a create response that fails validation", async () => {
    mocks.createSprite.mockResolvedValue({
      name: "sprite-1",
      status: "exploded",
    });
    const coordinator = new SpritesCoordinator({ apiKey: "sprites-key" });

    await expect(
      coordinator.createSprite({ name: "sprite-1" }),
    ).rejects.toThrow();
  });

  it("gets a sprite and maps it to a response", async () => {
    mocks.getSprite.mockResolvedValue({
      id: "sprite-id",
      name: "sprite-1",
      status: "running",
    });
    const coordinator = new SpritesCoordinator({ apiKey: "sprites-key" });

    const result = await coordinator.getSprite("sprite-1");

    expect(mocks.getSprite).toHaveBeenCalledWith("sprite-1");
    expect(result).toEqual({
      id: "sprite-id",
      name: "sprite-1",
      status: "running",
      url: "",
    });
  });

  it("deletes a sprite by name", async () => {
    mocks.deleteSprite.mockResolvedValue(undefined);
    const coordinator = new SpritesCoordinator({ apiKey: "sprites-key" });

    await coordinator.deleteSprite("sprite-1");

    expect(mocks.deleteSprite).toHaveBeenCalledWith("sprite-1");
  });

  it("lists sessions through the per-sprite SDK client", async () => {
    const sessions = [{ id: 1 }, { id: 2 }];
    mocks.listSessions.mockResolvedValue(sessions);
    mocks.sprite.mockReturnValue({ listSessions: mocks.listSessions });
    const coordinator = new SpritesCoordinator({ apiKey: "sprites-key" });

    const result = await coordinator.listSessions("sprite-1");

    expect(mocks.sprite).toHaveBeenCalledWith("sprite-1");
    expect(result).toEqual(sessions);
  });
});
