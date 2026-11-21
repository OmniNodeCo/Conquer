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
const groups = [upload(build.jobs.web).with.name, upload(build.jobs.portable).with.name,
  ...build.jobs.desktop.strategy.matrix.include.map((entry) => entry.artifact)];

test('Build tests before packaging and has no release permissions', () => {
  assert.deepEqual(Object.keys(build.on).sort(), ['pull_request', 'push', 'workflow_dispatch']);
  assert.deepEqual(build.permissions, { contents: 'read' });
  const commands = build.jobs.verify.steps.map((s) => s.run);
  assert.ok(commands.includes('npm ci') && commands.includes('npm test') && commands.includes('npm run test:ui'));
  for (const job of [build.jobs.web, build.jobs.portable, build.jobs.desktop]) {
    assert.ok([job.needs].flat().includes('verify'));
    assert.equal(upload(job).with['if-no-files-found'], 'error');
  }
  const desktop = build.jobs.desktop;
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
  assert.equal(download.with.pattern, 'conquer-*');
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
    assert.equal(result.stdout.trim(), `run_id=${run}\nsha=${sha}\ntag=${tag}`);
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
  assert.notEqual(bash(stage, {}, dir).status, 0);
  rmSync(path.join(dir, 'dist'), { recursive: true });
  for (const group of groups) {
    const artifact = path.join(dir, 'artifacts', group);
    mkdirSync(artifact, { recursive: true });
    writeFileSync(path.join(artifact, `${group}.bin`), group);
  }
  const staged = bash(stage, {}, dir);
  assert.equal(staged.status, 0, staged.stderr || staged.stdout);
  assert.equal(bash('sha256sum --check SHA256SUMS.txt', {}, path.join(dir, 'dist')).status, 0);

  const publish = steps.find((s) => s.run?.includes('gh release create')).run;
  const mock = `gh() { if [[ $2 == view ]]; then [[ $EXISTS == yes ]]; else echo "$*"; fi; }`;
  for (const exists of ['no', 'yes']) {
    const result = bash(`${mock}\n${publish}`, { TAG: 'preview', SHA: sha, RUN_ID: '200', GH_REPO: repo,
      GITHUB_SERVER_URL: 'https://github.com', DRAFT: 'false', PRERELEASE: 'true', EXISTS: exists }, dir);
    assert.equal(result.status, 0, result.stderr);
    if (exists === 'yes') assert.match(result.stdout, /release upload preview .* --clobber/);
    else assert.match(result.stdout, new RegExp(`release create preview .* --target ${sha}`));
    for (const group of groups) assert.ok(result.stdout.includes(`dist/${group}.bin`));
    assert.ok(result.stdout.includes('dist/SHA256SUMS.txt'));
  }
});
