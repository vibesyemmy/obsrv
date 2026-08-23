import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { lib: { entry: resolve(__dirname, 'src/main/index.ts') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // Both entries run sandboxed, where `require` resolves only `electron`
        // and a few builtins. Any module they share would be emitted as a
        // `chunks/` file neither can load, so the entries must not import a
        // common runtime module (types are fine). See `src/preload/sync.ts`.
        input: {
          app: resolve(__dirname, 'src/preload/app.ts'),
          sync: resolve(__dirname, 'src/preload/sync.ts'),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
    plugins: [react()],
  },
})
