// @ts-check

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    rules: {
      "no-undef": "off",
      "func-call-spacing": "off",

      "max-len": ["error", {
          code: 120,
      }],

      "new-parens": "error",
      "no-caller": "error",
      "no-bitwise": "off",
      "no-console": "off",
      "no-var": "error",
      "object-curly-spacing": ["error", "never"],
      "prefer-const": "error",
      "@typescript-eslint/no-explicit-any": "off",
      quotes: ["error", "double"],
      semi: "off",
      "@typescript-eslint/no-unused-expressions": "off",
    }
  }
);
