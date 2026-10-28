import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const config = {
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { sourcemap: false },
  server: {
    port: 3000,
    strictPort: true,
    // Let the API proxy forward preflights to Nest, which owns origin authorization.
    cors: false,
    allowedHosts: ['flagpole-thus-unluckily.ngrok-free.dev'],
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
    // Match Nest's default development bind address to avoid localhost resolving to ::1.
    proxy: { '/api/v1': { target: 'http://127.0.0.1:5000', changeOrigin: true } },
  },
  test: { environment: 'jsdom', setupFiles: './src/tests/setup.ts', css: true },
} as UserConfig & { test: { environment: string; setupFiles: string; css: boolean } };

export default defineConfig(config);
