import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },

  {
    files: ["drizzle.config.ts", "eslint.config.ts", "jest.config.ts"],
    languageOptions: {
      parserOptions: {
        projectService: false,
      },
    },
  },

  {
    ignores: ["dist/**", "node_modules/**"],
  },
);
