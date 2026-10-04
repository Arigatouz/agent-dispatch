#!/usr/bin/env node
/**
 * Fake coding-agent CLI for tests. Prints predictable stdout/stderr and can hang or exit on command, so
 * the runner can be exercised (streaming, exit codes, timeout, cancel) without spending any quota and
 * without touching a network.
 *
 * Flags: --hang (never exit), --exit=<code>, --stderr-only, --model-banner=<id>
 */
const args = process.argv.slice(2);

console.log('FAKE-ARGS:' + JSON.stringify(args));

const bannerIndex = args.findIndex((a) => a.startsWith('--model-banner='));
const bannerModel = bannerIndex >= 0 ? args[bannerIndex].split('=')[1] : 'fake-model-1';
console.error(`model: ${bannerModel}`);
console.error('reasoning effort: high');

if (!args.includes('--stderr-only')) {
  console.log('line one');
  process.stdout.write('line two\n');
  process.stdout.write('final line no trailing newline');
}

const exitArg = args.find((a) => a.startsWith('--exit='));
const exitCode = exitArg ? Number(exitArg.split('=')[1]) : 0;

if (args.includes('--hang')) {
  setInterval(() => {}, 1000);
} else {
  process.exit(exitCode);
}
