/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    // NOTE: engine and data logic is tested under node — jsdom is only needed for
    // components, which opt in via the `@vitest-environment jsdom` docblock.
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // NOTE: jsdom rendering in this sandbox is noticeably and unevenly slower than
    // usual — the default 5s timeout sometimes isn't enough for the first mount of
    // Radix components.
    testTimeout: 15000,
  },
});
