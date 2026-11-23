// main.ts is mend, the CLI SPEC.md specifies, and this is the kit's starting point for it (MIT). It does sections 1 to 4, 9 and 10 of SPEC.md: the command line, the output and
// exit codes, safe paths, format detection, JSON edits and the all-or-nothing write. The other three formats are
// detected and then read as holding no edit, so they answer `error: parse 1`: reading unified diffs (section 6),
// SEARCH/REPLACE blocks (section 7) and V4A patches (section 8), and matching lines at three tiers (section 5), are
// yours to write. Node 22, the standard library alone; run it as `node main.ts [options] [PATCH]`.
//
// In a trial the grader runs `node /bot/main.ts` with MAKEFUN_ENV_URL set, and then this file hands over to runner.ts
// (the last lines below): keep that hand-over and runner.ts as they are, and write the CLI.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const FORMATS = ['auto', 'unified', 'search-replace', 'v4a', 'json'];

class Exit2 {
  readonly line: string;
  constructor(line: string) {
    this.line = line;
  }
}
class Fail {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string) {
    this.code = code;
    this.path = path;
  }
}

const blank = (s: string): boolean => s.trim() === '';

export function patchLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

function safe(p: string): boolean {
  return p !== '' && !p.startsWith('/') && !p.includes('\\') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

// ---------------------------------------------------------------------------
// M2 — matcher 3 tier + primitif baris/file (SPEC sections 3 and 5).
// Not wired to the CLI yet: no format uses these until M3. The CLI behaviour
// below is unchanged by this section.
// ---------------------------------------------------------------------------

/** A file's line break (S3-04): CRLF when its first line feed follows a carriage return, LF otherwise. */
export function detectBreak(text: string): '\r\n' | '\n' {
  const nl = text.indexOf('\n');
  return nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';
}

export interface FileLines {
  lines: string[];
  br: '\r\n' | '\n';
  final: boolean;
}

/** A file's lines (S3-05, S3-06, S3-07): its text split at its break; the last, empty piece after a final break is not a line. */
export function splitFileLines(text: string): FileLines {
  if (text === '') return { lines: [], br: '\n', final: false };
  const br = detectBreak(text);
  const parts = text.split(br);
  const final = text.endsWith(br);
  if (final) parts.pop();
  return { lines: parts, br, final };
}

/** A changed file written back (S3-08): its own break between its lines, and a final one exactly when it ended with one. */
export function joinFileLines(lines: string[], br: '\r\n' | '\n', final: boolean): string {
  if (lines.length === 0) return '';
  return lines.join(br) + (final ? br : '');
}

const stripTrailingWs = (s: string): string => s.replace(/[ \t]+$/, '');
const stripBothWs = (s: string): string => s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
const leadingWs = (s: string): string => (s.match(/^[ \t]*/) ?? [''])[0]!;

export interface Occurrences {
  tier: 0 | 1 | 2;
  positions: number[];
}

/**
 * Where O occurs in lines (S5-01, S5-02, S5-03, S5-04, S5-05, S5-07, S5-08):
 * the first of three tiers at which it occurs at least once. Tier 0: every
 * line equal. Tier 1: equal once trailing spaces and tabs are removed from
 * both. Tier 2: equal once leading and trailing spaces and tabs are removed
 * from both. Occurrences may overlap. With --strict only tier 0 is tried
 * (S5-06). Null when O occurs at no tier (S5-07), and for empty O: an empty
 * old block is an insertion, matched by the format, not by this matcher.
 */
export function findOccurrences(O: string[], lines: string[], strict: boolean): Occurrences | null {
  if (O.length === 0) return null;
  const norms: ((s: string) => string)[] = [(s) => s, stripTrailingWs, stripBothWs];
  const maxTier = strict ? 0 : 2;
  for (let tier = 0; tier <= maxTier; tier++) {
    const norm = norms[tier]!;
    const want = O.map(norm);
    const positions: number[] = [];
    for (let i = 0; i + O.length <= lines.length; i++) {
      let ok = true;
      for (let j = 0; j < O.length; j++) {
        if (norm(lines[i + j]!) !== want[j]) {
          ok = false;
          break;
        }
      }
      if (ok) positions.push(i);
    }
    if (positions.length > 0) return { tier: tier as 0 | 1 | 2, positions };
  }
  return null;
}

export type EmptyPReading = 'literal' | 'conservative';

/**
 * At tier 2 every other line of N is re-indented (S5-12): F is the leading
 * spaces and tabs of the file's first matched line, P those of O's first
 * line; a line of N that is not empty and not only whitespace, and starts
 * with P, has that P replaced by F; any other line is written as it is.
 *
 * Ambiguity A16 (P empty): 'literal' reads the sentence mechanically — every
 * non-empty line starts with the empty prefix, so every such line gets F
 * prepended. 'conservative' re-indents only when P is non-empty. The caller
 * picks; M2 implements both and does not decide.
 */
export function reindentTier2(N: string[], O: string[], fileLines: string[], pos: number, emptyP: EmptyPReading): string[] {
  const F = leadingWs(fileLines[pos] ?? '');
  const P = leadingWs(O[0] ?? '');
  if (P === '' && emptyP === 'conservative') return [...N];
  return N.map((l) => {
    if (l === '' || l.trim() === '') return l;
    if (!l.startsWith(P)) return l;
    return F + l.slice(P.length);
  });
}

/**
 * Replace the k matched lines with N (S5-10, S5-11, S5-13). `contextOf` is
 * aligned with N: the index into O of the file line a context line stands
 * for, or null. A context line is written as the file's own matched line,
 * never the patch's (S5-11). At tiers 0 and 1 the lines of N are written as
 * they are; at tier 2 they are re-indented first (S5-12, S5-13).
 */
export function applyReplacement(
  lines: string[],
  pos: number,
  O: string[],
  N: string[],
  tier: 0 | 1 | 2,
  contextOf: (number | null)[],
  emptyP: EmptyPReading,
): string[] {
  const reindented = tier === 2 ? reindentTier2(N, O, lines, pos, emptyP) : [...N];
  const resolved = reindented.map((l, j) => {
    const at = contextOf[j];
    return at === null || at === undefined ? l : lines[pos + at]!;
  });
  return [...lines.slice(0, pos), ...resolved, ...lines.slice(pos + O.length)];
}

/** The tree as the edits leave it: changed paths in `now` (null: deleted), the rest read from disk. */
class Tree {
  private readonly orig = new Map<string, string | null>();
  readonly now = new Map<string, string | null>();
  original(p: string): string | null {
    if (!this.orig.has(p)) {
      let v: string | null = null;
      try {
        if (statSync(p).isFile()) v = readFileSync(p, 'utf8');
      } catch {
        v = null;
      }
      this.orig.set(p, v);
    }
    return this.orig.get(p)!;
  }
  get(p: string): string | null {
    return this.now.has(p) ? this.now.get(p)! : this.original(p);
  }
}

type Edit = (tree: Tree) => void;

function detect(lines: string[]): string | null {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) return null;
  if (lines[first]!.trim() === '*** Begin Patch') return 'v4a';
  const c = lines[first]!.trimStart()[0];
  if (c === '[' || c === '{') return 'json';
  if (lines.some((l) => l.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  if (lines.some((l, i) => l.startsWith('diff --git ') || (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')))) return 'unified';
  return null;
}

/** One JSON edit object (SPEC.md section 9), or null when it is not one. */
function jsonEdit(v: unknown): Edit | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const p = o.path;
  if (typeof p !== 'string') return null;
  const exists = (tree: Tree): string => {
    if (!safe(p)) throw new Fail('unsafe', p);
    const t = tree.get(p);
    if (t === null) throw new Fail('missing', p);
    return t;
  };
  if (o.command === 'create' && typeof o.file_text === 'string') {
    const text = o.file_text;
    return (tree) => {
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, text);
    };
  }
  if (o.command === 'str_replace' && typeof o.old_str === 'string' && o.old_str !== '' && (o.new_str === undefined || typeof o.new_str === 'string')) {
    const oldStr = o.old_str;
    const newStr = (o.new_str as string | undefined) ?? '';
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const crlf = nl > 0 && before[nl - 1] === '\r';
      const lf = (s: string): string => (crlf ? s.replaceAll('\r\n', '\n') : s);
      const t = lf(before);
      const old = lf(oldStr);
      let count = 0;
      for (let k = t.indexOf(old); k >= 0; k = t.indexOf(old, k + 1)) count += 1;
      if (count === 0) throw new Fail('no-match', p);
      if (count > 1) throw new Fail('ambiguous', p);
      const at = t.indexOf(old);
      const out = t.slice(0, at) + lf(newStr) + t.slice(at + old.length);
      tree.now.set(p, crlf ? out.replaceAll('\n', '\r\n') : out);
    };
  }
  if (o.command === 'insert' && typeof o.insert_line === 'number' && Number.isInteger(o.insert_line) && typeof o.new_str === 'string') {
    const line = o.insert_line;
    const add = patchLines(o.new_str);
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const br = nl > 0 && before[nl - 1] === '\r' ? '\r\n' : '\n';
      const lines = before === '' ? [] : before.split(br);
      const final = before !== '' && before.endsWith(br);
      if (final) lines.pop();
      if (line < 0 || line > lines.length) throw new Fail('no-match', p);
      lines.splice(line, 0, ...add);
      tree.now.set(p, lines.length === 0 ? '' : lines.join(br) + (final ? br : ''));
    };
  }
  return null;
}

function jsonEdits(text: string, lines: string[]): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  const edits: Edit[] = [];
  if (lines[first]!.trimStart().startsWith('[')) {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw new Exit2(`error: parse ${first + 1}`);
    }
    if (!Array.isArray(v)) throw new Exit2(`error: parse ${first + 1}`);
    for (const x of v) {
      const e = jsonEdit(x);
      if (e === null) throw new Exit2(`error: parse ${first + 1}`);
      edits.push(e);
    }
    return edits;
  }
  lines.forEach((l, i) => {
    if (blank(l)) return;
    let e: Edit | null = null;
    try {
      e = jsonEdit(JSON.parse(l));
    } catch {
      e = null;
    }
    if (e === null) throw new Exit2(`error: parse ${i + 1}`);
    edits.push(e);
  });
  return edits;
}

function run(args: string[]): { code: number; out: string[] } {
  let format: string | null = null;
  let check = false;
  let strict = false;
  const pos: string[] = [];
  let ended = false;
  for (const a of args) {
    if (!ended && a === '--') ended = true;
    else if (!ended && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=') && format === null && FORMATS.includes(a.slice(9))) format = a.slice(9);
      else if (a === '--check' && !check) check = true;
      else if (a === '--strict' && !strict) strict = true;
      else return { code: 2, out: ['error: usage'] };
    } else pos.push(a);
  }
  if (pos.length > 1) return { code: 2, out: ['error: usage'] };
  const file = pos.length === 0 || pos[0] === '-' ? null : pos[0]!;
  let text = '';
  try {
    text = readFileSync(file ?? 0, 'utf8');
  } catch {
    if (file !== null) return { code: 2, out: ['error: no-patch'] };
  }
  const lines = patchLines(text);
  const kind = format === null || format === 'auto' ? detect(lines) : format;
  if (kind === null) return { code: 2, out: ['error: format'] };
  let edits: Edit[];
  try {
    edits = kind === 'json' ? jsonEdits(text, lines) : [];
    if (edits.length === 0) throw new Exit2('error: parse 1');
  } catch (e) {
    if (e instanceof Exit2) return { code: 2, out: [e.line] };
    throw e;
  }
  const tree = new Tree();
  const fails: Fail[] = [];
  for (const edit of edits) {
    const before = new Map(tree.now);
    try {
      edit(tree);
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      tree.now.clear();
      for (const [k, v] of before) tree.now.set(k, v);
      fails.push(e);
    }
  }
  if (fails.length > 0) return { code: 1, out: [...fails.map((f) => `error: ${f.code} ${f.path}`), `failed: ${fails.length} of ${edits.length} edits`] };
  const rows: string[] = [];
  for (const p of [...tree.now.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
    const was = tree.original(p);
    const now = tree.now.get(p)!;
    if (was === now) continue;
    rows.push(`${was === null ? 'A' : now === null ? 'D' : 'M'} ${p}`);
    if (check) continue;
    if (now === null) rmSync(p, { force: true });
    else {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, now);
    }
  }
  return { code: 0, out: [...rows, `ok: ${rows.length} ${rows.length === 1 ? 'file' : 'files'}`] };
}


// Only run the CLI when this file is the program being run, not when a test
// imports its functions: `node main.ts` (directly, or spawned by runner.ts /
// a trial) has main.ts as argv[1]; an importer's argv[1] is the test file.
const invokedAsMain = typeof process.argv[1] === 'string' && process.argv[1].endsWith('main.ts');
if (invokedAsMain) {
  const trialEnv = process.env.MAKEFUN_ENV_URL;
  if (trialEnv !== undefined && trialEnv !== '') {
    // A trial: the kit's runner reads the checks from the env and runs this file on each one, without this variable.
    const { runTrial } = await import('./runner.ts');
    await runTrial(trialEnv);
  } else {
    const r = run(process.argv.slice(2));
    writeSync(1, r.out.map((l) => `${l}\n`).join(''));
    process.exitCode = r.code;
  }
}
