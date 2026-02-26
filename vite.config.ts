import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/flux-state/',
  server: {
    host: 'localhost',
    port: 5173,
  },
});
