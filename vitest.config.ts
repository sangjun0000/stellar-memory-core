import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';

// Vite strips 'node:' prefix for builtins it recognizes, but 'sqlite' (Node 22+)
// is not in Vite's builtin list. This plugin intercepts both forms and
// returns the actual module via dynamic import.
function nodeSqlitePlugin(): Plugin {
  return {
    name: 'node-sqlite',
    resolveId(id) {
      if (id === 'node:sqlite' || id === 'sqlite') {
        return '\0virtual:node-sqlite';
      }
    },
    load(id) {
      if (id === '\0virtual:node-sqlite') {
        // Re-export from the real node:sqlite using createRequire
        // because Vite's load hook can't directly use node: protocol.
        return `
          import { createRequire } from 'node:module';
          const _require = createRequire(import.meta.url);
          const _mod = _require('node:sqlite');
          export const DatabaseSync = _mod.DatabaseSync;
          export default _mod;
        `;
      }
    },
  };
}

export default defineConfig({
  plugins: [nodeSqlitePlugin()],
  test: {
    globals: false,
    exclude: ['**/node_modules/**', '**/dist/**', 'web/**'],
  },
});
