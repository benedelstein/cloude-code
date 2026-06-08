"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceTranscriptionResponse } from "@repo/shared";
import {
  deleteLatestVoiceDraft,
  loadLatestVoiceDraft,
  saveLatestVoiceDraft,
  type VoiceDraft,
} from "@/lib/voice-drafts";
import { uploadVoiceForTranscription } from "@/lib/voice-api";

export const MAX_VOICE_RECORDING_MS = 5 * 60 * 1000;
export const TARGET_VOICE_AUDIO_BITS_PER_SECOND = 96_000;
export const MAX_VOICE_AUDIO_BYTES = 10 * 1024 * 1024;
export const VOICE_SIGNAL_BAR_COUNT = 220;
const VOICE_SIGNAL_SAMPLE_INTERVAL_MS = 16;
const VOICE_SIGNAL_SAMPLE_COUNT = 512;
const MIN_VOICE_SIGNAL_LEVEL = 0.08;

const SUPPORTED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/wav",
];

export type VoiceInputState =
  | { status: "idle"; elapsedMs: 0; levels: number[] }
  | { status: "requesting-permission"; elapsedMs: 0; levels: number[] }
  | { status: "recording"; elapsedMs: number; levels: number[] }
  | { status: "finalizing"; elapsedMs: number; levels: number[] }
  | { status: "transcribing"; elapsedMs: number; levels: number[] }
  | { status: "error"; elapsedMs: number; levels: number[]; message: string; canRetry: boolean };

type FinalizeAction = "insert" | "send";

type UseVoiceInputOptions = {
  onInsertTranscript: (text: string) => void;
  onSendTranscript: (text: string) => void;
  uploadVoice?: (file: File) => Promise<VoiceTranscriptionResponse>;
};

export type UseVoiceInputResult = {
  state: VoiceInputState;
  isSupported: boolean;
  isActive: boolean;
  startRecording: () => Promise<void>;
  stopAndInsert: () => Promise<void>;
  stopAndSend: () => Promise<void>;
  retryInsert: () => Promise<void>;
  retrySend: () => Promise<void>;
  retryLast: () => Promise<void>;
  discardDraft: () => Promise<void>;
};

const EMPTY_LEVELS = Array.from({ length: VOICE_SIGNAL_BAR_COUNT }, () => 0.15);

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Voice transcription failed.";
}

function isVoiceRecordingSupported(): boolean {
  return typeof navigator !== "undefined"
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof MediaRecorder !== "undefined";
}

function selectSupportedVoiceMimeType(): string {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }

  return SUPPORTED_MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? "";
}

function createVoiceFile(draft: VoiceDraft): File {
  return new File([draft.blob], draft.fileName, {
    type: draft.mimeType || draft.blob.type || "audio/webm",
  });
}

function buildVoiceDraft(blob: Blob, durationMs: number): VoiceDraft {
  return {
    id: crypto.randomUUID(),
    blob,
    fileName: "voice-message.webm",
    mimeType: blob.type || "audio/webm",
    durationMs,
    createdAt: new Date().toISOString(),
  };
}

function stopRecorder(recorder: MediaRecorder, chunks: Blob[]): Promise<Blob> {
  return new Promise((resolve) => {
    recorder.addEventListener("stop", () => {
      resolve(new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || "audio/webm" }));
    }, { once: true });

    if (recorder.state !== "inactive") {
      recorder.requestData();
      recorder.stop();
    }
  });
}

export function useVoiceInput({
  onInsertTranscript,
  onSendTranscript,
  uploadVoice = uploadVoiceForTranscription,
}: UseVoiceInputOptions): UseVoiceInputResult {
  const [state, setState] = useState<VoiceInputState>({
    status: "idle",
    elapsedMs: 0,
    levels: EMPTY_LEVELS,
  });
  const [isSupported, setIsSupported] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const elapsedMsRef = useRef(0);
  const levelsRef = useRef<number[]>(EMPTY_LEVELS);
  const draftRef = useRef<VoiceDraft | null>(null);
  const maxTimerRef = useRef<number | null>(null);
  const elapsedTimerRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const isFinalizingRef = useRef(false);
  const lastActionRef = useRef<FinalizeAction>("insert");

  useEffect(() => {
    setIsSupported(isVoiceRecordingSupported());
  }, []);

  const clearTimers = useCallback(() => {
    if (maxTimerRef.current !== null) {
      window.clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
    if (elapsedTimerRef.current !== null) {
      window.clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const stopMedia = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
  }, []);

  const cleanupRecording = useCallback(() => {
    clearTimers();
    stopMedia();
    recorderRef.current = null;
    chunksRef.current = [];
    isFinalizingRef.current = false;
  }, [clearTimers, stopMedia]);

  const transcribeDraft = useCallback(async (draft: VoiceDraft, action: FinalizeAction) => {
    lastActionRef.current = action;
    const file = createVoiceFile(draft);
    if (file.size > MAX_VOICE_AUDIO_BYTES) {
      draftRef.current = draft;
      setState({
        status: "error",
        elapsedMs: draft.durationMs,
        levels: levelsRef.current,
        message: "Recording is too large to transcribe.",
        canRetry: true,
      });
      return;
    }

    setState({
      status: "transcribing",
      elapsedMs: draft.durationMs,
      levels: levelsRef.current,
    });

    try {
      const result = await uploadVoice(file);
      const text = result.text.trim();
      if (!text) {
        draftRef.current = null;
        await deleteLatestVoiceDraft().catch(() => undefined);
        setState({ status: "idle", elapsedMs: 0, levels: EMPTY_LEVELS });
        return;
      }

      if (action === "send") {
        onSendTranscript(text);
      } else {
        onInsertTranscript(text);
      }

      draftRef.current = null;
      await deleteLatestVoiceDraft().catch(() => undefined);
      setState({ status: "idle", elapsedMs: 0, levels: EMPTY_LEVELS });
    } catch (error) {
      draftRef.current = draft;
      setState({
        status: "error",
        elapsedMs: draft.durationMs,
        levels: levelsRef.current,
        message: getErrorMessage(error),
        canRetry: true,
      });
    }
  }, [onInsertTranscript, onSendTranscript, uploadVoice]);

  const finalizeRecording = useCallback(async (
    action: FinalizeAction,
    _reason: "manual" | "send" | "max-duration",
  ) => {
    if (isFinalizingRef.current) {
      return;
    }

    const recorder = recorderRef.current;
    if (!recorder) {
      return;
    }

    isFinalizingRef.current = true;
    clearTimers();
    const durationMs = Math.max(0, Date.now() - startedAtRef.current);
    setState({
      status: "finalizing",
      elapsedMs: durationMs,
      levels: levelsRef.current,
    });

    const blob = await stopRecorder(recorder, chunksRef.current);
    cleanupRecording();

    const draft = buildVoiceDraft(blob, durationMs);
    draftRef.current = draft;
    await saveLatestVoiceDraft(draft).catch(() => undefined);
    await transcribeDraft(draft, action);
  }, [cleanupRecording, clearTimers, transcribeDraft]);

  const startWaveform = useCallback((stream: MediaStream) => {
    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = VOICE_SIGNAL_SAMPLE_COUNT;
    source.connect(analyser);
    void audioContext.resume().catch(() => undefined);

    const samples = new Uint8Array(VOICE_SIGNAL_SAMPLE_COUNT);
    let lastSampleAt = 0;
    const updateLevels = () => {
      const now = performance.now();
      if (now - lastSampleAt >= VOICE_SIGNAL_SAMPLE_INTERVAL_MS) {
        lastSampleAt = now;
        analyser.getByteTimeDomainData(samples);
        let sumSquares = 0;
        for (let index = 0; index < samples.length; index += 1) {
          const centeredSample = ((samples[index] ?? 128) - 128) / 128;
          sumSquares += centeredSample * centeredSample;
        }
        const amplitude = Math.sqrt(sumSquares / samples.length);
        const nextLevel = Math.max(MIN_VOICE_SIGNAL_LEVEL, Math.min(1, amplitude * 5));
        const levels = [...levelsRef.current.slice(1), nextLevel];
        levelsRef.current = levels;
        const elapsedMs = Math.max(0, Date.now() - startedAtRef.current);
        elapsedMsRef.current = elapsedMs;
        setState({ status: "recording", elapsedMs, levels });
      }
      animationFrameRef.current = window.requestAnimationFrame(updateLevels);
    };

    animationFrameRef.current = window.requestAnimationFrame(updateLevels);
  }, []);

  const startRecording = useCallback(async () => {
    if (!isVoiceRecordingSupported()) {
      setState({
        status: "error",
        elapsedMs: 0,
        levels: EMPTY_LEVELS,
        message: "Voice recording is not supported in this browser.",
        canRetry: false,
      });
      return;
    }

    if (state.status !== "idle" && state.status !== "error") {
      return;
    }

    setState({ status: "requesting-permission", elapsedMs: 0, levels: EMPTY_LEVELS });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });

      const mimeType = selectSupportedVoiceMimeType();
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: TARGET_VOICE_AUDIO_BITS_PER_SECOND,
      });

      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      startedAtRef.current = Date.now();
      elapsedMsRef.current = 0;
      levelsRef.current = EMPTY_LEVELS;
      draftRef.current = null;

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      });

      recorder.start(1000);
      setState({ status: "recording", elapsedMs: 0, levels: EMPTY_LEVELS });
      startWaveform(stream);
      elapsedTimerRef.current = window.setInterval(() => {
        const elapsedMs = Math.max(0, Date.now() - startedAtRef.current);
        elapsedMsRef.current = elapsedMs;
        setState({ status: "recording", elapsedMs, levels: levelsRef.current });
      }, 250);
      maxTimerRef.current = window.setTimeout(() => {
        void finalizeRecording("insert", "max-duration");
      }, MAX_VOICE_RECORDING_MS);
    } catch (error) {
      cleanupRecording();
      setState({
        status: "error",
        elapsedMs: 0,
        levels: EMPTY_LEVELS,
        message: getErrorMessage(error),
        canRetry: false,
      });
    }
  }, [cleanupRecording, finalizeRecording, startWaveform, state.status]);

  const retry = useCallback(async (action: FinalizeAction) => {
    const draft = draftRef.current ?? await loadLatestVoiceDraft().catch(() => null);
    if (!draft) {
      setState({
        status: "error",
        elapsedMs: 0,
        levels: EMPTY_LEVELS,
        message: "Voice draft is unavailable.",
        canRetry: false,
      });
      return;
    }

    draftRef.current = draft;
    await transcribeDraft(draft, action);
  }, [transcribeDraft]);

  const discardDraft = useCallback(async () => {
    cleanupRecording();
    draftRef.current = null;
    await deleteLatestVoiceDraft().catch(() => undefined);
    setState({ status: "idle", elapsedMs: 0, levels: EMPTY_LEVELS });
  }, [cleanupRecording]);

  useEffect(() => {
    return () => {
      cleanupRecording();
    };
  }, [cleanupRecording]);

  return {
    state,
    isSupported,
    isActive: state.status !== "idle",
    startRecording,
    stopAndInsert: () => finalizeRecording("insert", "manual"),
    stopAndSend: () => finalizeRecording("send", "send"),
    retryInsert: () => retry("insert"),
    retrySend: () => retry("send"),
    retryLast: () => retry(lastActionRef.current),
    discardDraft,
  };
}
