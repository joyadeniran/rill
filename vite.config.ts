import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify - file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // In production Express serves the built bundle, so the console's
      // relative `/api` calls resolve on the same origin. In dev the app is on
      // Vite's port and the API is on its own, so without this proxy every
      // request from the console 404s against Vite.
      proxy: {
        '/api': {
          target: `http://localhost:${env.PORT || 3001}`,
          changeOrigin: true,
        },
      },
    },
  };
});
