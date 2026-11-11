import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vitest/config';

// The game version shown in the UI (#69), read from package.json at build time.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// design/ui/design-system/components/bundle.css is a byte-for-byte snapshot of a design artifact whose
// runtime needs a Google Fonts @import. The game self-hosts its fonts (src/styles/fonts.css), so this
// removes that one @import from that one file, in dev and in build, without editing the snapshot.
function stripGoogleFontsImport(): Plugin {
  return {
    name: 'strip-google-fonts-import',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0]?.replaceAll('\\', '/') ?? '';
      if (!file.endsWith('/design/ui/design-system/components/bundle.css')) return null;
      const stripped = code.replace(/@import\s+url\(\s*["']?https:\/\/fonts\.googleapis\.com[^)]*\)\s*;?\s*/g, '');
      return stripped === code ? null : { code: stripped, map: null };
    },
  };
}

export default defineConfig({
  // Relative base so the build works from any path (GitHub Pages project site, itch.io, a folder).
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [stripGoogleFontsImport()],
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
