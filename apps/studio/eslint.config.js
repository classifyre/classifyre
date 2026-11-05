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
    // react-three-fiber children (<mesh rotation=…>) are not DOM props.
    files: ["**/*.three.tsx"],
    rules: { "react/no-unknown-property": "off" },
  },
  {
    ignores: ["out/**", "build/**"],
  },
];
