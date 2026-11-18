import { copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { repositoryRoot, checkPluginMetadata } from './check-plugin-metadata.mjs';

const manifest = checkPluginMetadata();
assert.deepEqual(JSON.parse(readFileSync(join(repositoryRoot, 'plugin/dist/manifest.json'), 'utf8')), manifest);
for (const name of ['main.js', 'styles.css'])
    copyFileSync(join(repositoryRoot, 'plugin/dist', name), join(repositoryRoot, name));
console.log(`Built community assets for tag ${manifest.version}: main.js, manifest.json, styles.css.`);
