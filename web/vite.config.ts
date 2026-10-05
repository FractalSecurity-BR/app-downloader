import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Em desenvolvimento o Vite repassa /api e /d para a API (npm run dev em api/).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/d/': 'http://localhost:3000',
    },
  },
});
