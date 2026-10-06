import { defineConfig } from 'vite';

// Served behind a reverse proxy, so the dev server has to accept the public
// hostname as well as localhost. A leading dot allows any subdomain.
const allowedHosts = ['cement-twin.iocompute.ai', '.iocompute.ai', 'localhost'];

export default defineConfig({
  server: { port: 7373, host: true, strictPort: true, allowedHosts },
  preview: { port: 7373, host: true, strictPort: true, allowedHosts },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
