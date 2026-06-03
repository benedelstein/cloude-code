import {
  CreateSessionRequest,
  CreateSessionResponse,
  type CreateSessionRequest as CreateSessionRequestType,
  type CreateSessionResponse as CreateSessionResponseType,
} from "@repo/shared";
import { trimTrailingSlash } from "./env";

interface CloudeApiClientConfig {
  apiUrl: string;
  apiToken: string;
  fetcher?: typeof fetch;
}

export class CloudeApiClient {
  private readonly apiUrl: string;
  private readonly apiToken: string;
  private readonly fetcher: typeof fetch;

  constructor(config: CloudeApiClientConfig) {
    this.apiUrl = trimTrailingSlash(config.apiUrl);
    this.apiToken = config.apiToken;
    this.fetcher = config.fetcher ?? fetch;
  }

  /**
   * Creates a Cloude Code session through the API server.
   * @param request - Session creation payload accepted by `POST /sessions`.
   * @returns Created session metadata from the API server.
   */
  async createSession(
    request: CreateSessionRequestType,
  ): Promise<CreateSessionResponseType> {
    const body = CreateSessionRequest.parse(request);
    const response = await this.fetcher(`${this.apiUrl}/sessions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const responseText = await response.text();
    const parsedJson = parseJson(responseText);

    if (!response.ok) {
      throw new CloudeApiError(
        response.status,
        readErrorMessage(parsedJson) ?? "Failed to create session",
      );
    }

    return CreateSessionResponse.parse(parsedJson);
  }
}

export class CloudeApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "CloudeApiError";
    this.status = status;
  }
}

function parseJson(text: string): unknown {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (_error) {
    return null;
  }
}

function readErrorMessage(value: unknown): string | null {
  if (
    typeof value === "object"
    && value !== null
    && "error" in value
    && typeof value.error === "string"
  ) {
    return value.error;
  }
  return null;
}
