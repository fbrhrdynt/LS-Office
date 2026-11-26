import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev/preview: /api goes to the local API (LS_API overrides, e.g. a dev instance on another port).
const api = { '/api': { target: process.env.LS_API || 'http://127.0.0.1:3215', changeOrigin: false } };

export default defineConfig({ plugins: [react()], server: { proxy: api }, preview: { proxy: api } });
