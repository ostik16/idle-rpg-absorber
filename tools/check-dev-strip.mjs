// Builds for production and fails if the dev panel's text is in the bundle (#74). A static import of `src/dev/`
// outside an `import.meta.env.DEV` branch would ship it silently; this is the check for that.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Strings only the dev code contains. Minified names change, strings do not. The "not in this build" refusal stays.
const MARKERS = ['Dev tools', 'Raw save', 'Clear item from bag', 'Give at least 1 whole XP'];

const out = mkdtempSync(join(tmpdir(), 'dev-strip-'));
try {
  execFileSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], { stdio: 'ignore' });
  const assets = join(out, 'assets');
  const found = new Set();
  for (const file of readdirSync(assets).filter((name) => name.endsWith('.js'))) {
    const text = readFileSync(join(assets, file), 'utf8');
    for (const marker of MARKERS) if (text.includes(marker)) found.add(marker);
  }
  if (found.size > 0) {
    console.error(`Dev tools reached the production bundle: ${[...found].join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('Dev tools are not in the production bundle.');
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
