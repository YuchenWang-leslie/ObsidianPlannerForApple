import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Plugin packaging requires an Apple silicon Mac. npm run build remains available on other build hosts.');
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24+ is required.');
const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));
const { id, version } = readJSON('manifest.json');
assert.match(id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Unsafe plugin ID.');
assert.match(version, /^\d+\.\d+\.\d+$/, 'Plugin version must be x.y.z.');
for (const value of [readJSON('package.json').version, readJSON('package-lock.json').version, readJSON('package-lock.json').packages?.['']?.version]) {
    assert.equal(value, version, 'Plugin manifest/package/lock versions must agree.');
}
const helperName = 'DayPlannerAppleSyncHelper.app';
const helperRelative = `native/${helperName}`;
const helper = resolve('dist', helperRelative);
if (!existsSync(helper)) throw new Error('Bundled helper is missing. From the repository root run ./scripts/package-plugin-release.sh, or build JS then ./scripts/build-plugin-helper.sh before packaging. A JS-only ZIP is not a release.');

const run = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
const plist = join(helper, 'Contents/Info.plist');
const value = key => run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist]).trim();
assert.equal(value('CFBundleIdentifier'), 'com.obsidianplanner.pluginhelper');
assert.equal(value('CFBundleExecutable'), 'DayPlannerAppleSyncHelper');
assert.equal(value('CFBundlePackageType'), 'APPL');
assert.equal(value('CFBundleShortVersionString'), version, 'Helper/plugin versions must agree.');
assert.equal(value('LSUIElement'), 'true', 'The helper must be a background agent.');
assert.equal(value('LSMinimumSystemVersion'), '14.0');
assert.equal(value('CFBundleURLTypes:0:CFBundleURLSchemes:0'), 'obsidianplanner-helper');
assert.ok(value('NSRemindersFullAccessUsageDescription').length > 0, 'Missing Reminders privacy description.');
assert.ok(value('NSCalendarsFullAccessUsageDescription').length > 0, 'Missing Calendar privacy description.');
assert.equal(run('/usr/bin/lipo', ['-archs', join(helper, 'Contents/MacOS/DayPlannerAppleSyncHelper')]).trim(), 'arm64');
run('/usr/bin/codesign', ['--verify', '--strict', helper]);

const distributionFiles = ['main.js', 'manifest.json', 'styles.css', 'README.md', 'LICENSE'];
const expected = [...distributionFiles, ...[
    'Contents/Info.plist', 'Contents/MacOS/DayPlannerAppleSyncHelper',
    'Contents/Resources/LICENSE.txt', 'Contents/_CodeSignature/CodeResources',
].map(path => `${helperRelative}/${path}`)].sort();
const privateHome = Buffer.from(homedir().replace(/\/$/, '') + '/');
const localTokens = new Set();
function collectTokens(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
        if (key === 'pairingToken' && typeof child === 'string' && child.length) localTokens.add(child);
        else collectTokens(child);
    }
}
// Read only known local credential stores, without printing paths or values.
for (const bridge of ['Bridge', 'PluginBridge']) {
    const root = join(homedir(), 'Library/Application Support/ObsidianPlanner', bridge);
    const clients = join(root, 'clients');
    const candidates = [join(root, 'pairings.json')];
    if (existsSync(clients)) {
        assert.ok(lstatSync(clients).isDirectory() && !lstatSync(clients).isSymbolicLink(), 'Credential directory must not be a link.');
        candidates.push(...readdirSync(clients).filter(name => name.endsWith('.json')).map(name => join(clients, name)));
    }
    for (const path of candidates) {
        if (!existsSync(path)) continue;
        const stat = lstatSync(path);
        assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 2 * 1024 * 1024, 'Unexpected local credential file.');
        collectTokens(readJSON(path));
    }
}
const tokenBytes = [...localTokens].flatMap(token => [Buffer.from(token), Buffer.from(token.replaceAll('/', '\\/'))]);

mkdirSync('dist', { recursive: true });
const stage = mkdtempSync(resolve('dist/.package-'));
try {
    const root = join(stage, id);
    mkdirSync(join(root, 'native'), { recursive: true });
    for (const file of distributionFiles) {
        assert.ok(lstatSync(`dist/${file}`).isFile(), `Missing distribution file: ${file}`);
        copyFileSync(`dist/${file}`, join(root, file));
    }
    run('/usr/bin/ditto', ['--norsrc', '--noextattr', '--noacl', '--noqtn', helper, join(root, helperRelative)]);
    function scrub(path) {
        for (const name of readdirSync(path)) {
            const child = join(path, name);
            if (name === '.DS_Store' || name === '__MACOSX' || name.startsWith('._')) rmSync(child, { recursive: true, force: true });
            else if (lstatSync(child).isDirectory()) scrub(child);
        }
    }
    scrub(root);
    run('/usr/bin/xattr', ['-cr', root]);
    function files(path, prefix = '') {
        return readdirSync(path).flatMap(name => {
            const relative = prefix + name;
            const child = join(path, name);
            const stat = lstatSync(child);
            if (stat.isDirectory()) {
                assert.ok(expected.some(file => file.startsWith(relative + '/')), `Unexpected directory: ${relative}`);
                return files(child, relative + '/');
            }
            assert.ok(stat.isFile(), `Unexpected link or special file: ${relative}`);
            const data = readFileSync(child);
            assert.ok(!data.includes(privateHome), `Private home path in ${relative}`);
            assert.ok(!tokenBytes.some(token => data.includes(token)), `Local credential in ${relative}`);
            return [relative];
        }).sort();
    }
    assert.deepEqual(files(root), expected, 'Unexpected plugin release contents.');
    const builtManifest = readJSON(join(root, 'manifest.json'));
    assert.equal(builtManifest.id, id);
    assert.equal(builtManifest.version, version);
    const license = readFileSync('../LICENSE', 'utf8');
    assert.equal(readFileSync(join(root, 'LICENSE'), 'utf8'), license);
    assert.equal(readFileSync(join(root, helperRelative, 'Contents/Resources/LICENSE.txt'), 'utf8'), license);
    run('/usr/bin/codesign', ['--verify', '--strict', join(root, helperRelative)]);

    const filename = `${id}-${version}.zip`;
    const archive = join(stage, filename);
    run('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--noextattr', '--noacl', '--noqtn', '--keepParent', root, archive]);
    run('/usr/bin/unzip', ['-tq', archive]);
    const names = run('/usr/bin/unzip', ['-Z1', archive]).trim().split('\n');
    assert.deepEqual(names.filter(name => !name.endsWith('/')).sort(), expected.map(file => `${id}/${file}`).sort());
    assert.ok(names.every(name => !name.startsWith('/') && !name.split('/').some(part => part === '..' || part === '__MACOSX' || part === '.DS_Store' || part.startsWith('._'))), 'Unsafe ZIP path or Apple metadata.');
    renameSync(archive, resolve('dist', filename));
    const checksumName = `SHA256SUMS-plugin-${version}.txt`;
    const digest = createHash('sha256').update(readFileSync(`dist/${filename}`)).digest('hex');
    writeFileSync(join(stage, checksumName), `${digest}  ${filename}\n`);
    renameSync(join(stage, checksumName), resolve('dist', checksumName));
    run('/usr/bin/shasum', ['-a', '256', '-c', checksumName], { cwd: resolve('dist') });
    console.log(`Packaged dist/${filename} and dist/${checksumName}`);
} finally {
    rmSync(stage, { recursive: true, force: true });
}
