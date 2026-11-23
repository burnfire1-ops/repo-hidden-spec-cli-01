// M3b unit tests — SEARCH/REPLACE blocks (§7) parser + applier.
// TDD: ditulis dulu, dilihat gagal (RED), baru implementasi di main.ts.
// Jalankan: node --test tests/m3b.test.mjs   (dari repo/)
// Pemetaan butir SPEC (spec-inventory.md) -> tes:
//   S7-01..S7-06  -> parseSearchReplace (blok, path, parse error)
//   S7-07..S7-09  -> searchReplaceEdits (create/replace, ambiguous, no-match)
//   S2-10..S2-23  -> baris M/A/D + failed, via CLI
//   B1, B2, B3, B4 -> ambiguitas §7 (parent yang putuskan)

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseSearchReplace } from '../main.ts';

// ---------- parseSearchReplace: block shape (S7-01) ----------

test('parse: one block, path + old + new + searchLine', () => {
  const blocks = parseSearchReplace([
    'ledger.md',
    '<<<<<<< SEARCH',
    '- Keep 43 members at most.',
    '=======',
    '- Keep 43 amount at most.',
    '>>>>>>> REPLACE',
  ]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].searchLine, 2);
  assert.equal(blocks[0].path, 'ledger.md');
  assert.deepEqual(blocks[0].oldLines, ['- Keep 43 members at most.']);
  assert.deepEqual(blocks[0].newLines, ['- Keep 43 amount at most.']);
});

test('parse: multiple blocks in order (S7-07)', () => {
  const blocks = parseSearchReplace([
    'a.js', '<<<<<<< SEARCH', 'one', '=======', 'uno', '>>>>>>> REPLACE',
    'b.js', '<<<<<<< SEARCH', 'two', '=======', 'dos', '>>>>>>> REPLACE',
  ]);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].path, 'a.js');
  assert.equal(blocks[1].path, 'b.js');
  assert.equal(blocks[1].searchLine, 8);
});

test('parse: no blocks returns empty array', () => {
  assert.deepEqual(parseSearchReplace(['just prose', '', 'more prose']), []);
  assert.deepEqual(parseSearchReplace([]), []);
});

// ---------- markers: trailing whitespace stripped (S7-02) ----------

test('parse: markers match with trailing spaces/tabs removed (S7-02)', () => {
  const blocks = parseSearchReplace([
    'x.js',
    '<<<<<<< SEARCH  \t',
    'old',
    '======= ',
    'new',
    '>>>>>>> REPLACE\t',
  ]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].path, 'x.js');
  assert.deepEqual(blocks[0].oldLines, ['old']);
  assert.deepEqual(blocks[0].newLines, ['new']);
});

test('parse: marker with leading whitespace is NOT a marker (S7-02)', () => {
  const blocks = parseSearchReplace([
    'x.js',
    '  <<<<<<< SEARCH',
    'old',
    '=======',
    'new',
    '>>>>>>> REPLACE',
  ]);
  assert.deepEqual(blocks, []);
});

// ---------- path resolution (S7-03) ----------

test('parse: path is trimmed of surrounding whitespace (S7-03)', () => {
  const blocks = parseSearchReplace([
    '  table_total.md  ',
    '<<<<<<< SEARCH',
    'old',
    '=======',
    'new',
    '>>>>>>> REPLACE',
  ]);
  assert.equal(blocks[0].path, 'table_total.md');
});

test('parse: fence line before SEARCH is skipped as a path (S7-03)', () => {
  const blocks = parseSearchReplace([
    'app/worker.md',
    '```md',
    '<<<<<<< SEARCH',
    'old',
    '=======',
    'new',
    '>>>>>>> REPLACE',
  ]);
  assert.equal(blocks[0].path, 'app/worker.md');
});

test('parse: blank lines skipped when resolving the path (S7-03)', () => {
  const blocks = parseSearchReplace([
    'The edit below.',
    '',
    '   ',
    'ledger.md',
    '',
    '<<<<<<< SEARCH',
    'old',
    '=======',
    'new',
    '>>>>>>> REPLACE',
  ]);
  assert.equal(blocks[0].path, 'ledger.md');
});

test('parse: fence line with leading spaces is skipped as a path (S7-03)', () => {
  const blocks = parseSearchReplace([
    'a.js',
    '  ```x',
    '<<<<<<< SEARCH',
    'old',
    '=======',
    'new',
    '>>>>>>> REPLACE',
  ]);
  assert.equal(blocks[0].path, 'a.js');
});

test('parse: path window starts after the previous REPLACE line (S7-03)', () => {
  const blocks = parseSearchReplace([
    'first.js', '<<<<<<< SEARCH', 'o1', '=======', 'n1', '>>>>>>> REPLACE',
    'and then',
    'second.js',
    '<<<<<<< SEARCH', 'o2', '=======', 'n2', '>>>>>>> REPLACE',
  ]);
  assert.equal(blocks[0].path, 'first.js');
  assert.equal(blocks[1].path, 'second.js');
});

test('parse: prose as the nearest line IS the path, literal (S7-03)', () => {
  const blocks = parseSearchReplace([
    'and then',
    '<<<<<<< SEARCH',
    'old',
    '=======',
    'new',
    '>>>>>>> REPLACE',
  ]);
  assert.equal(blocks[0].path, 'and then');
});

// ---------- path fallback + parse errors (S7-04, S7-05) ----------

test('parse: block without a path line takes the previous block path (S7-04, GAP G17)', () => {
  const blocks = parseSearchReplace([
    'x.js', '<<<<<<< SEARCH', 'o1', '=======', 'n1', '>>>>>>> REPLACE',
    '<<<<<<< SEARCH', 'o2', '=======', 'n2', '>>>>>>> REPLACE',
  ]);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[1].path, 'x.js');
});

test('parse: first block without a path is error: parse <SEARCH line> (S7-04)', () => {
  assert.throws(
    () => parseSearchReplace(['```', '<<<<<<< SEARCH', '}', '=======', '} // cursor', '>>>>>>> REPLACE', '```']),
    (e) => e.line === 'error: parse 2',
  );
});

test('parse: SEARCH with no ======= is error: parse <SEARCH line> (S7-05)', () => {
  assert.throws(
    () => parseSearchReplace(['order.go', '<<<<<<< SEARCH', '\treturn total * 7', '>>>>>>> REPLACE']),
    (e) => e.line === 'error: parse 2',
  );
});

test('parse: SEARCH with ======= but no >>>>>>> REPLACE is error: parse <SEARCH line> (B1 reading a)', () => {
  assert.throws(
    () => parseSearchReplace(['x.js', '<<<<<<< SEARCH', 'old', '=======', 'new']),
    (e) => e.line === 'error: parse 2',
  );
});

// ---------- lines outside blocks ignored (S7-06) ----------

test('parse: prose and fences outside blocks are ignored (S7-06)', () => {
  const blocks = parseSearchReplace([
    'Sure! Below is the diff.',
    '',
    'a.js',
    '```js',
    '<<<<<<< SEARCH', 'old', '=======', 'new', '>>>>>>> REPLACE',
    '```',
    'and then',
    'b.js',
    '```js',
    '<<<<<<< SEARCH', 'old2', '=======', 'new2', '>>>>>>> REPLACE',
    '```',
    'Done.',
  ]);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].path, 'a.js');
  assert.equal(blocks[1].path, 'b.js');
});

// ---------- ambiguities B2/B3: literal readings locked ----------

test('B2 adversarial: a SEARCH line while scanning for ======= is ignored, scan continues (reading i)', () => {
  const blocks = parseSearchReplace([
    'x.js',
    '<<<<<<< SEARCH',
    'a',
    '<<<<<<< SEARCH',
    'b',
    '=======',
    'c',
    '>>>>>>> REPLACE',
  ]);
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0].oldLines, ['a', '<<<<<<< SEARCH', 'b']);
  assert.deepEqual(blocks[0].newLines, ['c']);
});

test('B3 adversarial: a marker-looking line as the nearest path line IS the path (literal)', () => {
  const blocks = parseSearchReplace([
    '=======',
    '<<<<<<< SEARCH',
    'old',
    '=======',
    'new',
    '>>>>>>> REPLACE',
  ]);
  assert.equal(blocks[0].path, '=======');
});

// ---------- searchReplaceEdits: applier (S7-07..S7-09) ----------
// Driven through a fake tree (plain object with get/now) — .mjs is not
// type-checked, so the fake only needs the two members the edit uses.

import { searchReplaceEdits } from '../main.ts';

function fakeTree(files) {
  const now = new Map();
  return {
    now,
    get: (p) => (now.has(p) ? now.get(p) : (p in files ? files[p] : null)),
  };
}

function srEdit(lines, strict = false) {
  const edits = searchReplaceEdits(lines, strict);
  assert.equal(edits.length, 1);
  return edits[0];
}

test('edit: replace once, exact tier 0 (S7-09)', () => {
  const tree = fakeTree({ 'a.js': 'one\ntwo\nthree\n' });
  srEdit(['a.js', '<<<<<<< SEARCH', 'two', '=======', 'TWO', '>>>>>>> REPLACE'])(tree);
  assert.equal(tree.now.get('a.js'), 'one\nTWO\nthree\n');
});

test('edit: replace at tier 1, trailing whitespace ignored (S7-09, S5-03)', () => {
  const tree = fakeTree({ 'a.js': 'def f(x):\n    return x\n' });
  srEdit(['a.js', '<<<<<<< SEARCH', 'def f(x): ', '=======', 'def g(x):', '>>>>>>> REPLACE'])(tree);
  assert.equal(tree.now.get('a.js'), 'def g(x):\n    return x\n');
});

test('edit: replace at tier 2, re-indent literal (S7-09, S5-12, A16)', () => {
  const tree = fakeTree({ 'a.js': '  value.node = 53;\n  return s * 7;\n}\n' });
  srEdit(['a.js', '<<<<<<< SEARCH', 'value.node = 53;', '=======', 'queue.node = 53;', '>>>>>>> REPLACE'])(tree);
  assert.equal(tree.now.get('a.js'), '  queue.node = 53;\n  return s * 7;\n}\n');
});

test('edit: tier-2 re-indent with empty P prepends F, literal (A16)', () => {
  const tree = fakeTree({ 'a.js': '  first();\n  second();\n' });
  srEdit(['a.js', '<<<<<<< SEARCH', 'first();', '=======', 'changed();', '  extra();', '>>>>>>> REPLACE'])(tree);
  // Literal A16: P is empty, so F ('  ') is prepended to every non-empty N
  // line — '  extra();' becomes four spaces + 'extra();'.
  assert.equal(tree.now.get('a.js'), '  changed();\n    extra();\n  second();\n');
});

test('edit: --strict matches tier 0 only (S5-06)', () => {
  const tree = fakeTree({ 'a.js': 'def f(x):\n    return x\n' });
  assert.throws(
    () => srEdit(['a.js', '<<<<<<< SEARCH', 'def f(x): ', '=======', 'def g(x):', '>>>>>>> REPLACE'], true)(tree),
    (e) => e.code === 'no-match' && e.path === 'a.js',
  );
});

test('edit: no-match fails (S7-09)', () => {
  const tree = fakeTree({ 'a.js': 'one\ntwo\n' });
  assert.throws(
    () => srEdit(['a.js', '<<<<<<< SEARCH', 'three', '=======', 'THREE', '>>>>>>> REPLACE'])(tree),
    (e) => e.code === 'no-match' && e.path === 'a.js',
  );
});

test('edit: occurrence twice at its tier fails ambiguous (S7-09)', () => {
  const tree = fakeTree({ 'a.js': 'x = 1;\ny = 2;\nx = 1;\n' });
  assert.throws(
    () => srEdit(['a.js', '<<<<<<< SEARCH', 'x = 1;', '=======', 'x = 9;', '>>>>>>> REPLACE'])(tree),
    (e) => e.code === 'ambiguous' && e.path === 'a.js',
  );
});

test('edit: missing file fails (S7-09)', () => {
  const tree = fakeTree({});
  assert.throws(
    () => srEdit(['gone.js', '<<<<<<< SEARCH', 'x', '=======', 'y', '>>>>>>> REPLACE'])(tree),
    (e) => e.code === 'missing' && e.path === 'gone.js',
  );
});

test('edit: unsafe path fails before the file is looked at (S2-14)', () => {
  const tree = fakeTree({});
  assert.throws(
    () => srEdit(['/etc/x.js', '<<<<<<< SEARCH', 'x', '=======', 'y', '>>>>>>> REPLACE'])(tree),
    (e) => e.code === 'unsafe' && e.path === '/etc/x.js',
  );
  assert.throws(
    () => srEdit(['../x.js', '<<<<<<< SEARCH', 'x', '=======', 'y', '>>>>>>> REPLACE'])(tree),
    (e) => e.code === 'unsafe' && e.path === '../x.js',
  );
});

test('edit: empty old lines create the file with LF + final break (S7-08, S3)', () => {
  const tree = fakeTree({});
  srEdit(['new.js', '<<<<<<< SEARCH', '=======', 'line one', 'line two', '>>>>>>> REPLACE'])(tree);
  assert.equal(tree.now.get('new.js'), 'line one\nline two\n');
});

test('edit: empty old lines on an existing file fails exists (S7-08)', () => {
  const tree = fakeTree({ 'new.js': 'old\n' });
  assert.throws(
    () => srEdit(['new.js', '<<<<<<< SEARCH', '=======', 'line one', '>>>>>>> REPLACE'])(tree),
    (e) => e.code === 'exists' && e.path === 'new.js',
  );
});

test('edit: empty new lines delete the matched lines, final break kept (S7-09)', () => {
  const tree = fakeTree({ 'a.js': 'keep\ndelete me\nkeep2\n' });
  srEdit(['a.js', '<<<<<<< SEARCH', 'delete me', '=======', '>>>>>>> REPLACE'])(tree);
  assert.equal(tree.now.get('a.js'), 'keep\nkeep2\n');
});

test('edit: CRLF file keeps its break (S3-08)', () => {
  const tree = fakeTree({ 'a.go': 'package p\r\n\r\nfunc F() int {\r\n\treturn 1\r\n}\r\n' });
  srEdit(['a.go', '<<<<<<< SEARCH', 'func F() int {', '=======', 'func G() int {', '>>>>>>> REPLACE'])(tree);
  assert.equal(tree.now.get('a.go'), 'package p\r\n\r\nfunc G() int {\r\n\treturn 1\r\n}\r\n');
});

test('edit: blocks apply in order, later blocks see earlier results (S7-07)', () => {
  const tree = fakeTree({ 'a.js': 'one\ntwo\nthree\n' });
  const edits = searchReplaceEdits([
    'a.js', '<<<<<<< SEARCH', 'one', '=======', 'uno', '>>>>>>> REPLACE',
    'a.js', '<<<<<<< SEARCH', 'two', '=======', 'dos', '>>>>>>> REPLACE',
  ]);
  assert.equal(edits.length, 2);
  for (const e of edits) e(tree);
  assert.equal(tree.now.get('a.js'), 'uno\ndos\nthree\n');
});

test('edit: no edits returns empty array (parse 1 is the CLI layer)', () => {
  assert.deepEqual(searchReplaceEdits(['just prose'], false), []);
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
  const dir = mkdtempSync(join(tmpdir(), 'm3b-'));
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
  const dir = mkdtempSync(join(tmpdir(), 'm3b-'));
  tmpDirs.push(dir);
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(p)), { recursive: true });
    writeFileSync(join(dir, p), content);
  }
  const r = spawnSync('node', [mainTs, ...args, '-'], { cwd: dir, input: stdin, encoding: 'utf8' });
  const read = (p) => (existsSync(join(dir, p)) ? readFileSync(join(dir, p), 'utf8') : null);
  return { code: r.status, out: r.stdout, err: r.stderr, read, exists: (p) => existsSync(join(dir, p)) };
}

test('cli: basic replace applies, M row', () => {
  const r = cli(
    { 'ledger.md': '# T\n\n- Keep 43 members at most.\n' },
    'ledger.md\n<<<<<<< SEARCH\n- Keep 43 members at most.\n=======\n- Keep 43 amount at most.\n>>>>>>> REPLACE\n',
  );
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M ledger.md\nok: 1 file\n');
  assert.equal(r.read('ledger.md'), '# T\n\n- Keep 43 amount at most.\n');
});

test('cli: create writes new file, A row', () => {
  const r = cli({}, 'new.js\n<<<<<<< SEARCH\n=======\nline one\nline two\n>>>>>>> REPLACE\n');
  assert.equal(r.code, 0);
  assert.equal(r.out, 'A new.js\nok: 1 file\n');
  assert.equal(r.read('new.js'), 'line one\nline two\n');
});

test('cli: --check reports M without writing', () => {
  const r = cli(
    { 'a.js': 'one\ntwo\n' },
    'a.js\n<<<<<<< SEARCH\ntwo\n=======\nTWO\n>>>>>>> REPLACE\n',
    ['--check'],
  );
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M a.js\nok: 1 file\n');
  assert.equal(r.read('a.js'), 'one\ntwo\n');
});

test('cli: --format=search-replace reads the patch as S/R (c-format)', () => {
  const r = cli(
    { 'lib/x.go': 'package draft\n\nfunc F() int {\n\treturn 1\n}\n' },
    'lib/x.go\n<<<<<<< SEARCH\n\treturn 1\n=======\n\treturn 2\n>>>>>>> REPLACE\n',
    ['--format=search-replace'],
  );
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M lib/x.go\nok: 1 file\n');
  assert.equal(r.read('lib/x.go'), 'package draft\n\nfunc F() int {\n\treturn 2\n}\n');
});

test('cli: old lines equal to new lines change nothing, ok: 0 files (c-noop)', () => {
  const r = cli(
    { 'a.go': 'package source\n' },
    'a.go\n```x\n<<<<<<< SEARCH\npackage source\n=======\npackage source\n>>>>>>> REPLACE\n```\n',
  );
  assert.equal(r.code, 0);
  assert.equal(r.out, 'ok: 0 files\n');
  assert.equal(r.read('a.go'), 'package source\n');
});

test('cli: ambiguous reports error, exit 1, file unchanged', () => {
  const r = cli(
    { 'a.js': 'x = 1;\ny = 2;\nx = 1;\n' },
    'a.js\n<<<<<<< SEARCH\nx = 1;\n=======\nx = 9;\n>>>>>>> REPLACE\n',
  );
  assert.equal(r.code, 1);
  assert.equal(r.out, 'error: ambiguous a.js\nfailed: 1 of 1 edits\n');
  assert.equal(r.read('a.js'), 'x = 1;\ny = 2;\nx = 1;\n');
});

test('cli: no-match reports error, exit 1', () => {
  const r = cli(
    { 'a.js': 'one\ntwo\n' },
    'a.js\n<<<<<<< SEARCH\nthree\n=======\nTHREE\n>>>>>>> REPLACE\n',
  );
  assert.equal(r.code, 1);
  assert.equal(r.out, 'error: no-match a.js\nfailed: 1 of 1 edits\n');
});

test('cli: missing file reports error, exit 1', () => {
  const r = cli({}, 'gone.js\n<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE\n');
  assert.equal(r.code, 1);
  assert.equal(r.out, 'error: missing gone.js\nfailed: 1 of 1 edits\n');
});

test('cli: create of an existing file reports exists, exit 1', () => {
  const r = cli({ 'a.js': 'old\n' }, 'a.js\n<<<<<<< SEARCH\n=======\nnew\n>>>>>>> REPLACE\n');
  assert.equal(r.code, 1);
  assert.equal(r.out, 'error: exists a.js\nfailed: 1 of 1 edits\n');
});

test('cli: patch from stdin applies (s-basic via -)', () => {
  const r = cliStdin(
    { 'a.js': 'one\ntwo\n' },
    'a.js\n<<<<<<< SEARCH\ntwo\n=======\nTWO\n>>>>>>> REPLACE\n',
  );
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M a.js\nok: 1 file\n');
  assert.equal(r.read('a.js'), 'one\nTWO\n');
});

test('cli: two blocks on the same file apply in order', () => {
  const r = cli(
    { 'a.js': 'one\ntwo\nthree\n' },
    'a.js\n<<<<<<< SEARCH\none\n=======\nuno\n>>>>>>> REPLACE\na.js\n<<<<<<< SEARCH\ntwo\n=======\ndos\n>>>>>>> REPLACE\n',
  );
  assert.equal(r.code, 0);
  assert.equal(r.out, 'M a.js\nok: 1 file\n');
  assert.equal(r.read('a.js'), 'uno\ndos\nthree\n');
});

test('cli: one failing block fails the whole patch, nothing written (S10)', () => {
  const r = cli(
    { 'a.js': 'one\ntwo\n' },
    'a.js\n<<<<<<< SEARCH\none\n=======\nuno\n>>>>>>> REPLACE\ngone.js\n<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE\n',
  );
  assert.equal(r.code, 1);
  assert.equal(r.out, 'error: missing gone.js\nfailed: 1 of 2 edits\n');
  assert.equal(r.read('a.js'), 'one\ntwo\n');
});

// ---------- ambiguities B4: create with empty new lines ----------

test('B4 adversarial: create with empty old AND new lines makes an empty file (reading a)', () => {
  const r = cli({}, 'empty.txt\n<<<<<<< SEARCH\n=======\n>>>>>>> REPLACE\n');
  assert.equal(r.code, 0);
  assert.equal(r.out, 'A empty.txt\nok: 1 file\n');
  assert.equal(r.read('empty.txt'), '');
});
