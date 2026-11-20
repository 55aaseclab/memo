import { join } from 'node:path';

// The caller provides only fresh, isolated demo paths and a loopback port.
export function createDemoIntegration() {
  return {
    supported: true, module: 'praxis/demo.mjs',
    plan({ dataDir, port }) {
      return {
        steps: [],
        server: { args: ['src/main.mjs'], environment: { MEMO_DATA_DIR: dataDir } },
      };
    },
  };
}
