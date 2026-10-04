#!/usr/bin/env node
/**
 * Minimal CDP client for the running Obsidian desktop app, using Node's built-in WebSocket.
 * The debug port is loopback only (127.0.0.1:9333) and only exists when Obsidian was launched with
 * --remote-debugging-port, which is a deliberate, temporary state for development.
 *
 * usage:
 *   node scripts/obsidian-cdp.mjs targets
 *   node scripts/obsidian-cdp.mjs eval "<js expression>"
 *   node scripts/obsidian-cdp.mjs screenshot <out.png>
 */
const PORT = process.env.OBSIDIAN_CDP_PORT || 9333;
const [, , cmd, ...rest] = process.argv;

async function list() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

async function pageSocket() {
  const pages = (await list()).filter((t) => t.type === 'page');
  if (!pages.length) throw new Error('no page target: is Obsidian running with --remote-debugging-port?');
  const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('websocket failed to open'));
  });
  let seq = 0;
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      const onMessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id !== id) return;
        ws.removeEventListener('message', onMessage);
        if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error)}`));
        else resolve(msg.result);
      };
      ws.addEventListener('message', onMessage);
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { ws, send };
}

const { ws, send } = await pageSocket();

if (cmd === 'targets') {
  console.log(JSON.stringify(await list(), null, 2));
} else if (cmd === 'eval') {
  const expression = rest.join(' ');
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    console.error('EXCEPTION', JSON.stringify(result.exceptionDetails.exception ?? result.exceptionDetails));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(result.result.value, null, 2));
  }
} else if (cmd === 'screenshot') {
  const out = rest[0];
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`wrote ${out}`);
} else {
  console.error('usage: obsidian-cdp.mjs targets|eval "<js>"|screenshot <out.png>');
  process.exitCode = 2;
}

ws.close();
