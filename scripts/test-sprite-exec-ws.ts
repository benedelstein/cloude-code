// Test script for the wrangler debug websocket exec endpoint.
// Usage:
//   tsx scripts/test-sprite-exec-ws.ts <sprite-name> [base-url]
//
// Examples:
//   tsx scripts/test-sprite-exec-ws.ts my-sprite
//   tsx scripts/test-sprite-exec-ws.ts my-sprite http://127.0.0.1:8787

import assert from "node:assert/strict";
import dotenv from "dotenv";

dotenv.config({ quiet: true, debug: false});

type DebugExecWsRequest = {
  spriteName: string;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
};

type DebugExecWsResponse = {
  exitCode?: number;
  error?: string;
  stdout: string;
  stderr: string;
};

type TestCase = {
  name: string;
  request: DebugExecWsRequest;
  expectedExitCode: number;
  stdoutIncludes?: string;
  stderrIncludes?: string;
};

const spriteName = process.argv[2];
const baseUrl =
  process.argv[3] ?? process.env.DEBUG_API_BASE_URL ?? "http://127.0.0.1:8787";

if (!spriteName) {
  console.error(
    "Usage: tsx scripts/test-sprite-exec-ws.ts <sprite-name> [base-url]",
  );
  process.exit(1);
}

const endpoint = new URL("/_debug/sprites-exec-ws", baseUrl).toString();

const testCases: TestCase[] = [
  {
    name: "stdout/stderr/exit",
    request: {
      spriteName,
      command: "echo out; echo err >&2; exit 7",
    },
    expectedExitCode: 7,
    stdoutIncludes: "out",
    stderrIncludes: "err",
  },
  {
    name: "cwd handling",
    request: {
      spriteName,
      command: "pwd",
      cwd: "/tmp",
    },
    expectedExitCode: 0,
    stdoutIncludes: "/tmp",
  },
  {
    name: "env handling",
    request: {
      spriteName,
      command: 'printf "%s" "$DEBUG_EXEC_WS_VALUE"',
      env: {
        DEBUG_EXEC_WS_VALUE: "hello from env",
      },
    },
    expectedExitCode: 0,
    stdoutIncludes: "hello from env",
  },
];

async function callDebugRoute(
  request: DebugExecWsRequest,
): Promise<DebugExecWsResponse> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
  });

  const body = (await response.json()) as DebugExecWsResponse;

  if (!response.ok) {
    throw new Error(
      `Debug route failed with ${response.status}: ${JSON.stringify(body)}`,
    );
  }

  return body;
}

async function runCase(testCase: TestCase): Promise<void> {
  console.log(`\n[${testCase.name}]`);
  console.log(`command: ${testCase.request.command.trim()}`);

  const result = await callDebugRoute(testCase.request);

  console.log(`exitCode: ${result.exitCode} expected: ${testCase.expectedExitCode}`.trim());

  assert.equal(result.exitCode, testCase.expectedExitCode);

  if (testCase.stdoutIncludes) {
    assert.match(result.stdout, new RegExp(escapeRegExp(testCase.stdoutIncludes)), [
      `stdout did not include ${JSON.stringify(testCase.stdoutIncludes)}`,
      `actual stdout: ${JSON.stringify(result.stdout)}`,
      `actual stderr: ${JSON.stringify(result.stderr)}`,
    ].join("\n"));
  }

  if (testCase.stderrIncludes) {
    assert.match(result.stderr, new RegExp(escapeRegExp(testCase.stderrIncludes)), [
      `stderr did not include ${JSON.stringify(testCase.stderrIncludes)}`,
      `actual stdout: ${JSON.stringify(result.stdout)}`,
      `actual stderr: ${JSON.stringify(result.stderr)}`,
    ].join("\n"));
  }

  console.log(`stdout: ${JSON.stringify(result.stdout)}`);
  console.log(`stderr: ${JSON.stringify(result.stderr)}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main(): Promise<void> {
  // console.log(`Using sprite: ${spriteName}`);
  // console.log(`Endpoint: ${endpoint}`);

  for (const testCase of testCases) {
    await runCase(testCase);
  }

  console.log("\nAll websocket debug-route checks passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
