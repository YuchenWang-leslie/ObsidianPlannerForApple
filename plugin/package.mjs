import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
const { id, version } = JSON.parse(readFileSync('manifest.json', 'utf8'));
const root = `dist/package/${id}`;
rmSync('dist/package', { recursive: true, force: true });
mkdirSync(root, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css', 'LICENSE', 'README.md']) copyFileSync(`dist/${file}`, `${root}/${file}`);
execFileSync('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--noextattr', '--noacl', '--keepParent', root, `dist/${id}-${version}.zip`]);
console.log(`Packaged dist/${id}-${version}.zip`);
