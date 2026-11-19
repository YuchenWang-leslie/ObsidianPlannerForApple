import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPluginMetadata, repositoryRoot } from './check-plugin-metadata.mjs';

const tag = process.env.RELEASE_TAG;
const repository = process.env.GITHUB_REPOSITORY;
const manifest = checkPluginMetadata();
assert.equal(tag, manifest.version, 'Dispatch this workflow using the exact community release tag.');
assert.ok(repository, 'GITHUB_REPOSITORY is required.');
const run = (args, cwd = repositoryRoot) => execFileSync('gh', args, { cwd, encoding: 'utf8' });
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
assert.equal(head, process.env.GITHUB_SHA, 'Run workflow_dispatch with --ref equal to the release tag.');
const release = JSON.parse(run(['release', 'view', tag, '--repo', repository, '--json', 'tagName,isDraft,isPrerelease,assets']));
const names = ['main.js', 'manifest.json', 'styles.css'];
assert.equal(release.tagName, tag);
assert.equal(release.isDraft, false);
assert.equal(release.isPrerelease, false);
assert.deepEqual(release.assets.map(asset => asset.name).sort(), [...names].sort(), 'Community releases must contain only the three supported files.');
const directory = mkdtempSync(join(tmpdir(), 'planner-release-'));
try {
    run(['release', 'download', tag, '--repo', repository, '--dir', directory]);
    for (const name of names) assert.deepEqual(readFileSync(join(directory, name)), readFileSync(join(repositoryRoot, name)), `Published ${name} differs from this source build.`);
    console.log(`Verified source-built assets against ${repository} release ${tag}.`);
} finally {
    rmSync(directory, { recursive: true, force: true });
}
