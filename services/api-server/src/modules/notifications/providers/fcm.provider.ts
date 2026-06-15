import { SignJWT, importPKCS8 } from "jose";
import { z } from "zod";
import type {
  FcmSendResult,
  NotificationQueueMessage,
} from "../types/notification.types";

const FirebaseServiceAccount = z.object({
  project_id: z.string().min(1),
  client_email: z.string().email(),
  private_key: z.string().min(1),
  token_uri: z.string().url().default("https://oauth2.googleapis.com/token"),
});
type FirebaseServiceAccount = z.infer<typeof FirebaseServiceAccount>;

const GoogleAccessTokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  token_type: z.string(),
});

type CachedAccessToken = {
  token: string;
  expiresAtMs: number;
};

interface FcmErrorBody {
  error?: {
    status?: string;
    message?: string;
    details?: Array<{
      "@type"?: string;
      errorCode?: string;
    }>;
  };
}

export class FcmProvider {
  private readonly serviceAccount: FirebaseServiceAccount;
  private cachedAccessToken: CachedAccessToken | null = null;

  constructor(serviceAccountJsonBase64: string) {
    this.serviceAccount = FirebaseServiceAccount.parse(
      JSON.parse(decodeBase64Utf8(serviceAccountJsonBase64)),
    );
  }

  async send(params: {
    token: string;
    event: NotificationQueueMessage;
  }): Promise<FcmSendResult> {
    const accessToken = await this.getAccessToken();
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${this.serviceAccount.project_id}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: params.token,
            notification: {
              title: params.event.title,
              body: params.event.body,
            },
            data: {
              notification_id: params.event.id,
              notification_type: params.event.payload.type,
              payload: JSON.stringify(params.event.payload),
            },
            apns: {
              payload: {
                aps: {
                  sound: "default",
                },
              },
            },
          },
        }),
      },
    );

    if (response.ok) {
      return { ok: true };
    }

    const errorBody = await parseFcmErrorBody(response);
    const message = errorBody.error?.message ?? "FCM send failed";
    if (isTerminalTokenError(errorBody)) {
      return {
        ok: false,
        error: {
          code: "TERMINAL_TOKEN",
          message,
          status: response.status,
        },
      };
    }

    return {
      ok: false,
      error: {
        code: "TRANSIENT",
        message,
        status: response.status,
      },
    };
  }

  private async getAccessToken(): Promise<string> {
    const nowMs = Date.now();
    if (this.cachedAccessToken && this.cachedAccessToken.expiresAtMs - 60_000 > nowMs) {
      return this.cachedAccessToken.token;
    }

    const assertion = await this.createJwtAssertion();
    const response = await fetch(this.serviceAccount.token_uri, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });

    if (!response.ok) {
      throw new Error(`Google OAuth token exchange failed: ${response.status}`);
    }

    const parsed = GoogleAccessTokenResponse.parse(await response.json());
    this.cachedAccessToken = {
      token: parsed.access_token,
      expiresAtMs: nowMs + parsed.expires_in * 1000,
    };
    return parsed.access_token;
  }

  private async createJwtAssertion(): Promise<string> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const privateKey = await importPKCS8(this.serviceAccount.private_key, "RS256");
    return await new SignJWT({
      scope: "https://www.googleapis.com/auth/firebase.messaging",
    })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(this.serviceAccount.client_email)
      .setSubject(this.serviceAccount.client_email)
      .setAudience(this.serviceAccount.token_uri)
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + 3600)
      .sign(privateKey);
  }
}

async function parseFcmErrorBody(response: Response): Promise<FcmErrorBody> {
  try {
    return await response.json() as FcmErrorBody;
  } catch {
    return {};
  }
}

function isTerminalTokenError(body: FcmErrorBody): boolean {
  const fcmErrorCodes = new Set(
    body.error?.details
      ?.filter((detail) => detail["@type"] === "type.googleapis.com/google.firebase.fcm.v1.FcmError")
      .map((detail) => detail.errorCode) ?? [],
  );

  return fcmErrorCodes.has("UNREGISTERED") ||
    fcmErrorCodes.has("INVALID_ARGUMENT") ||
    fcmErrorCodes.has("SENDER_ID_MISMATCH");
}

function decodeBase64Utf8(value: string): string {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}
