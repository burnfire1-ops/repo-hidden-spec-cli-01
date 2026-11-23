// M3c unit tests — V4A patches (§8) parser + applier.
// TDD: ditulis dulu, dilihat gagal (RED), baru implementasi di main.ts.
// Jalankan: node --test tests/m3c.test.mjs   (dari repo/)
// Pemetaan butir SPEC (spec-inventory.md) -> tes:
//   S8-01..S8-13  -> parseV4a (framing, section, chunk)
//   S8-14..S8-24  -> v4aEdits (add/delete/update/move, cursor, anchor, EOF)
//   S2-10..S2-23  -> baris M/A/D/R + failed, via CLI
//   C1, C2, C3    -> ambiguitas §8 (parent yang putuskan)

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseV4a } from '../main.ts';

// ---------- framing: Begin / End Patch (S8-02) ----------

test('parse: empty patch is error: parse 1 (S8-02)', () => {
  assert.throws(() => parseV4a([]), (e) => e.line === 'error: parse 1');
  assert.throws(() => parseV4a(['', '  ', '']), (e) => e.line === 'error: parse 1');
});

test('parse: first non-blank line must be Begin Patch (S8-02)', () => {
  assert.throws(
    () => parseV4a(['*** Update File: a.js', ' x', '*** End Patch']),
    (e) => e.line === 'error: parse 1',
  );
  assert.throws(
    () => parseV4a(['', 'prose', '*** Begin Patch', '*** End Patch']),
    (e) => e.line === 'error: parse 2',
  );
});

test('parse: missing End Patch is error: parse <lines+1> (S8-02, v-parse)', () => {
  // Mirrors v-parse d293e30b: 7 lines, no End Patch -> parse 8.
  assert.throws(
    () =>
      parseV4a([
        '*** Begin Patch',
        '*** Update File: pkg/record.py',
        '     if ledger_total > graph.graph:',
        '         return graph.build(ledger_total)',
        '-    return ledger_total * 2',
        '+    # sync the item limit',
        '+    return draft_total * 2',
      ]),
    (e) => e.line === 'error: parse 8',
  );
});

test('parse: trailing blank lines count toward lines+1 (S8-02)', () => {
  assert.throws(
    () => parseV4a(['*** Begin Patch', '*** Update File: a.js', ' x', '']),
    (e) => e.line === 'error: parse 5',
  );
});

test('parse: blank lines around Begin/End Patch are ignored (S8-02)', () => {
  const s = parseV4a(['', '  *** Begin Patch  ', '*** Add File: a.js', '+x', '', '*** End Patch', '']);
  assert.equal(s.length, 1);
  assert.equal(s[0].kind, 'add');
});

test('parse: non-blank line after End Patch is error: parse <lines+1> (S8-02)', () => {
  assert.throws(
    () => parseV4a(['*** Begin Patch', '*** Add File: a.js', '+x', '*** End Patch', 'stray']),
    (e) => e.line === 'error: parse 6',
  );
});

// ---------- sections (S8-04, S8-05, S8-06) ----------

test('parse: section kinds + paths trimmed (S8-04)', () => {
  const s = parseV4a([
    '*** Begin Patch',
    '*** Add File:   a.js  ',
    '+x',
    '*** Delete File: b.js',
    '*** Update File: c.js',
    ' y',
    '*** End Patch',
  ]);
  assert.equal(s.length, 3);
  assert.equal(s[0].kind, 'add');
  assert.equal(s[0].path, 'a.js');
  assert.equal(s[1].kind, 'delete');
  assert.equal(s[1].path, 'b.js');
  assert.equal(s[2].kind, 'update');
  assert.equal(s[2].path, 'c.js');
});

test('parse: blank lines between sections are ignored (S8-05)', () => {
  const s = parseV4a([
    '*** Begin Patch',
    '',
    '*** Add File: a.js',
    '+x',
    '',
    '',
    '*** Delete File: b.js',
    '',
    '*** End Patch',
  ]);
  assert.equal(s.length, 2);
  assert.deepEqual(s[0].lines, ['x']);
});

test('parse: stray line between Begin and first section is error (S8-06)', () => {
  assert.throws(
    () => parseV4a(['*** Begin Patch', 'prose here', '*** Add File: a.js', '+x', '*** End Patch']),
    (e) => e.line === 'error: parse 2',
  );
});

test('parse: second Begin Patch is error (S8-06)', () => {
  assert.throws(
    () =>
      parseV4a(['*** Begin Patch', '*** Add File: a.js', '+x', '*** Begin Patch', '*** End Patch']),
    (e) => e.line === 'error: parse 4',
  );
});

test('C1: *** Add File: with no space/path is error, not a section (strict prefix)', () => {
  assert.throws(
    () => parseV4a(['*** Begin Patch', '*** Add File:', '+x', '*** End Patch']),
    (e) => e.line === 'error: parse 2',
  );
});

test('parse: *** End of File inside an Add section is error (S8-06)', () => {
  assert.throws(
    () =>
      parseV4a(['*** Begin Patch', '*** Add File: a.js', '+x', '*** End of File', '*** End Patch']),
    (e) => e.line === 'error: parse 4',
  );
});

test('parse: body line between sections is error (S8-06)', () => {
  assert.throws(
    () =>
      parseV4a(['*** Begin Patch', '*** Add File: a.js', '+x', ' stray', '*** End Patch']),
    (e) => e.line === 'error: parse 4',
  );
});

// ---------- Add File (S8-07, S8-03) ----------

test('parse: Add lines are + lines or empty lines (S8-07)', () => {
  const s = parseV4a([
    '*** Begin Patch',
    '*** Add File: a.md',
    '+# Title',
    '+',
    '',
    '+## Body',
    '',
    '+tail',
    '*** End Patch',
  ]);
  assert.deepEqual(s[0].lines, ['# Title', '', '', '## Body', '', 'tail']);
});

test('parse: blank lines at the end of an Add section are stripped, + kept (S8-03, C7)', () => {
  const s = parseV4a([
    '*** Begin Patch',
    '*** Add File: a.md',
    '+x',
    '+',
    '',
    '',
    '*** End Patch',
  ]);
  // Trailing truly-blank patch lines are not part of the section; a trailing
  // `+` line (empty file line, not a blank patch line) is kept.
  assert.deepEqual(s[0].lines, ['x', '']);
});

test('parse: Add line not starting with + and not blank is error (S8-07)', () => {
  assert.throws(
    () => parseV4a(['*** Begin Patch', '*** Add File: a.js', '-x', '*** End Patch']),
    (e) => e.line === 'error: parse 3',
  );
});

// ---------- Delete File (S8-08) ----------

test('parse: Delete File section has no lines (S8-08)', () => {
  const s = parseV4a([
    '*** Begin Patch',
    '*** Delete File: b.js',
    '',
    '*** Add File: a.js',
    '+x',
    '*** End Patch',
  ]);
  assert.equal(s.length, 2);
  assert.equal(s[0].kind, 'delete');
});

test('parse: non-blank line in a Delete section is error (S8-08)', () => {
  assert.throws(
    () => parseV4a(['*** Begin Patch', '*** Delete File: b.js', '+x', '*** End Patch']),
    (e) => e.line === 'error: parse 3',
  );
});

// ---------- Update File: Move to + chunks (S8-09..S8-13) ----------

test('parse: Update with Move to first line + @@ chunk (S8-09, S8-10)', () => {
  const s = parseV4a([
    '*** Begin Patch',
    '*** Update File: old.js',
    '*** Move to: new.js',
    '@@ function f() {',
    ' x',
    '-old',
    '+new',
    '*** End Patch',
  ]);
  assert.equal(s.length, 1);
  assert.equal(s[0].kind, 'update');
  assert.equal(s[0].moveTo, 'new.js');
  assert.equal(s[0].chunks.length, 1);
  assert.equal(s[0].chunks[0].anchor, 'function f() {');
  assert.equal(s[0].chunks[0].eof, false);
  assert.deepEqual(
    s[0].chunks[0].body.map((b) => [b.kind, b.text]),
    [
      ['context', 'x'],
      ['old', 'old'],
      ['new', 'new'],
    ],
  );
});

test('parse: first chunk starts at a body line, no anchor (S8-10)', () => {
  const s = parseV4a(['*** Begin Patch', '*** Update File: a.js', ' one', '-two', '+three', '*** End Patch']);
  assert.equal(s[0].chunks.length, 1);
  assert.equal(s[0].chunks[0].anchor, null);
});

test('parse: @@ with empty text is no anchor; anchor is trimmed (S8-10)', () => {
  const s = parseV4a([
    '*** Begin Patch',
    '*** Update File: a.js',
    '@@',
    ' x',
    '@@   def g():  ',
    ' y',
    '*** End Patch',
  ]);
  assert.equal(s[0].chunks.length, 2);
  assert.equal(s[0].chunks[0].anchor, null);
  assert.equal(s[0].chunks[1].anchor, 'def g():');
});

test('parse: body lines are space/-/+ or empty (S8-11)', () => {
  const s = parseV4a([
    '*** Begin Patch',
    '*** Update File: a.js',
    ' ctx',
    '',
    ' ',
    '-old',
    '+new',
    '*** End Patch',
  ]);
  // The ` ` (space-only) line mid-chunk is an empty context line and is kept;
  // a space-only line at the very end would be stripped (S8-03, see below).
  assert.deepEqual(
    s[0].chunks[0].body.map((b) => [b.kind, b.text]),
    [
      ['context', 'ctx'],
      ['context', ''],
      ['context', ''],
      ['old', 'old'],
      ['new', 'new'],
    ],
  );
});

test('parse: trailing space-only line at end of section is stripped (S8-03, v-cursor)', () => {
  // Proof from practice v-cursor eeb74bea: the chunk ends with a ` ` line
  // before `*** End Patch`, and the file's matching occurrence has no
  // trailing empty line — the reference still succeeds, so a whitespace-only
  // line at the end of a section is a "blank line" (starter blank() =
  // trim() === ''), unlike S6-16 "empty lines" (zero-length only, M3a).
  const s = parseV4a([
    '*** Begin Patch',
    '*** Update File: a.js',
    ' ctx',
    '-old',
    '+new',
    ' ',
    '*** End Patch',
  ]);
  assert.deepEqual(
    s[0].chunks[0].body.map((b) => [b.kind, b.text]),
    [
      ['context', 'ctx'],
      ['old', 'old'],
      ['new', 'new'],
    ],
  );
});

test('parse: *** End of File ends a chunk and anchors it to EOF (S8-12)', () => {
  const s = parseV4a([
    '*** Begin Patch',
    '*** Update File: a.js',
    ' x',
    '-old',
    '+new',
    '*** End of File',
    '*** End Patch',
  ]);
  assert.equal(s[0].chunks.length, 1);
  assert.equal(s[0].chunks[0].eof, true);
});

test('parse: second chunk after End of File starts at @@ (S8-12)', () => {
  const s = parseV4a([
    '*** Begin Patch',
    '*** Update File: a.js',
    ' x',
    '*** End of File',
    '@@ anchor2',
    ' y',
    '*** End Patch',
  ]);
  assert.equal(s[0].chunks.length, 2);
  assert.equal(s[0].chunks[0].eof, true);
  assert.equal(s[0].chunks[1].eof, false);
  assert.equal(s[0].chunks[1].anchor, 'anchor2');
});

test('parse: Update with no chunk and no Move to is error at its Update line (S8-13)', () => {
  assert.throws(
    () => parseV4a(['*** Begin Patch', '*** Update File: a.js', '*** End Patch']),
    (e) => e.line === 'error: parse 2',
  );
  assert.throws(
    () => parseV4a(['*** Begin Patch', '*** Add File: z.js', '+q', '*** Update File: a.js', '*** End Patch']),
    (e) => e.line === 'error: parse 4',
  );
});

test('parse: Update with Move to only is a valid rename, no chunks (S8-13)', () => {
  const s = parseV4a(['*** Begin Patch', '*** Update File: a.js', '*** Move to: b.js', '*** End Patch']);
  assert.equal(s[0].chunks.length, 0);
  assert.equal(s[0].moveTo, 'b.js');
});

test('parse: Move to after chunks started is error (S8-09)', () => {
  assert.throws(
    () =>
      parseV4a([
        '*** Begin Patch',
        '*** Update File: a.js',
        ' x',
        '*** Move to: b.js',
        '*** End Patch',
      ]),
    (e) => e.line === 'error: parse 4',
  );
});

test('parse: body line after End of File without @@ is error (C5)', () => {
  assert.throws(
    () =>
      parseV4a([
        '*** Begin Patch',
        '*** Update File: a.js',
        ' x',
        '*** End of File',
        ' y',
        '*** End Patch',
      ]),
    (e) => e.line === 'error: parse 5',
  );
});

test('parse: End of File with no open chunk is error (C6)', () => {
  assert.throws(
    () =>
      parseV4a(['*** Begin Patch', '*** Update File: a.js', '*** End of File', '*** End Patch']),
    (e) => e.line === 'error: parse 3',
  );
});

test('C2: blank line before the first chunk body line is ignored, chunk starts later', () => {
  const s = parseV4a(['*** Begin Patch', '*** Update File: a.js', '', ' x', '-old', '+new', '*** End Patch']);
  assert.equal(s[0].chunks.length, 1);
  assert.deepEqual(
    s[0].chunks[0].body.map((b) => [b.kind, b.text]),
    [
      ['context', 'x'],
      ['old', 'old'],
      ['new', 'new'],
    ],
  );
});

test('C2: blank line after End of File is ignored', () => {
  const s = parseV4a([
    '*** Begin Patch',
    '*** Update File: a.js',
    ' x',
    '*** End of File',
    '',
    '@@ next',
    ' y',
    '*** End Patch',
  ]);
  assert.equal(s[0].chunks.length, 2);
  assert.equal(s[0].chunks[1].anchor, 'next');
});

test('parse: trailing blank lines at the end of an Update section are stripped (S8-03)', () => {
  const s = parseV4a([
    '*** Begin Patch',
    '*** Update File: a.js',
    ' x',
    '-old',
    '+new',
    '',
    '',
    '*** End Patch',
  ]);
  assert.deepEqual(
    s[0].chunks[0].body.map((b) => [b.kind, b.text]),
    [
      ['context', 'x'],
      ['old', 'old'],
      ['new', 'new'],
    ],
  );
});

test('parse: blank lines before @@ inside a section are kept as context (S8-03, mid-section)', () => {
  const s = parseV4a([
    '*** Begin Patch',
    '*** Update File: a.js',
    ' x',
    '',
    '@@ anchor',
    ' y',
    '*** End Patch',
  ]);
  // The blank line is inside the section (before the next chunk), not at its
  // end, so it is an empty context line of the first chunk.
  assert.deepEqual(
    s[0].chunks[0].body.map((b) => [b.kind, b.text]),
    [
      ['context', 'x'],
      ['context', ''],
    ],
  );
});

// ---------- v4aEdits: applier (S8-14..S8-24) ----------
// Driven through a fake tree (plain object with get/now/moves) — .mjs is not
// type-checked, so the fake only needs the members the edit uses.

import { v4aEdits } from '../main.ts';

function fakeTree(files) {
  const now = new Map();
  return {
    now,
    moves: [],
    get: (p) => (now.has(p) ? now.get(p) : (p in files ? files[p] : null)),
  };
}

function v4aEdit(lines, strict = false) {
  const edits = v4aEdits(lines, strict);
  assert.equal(edits.length, 1);
  return edits[0];
}

const BEGIN = '*** Begin Patch';
const END = '*** End Patch';

test('edit: Add creates the file, LF + final break (S8-15)', () => {
  const tree = fakeTree({});
  v4aEdit([BEGIN, '*** Add File: a.md', '+# Title', '+', '', '+body', END])(tree);
  assert.equal(tree.now.get('a.md'), '# Title\n\n\nbody\n');
});

test('edit: Add with zero lines creates an empty file (C3)', () => {
  const tree = fakeTree({});
  v4aEdit([BEGIN, '*** Add File: a.md', END])(tree);
  assert.equal(tree.now.get('a.md'), '');
});

test('edit: Add of an existing file fails exists (S8-15)', () => {
  const tree = fakeTree({ 'a.md': 'old\n' });
  assert.throws(() => v4aEdit([BEGIN, '*** Add File: a.md', '+x', END])(tree), (e) => e.code === 'exists');
});

test('edit: Delete removes the file; missing file fails missing (S8-16)', () => {
  const tree = fakeTree({ 'a.md': 'old\n' });
  v4aEdit([BEGIN, '*** Delete File: a.md', END])(tree);
  assert.equal(tree.now.get('a.md'), null);
  assert.throws(() => v4aEdit([BEGIN, '*** Delete File: nope.md', END])(tree), (e) => e.code === 'missing');
});

test('edit: Update plain chunk replaces at tier 0 (S8-20)', () => {
  const tree = fakeTree({ 'a.js': 'one\ntwo\nthree\n' });
  v4aEdit([BEGIN, '*** Update File: a.js', ' two', '-three', '+THREE', END])(tree);
  assert.equal(tree.now.get('a.js'), 'one\ntwo\nTHREE\n');
});

test('edit: Update chunk re-indents at tier 2, literal A16 (S8-20, S5-12)', () => {
  // Mirrors v-indent 6b3a9d6e: O[0] has no indent, file lines have two
  // spaces; the `+` line gets F prepended, context lines are the file's own.
  const tree = fakeTree({
    'src/report.js': 'function syncOwner(config, session) {\n  session.payload = 497;\n  return configTotal * 8;\n}\n',
  });
  v4aEdit([BEGIN, '*** Update File: src/report.js', ' session.payload = 497;', ' return configTotal * 8;', '-}', '+} // node', END])(tree);
  assert.equal(
    tree.now.get('src/report.js'),
    'function syncOwner(config, session) {\n  session.payload = 497;\n  return configTotal * 8;\n  } // node\n',
  );
});

test('edit: chunk anchor found, cursor moves past it (S8-19, v-cursor)', () => {
  // O occurs twice (before and after the anchor); the chunk must take the
  // occurrence after the anchor.
  const file = 'def split_tracker():\n    stage.stock = 318\n    return payload_total * 2\n\ndef scan_score():\n    stage.stock = 318\n    return payload_total * 2\n';
  const tree = fakeTree({ 'p.py': file });
  v4aEdit(
    [
      BEGIN,
      '*** Update File: p.py',
      '@@ def scan_score():',
      '     stage.stock = 318',
      '-    return payload_total * 2',
      '+    return payload_cart * 2',
      ' ',
      END,
    ],
  )(tree);
  assert.equal(
    tree.now.get('p.py'),
    'def split_tracker():\n    stage.stock = 318\n    return payload_total * 2\n\ndef scan_score():\n    stage.stock = 318\n    return payload_cart * 2\n',
  );
});

test('edit: anchor with no match fails no-match (S8-19)', () => {
  const tree = fakeTree({ 'a.js': 'one\ntwo\n' });
  assert.throws(
    () => v4aEdit([BEGIN, '*** Update File: a.js', '@@ nope', ' one', END])(tree),
    (e) => e.code === 'no-match',
  );
});

test('edit: anchor matches at tier 2 (S8-19, S5)', () => {
  const tree = fakeTree({ 'a.js': '  def f():\n    a = 1\n    return 1\n' });
  v4aEdit([BEGIN, '*** Update File: a.js', '@@ def f():', '     a = 1', '-    return 1', '+    return 2', END])(tree);
  assert.equal(tree.now.get('a.js'), '  def f():\n    a = 1\n    return 2\n');
});

test('edit: EOF chunk must end at the file last line (S8-21)', () => {
  const tree = fakeTree({ 'a.js': 'x\ntail\nmore\n' });
  // O occurs mid-file, not at the end -> no-match for an EOF chunk.
  assert.throws(
    () => v4aEdit([BEGIN, '*** Update File: a.js', ' x', '-tail', '+TAIL', '*** End of File', END])(tree),
    (e) => e.code === 'no-match',
  );
  const tree2 = fakeTree({ 'a.js': 'x\ntail\n' });
  v4aEdit([BEGIN, '*** Update File: a.js', ' x', '-tail', '+TAIL', '*** End of File', END])(tree2);
  assert.equal(tree2.now.get('a.js'), 'x\nTAIL\n');
});

test('edit: O empty inserts N at the cursor (S8-22, GAP G28)', () => {
  const tree = fakeTree({ 'a.js': 'def f():\n    return 1\n' });
  v4aEdit([BEGIN, '*** Update File: a.js', '@@ def f():', '+    # hello', END])(tree);
  assert.equal(tree.now.get('a.js'), 'def f():\n    # hello\n    return 1\n');
});

test('edit: O empty in an EOF chunk inserts at the end of the file (S8-22)', () => {
  const tree = fakeTree({ 'a.js': 'one\ntwo\n' });
  // Chunk body is only `+three`: O is empty, N is ['three']; the chunk is
  // ended by `*** End of File`, so N is inserted at the end of the file.
  v4aEdit([BEGIN, '*** Update File: a.js', '+three', '*** End of File', END])(tree);
  assert.equal(tree.now.get('a.js'), 'one\ntwo\nthree\n');
});

test('edit: cursor moves to just after the lines written (S8-23)', () => {
  // Two chunks; the second chunk's O occurs twice, and the first occurrence
  // is before the cursor left by the first chunk.
  const file = 'a\nb\nc\na\nb\nc\n';
  const tree = fakeTree({ 'f.txt': file });
  v4aEdit([BEGIN, '*** Update File: f.txt', ' a', '-b', '+B', '@@ c', ' a', '-b', '+B2', END])(tree);
  assert.equal(tree.now.get('f.txt'), 'a\nB\nc\na\nB2\nc\n');
});

test('edit: Move to writes the new path, deletes the old, records the move (S8-24)', () => {
  const tree = fakeTree({ 'old.js': 'one\ntwo\n' });
  v4aEdit([BEGIN, '*** Update File: old.js', '*** Move to: new.js', ' one', '-two', '+TWO', END])(tree);
  assert.equal(tree.now.get('old.js'), null);
  assert.equal(tree.now.get('new.js'), 'one\nTWO\n');
  assert.deepEqual(tree.moves, [['old.js', 'new.js']]);
});

test('edit: Move to only, no chunks, is a pure rename (S8-13)', () => {
  const tree = fakeTree({ 'old.js': 'one\ntwo\n' });
  v4aEdit([BEGIN, '*** Update File: old.js', '*** Move to: new.js', END])(tree);
  assert.equal(tree.now.get('old.js'), null);
  assert.equal(tree.now.get('new.js'), 'one\ntwo\n');
  assert.deepEqual(tree.moves, [['old.js', 'new.js']]);
});

test('edit: Move to an existing path fails exists (S8-17)', () => {
  const tree = fakeTree({ 'old.js': 'one\n', 'new.js': 'x\n' });
  assert.throws(
    () => v4aEdit([BEGIN, '*** Update File: old.js', '*** Move to: new.js', ' one', END])(tree),
    (e) => e.code === 'exists',
  );
});

test('edit: Update of a missing file fails missing (S8-17)', () => {
  const tree = fakeTree({});
  assert.throws(
    () => v4aEdit([BEGIN, '*** Update File: nope.js', ' x', END])(tree),
    (e) => e.code === 'missing',
  );
});

test('edit: CRLF file keeps its break (S3-08, v-crlf)', () => {
  const tree = fakeTree({ 'a.md': '# H\r\n\r\n## L\r\nold line\r\n' });
  v4aEdit([BEGIN, '*** Update File: a.md', ' ## L', '-old line', '+new line', END])(tree);
  assert.equal(tree.now.get('a.md'), '# H\r\n\r\n## L\r\nnew line\r\n');
});

test('edit: final break stays as it was (v-eof dd491575)', () => {
  const tree = fakeTree({ 'a.py': 'def f():\n    a = 1\n    return 1' });
  v4aEdit([BEGIN, '*** Update File: a.py', ' def f():', '     a = 1', '-    return 1', '+    return 2', '*** End of File', END])(tree);
  assert.equal(tree.now.get('a.py'), 'def f():\n    a = 1\n    return 2');
});

test('edit: --strict matches tier 0 only for chunk and anchor (S5-06)', () => {
  const tree = fakeTree({ 'a.js': '  def f():\n    return 1\n' });
  assert.throws(
    () => v4aEdit([BEGIN, '*** Update File: a.js', '@@ def f():', '     return 1', END], true)(tree),
    (e) => e.code === 'no-match',
  );
});

test('edit: unsafe path fails before the file is looked at (S2-14)', () => {
  const tree = fakeTree({});
  assert.throws(
    () => v4aEdit([BEGIN, '*** Add File: ../x.js', '+y', END])(tree),
    (e) => e.code === 'unsafe',
  );
  assert.throws(
    () => v4aEdit([BEGIN, '*** Update File: a.js', '*** Move to: ../b.js', ' x', END])(tree),
    (e) => e.code === 'unsafe',
  );
});

// ---------- CLI wiring ----------

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

function cli(files, patch, args = []) {
  const dir = mkdtempSync(join(tmpdir(), 'm3c-'));
  tmpDirs.push(dir);
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(p)), { recursive: true });
    writeFileSync(join(dir, p), content);
  }
  writeFileSync(join(dir, 'patch.diff'), patch);
  const r = spawnSync('node', [mainTs, ...args, 'patch.diff'], { cwd: dir, encoding: 'utf8' });
  const read = (p) => (existsSync(join(dir, p)) ? readFileSync(join(dir, p), 'utf8') : null);
  return { code: r.status, out: r.stdout, err: r.stderr, read, exists: (p) => existsSync(join(dir, p)) };
}

function cliStdin(files, stdin, args = []) {
  const dir = mkdtempSync(join(tmpdir(), 'm3c-'));
  tmpDirs.push(dir);
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(p)), { recursive: true });
    writeFileSync(join(dir, p), content);
  }
  const r = spawnSync('node', [mainTs, ...args, '-'], { cwd: dir, input: stdin, encoding: 'utf8' });
  const read = (p) => (existsSync(join(dir, p)) ? readFileSync(join(dir, p), 'utf8') : null);
  return { code: r.status, out: r.stdout, err: r.stderr, read, exists: (p) => existsSync(join(dir, p)) };
}

test('cli: add + delete + update in one patch, rows sorted A/D/M (v-add-delete)', () => {
  const r = cli(
    {
      'lib/label/target.go': 'package session\n\nfunc SaveReport(status []int) int {\n\ttotal := len(status) + 19\n\tif total > 449 {\n\t\treturn total / 3\n\t}\n',
      'server/count/owner_invoice.go': 'package record\n',
    },
    [
      '*** Begin Patch',
      '*** Add File: index_signal.md',
      '+# Client stock',
      '+',
      '+## Ledger report',
      '*** Delete File: server/count/owner_invoice.go',
      '*** Update File: lib/label/target.go',
      ' func SaveReport(status []int) int { ',
      ' \ttotal := len(status) + 19 ',
      '-\tif total > 449 { ',
      '+\tif stage > 449 {',
      '*** End Patch',
      '',
    ].join('\n'),
  );
  assert.equal(r.code, 0);
  assert.equal(r.out, 'A index_signal.md\nM lib/label/target.go\nD server/count/owner_invoice.go\nok: 3 files\n');
  assert.equal(r.read('index_signal.md'), '# Client stock\n\n## Ledger report\n');
  assert.equal(r.exists('server/count/owner_invoice.go'), false);
  assert.equal(r.read('lib/label/target.go'), 'package session\n\nfunc SaveReport(status []int) int {\n\ttotal := len(status) + 19\n\tif stage > 449 {\n\t\treturn total / 3\n\t}\n');
});

test('cli: Move to gives one R row, counts as one file (v-move)', () => {
  const r = cli(
    { 'server/worker.js': 'function fetchOwner(graph, table) {\n  const graphTotal = graph.length + 59;\n  return graphTotal * 9;\n}\n' },
    [
      '*** Begin Patch',
      '*** Update File: server/worker.js',
      '*** Move to: src/order/limit.js',
      '@@ function fetchOwner(graph, table) {',
      '   const graphTotal = graph.length + 59; ',
      '-  return graphTotal * 9;',
      '+  return graphTotal * 10;',
      '*** End Patch',
      '',
    ].join('\n'),
  );
  assert.equal(r.code, 0);
  assert.equal(r.out, 'R server/worker.js -> src/order/limit.js\nok: 1 file\n');
  assert.equal(r.exists('server/worker.js'), false);
  assert.equal(r.read('src/order/limit.js'), 'function fetchOwner(graph, table) {\n  const graphTotal = graph.length + 59;\n  return graphTotal * 10;\n}\n');
});

test('cli: --format=v4a reads a V4A patch', () => {
  const r = cli(
    { 'a.js': 'one\ntwo\n' },
    ['*** Begin Patch', '*** Update File: a.js', ' one', '-two', '+TWO', '*** End Patch', ''].join('\n'),
    ['--format=v4a'],
  );
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M a.js\nok: 1 file\n');
  assert.equal(r.read('a.js'), 'one\nTWO\n');
});

test('cli: --format=v4a on a JSON patch is error: parse 1 (c-format 2dcbcdf1ad8c)', () => {
  const r = cli(
    { 'tools/target.py': 'def f():\n    return 1\n' },
    '{"command":"str_replace","path":"tools/target.py","old_str":"    return 1","new_str":"    return 2"}\n',
    ['--format=v4a'],
  );
  assert.equal(r.code, 2);
  assert.equal(r.out, 'error: parse 1\n');
  assert.equal(r.read('tools/target.py'), 'def f():\n    return 1\n');
});

test('cli: patch from stdin applies (v4a via -)', () => {
  const r = cliStdin(
    { 'a.js': 'one\ntwo\n' },
    ['*** Begin Patch', '*** Update File: a.js', ' one', '-two', '+TWO', '*** End Patch', ''].join('\n'),
  );
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M a.js\nok: 1 file\n');
  assert.equal(r.read('a.js'), 'one\nTWO\n');
});

test('cli: --check reports M without writing', () => {
  const r = cli(
    { 'a.js': 'one\ntwo\n' },
    ['*** Begin Patch', '*** Update File: a.js', ' one', '-two', '+TWO', '*** End Patch', ''].join('\n'),
    ['--check'],
  );
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M a.js\nok: 1 file\n');
  assert.equal(r.read('a.js'), 'one\ntwo\n');
});

test('cli: parse error exits 2, file unchanged', () => {
  const r = cli(
    { 'a.js': 'one\ntwo\n' },
    ['*** Begin Patch', '*** Update File: a.js', ' one', '-two', '+TWO', ''].join('\n'),
  );
  assert.equal(r.code, 2);
  assert.equal(r.out, 'error: parse 6\n');
  assert.equal(r.read('a.js'), 'one\ntwo\n');
});

test('cli: one failing edit fails the whole patch, nothing written (S10, v-exists-missing)', () => {
  const r = cli(
    { 'docs/source/report.py': 'def render_buffer(region, tracker):\n    region_total = len(region) + 39\n' },
    [
      '*** Begin Patch',
      '*** Update File: docs/source/report.py',
      ' ',
      '-def render_buffer(region, tracker):',
      '+def render_buffer(price, tracker):',
      '     region_total = len(region) + 39',
      '*** Delete File: lib/session.md',
      '*** End Patch',
      '',
    ].join('\n'),
  );
  assert.equal(r.code, 1);
  assert.equal(r.out, 'error: missing lib/session.md\nfailed: 1 of 2 edits\n');
  assert.equal(r.read('docs/source/report.py'), 'def render_buffer(region, tracker):\n    region_total = len(region) + 39\n');
});

test('cli: EOF chunk applies at the end of the file (v-eof)', () => {
  const r = cli(
    { 'a.py': 'def f():\n    a = 1\n    return 1' },
    [
      '*** Begin Patch',
      '*** Update File: a.py',
      ' def f():',
      '     a = 1',
      '-    return 1',
      '+    return 2',
      '*** End of File',
      '*** End Patch',
      '',
    ].join('\n'),
  );
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M a.py\nok: 1 file\n');
  assert.equal(r.read('a.py'), 'def f():\n    a = 1\n    return 2');
});

test('cli: no-op update changes nothing, ok: 0 files', () => {
  const r = cli(
    { 'a.js': 'one\ntwo\n' },
    ['*** Begin Patch', '*** Update File: a.js', ' one', ' two', '*** End Patch', ''].join('\n'),
  );
  assert.equal(r.code, 0);
  assert.equal(r.out, 'ok: 0 files\n');
  assert.equal(r.read('a.js'), 'one\ntwo\n');
});

test('cli: auto-detect still picks unified and JSON, not v4a', () => {
  const u = cli(
    { 'a.js': 'one\ntwo\n' },
    ['--- a.js', '+++ b.js', '@@ -1,2 +1,2 @@', ' one', '-two', '+TWO', ''].join('\n'),
  );
  assert.equal(u.code, 0);
  assert.equal(u.out, 'R a.js -> b.js\nok: 1 file\n');
  const j = cliStdin({ 'a.js': 'one\ntwo\n' }, '[{"command":"str_replace","path":"a.js","old_str":"two","new_str":"TWO"}]\n');
  assert.equal(j.code, 0);
  assert.equal(j.out, 'M a.js\nok: 1 file\n');
});
