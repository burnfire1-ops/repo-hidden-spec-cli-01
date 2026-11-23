// M4 — CLI exactness + atomicity (§§1–4, 10): adversarial verification tests.
// Method: every test is written from the SPEC sentence it cites, not from the
// code. A test that passes confirms the starter's behaviour; a test that
// fails is a bug, fixed afterwards with a minimal change (TDD cycle).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const mainTs = join(repoDir, 'main.ts');
const tmpDirs = [];
after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

// files: {path: content} (nested paths OK); patch: patch text or null (no patch
// file written); args: CLI args before the patch argument; opts: {stdin,
// patchName, noPatchArg, setup(dir)}.
function runCli(files, patch, args = [], opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'm4-'));
  tmpDirs.push(dir);
  for (const [p, content] of Object.entries(files)) {
    const fp = join(dir, p);
    mkdirSync(dirname(fp), { recursive: true });
    writeFileSync(fp, content);
  }
  const patchArg = opts.patchName ?? 'patch.diff';
  if (patch !== null && patch !== undefined) writeFileSync(join(dir, patchArg), patch);
  if (opts.setup) opts.setup(dir);
  const argv = opts.noPatchArg ? [...args] : [...args, patchArg];
  const r = spawnSync('node', [mainTs, ...argv], { cwd: dir, encoding: 'utf8', input: opts.stdin });
  const read = (p) => (existsSync(join(dir, p)) ? readFileSync(join(dir, p), 'utf8') : null);
  return { code: r.status, out: r.stdout, err: r.stderr, read, exists: (p) => existsSync(join(dir, p)) };
}

const UNI_CHANGE = '--- a/x.txt\n+++ b/x.txt\n@@ -1,1 +1,1 @@\n-a\n+b\n';
const JSON_REPLACE = '{"command":"str_replace","path":"x.txt","old_str":"a","new_str":"b"}';

// ---------- Batch 1: usage errors (S1-10) ----------

test('S1-10b duplicate --check is a usage error', () => {
  const r = runCli({ 'x.txt': 'a\n' }, UNI_CHANGE, ['--check', '--check']);
  assert.equal(r.code, 2);
  assert.equal(r.out, 'error: usage\n');
  assert.equal(r.read('x.txt'), 'a\n');
});

test('S1-10b duplicate --strict is a usage error', () => {
  const r = runCli({ 'x.txt': 'a\n' }, UNI_CHANGE, ['--strict', '--strict']);
  assert.equal(r.code, 2);
  assert.equal(r.out, 'error: usage\n');
  assert.equal(r.read('x.txt'), 'a\n');
});

test('S1-10b duplicate --format is a usage error', () => {
  const r = runCli({ 'x.txt': 'a\n' }, UNI_CHANGE, ['--format=unified', '--format=json']);
  assert.equal(r.code, 2);
  assert.equal(r.out, 'error: usage\n');
  assert.equal(r.read('x.txt'), 'a\n');
});

test('S1-10d more than one positional is a usage error', () => {
  // argv: ['other.diff', 'patch.diff'] -> two positionals.
  const r2 = runCli(
    { 'x.txt': 'a\n' },
    UNI_CHANGE,
    ['other.diff'],
    { setup: (dir) => writeFileSync(join(dir, 'other.diff'), UNI_CHANGE) },
  );
  assert.equal(r2.code, 2);
  assert.equal(r2.out, 'error: usage\n');
  assert.equal(r2.read('x.txt'), 'a\n');
});

test('S1-10a unknown flag is a usage error', () => {
  for (const flag of ['--dry-run', '--bogus', '-x', '--format']) {
    const r = runCli({ 'x.txt': 'a\n' }, UNI_CHANGE, [flag]);
    assert.equal(r.code, 2, flag);
    assert.equal(r.out, 'error: usage\n', flag);
    assert.equal(r.read('x.txt'), 'a\n', flag);
  }
});

test('S1-10c --format value other than the five names is a usage error', () => {
  for (const f of ['--format=git', '--format=JSON', '--format=', '--format=Unified']) {
    const r = runCli({ 'x.txt': 'a\n' }, UNI_CHANGE, [f]);
    assert.equal(r.code, 2, f);
    assert.equal(r.out, 'error: usage\n', f);
    assert.equal(r.read('x.txt'), 'a\n', f);
  }
});

test('S1-08 options after PATCH still work', () => {
  // Explicit argv order: patch.diff THEN --check.
  const dir = mkdtempSync(join(tmpdir(), 'm4-'));
  tmpDirs.push(dir);
  writeFileSync(join(dir, 'x.txt'), 'a\n');
  writeFileSync(join(dir, 'patch.diff'), UNI_CHANGE);
  const r2 = spawnSync('node', [mainTs, 'patch.diff', '--check'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r2.status, 0);
  assert.equal(r2.stdout, 'M x.txt\nok: 1 file\n');
  assert.equal(readFileSync(join(dir, 'x.txt'), 'utf8'), 'a\n');
});

test('S1-09 -- ends options: --strict after -- is a positional (no-patch)', () => {
  // argv is exactly ['--', '--strict']: one positional, a file named --strict.
  const r = runCli({ 'x.txt': 'a\n' }, null, ['--', '--strict'], { noPatchArg: true });
  assert.equal(r.code, 2);
  assert.equal(r.out, 'error: no-patch\n');
  assert.equal(r.read('x.txt'), 'a\n');
});

test('S1-09 -- ends options: option after -- plus PATCH is two positionals', () => {
  const r = runCli({ 'x.txt': 'a\n' }, UNI_CHANGE, ['--', '--check']);
  // argv: ['--', '--check', 'patch.diff'] -> positionals --check + patch.diff
  assert.equal(r.code, 2);
  assert.equal(r.out, 'error: usage\n');
  assert.equal(r.read('x.txt'), 'a\n');
});

test('S1-09 -- before PATCH: patch after -- is read normally', () => {
  const r = runCli({ 'x.txt': 'a\n' }, UNI_CHANGE, ['--']);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M x.txt\nok: 1 file\n');
  assert.equal(r.read('x.txt'), 'b\n');
});

// ---------- Batch 2: error precedence (S2-08, G4/G5) ----------

test('G4 usage wins over no-patch', () => {
  const r = runCli({}, null, ['--bogus', 'missing.diff']);
  assert.equal(r.code, 2);
  assert.equal(r.out, 'error: usage\n');
});

test('G4 usage wins over a parse error in the patch', () => {
  const r = runCli({}, '@@ x +y @@\n', ['--check', '--check']);
  assert.equal(r.code, 2);
  assert.equal(r.out, 'error: usage\n');
});

test('G4 duplicate --format wins over a missing patch file', () => {
  const r = runCli({}, null, ['--format=json', '--format=json', 'missing.diff']);
  assert.equal(r.code, 2);
  assert.equal(r.out, 'error: usage\n');
});

test('G5 parse error is reported before any file is looked at (unified, missing target)', () => {
  const r = runCli({}, '--- a/ghost.txt\n+++ b/ghost.txt\n@@ x +y @@\n-a\n');
  assert.equal(r.code, 2);
  assert.equal(r.out, 'error: parse 3\n');
  assert.equal(r.exists('ghost.txt'), false);
});

test('G5 parse error before file check (SEARCH/REPLACE, missing target)', () => {
  const r = runCli({}, 'ghost.txt\n<<<<<<< SEARCH\na\n');
  assert.equal(r.code, 2);
  assert.equal(r.out, 'error: parse 2\n');
  assert.equal(r.exists('ghost.txt'), false);
});

test('G5 parse error before file check (V4A, missing target)', () => {
  const r = runCli({}, '*** Begin Patch\n*** Update File: ghost.txt\n@@ anchor\n');
  assert.equal(r.code, 2);
  assert.equal(r.out, 'error: parse 4\n');
  assert.equal(r.exists('ghost.txt'), false);
});

test('G5 parse error before file check (JSON, missing target)', () => {
  const r = runCli({}, '{"command":\n');
  assert.equal(r.code, 2);
  assert.equal(r.out, 'error: parse 1\n');
  assert.equal(r.exists('ghost.txt'), false);
});

test('S2-08 parse wins over unsafe: malformed first section, unsafe second', () => {
  const patch = '--- a/x.txt\n+++ b/x.txt\n@@ x +y @@\n-a\n--- a/../evil.txt\n+++ b/../evil.txt\n@@ -1,1 +1,1 @@\n-a\n+b\n';
  const r = runCli({ 'x.txt': 'a\n' }, patch);
  assert.equal(r.code, 2);
  assert.equal(r.out, 'error: parse 3\n');
  assert.equal(r.read('x.txt'), 'a\n');
});

test('S2-08 no-patch wins over format: missing file with --format=json', () => {
  // One positional only (missing.diff); no patch.diff appended.
  const r = runCli({}, null, ['--format=json', 'missing.diff'], { noPatchArg: true });
  assert.equal(r.code, 2);
  assert.equal(r.out, 'error: no-patch\n');
});

// ---------- Batch 3: safe paths (S3-02, S2-14, G6/G7) ----------

const JSON_CREATE = (path, text = 'hi') =>
  JSON.stringify({ command: 'create', path, file_text: text });

test('G7 unsafe paths: .., ., empty segment, backslash, empty, trailing slash', () => {
  const bad = ['../x.txt', 'a/../x.txt', './x.txt', 'a//x.txt', 'a\\x.txt', '', 'a/', '.', '..', '/abs.txt'];
  for (const p of bad) {
    const r = runCli({}, JSON_CREATE(p));
    assert.equal(r.code, 1, JSON.stringify(p));
    assert.equal(r.out, `error: unsafe ${p}\nfailed: 1 of 1 edits\n`, JSON.stringify(p));
    assert.equal(r.exists('x.txt'), false, JSON.stringify(p));
  }
});

test('S2-14/G6 unified unsafe: error names the path AFTER the a/ prefix is removed', () => {
  const patch = '--- a/../x.txt\n+++ b/../x.txt\n@@ -1,1 +1,1 @@\n-a\n+b\n';
  const r = runCli({ 'x.txt': 'a\n' }, patch);
  assert.equal(r.code, 1);
  assert.equal(r.out, 'error: unsafe ../x.txt\nfailed: 1 of 1 edits\n');
  assert.equal(r.read('x.txt'), 'a\n');
});

test('S2-14 unified create with unsafe new path names the stripped path', () => {
  const patch = '--- /dev/null\n+++ b/../new.txt\n@@ -0,0 +1,1 @@\n+hi\n';
  const r = runCli({}, patch);
  assert.equal(r.code, 1);
  assert.equal(r.out, 'error: unsafe ../new.txt\nfailed: 1 of 1 edits\n');
  assert.equal(r.exists('new.txt'), false);
});

test('S3-02 SEARCH/REPLACE with unsafe path fails unsafe', () => {
  const patch = '../x\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n';
  const r = runCli({ 'x.txt': 'a\n' }, patch);
  assert.equal(r.code, 1);
  assert.equal(r.out, 'error: unsafe ../x\nfailed: 1 of 1 edits\n');
  assert.equal(r.read('x.txt'), 'a\n');
});

test('S3-02 ".." as a substring of a segment is safe', () => {
  const r = runCli({}, JSON_CREATE('a..b/c.txt', 'hi\n'));
  assert.equal(r.code, 0);
  assert.equal(r.out, 'A a..b/c.txt\nok: 1 file\n');
  assert.equal(r.read('a..b/c.txt'), 'hi\n');
});

test('S3-02 deep nested create makes directories', () => {
  const r = runCli({}, JSON_CREATE('d1/d2/d3/f.txt', 'x'));
  assert.equal(r.code, 0);
  assert.equal(r.read('d1/d2/d3/f.txt'), 'x');
});

// ---------- Batch 4: format detection (S4, G9, S4-07) ----------

test('G9/S4-01 blank = empty OR only-whitespace: V4A after whitespace-only lines', () => {
  const patch = '   \n\t\n*** Begin Patch\n*** Add File: n.txt\n+hi\n*** End Patch\n';
  const r = runCli({}, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'A n.txt\nok: 1 file\n');
  assert.equal(r.read('n.txt'), 'hi\n');
});

test('S4-03 JSON detected past leading spaces on the first line', () => {
  const r = runCli({}, '   {"command":"create","path":"n.txt","file_text":"hi"}');
  assert.equal(r.code, 0);
  assert.equal(r.out, 'A n.txt\nok: 1 file\n');
});

test('S4-04 indented <<<<<<< SEARCH is NOT a marker (leading whitespace)', () => {
  const patch = 'x.txt\n  <<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n';
  const r = runCli({ 'x.txt': 'a\n' }, patch);
  assert.equal(r.code, 2);
  assert.equal(r.out, 'error: format\n');
  assert.equal(r.read('x.txt'), 'a\n');
});

test('S4-04 <<<<<<< SEARCH with trailing whitespace IS a marker', () => {
  const patch = 'x.txt\n<<<<<<< SEARCH   \na\n=======\nb\n>>>>>>> REPLACE\n';
  const r = runCli({ 'x.txt': 'a\n' }, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M x.txt\nok: 1 file\n');
  assert.equal(r.read('x.txt'), 'b\n');
});

test('S4-06 empty patch and whitespace-only patch are error: format', () => {
  for (const p of ['', '   \n\t\n  \n']) {
    const r = runCli({}, p);
    assert.equal(r.code, 2, JSON.stringify(p));
    assert.equal(r.out, 'error: format\n', JSON.stringify(p));
  }
});

test('S4-07 named --format=json reads unified text as json (parse error)', () => {
  const r = runCli({ 'x.txt': 'a\n' }, UNI_CHANGE, ['--format=json']);
  assert.equal(r.code, 2);
  assert.equal(r.out, 'error: parse 1\n');
  assert.equal(r.read('x.txt'), 'a\n');
});

test('S4-07 named --format=unified reads JSON text as unified (parse 1, no edits)', () => {
  const r = runCli({ 'x.txt': 'a\n' }, JSON_REPLACE, ['--format=unified']);
  assert.equal(r.code, 2);
  assert.equal(r.out, 'error: parse 1\n');
  assert.equal(r.read('x.txt'), 'a\n');
});

test('S4-07 named format on an empty patch is parse 1, not format', () => {
  for (const f of ['--format=json', '--format=unified', '--format=v4a', '--format=search-replace']) {
    const r = runCli({}, '', [f]);
    assert.equal(r.code, 2, f);
    assert.equal(r.out, 'error: parse 1\n', f);
  }
});

test('S4-07 named --format=search-replace reads prose as search-replace (parse 1)', () => {
  const r = runCli({}, 'just some prose\nno blocks here\n', ['--format=search-replace']);
  assert.equal(r.code, 2);
  assert.equal(r.out, 'error: parse 1\n');
});

test('S4-05/S1-05 explicit --format=auto detects normally', () => {
  const r = runCli({ 'x.txt': 'a\n' }, UNI_CHANGE, ['--format=auto']);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M x.txt\nok: 1 file\n');
});

// ---------- Batch 5: output exactness (S2-17, S2-21, S2-22, S2-23) ----------

test('S2-17 rows are in UTF-8 byte order: B.md before a.md', () => {
  const patch = '[{"command":"create","path":"a.md","file_text":"x"},{"command":"create","path":"B.md","file_text":"y"}]';
  const r = runCli({}, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'A B.md\nA a.md\nok: 2 files\n');
});

test('S2-17 byte order: Z < _ < a', () => {
  const patch = '[{"command":"create","path":"a.txt","file_text":"1"},{"command":"create","path":"_x.txt","file_text":"2"},{"command":"create","path":"Z.txt","file_text":"3"}]';
  const r = runCli({}, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'A Z.txt\nA _x.txt\nA a.txt\nok: 3 files\n');
});

test('S2-23 unified hunk with only context lines is a no-op (ok: 0 files)', () => {
  const patch = '--- a/x.txt\n+++ b/x.txt\n@@ -1,2 +1,2 @@\n a\n b\n';
  const r = runCli({ 'x.txt': 'a\nb\n' }, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'ok: 0 files\n');
  assert.equal(r.read('x.txt'), 'a\nb\n');
});

test('S2-22 file changed then restored to the same bytes is not listed', () => {
  const patch = '[{"command":"str_replace","path":"x.txt","old_str":"a","new_str":"b"},{"command":"str_replace","path":"x.txt","old_str":"b","new_str":"a"}]';
  const r = runCli({ 'x.txt': 'a\n' }, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'ok: 0 files\n');
  assert.equal(r.read('x.txt'), 'a\n');
});

test('S2-21 two moves sort by <new> path', () => {
  const patch =
    '--- a/z.txt\n+++ b/m.txt\n@@ -1,2 +1,2 @@\n z1\n-z2\n+Z2\n' +
    '--- a/a.txt\n+++ b/y.txt\n@@ -1,1 +1,1 @@\n-a1\n+A1\n';
  const r = runCli({ 'z.txt': 'z1\nz2\n', 'a.txt': 'a1\n' }, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'R z.txt -> m.txt\nR a.txt -> y.txt\nok: 2 files\n');
  assert.equal(r.exists('z.txt'), false);
  assert.equal(r.exists('a.txt'), false);
  assert.equal(r.read('m.txt'), 'z1\nZ2\n');
  assert.equal(r.read('y.txt'), 'A1\n');
});

// ---------- Batch 6: files, lines and paths (S3-04..S3-11, G8) ----------

test('G8/S3-07 JSON insert into an empty file writes without a final break', () => {
  const patch = '{"command":"insert","path":"e.txt","insert_line":0,"new_str":"hello"}';
  const r = runCli({ 'e.txt': '' }, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M e.txt\nok: 1 file\n');
  assert.equal(r.read('e.txt'), 'hello');
});

test('G8/S3-07 unified change on an empty file is no-match', () => {
  const patch = '--- a/e.txt\n+++ b/e.txt\n@@ -1,1 +1,1 @@\n-a\n+b\n';
  const r = runCli({ 'e.txt': '' }, patch);
  assert.equal(r.code, 1);
  assert.equal(r.out, 'error: no-match e.txt\nfailed: 1 of 1 edits\n');
  assert.equal(r.read('e.txt'), '');
});

test('G8/S3-07 SEARCH/REPLACE create on an existing empty file is exists', () => {
  const patch = 'e.txt\n<<<<<<< SEARCH\n=======\nnew\n>>>>>>> REPLACE\n';
  const r = runCli({ 'e.txt': '' }, patch);
  assert.equal(r.code, 1);
  assert.equal(r.out, 'error: exists e.txt\nfailed: 1 of 1 edits\n');
  assert.equal(r.read('e.txt'), '');
});

test('S3-08 CRLF file edited in the middle keeps CRLF and no final break', () => {
  const patch = '--- a/x.txt\n+++ b/x.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n';
  const r = runCli({ 'x.txt': 'a\r\nb\r\nc' }, patch);
  assert.equal(r.code, 0);
  assert.equal(r.read('x.txt'), 'a\r\nB\r\nc');
});

test('S6-29/S3-08 unified hunk touching EOF adds a final break unless \\ follows', () => {
  const patch = '--- a/x.txt\n+++ b/x.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n';
  const r = runCli({ 'x.txt': 'a\nb' }, patch);
  assert.equal(r.code, 0);
  assert.equal(r.read('x.txt'), 'a\nB\n');
  const patchNoEol = '--- a/x.txt\n+++ b/x.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n\\ No newline at end of file\n';
  const r2 = runCli({ 'x.txt': 'a\nb' }, patchNoEol);
  assert.equal(r2.code, 0);
  assert.equal(r2.read('x.txt'), 'a\nB');
});

test('S3-10 JSON create writes file_text byte for byte (CRLF, no trailing break)', () => {
  const r = runCli({}, JSON_CREATE('n.txt', 'x\r\ny'));
  assert.equal(r.code, 0);
  assert.equal(r.read('n.txt'), 'x\r\ny');
  const r2 = runCli({}, JSON_CREATE('e.txt', ''));
  assert.equal(r2.code, 0);
  assert.equal(r2.out, 'A e.txt\nok: 1 file\n');
  assert.equal(r2.read('e.txt'), '');
});

test('S3-01 non-ASCII content round-trips exactly (CJK + emoji)', () => {
  const patch = '{"command":"str_replace","path":"x.txt","old_str":"héllo wörld","new_str":"héllo wörld!"}';
  const r = runCli({ 'x.txt': 'héllo wörld\nこんにちは\n🎉\n' }, patch);
  assert.equal(r.code, 0);
  assert.equal(r.read('x.txt'), 'héllo wörld!\nこんにちは\n🎉\n');
});

test('S3-11 patch lines with CRLF endings are read with the CR removed', () => {
  const patch = '--- a/x.txt\r\n+++ b/x.txt\r\n@@ -1,1 +1,1 @@\r\n-a\r\n+b\r\n';
  const r = runCli({ 'x.txt': 'a\n' }, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M x.txt\nok: 1 file\n');
  assert.equal(r.read('x.txt'), 'b\n');
});

test('S3-09 SEARCH/REPLACE create ends with a line break', () => {
  const patch = 'n.txt\n<<<<<<< SEARCH\n=======\nx\ny\n>>>>>>> REPLACE\n';
  const r = runCli({}, patch);
  assert.equal(r.code, 0);
  assert.equal(r.read('n.txt'), 'x\ny\n');
});

test('S8-15 V4A Add writes LF lines ended by a line break', () => {
  const patch = '*** Begin Patch\n*** Add File: n.txt\n+one\n+two\n*** End Patch\n';
  const r = runCli({}, patch);
  assert.equal(r.code, 0);
  assert.equal(r.read('n.txt'), 'one\ntwo\n');
});

// ---------- Batch 7: order and atomicity (§10, G27) ----------

test('S10-04 second of three edits fails: nothing is written', () => {
  const patch = '[{"command":"create","path":"a.txt","file_text":"A"},{"command":"str_replace","path":"ghost.txt","old_str":"x","new_str":"y"},{"command":"create","path":"b.txt","file_text":"B"}]';
  const r = runCli({}, patch);
  assert.equal(r.code, 1);
  assert.equal(r.out, 'error: missing ghost.txt\nfailed: 1 of 3 edits\n');
  assert.equal(r.exists('a.txt'), false);
  assert.equal(r.exists('b.txt'), false);
});

test('S10-03 failed edit changes nothing, later edits still run (both failures reported)', () => {
  const patch = '[{"command":"str_replace","path":"ghost.txt","old_str":"x","new_str":"y"},{"command":"str_replace","path":"x.txt","old_str":"zzz","new_str":"w"}]';
  const r = runCli({ 'x.txt': 'a\n' }, patch);
  assert.equal(r.code, 1);
  assert.equal(r.out, 'error: missing ghost.txt\nerror: no-match x.txt\nfailed: 2 of 2 edits\n');
  assert.equal(r.read('x.txt'), 'a\n');
});

test('S10-01/G27 create then edit the same file in one patch', () => {
  const patch = '[{"command":"create","path":"f.txt","file_text":"a\\n"},{"command":"str_replace","path":"f.txt","old_str":"a","new_str":"b"}]';
  const r = runCli({}, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'A f.txt\nok: 1 file\n');
  assert.equal(r.read('f.txt'), 'b\n');
});

test('S10-01 SEARCH/REPLACE block 2 sees block 1 output', () => {
  const patch = 'f.txt\n<<<<<<< SEARCH\none\n=======\ntwo\n>>>>>>> REPLACE\nf.txt\n<<<<<<< SEARCH\ntwo\n=======\nthree\n>>>>>>> REPLACE\n';
  const r = runCli({ 'f.txt': 'one\n' }, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M f.txt\nok: 1 file\n');
  assert.equal(r.read('f.txt'), 'three\n');
});

test('S10-01 unified create section then change section on the same file', () => {
  const patch =
    '--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,1 @@\n+hello\n' +
    '--- a/n.txt\n+++ b/n.txt\n@@ -1,1 +1,1 @@\n-hello\n+HELLO\n';
  const r = runCli({}, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'A n.txt\nok: 1 file\n');
  assert.equal(r.read('n.txt'), 'HELLO\n');
});

test('S10-01 move then edit the moved file', () => {
  const patch =
    '--- a/A.txt\n+++ b/B.txt\n@@ -1,1 +1,1 @@\n-old\n+new\n' +
    '--- a/B.txt\n+++ b/B.txt\n@@ -1,1 +1,1 @@\n-new\n+NEW\n';
  const r = runCli({ 'A.txt': 'old\n' }, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'R A.txt -> B.txt\nok: 1 file\n');
  assert.equal(r.exists('A.txt'), false);
  assert.equal(r.read('B.txt'), 'NEW\n');
});

test('S10-05 --check with failing edits: same output and exit as without, nothing written', () => {
  const patch = '[{"command":"create","path":"a.txt","file_text":"A"},{"command":"str_replace","path":"ghost.txt","old_str":"x","new_str":"y"}]';
  const checked = runCli({}, patch, ['--check']);
  const plain = runCli({}, patch);
  assert.equal(checked.code, 1);
  assert.equal(plain.code, 1);
  assert.equal(checked.out, plain.out);
  assert.equal(checked.out, 'error: missing ghost.txt\nfailed: 1 of 2 edits\n');
  assert.equal(checked.exists('a.txt'), false);
  assert.equal(plain.exists('a.txt'), false);
});

test('S10-05 --check success: same output as a real run, files untouched', () => {
  const checked = runCli({ 'x.txt': 'a\n' }, UNI_CHANGE, ['--check']);
  const plain = runCli({ 'x.txt': 'a\n' }, UNI_CHANGE);
  assert.equal(checked.code, 0);
  assert.equal(checked.out, plain.out);
  assert.equal(checked.out, 'M x.txt\nok: 1 file\n');
  assert.equal(checked.read('x.txt'), 'a\n');
  assert.equal(plain.read('x.txt'), 'b\n');
});

test('S10-02 safety is checked before anything else; later edits still run', () => {
  const patch = '[{"command":"create","path":"/abs/x.txt","file_text":"A"},{"command":"str_replace","path":"ghost.txt","old_str":"x","new_str":"y"}]';
  const r = runCli({}, patch);
  assert.equal(r.code, 1);
  assert.equal(r.out, 'error: unsafe /abs/x.txt\nerror: missing ghost.txt\nfailed: 2 of 2 edits\n');
});

test('S10-04 no directories are created when any edit fails', () => {
  const patch = '[{"command":"create","path":"d/f.txt","file_text":"A"},{"command":"str_replace","path":"ghost.txt","old_str":"x","new_str":"y"}]';
  const r = runCli({}, patch);
  assert.equal(r.code, 1);
  assert.equal(r.exists('d'), false);
  assert.equal(r.exists('d/f.txt'), false);
});

// ---------- Batch 8: stdin, no-arg, no-patch (S1-03, S1-04, S2-04) ----------

test('S1-04 no PATCH argument reads the patch from stdin', () => {
  const r = runCli({ 'x.txt': 'a\n' }, null, [], { noPatchArg: true, stdin: JSON_REPLACE });
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M x.txt\nok: 1 file\n');
  assert.equal(r.read('x.txt'), 'b\n');
});

test('S1-04 PATCH - reads the patch from stdin', () => {
  const r = runCli({ 'x.txt': 'a\n' }, null, ['-'], { noPatchArg: true, stdin: JSON_REPLACE });
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M x.txt\nok: 1 file\n');
  assert.equal(r.read('x.txt'), 'b\n');
});

test('S1-04/S1-06 stdin patch with --check writes nothing', () => {
  const r = runCli({ 'x.txt': 'a\n' }, null, ['-', '--check'], { noPatchArg: true, stdin: JSON_REPLACE });
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M x.txt\nok: 1 file\n');
  assert.equal(r.read('x.txt'), 'a\n');
});

test('S2-04 PATCH naming a directory is error: no-patch', () => {
  const r = runCli({ 'x.txt': 'a\n' }, null, [], {
    setup: (dir) => mkdirSync(join(dir, 'patch.diff')),
  });
  assert.equal(r.code, 2);
  assert.equal(r.out, 'error: no-patch\n');
  assert.equal(r.read('x.txt'), 'a\n');
});

test('S2-04 missing PATCH file is error: no-patch, exactly one line', () => {
  const r = runCli({ 'x.txt': 'a\n' }, null, ['gone.diff'], { noPatchArg: true });
  assert.equal(r.code, 2);
  assert.equal(r.out, 'error: no-patch\n');
  assert.equal(r.read('x.txt'), 'a\n');
});

test('S1-04/S4-06 empty stdin is error: format', () => {
  const r = runCli({}, null, [], { noPatchArg: true, stdin: '' });
  assert.equal(r.code, 2);
  assert.equal(r.out, 'error: format\n');
});

test('S2-01 the patch file itself is never modified by a run', () => {
  const r = runCli({ 'x.txt': 'a\n' }, UNI_CHANGE);
  assert.equal(r.code, 0);
  assert.equal(r.read('patch.diff'), UNI_CHANGE);
  const r2 = runCli({ 'x.txt': 'a\n' }, '@@ x +y @@\n');
  assert.equal(r2.code, 2);
  assert.equal(r2.read('patch.diff'), '@@ x +y @@\n');
});

// ---------- Batch 9: filesystem-collision corners (EXPLORATORY) ----------
// No SPEC sentence defines these outcomes: the generator builds consistent
// trees, so the sealed pool almost certainly never produces them. These
// tests DOCUMENT the current behaviour (uncaught write error -> exit 1,
// empty stdout) so a future change is visible; they are NOT spec assertions.

test('EXPLORATORY create nested path under an existing file: exit 1, empty stdout', () => {
  const r = runCli({ a: 'file\n' }, JSON_CREATE('a/b.txt', 'x'));
  assert.equal(r.code, 1);
  assert.equal(r.out, '');
  assert.equal(r.read('a'), 'file\n');
  assert.equal(r.exists('a/b.txt'), false);
});

test('EXPLORATORY create a file where a directory of the same name exists', () => {
  const r = runCli({}, JSON_CREATE('d', 'x'), [], {
    setup: (dir) => mkdirSync(join(dir, 'd')),
  });
  assert.equal(r.code, 1);
  assert.equal(r.out, '');
  assert.equal(r.exists('d'), true);
});




