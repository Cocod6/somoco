import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The Foundry project is a separate codebase with its own toolchain, and
    // contracts/lib/ holds vendored git submodules (OpenZeppelin, forge-std)
    // whose JS is not ours to lint — without this they drown out real findings.
    "contracts/**",
  ]),
]);

export default eslintConfig;
