import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { load } from 'js-yaml';

const workflow = (name) => load(readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));
const build = workflow('build');
const release = workflow('release');
const { steps } = release.jobs.publish;
const upload = (job) => job.steps.find((s) => s.uses?.startsWith('actions/upload-artifact@'));
const groups = build.jobs.desktop.strategy.matrix.include.map((entry) => entry.artifact);
const version = '2.3.4';
const desktopAssets = {
  'conquer-windows-x64': [`Conquer-Setup-${version}-x64.exe`, `Conquer-Portable-${version}-x64.exe`, 'latest.yml'],
  'conquer-macos': ['arm64', 'x64'].map((arch) => `conquer-rule-the-globe-${version}-mac-${arch}.zip`),
  'conquer-linux-x64': [`conquer-rule-the-globe-${version}-linux-x64.AppImage`],
};

test('Build tests before packaging and has no release permissions', () => {
  assert.deepEqual(Object.keys(build.on).sort(), ['pull_request', 'push', 'workflow_dispatch']);
  assert.deepEqual(build.permissions, { contents: 'read' });
  const commands = build.jobs.verify.steps.map((s) => s.run);
  assert.ok(commands.includes('npm ci') && commands.includes('npm test') && commands.includes('npm run test:ui'));
  const desktop = build.jobs.desktop;
  assert.equal(desktop.needs, 'verify');
  assert.equal(upload(desktop).with['if-no-files-found'], 'error');
  assert.deepEqual(groups.sort(), Object.keys(desktopAssets).sort());
  assert.ok(!build.jobs.portable && !build.jobs.web, 'no browser launchers should be published');
  assert.deepEqual(desktop.strategy.matrix.include.map((entry) => entry.target).sort(), ['--linux', '--mac', '--win']);
  const builder = desktop.steps.find((s) => s.run?.includes('electron-builder'));
  assert.match(builder.run, /--publish never/);
  for (const secret of ['WIN_CSC_LINK', 'MAC_CSC_LINK', 'APPLE_ID']) assert.ok(JSON.stringify(builder.env).includes(`secrets.${secret}`));
  for (const job of Object.values(build.jobs)) {
    assert.ok(!job.permissions?.contents || job.permissions.contents === 'read');
    for (const step of [job, ...job.steps]) assert.doesNotMatch(step.if ?? '', /secrets\./);
  }
});

test('Release downloads only the selected Build run, without a checkout or rebuild', () => {
  assert.deepEqual(release.on.workflow_run, { workflows: [build.name], types: ['completed'], branches: ['main'] });
  assert.ok(release.on.workflow_dispatch.inputs.tag);
  assert.deepEqual(release.permissions, { actions: 'read', contents: 'write' });
  assert.match(release.jobs.publish.if, /workflow_run.conclusion == 'success'/);
  const download = steps.find((s) => s.uses?.startsWith('actions/download-artifact@'));
  assert.equal(download.with['run-id'], '${{ steps.build.outputs.run_id }}');
  assert.ok(download.with['github-token']);
  assert.equal(download.with.pattern, 'conquer-{windows-x64,macos,linux-x64}');
  assert.doesNotMatch(steps.map((s) => `${s.uses ?? ''}\n${s.run ?? ''}`).join('\n'), /actions\/checkout|npm ci|electron-builder/);
});

// Exercise the actual Ubuntu release steps offline. Other platforms can still run
// all the game and workflow-structure tests without installing runner utilities.
const bash = (script, env, cwd) => spawnSync('bash', ['-c', script], {
  encoding: 'utf8', env: { PATH: process.env.PATH, ...env }, cwd,
});
const shell = { skip: bash('command -v jq && command -v git && command -v sha256sum', {}).status !== 0 && 'requires Bash, jq, Git and sha256sum' };
const repo = 'example/game';
const sha = 'a'.repeat(40);
const ghApi = `gh() {
  local json
  case "$2" in
    */actions/workflows/build.yml) json='{"id":7}' ;;
    */actions/workflows/build.yml/runs\?*)
      [[ "$2" == *'branch=main'* && "$2" == *'status=success'* ]] || return 1
      case "$2" in
        *event=push*) json='{"workflow_runs":[{"id":100}]}' ;;
        *event=workflow_dispatch*) json='{"workflow_runs":[{"id":200}]}' ;;
        *) return 1 ;;
      esac ;;
    */actions/runs/[0-9]*) json=$RUN_JSON ;;
    */contents/package.json?ref=$SHA) json=$PACKAGE_JSON ;;
    *) return 1 ;;
  esac
  if [[ $# == 2 ]]; then printf '%s\\n' "$json"; else jq -r "$4" <<< "$json"; fi
}`;
function select(env = {}, metadata = {}) {
  return bash(`${ghApi}\nGITHUB_OUTPUT=$(mktemp)\ntrap 'rm -f "$GITHUB_OUTPUT"' EXIT\n${steps.find((s) => s.id === 'build').run}\ncat "$GITHUB_OUTPUT"`, {
    GH_REPO: repo, SHA: sha, RUN_ID: '', INPUT_TAG: '',
    PACKAGE_JSON: JSON.stringify({ content: Buffer.from('{"version":"2.3.4"}').toString('base64') }),
    RUN_JSON: JSON.stringify({ workflow_id: 7, head_sha: sha, head_repository: { full_name: repo },
      head_branch: 'main', event: 'push', conclusion: 'success', ...metadata }), ...env,
  });
}

test('manual release defaults to the latest green Build and its version; both inputs can be pinned', shell, () => {
  for (const [input, run, tag] of [[{}, '200', 'v2.3.4'], [{ RUN_ID: '100', INPUT_TAG: 'preview' }, '100', 'preview']]) {
    const result = select(input);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), `run_id=${run}\nsha=${sha}\ntag=${tag}\nversion=${version}`);
  }
  for (const metadata of [{ workflow_id: 8 }, { conclusion: 'failure' }, { event: 'pull_request' },
    { head_branch: 'topic' }, { head_repository: { full_name: 'fork/game' } }]) {
    assert.notEqual(select({ RUN_ID: '300' }, metadata).status, 0);
  }
});

test('Release refuses incomplete downloads and uploads the selected assets for a new or existing release', shell, (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'conquer-release-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const stage = steps.find((s) => s.run?.includes('sha256sum')).run;
  const stageEnv = { VERSION: version, TAG: 'preview/test', GITHUB_SERVER_URL: 'https://github.com', GH_REPO: repo };
  assert.notEqual(bash(stage, stageEnv, dir).status, 0);
  rmSync(path.join(dir, 'dist'), { recursive: true });
  for (const [group, files] of Object.entries(desktopAssets)) {
    const artifact = path.join(dir, 'artifacts', group);
    mkdirSync(artifact, { recursive: true });
    for (const file of files) writeFileSync(path.join(artifact, file), group);
  }
  const staged = bash(stage, stageEnv, dir);
  assert.equal(staged.status, 0, staged.stderr || staged.stdout);
  assert.equal(bash('sha256sum --check SHA256SUMS.txt', {}, path.join(dir, 'dist')).status, 0);
  for (const arch of ['arm64', 'x64']) {
    const feed = JSON.parse(readFileSync(path.join(dir, 'dist', `conquer-mac-${arch}.json`), 'utf8'));
    assert.equal(feed.currentRelease, version);
    assert.equal(feed.releases[0].updateTo.url,
      `https://github.com/${repo}/releases/download/preview%2Ftest/conquer-rule-the-globe-${version}-mac-${arch}.zip`);
  }

  const publish = steps.find((s) => s.run?.includes('gh release create')).run;
  const mock = `gh() { if [[ $2 == view ]]; then [[ $EXISTS == yes ]]; else echo "$*"; fi; }`;
  for (const exists of ['no', 'yes']) {
    const result = bash(`${mock}\n${publish}`, { TAG: 'preview', SHA: sha, RUN_ID: '200', GH_REPO: repo,
      GITHUB_SERVER_URL: 'https://github.com', DRAFT: 'false', PRERELEASE: 'true', EXISTS: exists }, dir);
    assert.equal(result.status, 0, result.stderr);
    if (exists === 'yes') assert.match(result.stdout, /release upload preview .* --clobber/);
    else assert.match(result.stdout, new RegExp(`release create preview .* --target ${sha}`));
    for (const file of Object.values(desktopAssets).flat()) assert.ok(result.stdout.includes(`dist/${file}`));
    assert.ok(result.stdout.includes('dist/SHA256SUMS.txt'));
  }
});
