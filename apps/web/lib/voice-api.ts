import "client-only";

import {
  VoiceTranscriptionResponse,
  type VoiceTranscriptionResponse as VoiceTranscriptionResponseType,
} from "@repo/shared";
import {
  ApiError,
  createVoiceTranscriptionToken,
  WS_API_URL,
} from "@/lib/client-api";

type ApiErrorResponse = {
  error?: string;
  details?: string;
  code?: string;
};

async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  let message = `Request failed: ${response.status}`;
  let code: string | undefined;
  let details: string | undefined;

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await response.json() as ApiErrorResponse;
    message = body.error ?? body.details ?? message;
    code = body.code;
    details = body.details;
  } else {
    const text = await response.text();
    message = text || message;
  }

  return new ApiError(message, response.status, code, details);
}

export async function uploadVoiceForTranscription(
  file: File,
): Promise<VoiceTranscriptionResponseType> {
  const { token, maxBytes } = await createVoiceTranscriptionToken();
  if (file.size > maxBytes) {
    throw new ApiError("Recording is too large to transcribe.", 413);
  }

  const formData = new FormData();
  formData.append("audio", file, file.name);

  const response = await fetch(`${WS_API_URL}/voice/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!response.ok) {
    throw await apiErrorFromResponse(response);
  }

  return VoiceTranscriptionResponse.parse(await response.json());
}
