# Community review response matrix — 0.4.2

This records review topics and actual evidence, not directory approval. Plugin 0.4.2 passed clean-source/local checks and read-only host QA; helper 0.4.0, standalone App 0.5.0/build 6, native code and MIT + Commons Clause/No Sell remain unchanged. Earlier 0.4.1 tests and 0.4.0 real-account writes are historical only.

| Review topic | Response / evidence needed | Current status |
| --- | --- | --- |
| UI heading | Use declarative headings and inspect the resulting host UI. | Real Obsidian 1.15.1 test-vault heading/guide rendered correctly; official lint passed |
| Settings definitions/update API | Use getSettingDefinitions/update; preserve the guide, Use system and searchable setting names. | Use system saved/refreshed; global search system time zone indexed the setting; 69-test suite and official lint passed |
| Unsafe JSON types | Parse external data as unknown and validate required nested structure before typed use; retain malformed-response/old-record regressions. | Official lint and full 69-test clean-source run passed |
| prefer-create-el | Reproduce the actual official preference and use the specific createDiv/createSpan helpers. | Complete official ESLint run: zero errors, zero warnings; not dismissed merely because createEl already existed |
| fs capability | Required for installed-helper verification and private local transport/credentials/results. [Exact paths and purposes](HELPER_SETUP.md#local-access-and-shared-history) are disclosed. | Necessary capability retained; reviewer decision pending |
| child_process capability | Fixed execFile programs/argv for plutil, codesign and open only; no shell/eval, downloader, installer or updater. [Exact argv](HELPER_SETUP.md#local-access-and-shared-history) are disclosed. | Necessary capability retained; reviewer decision pending |
| Recognized license | Retain complete MIT + Commons Clause v1.0 and No Sell. The official policy requires a license; its FAQ explains custom-license recognition warnings. | Terms unchanged; warning/acceptance not declared resolved |
| Unsupported release extras | Community tag 0.4.2 is restricted to main.js, manifest.json and styles.css; manual-v0.4.2 holds the plugin/helper ZIPs and their two-ZIP checksum. | Local ZIP contents, helper identity/signature and two-ZIP checksums verified; public inventory checked at publication |
| Release provenance / attestation | Configured rebuild/exact-byte-check/attestation workflow; genuine Actions/OIDC success and verifiable output are required. | GitHub account billing lock prevented remote jobs from starting; no actual attestation generated |

## Distribution contract

- [Community tag 0.4.2](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/releases/tag/0.4.2): exactly three standard assets.
- [Manual tag manual-v0.4.2](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/releases/tag/manual-v0.4.2): `day-planner-apple-sync-0.4.2.zip`, unchanged `day-planner-apple-sync-helper-0.4.0-macOS-arm64.zip` and `SHA256SUMS-manual-0.4.2.txt`; checksum covers only those two ZIPs.
- No rewriting old releases or automatic helper installation. Host QA was confined to the isolated test vault; the work vault/App remained unchanged, with no new permission request or Apple sync.

## Policy basis and validation boundary

The [submission guide](https://docs.obsidian.md/plugins/releasing/submit-plugin) defines manifest/version/standard-asset expectations. The [developer policies](https://docs.obsidian.md/community-directory/developer-policies) require license and outside-vault access disclosures and prohibit plugin-managed dependency installation/updates. The [FAQ](https://docs.obsidian.md/community-directory/faq) explains custom-license warnings and portal review actions; it does not guarantee acceptance here. No requirement to remove No Sell or adopt pure MIT is inferred.

A clean git archive export, without preexisting dependencies/build outputs, passed npm ci, official lint (zero errors/warnings), all 69 tests, build and metadata checks. main.js/manifest.json/styles.css match the working build byte for byte; final npm audit is zero. Real Obsidian QA loaded the old helper credential/completed run and previewed five Unchanged/Skipped plans. Two preexisting overlap warnings remained. Fake-note/shared-history bytes stayed unchanged; one completed run pointer refreshed, so no claim is made that every run file stayed unchanged.

[Remote run 44439328478](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/actions/runs/44439328478) explicitly reported a GitHub account lock caused by a billing issue. Jobs had no steps and are not counted as passed. Retry the release rebuild/byte-check/attestation workflow after the billing lock is resolved; local checks do not constitute genuine Actions/OIDC attestation. Final attachment verification is separate. The [release notes](releases/0.4.2.md) retain the scope, and community approval remains separate from local checks and provenance proof.

## Retry provenance after the billing lock is resolved

Dispatch using the release tag as both the workflow ref and input:

```sh
gh workflow run attest-release.yml --repo YuchenWang-leslie/ObsidianPlannerForApple --ref 0.4.2 -f tag=0.4.2
```

Wait for a successful run, download the three assets from release 0.4.2, then verify each locally:

```sh
gh attestation verify main.js --repo YuchenWang-leslie/ObsidianPlannerForApple
gh attestation verify styles.css --repo YuchenWang-leslie/ObsidianPlannerForApple
gh attestation verify manifest.json --repo YuchenWang-leslie/ObsidianPlannerForApple
```
