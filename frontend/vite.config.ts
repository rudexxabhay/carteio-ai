import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';

const config = {
  plugins: [react()],
  build: { sourcemap: false },
  server: {
    port: 3000,
    strictPort: true,
    proxy: { '/api/v1': { target: 'http://localhost:5000', changeOrigin: true } },
  },
  test: { environment: 'jsdom', setupFiles: './src/tests/setup.ts', css: true },
} as UserConfig & { test: { environment: string; setupFiles: string; css: boolean } };

export default defineConfig(config);
