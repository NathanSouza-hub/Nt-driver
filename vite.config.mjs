import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import crypto from 'crypto';

// Identificador único de cada build. Vai embutido no JS (__APP_BUILD_ID__) e em dist/version.json;
// quando o deploy publica um build novo, os dois deixam de bater e o app mostra o aviso de atualização.
const buildId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;

const emitVersionFile = () => ({
  name: 'nt-version-file',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ buildId }) });
  },
});

export default defineConfig({
  plugins: [react(), emitVersionFile()],
  define: {
    __APP_BUILD_ID__: JSON.stringify(buildId),
  },
  publicDir: path.resolve(import.meta.dirname, 'public'),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    open: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'nt'),
    },
  },
});
