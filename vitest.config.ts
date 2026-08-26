import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    projects: [
      {
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node' },
      },
      {
        // `findScroller` (src/preload/sync.ts) needs a real document and real
        // layout to test, so the sync preload is imported here. It imports
        // `electron` for `ipcRenderer`; the alias below swaps in a recorder so
        // the module loads in a browser. Browser-project only — the app build
        // never resolves it.
        resolve: { alias: { electron: resolve(__dirname, 'tests/browser/stubs/electron.ts') } },
        test: {
          name: 'browser',
          include: ['tests/browser/**/*.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: 'playwright',
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
