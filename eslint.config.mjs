import { defineConfig, globalIgnores } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
    globalIgnores(['node_modules/**', 'plugin/node_modules/**', '.local/**', '.build/**', 'plugin/dist/**', 'main.js']),
    ...obsidianmd.configs.recommended,
    {
        files: ['plugin/src/**/*.ts'],
        languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    },
]);
