import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/main.ts'], bundle: true, format: 'cjs', platform: 'node', target: 'es2022', external: ['obsidian', 'electron'], outfile: 'dist/main.js', minify: false });
for (const file of ['manifest.json', 'styles.css', 'LICENSE', 'README.md']) await copyFile(file, `dist/${file}`);
