import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    files: ["frontend/src/**/*.{ts,tsx}", "vite.config.ts", "vitest.config.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
);
