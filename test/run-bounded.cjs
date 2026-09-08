// Serial test isolation, bounded heap/output/time, fail-fast. No automatic retries.
const { spawn } = require('node:child_process');
const { readdirSync, existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const directory = path.resolve(__dirname, '../.test-dist/test');
const selected = process.argv.slice(2);
const files = selected.length ? selected : readdirSync(directory).filter(name => name.endsWith('.test.js')).sort();
const heapMiB = 512;
const outputLimit = 256 * 1024;
let total = 0, passedTotal = 0, skippedTotal = 0;

async function run(file) {
  if (!/^[A-Za-z0-9_-]+\.test\.js$/.test(file)) throw new Error('Invalid test filename');
  const args = [`--max-old-space-size=${heapMiB}`, '--max-semi-space-size=16', '--disable-wasm-trap-handler', path.join(directory, file)];
  // RLIMIT_AS is an OS-enforced per-process ceiling, not just V8's heap limit.
  const hardLimit = process.platform === 'linux' && existsSync('/usr/bin/prlimit');
  const executable = hardLimit ? '/usr/bin/prlimit' : process.execPath;
  const commandArgs = hardLimit ? ['--as=4294967296', '--core=0', '--cpu=60', '--', process.execPath, ...args] : args;
  return new Promise(resolve => {
    const child = spawn(executable, commandArgs, { cwd: path.resolve(__dirname, '..'), env: process.env });
    let output = '', bytes = 0, stopped = '';
    const stop = reason => { if (!stopped) { stopped = reason; child.kill('SIGKILL'); } };
    const consume = chunk => {
      bytes += chunk.length;
      if (bytes > outputLimit) { stop('output exceeded 256 KiB'); return; }
      output += chunk.toString();
    };
    child.stdout.on('data', consume); child.stderr.on('data', consume);
    const timer = setTimeout(() => stop('wall time exceeded 90 seconds'), 90_000);
    const memory = process.platform === 'linux' ? setInterval(() => {
      try {
        const rssKiB = Number(readFileSync(`/proc/${child.pid}/status`, 'utf8').match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0);
        if (rssKiB > 1024 * 1024) stop('resident memory exceeded 1 GiB');
      } catch { /* Process has exited. */ }
    }, 100) : undefined;
    child.on('error', error => { stopped = error.message; });
    child.on('close', (code, signal) => {
      clearTimeout(timer); if (memory) clearInterval(memory);
      const tests = Number(output.match(/(?:#|ℹ) tests (\d+)/)?.[1] ?? 0);
      const passed = Number(output.match(/(?:#|ℹ) pass (\d+)/)?.[1] ?? 0);
      const skipped = Number(output.match(/(?:#|ℹ) skipped (\d+)/)?.[1] ?? 0);
      const failed = Number(output.match(/(?:#|ℹ) fail (\d+)/)?.[1] ?? 0);
      const cancelled = Number(output.match(/(?:#|ℹ) cancelled (\d+)/)?.[1] ?? 0);
      const ok = code === 0 && tests > 0 && failed === 0 && cancelled === 0 && !stopped;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${file}: ${tests} tests (${passed} passed, ${skipped} skipped)${!ok ? ` · exit=${code}, signal=${signal}` : ''}${stopped ? ' · ' + stopped : ''}`);
      if (!ok) console.error(output.slice(-16 * 1024));
      total += tests; passedTotal += passed; skippedTotal += skipped;
      resolve(ok);
    });
  });
}
(async () => {
  for (const file of files) if (!await run(file)) { process.exitCode = 1; return; }
  console.log(`TOTAL ${files.length} files, ${total} tests: ${passedTotal} passed, ${skippedTotal} skipped; concurrency=1, heap=${heapMiB} MiB.`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
