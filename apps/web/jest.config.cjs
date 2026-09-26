/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/lib", "<rootDir>/components/case-board"],
  testMatch: ["**/*.spec.ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }],
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    "^@workspace/case-board/(.*)$": "<rootDir>/../../packages/case-board/src/$1",
  },
  moduleFileExtensions: ["ts", "js", "json"],
}

