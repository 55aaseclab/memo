import { createStackIntegration } from './stack.mjs';
import { localCompose } from './local-compose.mjs';
export function createDeploymentIntegration() { return {
  stack: createStackIntegration(),
  localCompose,
  "dataId": "memo",
  "volumes": [
    "memo"
  ],
  "adapterPort": 4325,
  "runtime": {
    "MEMO_DATA_DIR": "/data/memo",
    "MEMO_BUSINESS_KEY_FILE": "/config/key",
    "MEMO_SPACE_IDS": "${spaceId}"
  },
  "businessBindings": {
    "dataDir": "/data/memo"
  },
  "initialFiles": [],
  "native": {
    "dockerfile": "Dockerfile.praxis",
    "command": [
      "node",
      "src/main.mjs"
    ]
  }
}; }
