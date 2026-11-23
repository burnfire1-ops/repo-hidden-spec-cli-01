// M5 — decided ambiguities (parent decisions, SPEC-grounded) + nuance items.
// Method: every test is written from the SPEC sentence + the parent's recorded
// decision in spec-inventory.md, not from the code. A test that passes confirms
// the implementation matches the DECIDED reading; a test that fails is a bug
// (or a misderived expectation — re-derive from SPEC, never from the code).
// The alternative readings are recorded as sealed risks, never implemented.
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

// files: {path: content}; patch: patch text or null; args: CLI args before the
// patch argument; opts: {stdin, patchName, noPatchArg, setup(dir)}.
function runCli(files, patch, args = [], opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'm5-'));
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

// ---------- A2 (S6-29): `\` after a `-` line does NOT suppress the final break ----------

test('A2 (a) literal: backslash after a `-` line keeps the final break', () => {
  // File "a\nb" has NO final break. Hunk replaces b with c; the `\` line
  // follows the `-b` line, not the last context/`+` line, so S6-29's
  // unless-clause does not fire and the result ends WITH a break.
  const patch = '--- a/x.txt\n+++ b/x.txt\n@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+c\n';
  const r = runCli({ 'x.txt': 'a\nb' }, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M x.txt\nok: 1 file\n');
  assert.equal(r.read('x.txt'), 'a\nc\n');
});

test('A2 control: backslash after a `+` line DOES suppress the final break', () => {
  const patch = '--- a/x.txt\n+++ b/x.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n\\ No newline at end of file\n';
  const r = runCli({ 'x.txt': 'a\nb\n' }, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M x.txt\nok: 1 file\n');
  assert.equal(r.read('x.txt'), 'a\nc');
});

// ---------- A7 (S6-16): an all-empty hunk body strips to a vacuous no-op ----------

test('A7 (a) strip-all: one empty body line is a no-op, ok: 0 files', () => {
  // Reading (b) (empty line = context O=['']) would say no-match on a file
  // with no empty line; the decided reading strips it and succeeds vacuously.
  const patch = '--- a/x.txt\n+++ b/x.txt\n@@ -1,1 +1,1 @@\n\n';
  const r = runCli({ 'x.txt': 'a\nb\n' }, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'ok: 0 files\n');
  assert.equal(r.read('x.txt'), 'a\nb\n');
});

test('A7 (a) strip-all: two empty body lines are a no-op too', () => {
  const patch = '--- a/x.txt\n+++ b/x.txt\n@@ -1,1 +1,1 @@\n\n\n';
  const r = runCli({ 'x.txt': 'a\nb\n' }, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'ok: 0 files\n');
  assert.equal(r.read('x.txt'), 'a\nb\n');
});

// ---------- A16 (S5-12): tier-2 re-indent, literal reading when P is empty ----------

test('A16 LITERAL: S/R tier-2, empty P prepends F to every non-empty N line', () => {
  // O[0] "foo();" has no leading whitespace (P=""); the matched file line
  // is indented two spaces (F="  "); every non-empty N line gets "  ".
  const patch = 'x.txt\n<<<<<<< SEARCH\nfoo();\n=======\nbaz();\nqux();\n>>>>>>> REPLACE\n';
  const r = runCli({ 'x.txt': '  foo();\n  bar();\n' }, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M x.txt\nok: 1 file\n');
  assert.equal(r.read('x.txt'), '  baz();\n  qux();\n  bar();\n');
});

test('A16 LITERAL: unified tier-2, empty P prepends F to the N line', () => {
  const patch = '--- a/x.txt\n+++ b/x.txt\n@@ -1,1 +1,2 @@\n-x = 1;\n+  z = 3;\n';
  const r = runCli({ 'x.txt': '  x = 1;\n  y = 2;\n' }, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M x.txt\nok: 1 file\n');
  assert.equal(r.read('x.txt'), '    z = 3;\n  y = 2;\n');
});

// ---------- A21 (S6-20): a malformed `@@` in a deletion section is a parse error ----------

test('A21 (a): malformed @@ in a deletion section is error: parse 3', () => {
  const patch = '--- a/x.txt\n+++ /dev/null\n@@ -1,1 +1,1\n-a\n';
  const r = runCli({ 'x.txt': 'a\n' }, patch);
  assert.equal(r.code, 2);
  assert.equal(r.out, 'error: parse 3\n');
  assert.equal(r.read('x.txt'), 'a\n');
});

test('A21 control (S6-20): a deletion with a well-formed non-matching hunk still deletes', () => {
  const patch = '--- a/x.txt\n+++ /dev/null\n@@ -1,1 +1,1 @@\n-qqq\n';
  const r = runCli({ 'x.txt': 'zzz\n' }, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'D x.txt\nok: 1 file\n');
  assert.equal(r.exists('x.txt'), false);
});

// ---------- A12 (S6-02/S6-16): a header line after the first hunk is ignored ----------

test('A12: index line after the first hunk is ignored, second @@ starts a new hunk', () => {
  const patch =
    '--- a/x.txt\n+++ b/x.txt\n@@ -1,1 +1,1 @@\n-a\n+x\nindex deadbeef..1234567 100644\n@@ -3,1 +3,1 @@\n-c\n+z\n';
  const r = runCli({ 'x.txt': 'a\nb\nc\n' }, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M x.txt\nok: 1 file\n');
  assert.equal(r.read('x.txt'), 'x\nb\nz\n');
});

// ---------- A20 (S6-19): context/`-` lines in a creation hunk are ignored ----------

test('A20: creation hunk with context and `-` lines yields only the `+` lines', () => {
  const patch = '--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,3 @@\n context-ignored\n-old-ignored\n+keep1\n+keep2\n';
  const r = runCli({}, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'A new.txt\nok: 1 file\n');
  assert.equal(r.read('new.txt'), 'keep1\nkeep2\n');
});

// ---------- B1 (S7-05): `=======` with no `>>>>>>> REPLACE` is a parse error ----------

test('B1 (a): SEARCH with ======= but no >>>>>>> REPLACE is error: parse <SEARCH line>', () => {
  const patch = 'x.txt\n<<<<<<< SEARCH\na\n=======\nb\n';
  const r = runCli({ 'x.txt': 'a\n' }, patch);
  assert.equal(r.code, 2);
  assert.equal(r.out, 'error: parse 2\n');
  assert.equal(r.read('x.txt'), 'a\n');
});

// ---------- B2 (S7-05): a nested `<<<<<<< SEARCH` is swallowed as an old line ----------

test('B2 (i): nested SEARCH line is an old line, scan continues', () => {
  const patch = 'x.txt\n<<<<<<< SEARCH\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n';
  const r = runCli({ 'x.txt': '<<<<<<< SEARCH\na\n' }, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M x.txt\nok: 1 file\n');
  assert.equal(r.read('x.txt'), 'b\n');
});

// ---------- B3 (S7-03): a marker-like line IS the path ----------

test('B3 LITERAL: a ======= line is the path (only blank + fence lines are skipped)', () => {
  const patch = '=======\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n';
  const r = runCli({ '=======': 'a\n' }, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M =======\nok: 1 file\n');
  assert.equal(r.read('======='), 'b\n');
});

// ---------- B4 (S7-08): empty old + empty new creates an empty file ----------

test('B4 (a): old empty + new empty creates an empty file', () => {
  const patch = 'new.txt\n<<<<<<< SEARCH\n=======\n>>>>>>> REPLACE\n';
  const r = runCli({}, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'A new.txt\nok: 1 file\n');
  assert.equal(r.read('new.txt'), '');
});

// ---------- C1 (S8-04): `*** Add File:` without the trailing space is not a section start ----------

test('C1 STRICT: *** Add File: with no space is not a section start (parse its line)', () => {
  const patch = '*** Begin Patch\n*** Add File:\n+hi\n*** End Patch\n';
  const r = runCli({}, patch);
  assert.equal(r.code, 2);
  assert.equal(r.out, 'error: parse 2\n');
});

// ---------- C2 (S8-05): blank lines with no chunk open are ignored ----------

test('C2: blank line after an Update File header, before the first chunk, is ignored', () => {
  const patch = '*** Begin Patch\n*** Update File: x.txt\n\n@@ a\n b\n+c\n*** End Patch\n';
  const r = runCli({ 'x.txt': 'a\nb\n' }, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M x.txt\nok: 1 file\n');
  assert.equal(r.read('x.txt'), 'a\nb\nc\n');
});

test('C2: whitespace-only line after *** End of File, before the next chunk, is ignored', () => {
  // Chunk 1 is an end-of-file chunk (S8-12/S8-21): its O must end at the
  // file's last line, so O=['d'] with anchor 'c'. After it the cursor is at
  // the end of the file, so chunk 2 can only be an unanchored insertion
  // (bare `@@` = no anchor, S8-10); the whitespace-only line between them
  // is the C2 element under test.
  const patch =
    '*** Begin Patch\n*** Update File: x.txt\n@@ c\n d\n+y\n*** End of File\n   \n@@\n+TAIL\n*** End Patch\n';
  const r = runCli({ 'x.txt': 'a\nb\nc\nd\n' }, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M x.txt\nok: 1 file\n');
  assert.equal(r.read('x.txt'), 'a\nb\nc\nd\ny\nTAIL\n');
});

test('C2: blank lines before *** Begin Patch are ignored (first non-blank line)', () => {
  const patch = '\n\n*** Begin Patch\n*** Add File: n.txt\n+hi\n*** End Patch\n';
  const r = runCli({}, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'A n.txt\nok: 1 file\n');
  assert.equal(r.read('n.txt'), 'hi\n');
});

// ---------- C3 (S8-15): an Add section with zero lines creates an empty file ----------

test('C3 (a): Add File section with no lines creates an empty file', () => {
  const patch = '*** Begin Patch\n*** Add File: empty.txt\n*** End Patch\n';
  const r = runCli({}, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'A empty.txt\nok: 1 file\n');
  assert.equal(r.read('empty.txt'), '');
});

// ---------- Nuances (inventory note, not GAPs) ----------

test('S2-17 nuance: output rows sort in byte order, B.md before a.md', () => {
  const patch =
    '[{"command":"create","path":"a.md","file_text":"a"},' +
    '{"command":"create","path":"B.md","file_text":"b"}]';
  const r = runCli({}, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'A B.md\nA a.md\nok: 2 files\n');
  assert.equal(r.read('B.md'), 'b');
  assert.equal(r.read('a.md'), 'a');
});

test('S3-01 nuance: CJK/emoji content is preserved byte for byte', () => {
  const patch = '--- a/x.txt\n+++ b/x.txt\n@@ -1,2 +1,2 @@\n héllo 🌍\n-世界\n+世界！🎉\n';
  const r = runCli({ 'x.txt': 'héllo 🌍\n世界\n' }, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M x.txt\nok: 1 file\n');
  assert.equal(r.read('x.txt'), 'héllo 🌍\n世界！🎉\n');
});

test('S9-09 nuance: JSON str_replace is exact, no tier — trailing-space old_str is no-match', () => {
  const patch = '{"command":"str_replace","path":"x.txt","old_str":"a ","new_str":"b"}';
  const r = runCli({ 'x.txt': 'a\n' }, patch);
  assert.equal(r.code, 1);
  assert.equal(r.out, 'error: no-match x.txt\nfailed: 1 of 1 edits\n');
  assert.equal(r.read('x.txt'), 'a\n');
});

test('S9-09 control: JSON str_replace substring match still applies', () => {
  const patch = '{"command":"str_replace","path":"x.txt","old_str":"a","new_str":"b"}';
  const r = runCli({ 'x.txt': 'a \n' }, patch);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M x.txt\nok: 1 file\n');
  assert.equal(r.read('x.txt'), 'b \n');
});
