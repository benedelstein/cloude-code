"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { RotateCcw } from "lucide-react";
import { LoadingSpinner } from "@/components/parts/loading-spinner";
import { Button } from "@/components/ui/button";
import { useSessionTerminal } from "@/hooks/use-session-terminal";
import "@xterm/xterm/css/xterm.css";

const RESIZE_DEBOUNCE_MS = 100;

interface SessionTerminalProps {
  sessionId: string;
  /** True once the session's sprite is provisioned and ready. */
  isSessionReady: boolean;
  /** True once the user has activated the Shell tab at least once. */
  isActivated: boolean;
}

/** Reads an xterm theme from the app CSS variables so the terminal follows the app palette. */
function readTerminalTheme(): { background: string; foreground: string; cursor: string } {
  const styles = getComputedStyle(document.documentElement);
  const background = styles.getPropertyValue("--background-secondary").trim();
  const foreground = styles.getPropertyValue("--foreground").trim();
  return { background, foreground, cursor: foreground };
}

export default function SessionTerminal({
  sessionId,
  isSessionReady,
  isActivated,
}: SessionTerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeTimeoutRef = useRef<number | null>(null);
  const [isTerminalReady, setIsTerminalReady] = useState(false);

  const getDimensions = useCallback(() => {
    const terminal = terminalRef.current;
    return terminal ? { cols: terminal.cols, rows: terminal.rows } : null;
  }, []);

  const onData = useCallback((data: Uint8Array) => {
    terminalRef.current?.write(data);
  }, []);

  const { status, exitCode, sendInput, sendResize, reconnect } = useSessionTerminal({
    sessionId,
    enabled: isActivated && isSessionReady && isTerminalReady,
    getDimensions,
    onData,
  });

  const sendInputRef = useRef(sendInput);
  const sendResizeRef = useRef(sendResize);
  useEffect(() => {
    sendInputRef.current = sendInput;
    sendResizeRef.current = sendResize;
  }, [sendInput, sendResize]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: "var(--font-mono, ui-monospace, monospace)",
      theme: readTerminalTheme(),
      scrollback: 5000,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    fitAddon.fit();
    terminal.onData((data) => sendInputRef.current(data));

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    setIsTerminalReady(true);

    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimeoutRef.current !== null) {
        window.clearTimeout(resizeTimeoutRef.current);
      }
      resizeTimeoutRef.current = window.setTimeout(() => {
        const activeTerminal = terminalRef.current;
        const activeFitAddon = fitAddonRef.current;
        // Fitting while hidden (display:none tab) collapses dimensions; skip.
        if (!activeTerminal || !activeFitAddon || container.clientWidth === 0) {
          return;
        }
        activeFitAddon.fit();
        sendResizeRef.current(activeTerminal.cols, activeTerminal.rows);
      }, RESIZE_DEBOUNCE_MS);
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      if (resizeTimeoutRef.current !== null) {
        window.clearTimeout(resizeTimeoutRef.current);
      }
      terminalRef.current = null;
      fitAddonRef.current = null;
      terminal.dispose();
    };
  }, []);

  const showOverlay = !isSessionReady || status === "exited" || status === "disconnected";

  return (
    <div className="relative h-full min-h-0 overflow-hidden rounded-xl border border-sidebar-border bg-background-secondary">
      <div ref={containerRef} className="h-full w-full p-2" />

      {showOverlay ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background-secondary/90 px-4 text-center">
          {!isSessionReady ? (
            <>
              <LoadingSpinner className="h-4 w-4 text-foreground-tertiary" />
              <p className="text-xs text-foreground-secondary">Environment is starting...</p>
            </>
          ) : (
            <>
              <p className="text-xs text-foreground-secondary">
                {status === "exited"
                  ? `Shell exited${exitCode !== null ? ` (code ${exitCode})` : ""}.`
                  : "Terminal disconnected."}
              </p>
              <Button variant="outline" size="sm" onClick={reconnect}>
                <RotateCcw className="h-3 w-3" />
                Reconnect
              </Button>
            </>
          )}
        </div>
      ) : null}

      {status === "connecting" && isSessionReady ? (
        <div className="absolute right-2 top-2 z-10">
          <LoadingSpinner className="h-3.5 w-3.5 text-foreground-tertiary" />
        </div>
      ) : null}
    </div>
  );
}
