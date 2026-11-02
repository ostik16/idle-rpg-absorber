import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works from any path (GitHub Pages project site, itch.io, a folder).
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
