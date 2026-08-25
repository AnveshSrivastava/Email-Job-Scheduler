/// <reference types="vitest" />
import { defineConfig } from 'vite';
import type { UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import type { InlineConfig } from 'vitest/node';

interface VitestConfigExport extends UserConfig {
  test: InlineConfig;
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
} as VitestConfigExport);
