/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: [
    "<rootDir>/lib",
    "<rootDir>/components/case-board",
    "<rootDir>/components/data-query",
    "<rootDir>/components/data-request",
    "<rootDir>/components/visual-schema",
  ],
  testMatch: ["**/*.spec.ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }],
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    "^@workspace/case-board/(.*)$": "<rootDir>/../../packages/case-board/src/$1",
    "^@workspace/schemas/(.*)$": [
      "<rootDir>/../../packages/schemas/src/$1",
      "<rootDir>/../../packages/schemas/src/schemas/$1",
    ],
  },
  moduleFileExtensions: ["ts", "js", "json"],
}

