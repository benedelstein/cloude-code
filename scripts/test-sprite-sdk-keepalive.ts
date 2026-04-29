/**
 * Mirrors the official @fly/sprites SDK docs example for `createSession`,
 * which the docs describe as "detachable" (and the SDK doc-comment confirms
 * is implemented as a tmux session).
 *
 * The docs imply the session keeps running after the SDK process exits.
 * We're testing whether that's actually the case: does python's `time.sleep(30)`
 * complete after we disconnect, or does it freeze?
 *
 * What python does:
 *   1. Prints "Server ready" to stdout (so the SDK's stdout listener has
 *      something to fire on, mirroring the docs example).
 *   2. Appends a "start <timestamp>" line to /tmp/sprite-sdk-test.log.
 *   3. Sleeps 30 seconds.
 *   4. Appends a "end <timestamp>" line.
 *
 * If end - start == 30s, sprite kept it running.
 * If end - start is much larger (or end is missing), sprite suspended it.
 *
 * Usage:
 *   tsx scripts/test-sprite-sdk-keepalive.ts <sprite-name>
 *
 * Env (loaded from .env): SPRITES_API_KEY
 */
import "dotenv/config";
import { SpritesClient } from "@fly/sprites";

const token = process.env.SPRITES_API_KEY!;
const spriteName = process.argv[2];

const LOG_PATH = "/tmp/sprite-sdk-test.log";
const PYTHON_SCRIPT = `
import time, datetime
with open('${LOG_PATH}', 'w') as f:
    print("start " + datetime.datetime.now().isoformat(), flush=True)
    f.write('start ' + datetime.datetime.now().isoformat() + '\\n')
    f.flush()
    for i in range(1000):
        f.write('tick ' + str(i) + ' ' + datetime.datetime.now().isoformat() + '\\n')
        f.flush()
        time.sleep(1)
    print("end " + datetime.datetime.now().isoformat(), flush=True)
    f.write('end   ' + datetime.datetime.now().isoformat() + '\\n')
    f.flush()
`;

const client = new SpritesClient(token);
const sprite = client.sprite(spriteName);

const cmd = sprite.createSession("python3", ["-c", PYTHON_SCRIPT]);

cmd.stdout.on("data", (chunk: Buffer) => {
  process.stdout.write(`[stdout] ${chunk.toString()}`);
});

setTimeout(() => {
  process.exit(0);
}, 2000);
