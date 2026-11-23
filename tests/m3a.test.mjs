// M3a unit tests — Unified diff (§6) parser + applier.
// TDD: ditulis dulu, dilihat gagal (RED), baru implementasi di main.ts.
// Jalankan: node --test tests/m3a.test.mjs   (dari repo/)
// Pemetaan butir SPEC (spec-inventory.md) -> tes:
//   S6-01..S6-13  -> parseUnified (section, header, parse error)
//   S6-14..S6-17  -> parseUnified (hunk, body)
//   S6-18..S6-31  -> unifiedEdits / applyUnifiedHunk (section edit, nearest, insert, noeol)
//   S2-21         -> baris R (move) via runCheck
//   A2, A7, A21   -> adversarial kedua bacaan (parent yang putuskan)
//   A12, A20      -> mengikuti bacaan M1 (lihat tes)

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseUnified,
  sectionKind,
  hunkON,
  applyUnifiedHunk,
  unifiedEdits,
} from '../main.ts';
import { runCheck } from '../runner.ts';

// ---------- parseUnified: section starts (S6-01) ----------

test('parse: diff --git starts a section with its paths', () => {
  const secs = parseUnified(['diff --git a/x.js b/y.js', 'index abc..def 100644', '--- a/x.js', '+++ b/y.js']);
  assert.equal(secs.length, 1);
  assert.equal(secs[0].oldPath, 'x.js');
  assert.equal(secs[0].newPath, 'y.js');
  assert.deepEqual(secs[0].hunks, []);
});

test('parse: bare ---/+++ starts a section', () => {
  const secs = parseUnified(['--- a/x.js', '+++ b/x.js']);
  assert.equal(secs.length, 1);
  assert.equal(secs[0].oldPath, 'x.js');
  assert.equal(secs[0].newPath, 'x.js');
});

test('parse: multiple sections', () => {
  const secs = parseUnified([
    'diff --git a/a.js b/a.js', '--- a/a.js', '+++ b/a.js',
    'diff --git a/b.js b/b.js', '--- a/b.js', '+++ b/b.js',
  ]);
  assert.equal(secs.length, 2);
  assert.equal(secs[0].oldPath, 'a.js');
  assert.equal(secs[1].oldPath, 'b.js');
});

test('parse: no sections returns empty array', () => {
  assert.deepEqual(parseUnified(['just prose', '', 'more prose']), []);
});

// ---------- parseUnified: header paths (S6-03..S6-06) ----------

test('parse: path strips a/ and b/ prefixes', () => {
  const secs = parseUnified(['--- a/deep/path.js', '+++ b/deep/path.js']);
  assert.equal(secs[0].oldPath, 'deep/path.js');
  assert.equal(secs[0].newPath, 'deep/path.js');
});

test('parse: path without prefix stays as-is', () => {
  const secs = parseUnified(['--- config.py', '+++ config.py']);
  assert.equal(secs[0].oldPath, 'config.py');
  assert.equal(secs[0].newPath, 'config.py');
});

test('parse: path cut at first tab, surrounding spaces removed (S6-04)', () => {
  const secs = parseUnified(['--- a/foo.js\t2024-01-01 00:00:00', '+++ b/foo.js\t2024-01-01 00:00:00']);
  assert.equal(secs[0].oldPath, 'foo.js');
  assert.equal(secs[0].newPath, 'foo.js');
  const secs2 = parseUnified(['---   a/bar.js   ', '+++   b/bar.js   ']);
  assert.equal(secs2[0].oldPath, 'bar.js');
  assert.equal(secs2[0].newPath, 'bar.js');
});

test('parse: /dev/null means no file (S6-05)', () => {
  const secs = parseUnified(['--- /dev/null', '+++ b/new.js']);
  assert.equal(secs[0].oldPath, null);
  assert.equal(secs[0].newPath, 'new.js');
  const secs2 = parseUnified(['--- a/old.js', '+++ /dev/null']);
  assert.equal(secs2[0].oldPath, 'old.js');
  assert.equal(secs2[0].newPath, null);
});

// ---------- parseUnified: rename + diff --git fallback (S6-07, S6-09) ----------

test('parse: rename from/to used when no ---/+++ pair (S6-07)', () => {
  const secs = parseUnified([
    'diff --git a/old.js b/new.js',
    'similarity index 93%',
    'rename from old.js',
    'rename to new.js',
  ]);
  assert.equal(secs[0].oldPath, 'old.js');
  assert.equal(secs[0].newPath, 'new.js');
});

test('parse: ---/+++ pair wins over rename lines (S6-07)', () => {
  const secs = parseUnified([
    'diff --git a/a.js b/b.js',
    'rename from renamed-old.js',
    'rename to renamed-new.js',
    '--- a/pair-old.js',
    '+++ b/pair-new.js',
  ]);
  assert.equal(secs[0].oldPath, 'pair-old.js');
  assert.equal(secs[0].newPath, 'pair-new.js');
});

test('parse: diff --git paths used when nothing else names one (S6-09, GAP G12)', () => {
  const secs = parseUnified(['diff --git a/only.js b/only.js', 'index abc..def 100644']);
  assert.equal(secs[0].oldPath, 'only.js');
  assert.equal(secs[0].newPath, 'only.js');
});

// ---------- parseUnified: mode flags + ignored lines (S6-08, S6-10) ----------

test('parse: new file mode marks creation (S6-08)', () => {
  const secs = parseUnified(['diff --git a/n.js b/n.js', 'new file mode 100644', '--- /dev/null', '+++ b/n.js']);
  assert.equal(secs[0].newFileMode, true);
  assert.equal(secs[0].deletedFileMode, false);
  assert.equal(sectionKind(secs[0]), 'create');
});

test('parse: deleted file mode marks deletion (S6-08)', () => {
  const secs = parseUnified(['diff --git a/o.js b/o.js', 'deleted file mode 100644', '--- a/o.js', '+++ /dev/null']);
  assert.equal(secs[0].newFileMode, false);
  assert.equal(secs[0].deletedFileMode, true);
  assert.equal(sectionKind(secs[0]), 'delete');
});

test('parse: index/mode/similarity/Index lines ignored (S6-10)', () => {
  const secs = parseUnified([
    'diff --git a/x.js b/x.js',
    'index abc..def 100644',
    'old mode 100644',
    'new mode 100755',
    'similarity index 93%',
    'dissimilarity index 12%',
    'Index: something',
    'whatever else',
    '--- a/x.js',
    '+++ b/x.js',
  ]);
  assert.equal(secs.length, 1);
  assert.equal(secs[0].oldPath, 'x.js');
  assert.equal(secs[0].newPath, 'x.js');
});

test('parse: prose before first section ignored (S6-17)', () => {
  const secs = parseUnified(['I updated the function.', '', '```diff', '--- a/x.js', '+++ b/x.js']);
  assert.equal(secs.length, 1);
  assert.equal(secs[0].oldPath, 'x.js');
});

// ---------- parseUnified: parse errors (S6-11, S6-12) ----------

test('parse error: diff --git without b/ part (S6-12)', () => {
  assert.throws(() => parseUnified(['diff --git a/foo']), (e) => e.line === 'error: parse 1');
});

test('parse error: diff --git without a/ b/ prefixes (S6-12)', () => {
  assert.throws(() => parseUnified(['diff --git foo bar', '--- a/foo', '+++ b/bar']), (e) => e.line === 'error: parse 1');
});

test('parse error: diff --git with trailing junk (S6-12)', () => {
  assert.throws(() => parseUnified(['diff --git a/x b/y extra']), (e) => e.line === 'error: parse 1');
});

test('parse error: lone --- in header names the line after it (S6-11)', () => {
  // '--- a/x' di baris 2, tidak diikuti '+++ ' -> parse 3 (baris sesudahnya)
  assert.throws(
    () => parseUnified(['diff --git a/x b/x', '--- a/x', '@@ -1,1 +1,1 @@']),
    (e) => e.line === 'error: parse 3',
  );
});

test('parse error: lone --- as last line of header (S6-11)', () => {
  assert.throws(() => parseUnified(['diff --git a/x b/x', '--- a/x']), (e) => e.line === 'error: parse 3');
});

test('parse: lone --- outside any section is prose, not an error (S6-11)', () => {
  assert.deepEqual(parseUnified(['--- a/x', 'some prose']), []);
});

// ---------- parseUnified: hunk headers (S6-13, S6-14) ----------

test('parse: hunk header with counts and trailing text (S6-13, S6-14)', () => {
  const secs = parseUnified(['--- a/x', '+++ b/x', '@@ -3,10 +3,9 @@ func foo', ' ctx', '-old', '+new']);
  assert.equal(secs[0].hunks.length, 1);
  assert.equal(secs[0].hunks[0].a, 3);
  assert.deepEqual(secs[0].hunks[0].body, [
    { kind: 'context', text: 'ctx', backslashAfter: false },
    { kind: 'old', text: 'old', backslashAfter: false },
    { kind: 'new', text: 'new', backslashAfter: false },
  ]);
});

test('parse: hunk header without counts (S6-13)', () => {
  const secs = parseUnified(['--- a/x', '+++ b/x', '@@ -1 +1 @@', ' a']);
  assert.equal(secs[0].hunks[0].a, 1);
});

test('parse: hunk header A=0 (insertion/creation)', () => {
  const secs = parseUnified(['--- /dev/null', '+++ b/n', '@@ -0,0 +1,5 @@', '+a', '+b']);
  assert.equal(secs[0].hunks[0].a, 0);
});

test('parse error: malformed @@ missing dash (S6-13, u-parse #2)', () => {
  assert.throws(
    () => parseUnified(['--- docs/field_price.go', '+++ docs/field_price.go', '@@ 14,9 +14,10 @@']),
    (e) => e.line === 'error: parse 3',
  );
});

test('parse error: @@ without closing @@ (S6-13)', () => {
  assert.throws(
    () => parseUnified(['--- a/x', '+++ b/x', '@@ -1,2 +3,4']),
    (e) => e.line === 'error: parse 3',
  );
});

test('parse error: @@ with non-numeric counts (S6-13)', () => {
  assert.throws(
    () => parseUnified(['--- a/x', '+++ b/x', '@@ -x +y @@']),
    (e) => e.line === 'error: parse 3',
  );
});

test('parse error: hunk before any section (S6-13)', () => {
  assert.throws(() => parseUnified(['@@ -1,1 +1,1 @@', ' a']), (e) => e.line === 'error: parse 1');
});

// ---------- parseUnified: body classification (S6-15, S6-16) ----------

test('parse: backslash line attaches to the body line before it (S6-28)', () => {
  const secs = parseUnified(['--- a/x', '+++ b/x', '@@ -1,2 +1,2 @@', ' a', '+b', '\\ No newline at end of file']);
  assert.deepEqual(secs[0].hunks[0].body, [
    { kind: 'context', text: 'a', backslashAfter: false },
    { kind: 'new', text: 'b', backslashAfter: true },
  ]);
});

test('parse: empty line is a context line with empty text (S6-15)', () => {
  const secs = parseUnified(['--- a/x', '+++ b/x', '@@ -1,3 +1,3 @@', ' a', '', ' b']);
  assert.deepEqual(secs[0].hunks[0].body, [
    { kind: 'context', text: 'a', backslashAfter: false },
    { kind: 'context', text: '', backslashAfter: false },
    { kind: 'context', text: 'b', backslashAfter: false },
  ]);
});

test('parse: trailing empty lines stripped, space-only line kept (S6-16)', () => {
  const secs = parseUnified(['--- a/x', '+++ b/x', '@@ -1,2 +1,2 @@', ' a', '', '']);
  assert.deepEqual(secs[0].hunks[0].body, [{ kind: 'context', text: 'a', backslashAfter: false }]);
  const secs2 = parseUnified(['--- a/x', '+++ b/x', '@@ -1,2 +1,2 @@', ' a', ' ']);
  assert.deepEqual(secs2[0].hunks[0].body, [
    { kind: 'context', text: 'a', backslashAfter: false },
    { kind: 'context', text: '', backslashAfter: false },
  ]);
});

test('parse: backslash as first body line refers to nothing (ignored)', () => {
  const secs = parseUnified(['--- a/x', '+++ b/x', '@@ -1,1 +1,1 @@', '\\ No newline at end of file', ' a']);
  assert.deepEqual(secs[0].hunks[0].body, [{ kind: 'context', text: 'a', backslashAfter: false }]);
});

test('parse: body ends at diff --git (S6-16)', () => {
  const secs = parseUnified([
    '--- a/x', '+++ b/x', '@@ -1,1 +1,1 @@', ' a',
    'diff --git a/y b/y', '--- a/y', '+++ b/y', '@@ -1,1 +1,1 @@', ' b',
  ]);
  assert.equal(secs.length, 2);
  assert.equal(secs[0].hunks.length, 1);
  assert.equal(secs[1].hunks.length, 1);
});

test('parse: body ends at ---/+++ pair, new section (S6-16)', () => {
  const secs = parseUnified([
    '--- a/x', '+++ b/x', '@@ -1,1 +1,1 @@', ' a',
    '--- a/y', '+++ b/y', '@@ -1,1 +1,1 @@', ' b',
  ]);
  assert.equal(secs.length, 2);
  assert.equal(secs[0].hunks[0].body.length, 1);
});

test('parse: body ends at other line, next @@ is a new hunk in the same section (S6-16, A12)', () => {
  const secs = parseUnified([
    '--- a/x', '+++ b/x', '@@ -1,1 +1,1 @@', ' a',
    'index abc..def 100644',
    '@@ -5,1 +5,1 @@', ' b',
  ]);
  assert.equal(secs.length, 1);
  assert.equal(secs[0].hunks.length, 2);
  assert.equal(secs[0].hunks[1].a, 5);
});

test('parse: header line after first hunk ignored, hunks continue (A12)', () => {
  const secs = parseUnified([
    'diff --git a/x b/x', '--- a/x', '+++ b/x',
    '@@ -1,1 +1,1 @@', ' a',
    'index xyz..abc 100644',
    '@@ -3,1 +3,1 @@', ' b',
  ]);
  assert.equal(secs.length, 1);
  assert.equal(secs[0].hunks.length, 2);
});

// ---------- hunkON (S6-24) ----------

test('hunkON: O is context+old, N is context+new, contextOf aligned (S6-24)', () => {
  const hunk = {
    a: 1,
    body: [
      { kind: 'context', text: 'a', backslashAfter: false },
      { kind: 'old', text: 'b', backslashAfter: false },
      { kind: 'new', text: 'B', backslashAfter: false },
      { kind: 'context', text: 'c', backslashAfter: false },
    ],
  };
  assert.deepEqual(hunkON(hunk), {
    O: ['a', 'b', 'c'],
    N: ['a', 'B', 'c'],
    contextOf: [0, null, 2],
  });
});

test('hunkON: pure insertion has empty O (S6-27)', () => {
  const hunk = { a: 9, body: [{ kind: 'new', text: 'x', backslashAfter: false }] };
  assert.deepEqual(hunkON(hunk), { O: [], N: ['x'], contextOf: [null] });
});

// ---------- applyUnifiedHunk (S6-24..S6-29) ----------

const st = (lines, final = true) => ({ lines, br: '\n', final });
const hunk = (a, body) => ({ a, body });
const ctx = (text, backslashAfter = false) => ({ kind: 'context', text, backslashAfter });
const old = (text, backslashAfter = false) => ({ kind: 'old', text, backslashAfter });
const nw = (text, backslashAfter = false) => ({ kind: 'new', text, backslashAfter });

test('applyUnifiedHunk: replaces nearest occurrence to A-1+d (S6-26)', () => {
  const r = applyUnifiedHunk(st(['a', 'b', 'c', 'b', 'd']), hunk(4, [old('b'), nw('B')]), 0, false);
  assert.deepEqual(r.lines, ['a', 'b', 'c', 'B', 'd']);
  assert.equal(r.d, 0);
});

test('applyUnifiedHunk: ties go to the earlier occurrence (S6-26)', () => {
  const r = applyUnifiedHunk(st(['b', 'x', 'b']), hunk(2, [old('b'), nw('B')]), 0, false);
  assert.deepEqual(r.lines, ['B', 'x', 'b']);
});

test('applyUnifiedHunk: d shifts the target (S6-25, S6-26)', () => {
  const r = applyUnifiedHunk(st(['a', 'b', 'c', 'b', 'd']), hunk(2, [old('b'), nw('B')]), 2, false);
  assert.deepEqual(r.lines, ['a', 'b', 'c', 'B', 'd']);
});

test('applyUnifiedHunk: no-match throws (S6-26)', () => {
  assert.throws(
    () => applyUnifiedHunk(st(['a', 'b']), hunk(1, [old('z'), nw('Z')]), 0, false),
    (e) => e.line === 'error: no-match',
  );
});

test('applyUnifiedHunk: strict only tier 0 (S5-06)', () => {
  assert.throws(
    () => applyUnifiedHunk(st([' b']), hunk(1, [old('b'), nw('B')]), 0, true),
    (e) => e.line === 'error: no-match',
  );
  // tanpa strict: tier 2 cocok, 'B' di-re-indent literal (A16) jadi ' B'
  const r = applyUnifiedHunk(st([' b']), hunk(1, [old('b'), nw('B')]), 0, false);
  assert.deepEqual(r.lines, [' B']);
});

test('applyUnifiedHunk: context line written as the file own line (S5-11)', () => {
  const r = applyUnifiedHunk(st([' a', 'b']), hunk(1, [ctx('a'), old('b'), nw('B')]), 0, false);
  assert.deepEqual(r.lines, [' a', ' B']);
});

test('applyUnifiedHunk: empty O inserts after first A+d lines (S6-27)', () => {
  const r = applyUnifiedHunk(st(['a', 'b', 'c']), hunk(1, [nw('x')]), 0, false);
  assert.deepEqual(r.lines, ['a', 'x', 'b', 'c']);
  assert.equal(r.d, 1);
});

test('applyUnifiedHunk: empty O with A=0 inserts at the top (S6-27)', () => {
  const r = applyUnifiedHunk(st(['a', 'b']), hunk(0, [nw('x')]), 0, false);
  assert.deepEqual(r.lines, ['x', 'a', 'b']);
});

test('applyUnifiedHunk: empty O clamped to the end, final break added (S6-27)', () => {
  const r = applyUnifiedHunk(st(['a'], false), hunk(99, [nw('x')]), 0, false);
  assert.deepEqual(r.lines, ['a', 'x']);
  assert.equal(r.final, true);
});

test('applyUnifiedHunk: backslash after last + line at EOF removes final break (S6-28)', () => {
  const r = applyUnifiedHunk(st(['a', 'b']), hunk(2, [old('b'), nw('B', true)]), 0, false);
  assert.deepEqual(r.lines, ['a', 'B']);
  assert.equal(r.final, false);
});

test('applyUnifiedHunk: no backslash at EOF keeps final break (S6-29)', () => {
  const r = applyUnifiedHunk(st(['a', 'b']), hunk(2, [old('b'), nw('B')]), 0, false);
  assert.deepEqual(r.lines, ['a', 'B']);
  assert.equal(r.final, true);
});

test('applyUnifiedHunk: final break unchanged when match does not run to EOF', () => {
  const r = applyUnifiedHunk(st(['a', 'b', 'c'], false), hunk(1, [old('a'), nw('A')]), 0, false);
  assert.deepEqual(r.lines, ['A', 'b', 'c']);
  assert.equal(r.final, false);
});

test('applyUnifiedHunk: insertion at end with backslash after last + line, no final break', () => {
  const r = applyUnifiedHunk(st(['a']), hunk(1, [nw('x', true)]), 0, false);
  assert.deepEqual(r.lines, ['a', 'x']);
  assert.equal(r.final, false);
});

test('applyUnifiedHunk: empty hunk is a no-op (A7 reading a)', () => {
  const r = applyUnifiedHunk(st(['a', 'b']), hunk(1, []), 0, false);
  assert.deepEqual(r.lines, ['a', 'b']);
  assert.equal(r.d, 0);
  assert.equal(r.final, true);
});

// ---------- unifiedEdits + CLI wiring (S6-18..S6-22, S2-14) ----------

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const mainTs = join(repoDir, 'main.ts');

const tmpDirs = [];
after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function cli(files, patch, args = []) {
  const dir = mkdtempSync(join(tmpdir(), 'm3a-'));
  tmpDirs.push(dir);
  for (const [p, content] of Object.entries(files)) writeFileSync(join(dir, p), content);
  writeFileSync(join(dir, 'patch.diff'), patch);
  const r = spawnSync('node', [mainTs, ...args, 'patch.diff'], { cwd: dir, encoding: 'utf8' });
  const read = (p) => (existsSync(join(dir, p)) ? readFileSync(join(dir, p), 'utf8') : null);
  return { code: r.status, out: r.stdout, err: r.stderr, read, exists: (p) => existsSync(join(dir, p)) };
}

test('unifiedEdits: one Edit per section (S6-18)', () => {
  const edits = unifiedEdits(['--- a/x', '+++ b/x', '@@ -1,1 +1,1 @@', ' a', '--- a/y', '+++ b/y', '@@ -1,1 +1,1 @@', ' b'], false);
  assert.equal(edits.length, 2);
});

test('cli: unified change edit applies, M row (S6-18)', () => {
  const r = cli(
    { 'x.txt': 'a\nb\nc\n' },
    '--- a/x.txt\n+++ b/x.txt\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n',
  );
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M x.txt\nok: 1 file\n');
  assert.equal(r.read('x.txt'), 'a\nB\nc\n');
});

test('cli: unified create writes new file, A row (S6-19)', () => {
  const r = cli({}, '--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n');
  assert.equal(r.code, 0);
  assert.equal(r.out, 'A n.txt\nok: 1 file\n');
  assert.equal(r.read('n.txt'), 'one\ntwo\n');
});

test('cli: unified delete removes file, D row (S6-20)', () => {
  const r = cli(
    { 'x.txt': 'a\nb\n' },
    '--- a/x.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n',
  );
  assert.equal(r.code, 0);
  assert.equal(r.out, 'D x.txt\nok: 1 file\n');
  assert.equal(r.exists('x.txt'), false);
});

test('cli: unified move renames with content change, R row counts as 1 file (S6-21, S6-22)', () => {
  const r = cli(
    { 'old.txt': 'a\nb\n' },
    '--- a/old.txt\n+++ b/new.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n',
  );
  assert.equal(r.code, 0);
  assert.equal(r.out, 'R old.txt -> new.txt\nok: 1 file\n');
  assert.equal(r.exists('old.txt'), false);
  assert.equal(r.read('new.txt'), 'a\nB\n');
});

test('cli: pure rename with no hunks still moves, R row (S6-21)', () => {
  const r = cli({ 'old.txt': 'a\nb\n' }, '--- a/old.txt\n+++ b/new.txt\n');
  assert.equal(r.code, 0);
  assert.equal(r.out, 'R old.txt -> new.txt\nok: 1 file\n');
  assert.equal(r.read('new.txt'), 'a\nb\n');
});

test('cli: R row sorts by the new path (S6-22)', () => {
  const r = cli(
    { 'old.txt': 'a\n', 'm.txt': 'x\n' },
    '--- a/old.txt\n+++ b/a.txt\n@@ -1,1 +1,1 @@\n-a\n+A\n--- a/m.txt\n+++ b/m.txt\n@@ -1,1 +1,1 @@\n-x\n+X\n',
  );
  assert.equal(r.code, 0);
  assert.equal(r.out, 'R old.txt -> a.txt\nM m.txt\nok: 2 files\n');
});

test('cli: no-match reports error: no-match <path>, exit 1, file unchanged (S6-26, S2-14)', () => {
  const r = cli(
    { 'x.txt': 'a\nb\n' },
    '--- a/x.txt\n+++ b/x.txt\n@@ -1,2 +1,2 @@\n a\n-z\n+Z\n',
  );
  assert.equal(r.code, 1);
  assert.equal(r.out, 'error: no-match x.txt\nfailed: 1 of 1 edits\n');
  assert.equal(r.read('x.txt'), 'a\nb\n');
});

test('cli: create of an existing file reports error: exists (S2-14)', () => {
  const r = cli({ 'n.txt': 'old\n' }, '--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,1 @@\n+new\n');
  assert.equal(r.code, 1);
  assert.equal(r.out, 'error: exists n.txt\nfailed: 1 of 1 edits\n');
  assert.equal(r.read('n.txt'), 'old\n');
});

test('cli: delete of a missing file reports error: missing (S2-14)', () => {
  const r = cli({}, '--- a/x.txt\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-a\n');
  assert.equal(r.code, 1);
  assert.equal(r.out, 'error: missing x.txt\nfailed: 1 of 1 edits\n');
});

test('cli: --check reports M without writing', () => {
  const r = cli(
    { 'x.txt': 'a\nb\n' },
    '--- a/x.txt\n+++ b/x.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n',
    ['--check'],
  );
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M x.txt\nok: 1 file\n');
  assert.equal(r.read('x.txt'), 'a\nb\n');
});

test('cli: two sections in one patch, both apply (S6-18)', () => {
  const r = cli(
    { 'a.txt': '1\n', 'b.txt': '2\n' },
    '--- a/a.txt\n+++ b/a.txt\n@@ -1,1 +1,1 @@\n-1\n+one\n--- a/b.txt\n+++ b/b.txt\n@@ -1,1 +1,1 @@\n-2\n+two\n',
  );
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M a.txt\nM b.txt\nok: 2 files\n');
  assert.equal(r.read('a.txt'), 'one\n');
  assert.equal(r.read('b.txt'), 'two\n');
});

test('cli: creation ignores context and - lines, file is + lines only (A20)', () => {
  const r = cli(
    {},
    '--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,3 @@\n context\n-gone\n+kept\n',
  );
  assert.equal(r.code, 0);
  assert.equal(r.read('n.txt'), 'kept\n');
});

// ---------- Ambiguities (M1): adversarial cases ----------
// A2: `\` after a `-` line at EOF.
//   Reading (a) LITERAL S6-29 — only the hunk's last context or `+` line counts;
//   a `\` after a deleted line does not suppress the final break.
//   Reading (b) — the `\` suppresses the final break anyway (the deleted line
//   was the last line, so "no newline at end of file" describes the result).
//   The two readings differ exactly here: (a) final=true, (b) final=false.
test('A2 adversarial: backslash after - line at EOF, literal reading (a)', () => {
  const r = applyUnifiedHunk(st(['a', 'b']), hunk(1, [ctx('a'), old('b', true)]), 0, false);
  assert.deepEqual(r.lines, ['a']);
  assert.equal(r.final, true); // reading (b) would give false
});

// A7: hunk body entirely empty lines.
//   Reading (a) strip-all — S6-16 "empty lines at the end of a body are not
//   part of it", mechanically the whole body is at the end, so the body is
//   empty and the hunk is a vacuous success (insert []).
//   Reading (b) — the empty lines are context lines (O = ['', '']), so the
//   hunk only succeeds when the file has that many consecutive empty lines.
//   The two readings differ on a file with no empty lines: (a) succeeds,
//   (b) fails no-match.
test('A7 adversarial: all-empty body strips to nothing, vacuous success (a)', () => {
  const secs = parseUnified(['--- a/x', '+++ b/x', '@@ -1,0 +1,0 @@', '', '']);
  assert.deepEqual(secs[0].hunks[0].body, []); // reading (b) would give 2 context lines
});

test('A7 adversarial CLI: all-empty hunk on a file with no empty lines succeeds (a)', () => {
  const r = cli({ 'x.txt': 'a\nb\n' }, '--- a/x.txt\n+++ b/x.txt\n@@ -1,0 +1,0 @@\n\n\n');
  assert.equal(r.code, 0); // reading (b) would give exit 1, error: no-match x.txt
  assert.equal(r.out, 'ok: 0 files\n');
  assert.equal(r.read('x.txt'), 'a\nb\n');
});

// A21: malformed `@@` in a deletion section.
//   Reading (a) parse error still applies — S6-13 is unconditional and S2-08
//   puts parse before everything; only well-formed hunk contents are "not read".
//   Reading (b) — a deletion needs no hunk at all, so a malformed hunk line
//   inside a deletion section is never read and cannot be a parse error.
//   The two readings differ here: (a) exit 2 error: parse 3, file kept;
//   (b) exit 0, file deleted.
test('A21 adversarial: malformed @@ in a deletion section is a parse error (a)', () => {
  assert.throws(
    () => parseUnified(['--- a/x', '+++ /dev/null', '@@ -x +y @@']),
    (e) => e.line === 'error: parse 3',
  );
});

test('A21 adversarial CLI: malformed @@ in deletion, parse error, file kept (a)', () => {
  const r = cli({ 'x.txt': 'a\n' }, '--- a/x.txt\n+++ /dev/null\n@@ -x +y @@\n-a\n');
  assert.equal(r.code, 2); // reading (b) would give exit 0, D x.txt
  assert.equal(r.out, 'error: parse 3\n');
  assert.equal(r.read('x.txt'), 'a\n');
});

test('A2 adversarial CLI: backslash after - line at EOF keeps the final break (a)', () => {
  const r = cli({ 'x.txt': 'a\nb\n' }, '--- a/x.txt\n+++ b/x.txt\n@@ -1,2 +1,1 @@\n a\n-b\n\\ No newline at end of file\n');
  assert.equal(r.code, 0);
  assert.equal(r.read('x.txt'), 'a\n'); // reading (b) would give 'a' (no trailing break)
});

test('cli: deletion hunks are not read, non-matching hunk still deletes (S6-20)', () => {
  const r = cli(
    { 'x.txt': 'a\nb\n' },
    '--- a/x.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-ZZZ-NOT-IN-FILE\n',
  );
  assert.equal(r.code, 0);
  assert.equal(r.out, 'D x.txt\nok: 1 file\n');
  assert.equal(r.exists('x.txt'), false);
});

test('cli: created file ends without a break when backslash follows its last + line (S6-30)', () => {
  const r = cli(
    {},
    '--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n\\ No newline at end of file\n',
  );
  assert.equal(r.code, 0);
  assert.equal(r.read('n.txt'), 'one\ntwo');
});
