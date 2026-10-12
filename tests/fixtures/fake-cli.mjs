#!/usr/bin/env node
/**
 * Fake coding-agent CLI for tests. Prints predictable stdout/stderr and can hang or exit on command, so
 * the runner can be exercised (streaming, exit codes, timeout, cancel) without spending any quota and
 * without touching a network.
 *
 * Flags: --hang (never exit), --exit=<code>, --stderr-only, --blocked, --model-banner=<id>
 */
const args = process.argv.slice(2);

// A stdout-silence fixture must be silent: the marker would otherwise be captured as the answer, which is
// exactly the condition a blocked run has to model.
if (!args.includes('--blocked')) console.log('FAKE-ARGS:' + JSON.stringify(args));

const bannerIndex = args.findIndex((a) => a.startsWith('--model-banner='));
const bannerModel = bannerIndex >= 0 ? args[bannerIndex].split('=')[1] : 'fake-model-1';
console.error(`model: ${bannerModel}`);
console.error('reasoning effort: high');

const eventsArg = args.find((a) => a.startsWith('--events='));

// --blocked models agy in headless print mode: it cannot answer a permission prompt, so it denies its own
// tool call, prints the reason on stderr and exits 0 with an empty stdout. A blocked run that looks like a
// silent success is the bug this fixture exists to catch.
if (args.includes('--blocked')) {
  console.error(
    'jetski: no output produced — a tool required the "command" permission that headless mode cannot ' +
      'prompt for, so it was auto-denied. Add an allow-rule under permissions.allow in settings.json',
  );
}

if (!args.includes('--stderr-only') && !args.includes('--blocked')) {
  console.log('line one');
  process.stdout.write('line two\n');
  // The unterminated line is only safe when nothing follows it: printing an event straight after it would
  // glue the two together and neither would parse.
  if (!eventsArg) process.stdout.write('final line no trailing newline');
}

// --events=<kind> prints a vendor-shaped event stream, so event parsing and noise handling are exercised
// without a network round trip.
if (eventsArg) {
  const kind = eventsArg.split('=')[1];
  if (kind === 'claude') {
    console.log(JSON.stringify({ type: 'assistant', message: { model: 'claude-haiku-4-5', content: [{ type: 'text', text: 'EVENT-ANSWER' }] } }));
    console.log(JSON.stringify({ type: 'result', subtype: 'success', result: 'EVENT-ANSWER' }));
  } else if (kind === 'codex') {
    // The real codex --json stream opens with session bookkeeping and ends with the agent message.
    console.log(JSON.stringify({ type: 'thread.started', thread_id: 't1' }));
    console.log(JSON.stringify({ type: 'item.completed', item: { type: 'reasoning', text: 'thinking' } }));
    console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'EVENT-ANSWER.' } }));
  } else if (kind === 'opencode') {
    console.log(JSON.stringify({ type: 'text', part: { type: 'text', text: 'EVENT-ANSWER.' } }));
  } else if (kind === 'none') {
    // Bookkeeping only: the shape a quota-blocked codex run leaves behind.
    console.log(JSON.stringify({ type: 'thread.started', thread_id: 't1' }));
  }
}

const exitArg = args.find((a) => a.startsWith('--exit='));
const exitCode = exitArg ? Number(exitArg.split('=')[1]) : 0;

// --wait-stdin models what codex and claude actually do: they probe stdin and wait for it. If the runner
// hands them an open pipe instead of /dev/null they hang until the timeout, which is exactly the bug this
// mode exists to catch.
if (args.includes('--wait-stdin')) {
  // Wait for stdin to close and DO NOT fall through: with an open pipe this process must hang, exactly
  // like codex does, or the regression it models is invisible.
  process.stdin.resume();
  process.stdin.on('end', () => {
    console.log('STDIN-CLOSED');
    process.exit(0);
  });
  process.stdin.on('error', () => {
    console.log('STDIN-CLOSED');
    process.exit(0);
  });
  setInterval(() => {}, 1000);
} else if (args.includes('--hang')) {
  setInterval(() => {}, 1000);
} else {
  process.exit(exitCode);
}
