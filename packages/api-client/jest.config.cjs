/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.spec.ts"],
  transform: {
    // The package targets ESM; ts-jest emits CommonJS for the test run only.
    "^.+\\.ts$": [
      "ts-jest",
      { tsconfig: { module: "commonjs", moduleResolution: "node" } },
    ],
  },
  moduleFileExtensions: ["ts", "js", "json"],
};
