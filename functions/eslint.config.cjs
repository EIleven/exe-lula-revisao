// /home/user/studio/functions/eslint.config.cjs

const tsParser = require("@typescript-eslint/parser");
const tsPlugin = require("@typescript-eslint/eslint-plugin");

module.exports = [
  // Ignora build e deps
  {
    ignores: ["lib/**", "node_modules/**"],
  },

  // Regras para TypeScript (Cloud Functions)
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: __dirname,
        sourceType: "module",
      },
      ecmaVersion: 2022,
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      // Base recomendado do typescript-eslint
      ...tsPlugin.configs.recommended.rules,

      // Em TS, quem garante identificadores é o TS, não o ESLint
      "no-undef": "off",

      // Mantém seus padrões anteriores
      "max-len": ["error", {code: 80, ignoreUrls: true}],
      "quote-props": ["error", "as-needed"],
      "@typescript-eslint/no-explicit-any": "warn",

      // (opcional, mas geralmente útil)
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {argsIgnorePattern: "^_", varsIgnorePattern: "^_"},
      ],
    },
  },
];
