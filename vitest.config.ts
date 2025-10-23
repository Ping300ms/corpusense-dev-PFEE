import { defineConfig } from 'vitest/config'
import * as Path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': Path.resolve(__dirname, './src'),
    },
  },
});
