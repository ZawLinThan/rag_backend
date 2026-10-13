import type { Config } from "jest";

const config: Config = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests/api"],
  testMatch: ["**/*.api.test.ts"],
  setupFiles: ["<rootDir>/tests/setupEnv.ts"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          esModuleInterop: true,
          target: "ES2022",
          module: "commonjs",
          isolatedModules: true,
        },
      },
    ],
  },
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  maxWorkers: 1,
  testTimeout: 150000,
  clearMocks: true,
};

export default config;
