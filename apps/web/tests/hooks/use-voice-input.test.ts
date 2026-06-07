import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_VOICE_AUDIO_BYTES,
  MAX_VOICE_RECORDING_MS,
  useVoiceInput,
} from "@/hooks/use-voice-input";

const {
  deleteLatestVoiceDraft,
  loadLatestVoiceDraft,
  saveLatestVoiceDraft,
} = vi.hoisted(() => ({
  deleteLatestVoiceDraft: vi.fn(async () => undefined),
  loadLatestVoiceDraft: vi.fn(async () => null),
  saveLatestVoiceDraft: vi.fn(async () => undefined),
}));

vi.mock("@/lib/voice-drafts", () => ({
  deleteLatestVoiceDraft,
  loadLatestVoiceDraft,
  saveLatestVoiceDraft,
}));

let recordedBlob: Blob;

class FakeMediaRecorder extends EventTarget {
  public static isTypeSupported = vi.fn(() => true);
  public state: RecordingState = "inactive";
  public readonly mimeType: string;

  constructor(
    _stream: MediaStream,
    options?: MediaRecorderOptions,
  ) {
    super();
    this.mimeType = options?.mimeType ?? "audio/webm";
  }

  start(): void {
    this.state = "recording";
  }

  requestData(): void {
    const event = new Event("dataavailable") as Event & { data: Blob };
    Object.defineProperty(event, "data", { value: recordedBlob });
    this.dispatchEvent(event);
  }

  stop(): void {
    this.state = "inactive";
    this.dispatchEvent(new Event("stop"));
  }
}

class FakeAudioContext {
  public createMediaStreamSource(): { connect: () => void } {
    return { connect: vi.fn() };
  }

  public createAnalyser(): AnalyserNode {
    return {
      fftSize: 128,
      frequencyBinCount: 8,
      getByteFrequencyData: (data: Uint8Array) => data.fill(64),
    } as unknown as AnalyserNode;
  }

  public close(): Promise<void> {
    return Promise.resolve();
  }
}

function createMediaStream(): MediaStream {
  return {
    getTracks: () => [{ stop: vi.fn() }],
  } as unknown as MediaStream;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("useVoiceInput", () => {
  beforeEach(() => {
    recordedBlob = new Blob(["voice"], { type: "audio/webm" });
    saveLatestVoiceDraft.mockClear();
    loadLatestVoiceDraft.mockClear();
    deleteLatestVoiceDraft.mockClear();
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(async () => createMediaStream()),
      },
    });
  });

  it("records, transcribes, and inserts transcript on stop", async () => {
    const insertTranscript = vi.fn();
    const sendTranscript = vi.fn();
    const uploadVoice = vi.fn(async () => ({ text: "hello world" }));

    const { result } = renderHook(() => useVoiceInput({
      onInsertTranscript: insertTranscript,
      onSendTranscript: sendTranscript,
      uploadVoice,
    }));

    await act(async () => {
      await result.current.startRecording();
    });
    expect(result.current.state.status).toBe("recording");

    await act(async () => {
      await result.current.stopAndInsert();
      await flushMicrotasks();
    });

    expect(uploadVoice).toHaveBeenCalledWith(expect.any(File));
    expect(insertTranscript).toHaveBeenCalledWith("hello world");
    expect(sendTranscript).not.toHaveBeenCalled();
    expect(saveLatestVoiceDraft).toHaveBeenCalledTimes(1);
    expect(deleteLatestVoiceDraft).toHaveBeenCalledTimes(1);
    expect(result.current.state.status).toBe("idle");
  });

  it("auto-stops at the maximum duration and inserts transcript", async () => {
    vi.useFakeTimers();
    vi.spyOn(window, "setInterval").mockImplementation(
      () => 1 as unknown as ReturnType<typeof window.setInterval>,
    );
    vi.spyOn(window, "clearInterval").mockImplementation(() => undefined);

    const insertTranscript = vi.fn();
    const uploadVoice = vi.fn(async () => ({ text: "timed out safely" }));
    const { result } = renderHook(() => useVoiceInput({
      onInsertTranscript: insertTranscript,
      onSendTranscript: vi.fn(),
      uploadVoice,
    }));

    await act(async () => {
      await result.current.startRecording();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_VOICE_RECORDING_MS);
      await flushMicrotasks();
    });

    expect(insertTranscript).toHaveBeenCalledWith("timed out safely");
    expect(result.current.state.status).toBe("idle");
  });

  it("keeps a retryable draft after upload failure", async () => {
    const insertTranscript = vi.fn();
    const uploadVoice = vi.fn()
      .mockRejectedValueOnce(new Error("network failed"))
      .mockResolvedValueOnce({ text: "retry worked" });

    const { result } = renderHook(() => useVoiceInput({
      onInsertTranscript: insertTranscript,
      onSendTranscript: vi.fn(),
      uploadVoice,
    }));

    await act(async () => {
      await result.current.startRecording();
      await result.current.stopAndInsert();
      await flushMicrotasks();
    });

    expect(result.current.state).toMatchObject({
      status: "error",
      message: "network failed",
      canRetry: true,
    });
    expect(deleteLatestVoiceDraft).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.retryLast();
      await flushMicrotasks();
    });

    expect(insertTranscript).toHaveBeenCalledWith("retry worked");
    expect(deleteLatestVoiceDraft).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized recordings without uploading", async () => {
    recordedBlob = new Blob([new Uint8Array(MAX_VOICE_AUDIO_BYTES + 1)], {
      type: "audio/webm",
    });
    const uploadVoice = vi.fn(async () => ({ text: "should not upload" }));

    const { result } = renderHook(() => useVoiceInput({
      onInsertTranscript: vi.fn(),
      onSendTranscript: vi.fn(),
      uploadVoice,
    }));

    await act(async () => {
      await result.current.startRecording();
      await result.current.stopAndInsert();
      await flushMicrotasks();
    });

    expect(uploadVoice).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({
      status: "error",
      message: "Recording is too large to transcribe.",
      canRetry: true,
    });
    expect(saveLatestVoiceDraft).toHaveBeenCalledTimes(1);
  });
});
