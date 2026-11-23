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
// ---------------------------------------------------------------------------
// M3a — unified diffs (SPEC section 6): parser + applier.
// ---------------------------------------------------------------------------

/** One body line of a hunk (S6-15): context, old, or new; `backslashAfter` when a `\` line follows it (S6-28). */
export interface UnifiedBodyLine {
  kind: 'context' | 'old' | 'new';
  text: string;
  backslashAfter: boolean;
}

export interface UnifiedHunk {
  /** Old start line A (1-based) from the hunk header; B and D are not used (S6-14). */
  a: number;
  body: UnifiedBodyLine[];
}

export interface UnifiedSection {
  /** Old path, or null for /dev/null (no file). */
  oldPath: string | null;
  /** New path, or null for /dev/null (no file). */
  newPath: string | null;
  newFileMode: boolean;
  deletedFileMode: boolean;
  hunks: UnifiedHunk[];
}

/** What kind of edit a section is (S6-19..S6-22). */
export function sectionKind(s: UnifiedSection): 'create' | 'delete' | 'move' | 'change' {
  if (s.oldPath === null || s.newFileMode) return 'create';
  if (s.newPath === null || s.deletedFileMode) return 'delete';
  if (s.oldPath !== s.newPath) return 'move';
  return 'change';
}

const DIFF_GIT_RE = /^diff --git a\/(\S+) b\/(\S+)$/;
const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?=$|)/;

/**
 * Collect a hunk body starting at lines[start] (S6-15, S6-16). Returns the
 * classified body lines and the index of the first line after the body. A
 * body ends at the first line that is not a body line, a `diff --git ` line,
 * a `--- ` + `+++ ` pair, or a `@@` line. Trailing zero-length lines are
 * stripped; a ` ` (space-only) line is a context line and is kept.
 */
function collectBody(lines: string[], start: number): { body: UnifiedBodyLine[]; next: number } {
  const raw: string[] = [];
  let i = start;
  while (i < lines.length) {
    const l = lines[i]!;
    if (l.startsWith('diff --git ')) break;
    if (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')) break;
    if (l.startsWith('@@')) break;
    if (l === '' || l.startsWith(' ') || l.startsWith('-') || l.startsWith('+') || l.startsWith('\\')) {
      raw.push(l);
      i++;
      continue;
    }
    break;
  }
  while (raw.length > 0 && raw[raw.length - 1] === '') raw.pop();
  const body: UnifiedBodyLine[] = [];
  for (const l of raw) {
    if (l.startsWith('\\')) {
      const prev = body[body.length - 1];
      if (prev) prev.backslashAfter = true;
      continue;
    }
    body.push({
      kind: l === '' || l[0] === ' ' ? 'context' : l[0] === '-' ? 'old' : 'new',
      text: l === '' ? '' : l.slice(1),
      backslashAfter: false,
    });
  }
  return { body, next: i };
}

/** A `--- ` / `+++ ` path (S6-03, S6-04, S6-06): after the four characters, up to the first tab, surrounding spaces removed, one leading a/ or b/ removed; /dev/null means no file (S6-05). */
function parseHeaderPath(raw: string): string | null {
  let p = raw.split('\t', 1)[0]!.trim();
  if (p.startsWith('a/')) p = p.slice(2);
  else if (p.startsWith('b/')) p = p.slice(2);
  if (p === '/dev/null') return null;
  return p;
}

interface SectionDraft extends UnifiedSection {
  oldNamedBy: 'pair' | 'rename' | 'git' | null;
  newNamedBy: 'pair' | 'rename' | 'git' | null;
}

/**
 * Parse a unified patch into sections (S6-01..S6-13). Throws Exit2 on parse
 * errors, with the 1-based line the format's section names. Hunk bodies are
 * collected by parseHunkBody below (M3a batch 3); this pass handles section
 * starts and headers.
 */
export function parseUnified(lines: string[]): UnifiedSection[] {
  const sections: UnifiedSection[] = [];
  let cur: SectionDraft | null = null;
  // A section is "in its header" while it has no hunks yet (S6-02).
  const inHeader = (): boolean => cur !== null && cur.hunks.length === 0;
  const startSection = (oldPath: string | null, newPath: string | null, namedBy: 'git' | 'pair'): SectionDraft => {
    const s: SectionDraft = {
      oldPath, newPath, newFileMode: false, deletedFileMode: false, hunks: [],
      oldNamedBy: namedBy, newNamedBy: namedBy,
    };
    sections.push(s);
    cur = s;
    return s;
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const n = i + 1; // 1-based line number
    if (line.startsWith('diff --git ')) {
      const m = DIFF_GIT_RE.exec(line);
      if (!m) throw new Exit2(`error: parse ${n}`);
      startSection(m[1]!, m[2]!, 'git');
      i++;
      continue;
    }
    if (line.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')) {
      const oldP = parseHeaderPath(line.slice(4));
      const newP = parseHeaderPath(lines[i + 1]!.slice(4));
      if (cur !== null && inHeader()) {
        // The pair is part of this section's header (S6-01); it names the paths.
        cur.oldPath = oldP;
        cur.newPath = newP;
        cur.oldNamedBy = 'pair';
        cur.newNamedBy = 'pair';
      } else {
        startSection(oldP, newP, 'pair');
      }
      i += 2;
      continue;
    }
    if (line.startsWith('@@')) {
      if (cur === null) throw new Exit2(`error: parse ${n}`);
      const m = HUNK_RE.exec(line);
      if (!m) throw new Exit2(`error: parse ${n}`);
      const { body, next } = collectBody(lines, i + 1);
      cur.hunks.push({ a: Number(m[1]!), body });
      i = next;
      continue;
    }
    if (cur !== null && inHeader()) {
      if (line.startsWith('--- ')) {
        // A `--- ` line not followed by a `+++ ` line, inside a section's header (S6-11).
        throw new Exit2(`error: parse ${n + 1}`);
      }
      if (line.startsWith('+++ ')) {
        // A lone `+++ ` line names the new path when no pair does.
        if (cur.newNamedBy !== 'pair') {
          cur.newPath = parseHeaderPath(line.slice(4));
          cur.newNamedBy = 'pair';
        }
        i++;
        continue;
      }
      if (line.startsWith('rename from ')) {
        if (cur.oldNamedBy !== 'pair') {
          cur.oldPath = line.slice('rename from '.length).trim();
          cur.oldNamedBy = 'rename';
        }
        i++;
        continue;
      }
      if (line.startsWith('rename to ')) {
        if (cur.newNamedBy !== 'pair') {
          cur.newPath = line.slice('rename to '.length).trim();
          cur.newNamedBy = 'rename';
        }
        i++;
        continue;
      }
      if (line.startsWith('new file mode')) {
        cur.newFileMode = true;
        i++;
        continue;
      }
      if (line.startsWith('deleted file mode')) {
        cur.deletedFileMode = true;
        i++;
        continue;
      }
      // `index`, `old mode`, `new mode`, `similarity index`,
      // `dissimilarity index`, `Index:` and any other line are ignored (S6-10).
      i++;
      continue;
    }
    // Outside a section's header: lines that are not part of a section header
    // are ignored (S6-17) — prose, code fences, and (until batch 3) hunk lines.
    i++;
  }
  return sections;
}

/** O and N of a hunk, with N's context alignment (S6-24): O = context + old lines, N = context + new lines; contextOf[k] is the index into O of N[k] when N[k] is a context line, null when N[k] is a `+` line. */
export function hunkON(hunk: UnifiedHunk): { O: string[]; N: string[]; contextOf: (number | null)[] } {
  const O: string[] = [];
  const N: string[] = [];
  const contextOf: (number | null)[] = [];
  for (const b of hunk.body) {
    if (b.kind === 'context') {
      contextOf.push(O.length);
      O.push(b.text);
      N.push(b.text);
    } else if (b.kind === 'old') {
      O.push(b.text);
    } else {
      N.push(b.text);
      contextOf.push(null);
    }
  }
  return { O, N, contextOf };
}

/** The last context or `+` line of a hunk body, or null (S6-28/S6-29 name only those lines; a `\` after a `-` line does not count — see A2). */
function lastContextOrNew(hunk: UnifiedHunk): UnifiedBodyLine | null {
  for (let k = hunk.body.length - 1; k >= 0; k--) {
    const b = hunk.body[k]!;
    if (b.kind === 'context' || b.kind === 'new') return b;
  }
  return null;
}

/**
 * Apply one hunk to a file's lines (S6-23..S6-29). O non-empty: the occurrence
 * of O nearest to A-1+d, ties to the earlier one (S6-25); no occurrence is a
 * no-match (S6-26) — thrown as `error: no-match` without a path, the caller
 * (section edit) adds the path. O empty: insert N after the first A+d lines,
 * clamped to [0, lines.length] (S6-27). The returned d is the cumulative
 * delta after this hunk (N.length - O.length added). Final break: when the
 * matched lines run to EOF, or an insertion lands at the end, the file ends
 * with a break unless `\` follows the hunk's last context or `+` line
 * (S6-28/S6-29); otherwise the break is unchanged. Context lines are written
 * as the file's own lines and tier-2 re-indent is literal (A16), both via
 * applyReplacement (S5-11, S5-12). For an insertion there is no match, hence
 * no tier: `+` lines are written as they are.
 */
export function applyUnifiedHunk(
  state: { lines: string[]; br: '\r\n' | '\n'; final: boolean },
  hunk: UnifiedHunk,
  d: number,
  strict: boolean,
): { lines: string[]; br: '\r\n' | '\n'; final: boolean; d: number } {
  const { O, N, contextOf } = hunkON(hunk);
  const { lines, br } = state;
  let final = state.final;
  const newD = d + N.length - O.length;
  if (O.length > 0) {
    const occ = findOccurrences(O, lines, strict);
    if (occ === null) throw new Exit2('error: no-match');
    const target = hunk.a - 1 + d;
    let best = occ.positions[0]!;
    for (const p of occ.positions) {
      if (Math.abs(p - target) < Math.abs(best - target)) best = p;
    }
    const newLines = applyReplacement(lines, best, O, N, occ.tier, contextOf, 'literal');
    if (best + O.length === lines.length) {
      const last = lastContextOrNew(hunk);
      final = last === null || !last.backslashAfter;
    }
    return { lines: newLines, br, final, d: newD };
  }
  const pos = Math.max(0, Math.min(hunk.a + d, lines.length));
  const newLines = applyReplacement(lines, pos, [], N, 0, contextOf, 'literal');
  if (pos === lines.length && N.length > 0) {
    const last = lastContextOrNew(hunk);
    final = last === null || !last.backslashAfter;
  }
  return { lines: newLines, br, final, d: newD };
}

/**
 * Build one Edit per section (S6-18): each section is one edit, applied in
 * order; a section whose hunks all succeed changes the tree, a section that
 * fails leaves it untouched (run() also snapshots per edit, S10-02).
 */
export function unifiedEdits(lines: string[], strict: boolean): Edit[] {
  const sections = parseUnified(lines);
  return sections.map((s) => (tree) => unifiedSectionEdit(tree, s, strict));
}

function unifiedSectionEdit(tree: Tree, s: UnifiedSection, strict: boolean): void {
  const kind = sectionKind(s);
  const oldP = s.oldPath;
  const newP = s.newPath;
  // Safety first (S10-02): named paths are checked before existence checks.
  if (oldP !== null && !safe(oldP)) throw new Fail('unsafe', oldP);
  if (newP !== null && !safe(newP)) throw new Fail('unsafe', newP);
  if (kind === 'create') {
    // Both paths /dev/null names no file: nothing to create.
    if (newP === null) return;
    if (tree.get(newP) !== null) throw new Fail('exists', newP);
    // A20: context and `-` lines in a creation hunk are ignored; the file is
    // the `+` lines of all hunks, line break LF, final break unless `\`
    // follows the last `+` line.
    const plus: string[] = [];
    let final = true;
    for (const h of s.hunks) {
      for (const b of h.body) {
        if (b.kind === 'new') {
          plus.push(b.text);
          final = !b.backslashAfter;
        }
      }
    }
    tree.now.set(newP, plus.length === 0 ? '' : plus.join('\n') + (final ? '\n' : ''));
    return;
  }
  // delete, move and change all edit the old file.
  const file = oldP!;
  const before = tree.get(file);
  if (before === null) throw new Fail('missing', file);
  if (kind === 'move' && newP !== null && tree.get(newP) !== null) throw new Fail('exists', newP);
  if (kind === 'delete') {
    // S6-20: a deletion's hunks are not read — the file is deleted regardless
    // of whether its hunks would match (they are still parsed: a malformed
    // `@@` line is a parse error before any edit runs, see A21).
    tree.now.set(file, null);
    return;
  }
  let state: { lines: string[]; br: '\r\n' | '\n'; final: boolean; d: number } = { ...splitFileLines(before), d: 0 };
  try {
    for (const h of s.hunks) {
      state = applyUnifiedHunk(state, h, state.d, strict);
    }
  } catch (e) {
    if (e instanceof Exit2 && e.line === 'error: no-match') throw new Fail('no-match', file);
    throw e;
  }
  const after = joinFileLines(state.lines, state.br, state.final);
  if (kind === 'move') {
    const target = newP!;
    tree.now.set(file, null);
    tree.now.set(target, after);
    tree.moves.push([file, target]);
    return;
  }
  tree.now.set(file, after);
}

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
  /** Moves recorded by unified move edits, as [old, new] pairs (S6-22). */
  readonly moves: [string, string][] = [];
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
    edits = kind === 'json' ? jsonEdits(text, lines) : kind === 'unified' ? unifiedEdits(lines, strict) : [];
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
  // One entry per changed file; a move that qualifies is one R row sorted by
  // its new path and counts as one file (S6-22), replacing the D row of the
  // old path and the A row of the new path (their writes are kept).
  const entries: { key: string; row: string; write: () => void }[] = [];
  for (const p of [...tree.now.keys()]) {
    const was = tree.original(p);
    const now = tree.now.get(p)!;
    if (was === now) continue;
    entries.push({
      key: p,
      row: `${was === null ? 'A' : now === null ? 'D' : 'M'} ${p}`,
      write: () => {
        if (check) return;
        if (now === null) rmSync(p, { force: true });
        else {
          mkdirSync(dirname(p), { recursive: true });
          writeFileSync(p, now);
        }
      },
    });
  }
  for (const [o, n] of tree.moves) {
    // A recorded move qualifies only when the old file existed before and
    // does not after, and the new file did not exist before and does after.
    if (tree.original(o) !== null && tree.get(o) === null && tree.original(n) === null && tree.get(n) !== null) {
      const doomed = entries.filter((e) => e.key === o || e.key === n);
      const writes = doomed.map((e) => e.write);
      for (let k = entries.length - 1; k >= 0; k--) {
        if (entries[k]!.key === o || entries[k]!.key === n) entries.splice(k, 1);
      }
      entries.push({ key: n, row: `R ${o} -> ${n}`, write: () => { for (const w of writes) w(); } });
    }
  }
  entries.sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
  for (const e of entries) rows.push(e.row);
  for (const e of entries) e.write();
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
