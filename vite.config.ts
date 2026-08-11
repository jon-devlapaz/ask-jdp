import { flue } from '@flue/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [flue()],
  // The live process serves dist/client from disk. A server-only rebuild must
  // never erase the public client while preparing the next Node entry.
  build: { emptyOutDir: false },
});
