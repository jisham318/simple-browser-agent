import js from "@eslint/js";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

/** @type {import('eslint').Linter.Config[]} */
export default [
	{
		files: ["eslint.config.mjs", "./packages/**/src/**/*.{js,mjs,cjs,ts,tsx}"],
		languageOptions: { globals: globals.browser },
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		plugins: {
			"simple-import-sort": simpleImportSort,
		},
		rules: {
			"@typescript-eslint/no-namespace": "off",
			"simple-import-sort/imports": "warn",
			"simple-import-sort/exports": "warn",
		},
	},
];
