"use client";

import { useCallback, useRef, useState } from "react";
import type { SessionSetupOutputResponse, SetupOutputChunksEvent } from "@repo/shared";
import { getSessionSetupOutput } from "@/lib/client-api";

/** Live setup-script output accumulated from setup.output.chunks events. */
export interface SetupScriptOutputState {
  /** Server-assigned id of the script run the output belongs to. */
  epoch: string;
  stdout: string;
  stderr: string;
}

/**
 * Applies streamed chunks while keeping each accumulated stream an exact
 * prefix of the server-side stream: only contiguous chunks are appended.
 * Chunks past the applied prefix (missed while disconnected or before this
 * client joined) are dropped and reported as a gap so the caller can resync
 * from the fetch endpoint instead of splicing output together incorrectly.
 */
function applySetupOutputChunks(
  previous: SetupScriptOutputState | null,
  event: SetupOutputChunksEvent,
): { state: SetupScriptOutputState; gapDetected: boolean } {
  // A new epoch means the script (re)started; discard prior output.
  let next = previous && previous.epoch === event.epoch
    ? previous
    : { epoch: event.epoch, stdout: "", stderr: "" };
  let gapDetected = false;
  for (const chunk of event.chunks) {
    const current = next[chunk.stream];
    if (chunk.offset > current.length) {
      gapDetected = true;
      continue;
    }
    if (chunk.offset + chunk.data.length <= current.length) {
      // Already applied (e.g. covered by a fetched snapshot).
      continue;
    }
    const data = chunk.data.slice(current.length - chunk.offset);
    next = { ...next, [chunk.stream]: current + data };
  }
  return { state: next, gapDetected };
}

/**
 * Owns live setup-script output for a session: accumulates streamed
 * setup.output.chunks events, merges fetched snapshots, and resyncs from the
 * fetch endpoint whenever streamed chunks leave a gap.
 */
export function useSetupScriptOutput(sessionId: string): {
  setupScriptOutput: SetupScriptOutputState | null;
  hydrateSetupOutput: (snapshot: SessionSetupOutputResponse) => void;
  applySetupOutputEvent: (event: SetupOutputChunksEvent) => void;
} {
  const [setupScriptOutput, setSetupScriptOutput] = useState<SetupScriptOutputState | null>(null);
  // Mirrors setupScriptOutput so event handlers can read/update it
  // synchronously (state updaters are not safe for the gap side effect).
  const outputRef = useRef<SetupScriptOutputState | null>(null);
  const resyncInFlightRef = useRef(false);

  // Merges a fetched setup-output snapshot with chunks already streamed live.
  // Both sides are prefixes of the same stream, so the longer one wins.
  const hydrateSetupOutput = useCallback((snapshot: SessionSetupOutputResponse) => {
    const prev = outputRef.current;
    const next = !prev || prev.epoch !== snapshot.epoch
      ? { epoch: snapshot.epoch, stdout: snapshot.stdout, stderr: snapshot.stderr }
      : {
          epoch: prev.epoch,
          stdout: snapshot.stdout.length >= prev.stdout.length ? snapshot.stdout : prev.stdout,
          stderr: snapshot.stderr.length >= prev.stderr.length ? snapshot.stderr : prev.stderr,
        };
    outputRef.current = next;
    setSetupScriptOutput(next);
  }, []);

  // Fills holes left by missed chunks (mid-run join, WS reconnect) from the
  // fetch endpoint. Gaps re-trigger this until the streams are contiguous.
  const resyncSetupOutput = useCallback(() => {
    if (resyncInFlightRef.current) {
      return;
    }
    resyncInFlightRef.current = true;
    getSessionSetupOutput(sessionId)
      .then((snapshot) => {
        if (snapshot) {
          hydrateSetupOutput(snapshot);
        }
      })
      .catch((error) => console.warn("Failed to resync setup output", error))
      .finally(() => {
        resyncInFlightRef.current = false;
      });
  }, [hydrateSetupOutput, sessionId]);

  const applySetupOutputEvent = useCallback((event: SetupOutputChunksEvent) => {
    const { state, gapDetected } = applySetupOutputChunks(outputRef.current, event);
    outputRef.current = state;
    setSetupScriptOutput(state);
    if (gapDetected) {
      resyncSetupOutput();
    }
  }, [resyncSetupOutput]);

  return { setupScriptOutput, hydrateSetupOutput, applySetupOutputEvent };
}
