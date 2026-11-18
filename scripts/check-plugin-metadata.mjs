import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const read = name => JSON.parse(readFileSync(join(repositoryRoot, name), 'utf8'));

export function checkPluginMetadata() {
    const manifest = read('manifest.json');
    for (const name of ['id', 'name', 'version', 'minAppVersion', 'description', 'author'])
        assert.ok(typeof manifest[name] === 'string' && manifest[name].trim(), `Missing manifest ${name}.`);
    assert.match(manifest.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(!manifest.id.includes('obsidian'), 'Plugin IDs cannot contain obsidian.');
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
    assert.match(manifest.minAppVersion, /^\d+\.\d+\.\d+$/);
    assert.ok(manifest.description.length <= 250 && manifest.description.endsWith('.'));
    assert.equal(manifest.isDesktopOnly, true);
    assert.deepEqual(read('plugin/manifest.json'), manifest, 'Root and plugin manifests differ.');
    for (const name of ['package.json', 'plugin/package.json', 'package-lock.json', 'plugin/package-lock.json'])
        assert.equal(read(name).version, manifest.version, `${name} version differs.`);
    const lock = read('package-lock.json');
    assert.equal(lock.packages[''].version, manifest.version);
    assert.equal(lock.packages.plugin.version, manifest.version);
    assert.equal(read('plugin/package-lock.json').packages[''].version, manifest.version);
    assert.equal(read('versions.json')[manifest.version], manifest.minAppVersion);
    assert.equal(readFileSync(join(repositoryRoot, 'LICENSE'), 'utf8'), readFileSync(join(repositoryRoot, 'plugin/LICENSE'), 'utf8'));
    return manifest;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    const manifest = checkPluginMetadata();
    console.log(`Community metadata valid: ${manifest.id} ${manifest.version}.`);
}
