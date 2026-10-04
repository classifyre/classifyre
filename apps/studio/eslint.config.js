import remotion from "@remotion/eslint-plugin";
import { config } from "@workspace/eslint-config/react-internal";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...config,
  {
    files: ["src/**/*.{ts,tsx}", "videos/**/*.{ts,tsx}"],
    ...remotion.flatPlugin,
  },
  {
    ignores: ["out/**", "build/**"],
  },
];
