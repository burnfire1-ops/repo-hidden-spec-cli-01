// M2 unit tests — matcher 3 tier + primitif baris/file.
// TDD: ditulis dulu, dilihat gagal (RED), baru implementasi di main.ts.
// Jalankan: node --test tests/m2.test.mjs   (dari repo/)
// Pemetaan butir SPEC (spec-inventory.md) -> tes:
//   S5-01..S5-13  -> findOccurrences / reindentTier2 / applyReplacement
//   S3-04..S3-09  -> splitFileLines / joinFileLines
//   S3-11         -> patchLines (sudah ada di starter; tes di sini sebagai jangkar)
//   GAP G10       -> overlap test
//   A16           -> kedua bacaan P-kosong (literal vs konservatif)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findOccurrences,
  reindentTier2,
  applyReplacement,
  splitFileLines,
  joinFileLines,
  patchLines,
} from '../main.ts';

// ---------- findOccurrences: tier 0 (S5-03) ----------

test('tier0: exact match, single position', () => {
  assert.deepEqual(findOccurrences(['b'], ['a', 'b', 'c'], false), { tier: 0, positions: [1] });
});

test('tier0: exact match, several positions in order', () => {
  assert.deepEqual(findOccurrences(['x'], ['x', 'y', 'x', 'x'], false), { tier: 0, positions: [0, 2, 3] });
});

test('tier0: multi-line O', () => {
  assert.deepEqual(findOccurrences(['b', 'c'], ['a', 'b', 'c', 'd'], false), { tier: 0, positions: [1] });
});

test('tier0: no match returns null', () => {
  assert.equal(findOccurrences(['z'], ['a', 'b'], false), null);
});

test('tier0: empty O returns null (O kosong ditangani M3a sebagai insert, bukan match)', () => {
  assert.equal(findOccurrences([], ['a', 'b'], false), null);
});

// ---------- findOccurrences: tier 1 (S5-04) ----------

test('tier1: trailing spaces/tabs ignored on both sides', () => {
  // file punya trailing ws, O tidak — tier 0 gagal, tier 1 kena
  assert.deepEqual(findOccurrences(['b'], ['a', 'b   ', 'c'], false), { tier: 1, positions: [1] });
  assert.deepEqual(findOccurrences(['b\t'], ['a', 'b', 'c'], false), { tier: 1, positions: [1] });
  assert.deepEqual(findOccurrences(['b '], ['a', 'b\t', 'c'], false), { tier: 1, positions: [1] });
});

test('tier1: leading whitespace still matters', () => {
  assert.equal(findOccurrences(['b'], ['  b'], false)?.tier, 2);
});

// ---------- findOccurrences: tier 2 (S5-05) ----------

test('tier2: leading+trailing spaces/tabs ignored', () => {
  assert.deepEqual(findOccurrences(['b'], ['a', '  b\t ', 'c'], false), { tier: 2, positions: [1] });
  assert.deepEqual(findOccurrences(['  b  '], ['a', '\tb', 'c'], false), { tier: 2, positions: [1] });
});

test('tier2: inner whitespace still matters', () => {
  assert.equal(findOccurrences(['a b'], ['a  b'], false), null);
});

// ---------- findOccurrences: tier precedence (S5-02) ----------

test('tier precedence: tier 0 wins over tier 1 and 2', () => {
  // 'b' exact di 0, 'b ' (trailing) juga ada di 2
  assert.deepEqual(findOccurrences(['b'], ['b', 'b ', '  b'], false), { tier: 0, positions: [0] });
});

test('tier precedence: tier 1 wins over tier 2', () => {
  assert.deepEqual(findOccurrences(['b'], ['b ', '  b'], false), { tier: 1, positions: [0] });
});

// ---------- findOccurrences: strict (S5-06) ----------

test('strict: only tier 0 tried', () => {
  assert.deepEqual(findOccurrences(['b'], ['b'], true), { tier: 0, positions: [0] });
  assert.equal(findOccurrences(['b'], ['b '], true), null);
  assert.equal(findOccurrences(['b'], ['  b'], true), null);
});

// ---------- findOccurrences: overlap (S5-08, GAP G10) ----------

test('overlap: occurrences may overlap', () => {
  assert.deepEqual(findOccurrences(['a', 'a'], ['a', 'a', 'a'], false), { tier: 0, positions: [0, 1] });
});

test('overlap: single-line O in repeated lines', () => {
  assert.deepEqual(findOccurrences(['a'], ['a', 'a', 'a'], false), { tier: 0, positions: [0, 1, 2] });
});

// ---------- reindentTier2 (S5-12) ----------

test('reindent: P replaced by F on lines starting with P', () => {
  // O pertama '  foo', file pertama '    foo' -> P='  ', F='    '
  const out = reindentTier2(['  bar', '  baz'], ['  foo'], ['x', '    foo', 'y'], 1, 'literal');
  assert.deepEqual(out, ['    bar', '    baz']);
});

test('reindent: lines not starting with P written as-is', () => {
  const out = reindentTier2(['  bar', 'qux', '   deep'], ['  foo'], ['    foo'], 0, 'literal');
  assert.deepEqual(out, ['    bar', 'qux', '     deep']);
});

test('reindent: empty and whitespace-only lines written as-is', () => {
  const out = reindentTier2(['  bar', '', '   ', '\t'], ['  foo'], ['    foo'], 0, 'literal');
  assert.deepEqual(out, ['    bar', '', '   ', '\t']);
});

test('reindent: tabs in P/F preserved as-is', () => {
  const out = reindentTier2(['\tbar'], ['\tfoo'], ['  foo'], 0, 'literal');
  assert.deepEqual(out, ['  bar']);
});

// ---------- reindentTier2: A16, P kosong — KEDUA bacaan ----------

test('A16 literal: P="" -> every non-empty N line gets F prepended', () => {
  // O pertama 'foo' (P=''), file pertama '  foo' (F='  ')
  const out = reindentTier2(['bar', 'baz', ''], ['foo'], ['  foo'], 0, 'literal');
  assert.deepEqual(out, ['  bar', '  baz', '']);
});

test('A16 conservative: P="" -> no re-indent at all', () => {
  const out = reindentTier2(['bar', 'baz', ''], ['foo'], ['  foo'], 0, 'conservative');
  assert.deepEqual(out, ['bar', 'baz', '']);
});

test('A16: both readings agree when P is non-empty', () => {
  const a = reindentTier2(['  bar'], ['  foo'], ['    foo'], 0, 'literal');
  const b = reindentTier2(['  bar'], ['  foo'], ['    foo'], 0, 'conservative');
  assert.deepEqual(a, b);
  assert.deepEqual(a, ['    bar']);
});

// ---------- applyReplacement (S5-10, S5-11, S5-13) ----------

test('apply: N replaces the k matched lines (tier 0)', () => {
  const lines = ['a', 'b', 'c', 'd'];
  assert.deepEqual(applyReplacement(lines, 1, ['b', 'c'], ['B', 'C'], 0, [null, null], 'literal'), ['a', 'B', 'C', 'd']);
});

test('apply: empty N deletes the matched lines', () => {
  assert.deepEqual(applyReplacement(['a', 'b', 'c'], 1, ['b'], [], 0, [], 'literal'), ['a', 'c']);
});

test('apply: tier 0/1 lines of N written as-is (S5-13)', () => {
  assert.deepEqual(applyReplacement(['a', 'b '], 1, ['b'], ['  B\t'], 1, [null], 'literal'), ['a', '  B\t']);
});

test('apply: context line written as the file line, never the patch line (S5-11)', () => {
  // file line 'b ' (trailing spasi), patch context line 'b' — hasil harus 'b ' (file)
  const out = applyReplacement(['a', 'b ', 'c'], 1, ['b', 'c'], ['b', 'C'], 1, [0, null], 'literal');
  assert.deepEqual(out, ['a', 'b ', 'C']);
});

test('apply: tier 2 re-indents non-context N lines', () => {
  // P='  ' (O pertama), F='    ' (file pertama) -> '  B' jadi '    B'
  const out = applyReplacement(['    b'], 0, ['  b'], ['  B'], 2, [null], 'literal');
  assert.deepEqual(out, ['    B']);
});

test('apply: original lines array not mutated', () => {
  const lines = ['a', 'b', 'c'];
  applyReplacement(lines, 1, ['b'], ['B'], 0, [null], 'literal');
  assert.deepEqual(lines, ['a', 'b', 'c']);
});

// ---------- splitFileLines / joinFileLines (S3-04..S3-09) ----------

test('split: LF with final break (S3-04, S3-06)', () => {
  assert.deepEqual(splitFileLines('a\nb\n'), { lines: ['a', 'b'], br: '\n', final: true });
});

test('split: LF without final break (S3-06)', () => {
  assert.deepEqual(splitFileLines('a\nb'), { lines: ['a', 'b'], br: '\n', final: false });
});

test('split: CRLF when first LF follows CR (S3-04)', () => {
  assert.deepEqual(splitFileLines('a\r\nb\r\n'), { lines: ['a', 'b'], br: '\r\n', final: true });
});

test('split: CRLF without final break', () => {
  assert.deepEqual(splitFileLines('a\r\nb'), { lines: ['a', 'b'], br: '\r\n', final: false });
});

test('split: empty file has no lines and no final break (S3-07)', () => {
  assert.deepEqual(splitFileLines(''), { lines: [], br: '\n', final: false });
});

test('split: single line, no break', () => {
  assert.deepEqual(splitFileLines('a'), { lines: ['a'], br: '\n', final: false });
});

test('split: one empty line with final break', () => {
  assert.deepEqual(splitFileLines('\n'), { lines: [''], br: '\n', final: true });
});

test('split: first LF decides the break (mixed file)', () => {
  // LF pertama di "a\n" -> LF; sisa '\r' menempel di baris
  assert.deepEqual(splitFileLines('a\nb\r\n'), { lines: ['a', 'b\r'], br: '\n', final: true });
});

test('join: round-trip LF / CRLF / no-final / empty (S3-08)', () => {
  for (const text of ['a\nb\n', 'a\nb', 'a\r\nb\r\n', 'a\r\nb', '', 'a', '\n', 'a\n\nb\n']) {
    const s = splitFileLines(text);
    assert.equal(joinFileLines(s.lines, s.br, s.final), text, `round-trip ${JSON.stringify(text)}`);
  }
});

test('join: file of no lines is written empty (S3-07)', () => {
  assert.equal(joinFileLines([], '\n', false), '');
  assert.equal(joinFileLines([], '\r\n', false), '');
});

test('join: final break exactly when it ended with one (S3-08)', () => {
  assert.equal(joinFileLines(['a', 'b'], '\n', true), 'a\nb\n');
  assert.equal(joinFileLines(['a', 'b'], '\n', false), 'a\nb');
  assert.equal(joinFileLines(['a', 'b'], '\r\n', true), 'a\r\nb\r\n');
});

// ---------- patchLines anchor (S3-11, sudah di starter) ----------

test('patchLines: split at \\n, one trailing \\r removed, no empty piece after final \\n', () => {
  assert.deepEqual(patchLines('a\r\nb\n'), ['a', 'b']);
  assert.deepEqual(patchLines(''), []);
  assert.deepEqual(patchLines('a'), ['a']);
});
