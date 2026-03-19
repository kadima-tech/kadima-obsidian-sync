import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    alias: {
      'obsidian': path.resolve(__dirname, './tests/obsidian-shim.ts'),
    },
    globals: true,
  },
  define: {
    '__DEV__': true,
  },
});
