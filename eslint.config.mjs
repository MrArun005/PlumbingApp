// Flat ESLint config shared by every workspace package.
// Key project rule: no `console.*` — all runtime logging must go through the
// structured logger (see BUILD PROMPT rule 10).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/*.js", "**/*.mjs"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      "no-console": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ]
    }
  },
  {
    // Tests may use devDependency helpers freely, but still no console/any.
    files: ["**/*.test.ts", "**/*.spec.ts"],
    rules: {}
  }
);
