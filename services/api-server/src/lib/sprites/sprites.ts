import { z } from "zod";
import { Session, SpritesClient } from "@fly/sprites";

// =============================================================================
// Zod Schemas
// =============================================================================

export const SpriteStatus = z.enum(["cold", "warm", "running"]);
export type SpriteStatus = z.infer<typeof SpriteStatus>;

export const SpriteResponse = z.object({
  id: z.string().optional(),
  name: z.string(),
  status: z.enum(["cold", "warm", "running"]).optional(),
  url: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type SpriteResponse = z.infer<typeof SpriteResponse>;

export const CreateSpriteRequest = z.object({
  name: z.string(),
  config: z
    .object({
      ramMB: z.number().optional(),
      cpus: z.number().optional(),
      storageGB: z.number().optional(),
    })
    .optional(),
  image: z.string().optional(),
  env: z.record(z.string()).optional(),
});
export type CreateSpriteRequest = z.infer<typeof CreateSpriteRequest>;

// =============================================================================
// SpritesCoordinator - Wraps @fly/sprites for sprite lifecycle management
// Uses HTTP-based operations (create/delete/get) which work in Workers
// =============================================================================

export interface SpritesClientConfig {
  apiKey: string;
  timeout?: number;
}

export class SpritesCoordinator {
  private spritesClient: SpritesClient;

  constructor(config: SpritesClientConfig) {
    this.spritesClient = new SpritesClient(config.apiKey, {
      timeout: config.timeout,
    });
  }

  async createSprite(request: CreateSpriteRequest): Promise<SpriteResponse> {
    const config = request.config
      ? {
          ramMB: request.config.ramMB,
          cpus: request.config.cpus,
          storageGB: request.config.storageGB,
        }
      : undefined;
    const d0 = Date.now();
    const sprite = await this.spritesClient.createSprite(request.name, config);
    console.log(
      `created sprite ${sprite.name} ${sprite.id} in ${Date.now() - d0}ms`
    );
    return SpriteResponse.parse({
      id: sprite.id,
      name: sprite.name,
      status: sprite.status,
      createdAt: sprite.createdAt?.toISOString(),
      updatedAt: sprite.updatedAt?.toISOString(),
    });
  }

  async getSprite(name: string): Promise<SpriteResponse> {
    const sprite = await this.spritesClient.getSprite(name);
    return SpriteResponse.parse({
      id: sprite.id,
      name: sprite.name,
      status: sprite.status,
      url: "",
      createdAt: sprite.createdAt,
      updatedAt: sprite.updatedAt,
    });
  }

  async deleteSprite(name: string): Promise<void> {
    await this.spritesClient.deleteSprite(name);
  }

  async listSessions(name: string): Promise<Array<Session>> {
    const sessions = await this.spritesClient.sprite(name).listSessions();
    return sessions;
  }
}