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
    // Движок и данные тестируются в node — jsdom нужен только компонентам,
    // они помечены докблоком `@vitest-environment jsdom`.
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // jsdom-рендер в этой песочнице заметно и неравномерно медленнее обычного —
    // дефолтные 5с иногда не хватает на первый монтаж Radix-компонентов.
    testTimeout: 15000,
  },
});
