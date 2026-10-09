// The "Regenerate these results in" scripts: a recipe (see recipes.js)
// becomes a MATLAB, R, or Python script holding the data the page analyzed,
// the choices it made, and code that recomputes every number the page shows,
// checks each against the analyzer's own value, and draws the figures of the
// page's view (figure_scripts.js). Pure functions, no DOM.
//
// A script is assembled from: a header comment (title, stamp, choices,
// requirements), the report helper, the helpers the body needs (MATLAB puts
// these after the body as local functions), a Settings block, a Data block,
// and the page's body. BODIES[page][lang] builds the body and names the
// helpers it needs from script_lib.js. In CSV mode the Data block holds no
// data and reads them from the CSV files the recipe names instead.
//
// Every script is 7-bit ASCII: each string that reaches one (a title, a
// dataset name, a provenance value, a report name) goes through ascii().

import { plain, joinNums, sanitizeName, kebabName } from './scripts.js';
import { LIB } from './script_lib.js';
import { FIG, figureBlock } from './figure_scripts.js';
import { pairLabel, repKeys, REP_LINES_MAX, MAX_NUMBERS } from './recipes.js';

const BY = 'the Output Analyzer';

// ── ASCII folding ────────────────────────────────────────────────────────

// Greek letters by name; the capitals are added below with capitalized names.
const GREEK = {
  'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon', 'ϵ': 'epsilon', 'ζ': 'zeta',
  'η': 'eta', 'θ': 'theta', 'ι': 'iota', 'κ': 'kappa', 'λ': 'lambda', 'μ': 'mu', 'ν': 'nu', 'ξ': 'xi',
  'ο': 'omicron', 'π': 'pi', 'ρ': 'rho', 'σ': 'sigma', 'ς': 'sigma', 'τ': 'tau', 'υ': 'upsilon',
  'φ': 'phi', 'ϕ': 'phi', 'χ': 'chi', 'ψ': 'psi', 'ω': 'omega'
};
for (const [k, v] of Object.entries(GREEK)) {
  const K = k.toUpperCase();
  if (K !== k && !GREEK[K]) GREEK[K] = v[0].toUpperCase() + v.slice(1);
}

// Symbols and letters folded before canonical decomposition: NFKD would split
// some of them into an ASCII character and a combining mark (the "not equal"
// sign into "=" and a slash overlay, which the mark strip would then leave as
// "="), turn the micro sign into a mu, and the superscripts into bare digits.
const SYMBOL = {
  '≤': '<=', '≥': '>=', '≠': '!=', '≈': '~', '±': '+/-', '×': 'x', '÷': '/', '⁄': '/', '√': 'sqrt',
  '∞': 'infinity', '→': '->', '←': '<-', '°': ' deg', '•': '-', '′': "'", '″': '"',
  '\u00b5': 'u', '¹': '^1', '²': '^2', '³': '^3',
  'ß': 'ss', 'æ': 'ae', 'Æ': 'AE', 'œ': 'oe', 'Œ': 'OE', 'ø': 'o', 'Ø': 'O', 'ł': 'l', 'Ł': 'L',
  'đ': 'd', 'Đ': 'D', 'ð': 'd', 'Ð': 'D', 'þ': 'th', 'Þ': 'Th'
};

/**
 * A string as 7-bit ASCII for a script: plain() first (dashes, curly quotes,
 * the minus sign, line breaks), then the symbols above to their ASCII
 * spellings (the micro sign to "u", a superscript 2 to "^2"), accents dropped
 * by canonical decomposition, Greek letters to their names, control
 * characters to spaces, and anything else to "?".
 * @param {*} s
 * @returns {string}
 */
export function ascii(s) {
  return plain(s)
    .replace(/[^\x00-\x7f]/gu, c => (Object.prototype.hasOwnProperty.call(SYMBOL, c) ? SYMBOL[c] : c))
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0370-\u03ff]/g, c => GREEK[c] || c)
    .replace(/[^\x00-\x7f]/gu, '?')
    .replace(/[\x00-\x1f\x7f]/g, ' ');
}

// ── Per-language syntax ──────────────────────────────────────────────────

function dq(s) { return '"' + ascii(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
function sq(s) { return "'" + ascii(s).replace(/'/g, "''") + "'"; }

const LANG = {
  R: {
    lang: 'R', comment: '# ', sect: s => '\n## ' + s + ' ----',
    str: dq,
    vec: a => (a.length ? 'c(' + joinNums(a, 'NaN', '  ', '') + ')' : 'numeric(0)'),
    strs: a => (a.length ? 'c(' + a.map(dq).join(', ') + ')' : 'character(0)'),
    assign: (n, e) => n + ' <- ' + e,
    bool: b => (b ? 'TRUE' : 'FALSE'), nan: 'NaN', inf: 'Inf',
    list: items => 'list(' + items.join(', ') + ')',
    prelude: () => ['options(digits = 10)'],
    requires: 'R with its stats package (no other packages).'
  },
  py: {
    lang: 'py', comment: '# ', sect: s => '\n# ---- ' + s + ' ----',
    str: dq,
    vec: a => 'np.array([' + joinNums(a, 'np.nan', '    ', '') + '])',
    strs: a => '[' + a.map(dq).join(', ') + ']',
    assign: (n, e) => n + ' = ' + e,
    bool: b => (b ? 'True' : 'False'), nan: 'np.nan', inf: 'np.inf',
    list: items => '[' + items.join(', ') + ']',
    // SciPy's submodules are imported only where the script's code calls them.
    prelude: code => {
      const mods = ['integrate', 'optimize', 'stats'].filter(m => new RegExp('\\b' + m + '\\.').test(code));
      return ['import numpy as np', ...(mods.length ? ['from scipy import ' + mods.join(', ')] : []), 'np.set_printoptions(precision=10)'];
    },
    // Matplotlib is named only where the script draws a figure.
    requires: code => 'Python 3 with NumPy and SciPy 1.11 or later' +
      (/import matplotlib/.test(code) ? ' (Matplotlib, if installed, draws the figures).' : '.')
  },
  m: {
    lang: 'm', comment: '% ', sect: s => '\n%% ' + s,
    str: sq,
    vec: a => (a.length ? '[' + joinNums(a, 'NaN', '    ', ' ...') + ']' : '[]'),
    strs: a => '{' + a.map(sq).join(', ') + '}',
    assign: (n, e) => n + ' = ' + e + ';',
    bool: b => (b ? 'true' : 'false'), nan: 'NaN', inf: 'Inf',
    list: items => '{' + items.join(', ') + '}',
    prelude: () => ['format long g'],
    requires: 'MATLAB with the Statistics and Machine Learning Toolbox. A Shapiro-Wilk check, where the page makes one, runs only when a swtest function is on the path (the toolbox has one from R2026b; for earlier releases, one is on the File Exchange).'
  }
};

/**
 * The line that opens a section of a script, as the writers emit it: for the
 * Data section, "## Data ----" in R, "# ---- Data ----" in Python, and
 * "%% Data" in MATLAB.
 * @param {'m'|'R'|'tidy'|'py'} lang
 * @param {string} title
 */
export function sectionLine(lang, title) {
  if (!Object.prototype.hasOwnProperty.call(LANG, lang)) throw new RangeError('sectionLine: unknown language ' + lang);
  return LANG[lang].sect(title).trim();
}

/** The writers by language key, with the button label and the file-name rule. */
export const ANALYSIS_WRITERS = {
  m: { label: 'MATLAB', name: 'MATLAB', ext: 'm', mime: 'text/x-matlab' },
  R: { label: 'Base R', name: 'base R', ext: 'R', mime: 'text/x-r' },
  tidy: { label: 'Tidy R', name: 'R with the tidyverse', ext: 'R', mime: 'text/x-r', suffix: '-tidy' },
  py: { label: 'Python', name: 'Python', ext: 'py', mime: 'text/x-python' }
};

// Tidy R is the R syntax with the tidyverse loaded. Both dialects report
// L.lang === 'R', share LIB.R, and print the same report lines; where L.tidy
// is set, the emitters add the data as a long tibble beside the vectors, take
// the descriptives with dplyr, print each test object the script builds
// through broom::tidy() after its report lines, and draw the figures with
// ggplot2 in place of base graphics.
LANG.tidy = Object.assign({}, LANG.R, {
  tidy: true,
  // pillar.sigfig lets a printed tibble show seven significant digits, enough to
  // recognize each report line's value.
  prelude: () => ['suppressPackageStartupMessages({ library(tibble); library(dplyr); library(tidyr); library(broom); library(ggplot2) })',
    'options(digits = 10, pillar.sigfig = 7)'],
  requires: 'R 4.1 or later with tibble, dplyr 1.1 or later, tidyr, broom, and ggplot2.'
});
LANG.R.tidy = false;

/**
 * The file name of a recipe's script in one language: the title in kebab
 * case with "-analysis" (and "-tidy" for Tidy R) for R and Python, and an
 * identifier ending in "_analysis" for MATLAB, which runs a script by name.
 * @param {object} recipe
 * @param {'m'|'R'|'tidy'|'py'} lang
 */
export function scriptFileName(recipe, lang) {
  const w = ANALYSIS_WRITERS[lang];
  if (!w) throw new RangeError('scriptFileName: unknown language ' + lang);
  const base = ascii(recipe.title || recipe.page || 'analysis');
  if (lang === 'm') return sanitizeName(base).slice(0, 50).replace(/_+$/, '') + '_analysis.m';
  return kebabName(base).slice(0, 50).replace(/-+$/, '') + '-analysis' + (w.suffix || '') + '.' + w.ext;
}

function pad2(n) { return String(n).padStart(2, '0'); }
function stamp(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/** A value as a literal of the language: a string, a boolean, NaN for a missing number, or the number. */
export function lit(L, v) {
  if (typeof v === 'string') return L.str(v);
  if (typeof v === 'boolean') return L.bool(v);
  if (v == null || Number.isNaN(v)) return L.nan;
  if (v === Infinity) return L.inf;
  if (v === -Infinity) return '-' + L.inf;
  return String(v);
}

// Rscript reads a script one line at a time and parses the whole statement so
// far after every line, and so a vector literal spread over thousands of lines
// takes time that grows with the square of its length (minutes near the
// 200,000-number cap). In R a vector longer than a line is therefore written as
// short complete statements, each on one line: its first part assigned, and
// every later part appended. Python and MATLAB read the whole file first and
// keep the one wrapped literal.
const R_LINE = 92;
function rChunks(target, tokens, empty) {
  if (!tokens.length) return [target + ' <- ' + empty];
  const out = [];
  let line = target + ' <- c(', n = 0;
  for (const tok of tokens) {
    if (n && line.length + tok.length + 3 > R_LINE) { out.push(line + ')'); line = target + ' <- c(' + target + ', '; n = 0; }
    line += (n ? ', ' : '') + tok;
    n++;
  }
  out.push(line + ')');
  return out;
}
const numTok = v => (typeof v === 'number' && Number.isFinite(v) ? String(v) : 'NaN');

/** Lines assigning a vector of numbers to `target`. */
export function vecAssign(L, target, values) {
  return L.lang === 'R' ? rChunks(target, Array.from(values, numTok), 'numeric(0)') : [L.assign(target, L.vec(values))];
}

/** Lines assigning a vector of strings to `target`. */
export function strsAssign(L, target, values) {
  return L.lang === 'R' ? rChunks(target, values.map(v => L.str(v)), 'character(0)') : [L.assign(target, L.strs(values))];
}

/**
 * Whether ids can be written as numbers: only when every one is a finite
 * number written plainly, so that it prints back exactly as the page shows it
 * ("7" can, "007", "1.0", and "1e3" cannot, and stay strings).
 */
function numericIds(ids) {
  return ids.every(i => { const s = String(i), n = Number(s); return Number.isFinite(n) && String(n) === s; });
}

/** Lines assigning ids: numbers when numericIds allows, strings otherwise. */
function idsAssign(L, target, ids) {
  return numericIds(ids) ? vecAssign(L, target, ids.map(Number)) : strsAssign(L, target, ids.map(String));
}

/** Ids as a literal: numbers when numericIds allows, strings otherwise. */
function idsLit(L, ids) {
  return numericIds(ids) ? L.vec(ids.map(Number)) : L.strs(ids.map(String));
}

// Literal tokens joined by commas and wrapped before column 92, each later
// line indented by `indent` and every earlier one ending in `cont`.
function joinToks(toks, indent, cont) {
  const lines = [];
  let line = '';
  for (const t of toks) {
    if (line && line.length + t.length + 2 > 92) { lines.push(line + ','); line = ''; }
    line += (line ? ', ' : '') + t;
  }
  lines.push(line);
  return lines.join(cont + '\n' + indent);
}

/**
 * Lines assigning the analyzer's values to `target`, each written by lit():
 * numbers with NaN and Inf kept, and yes/no values as booleans.
 */
function pageAssign(L, target, values) {
  const toks = values.map(v => lit(L, v));
  if (L.lang === 'R') return rChunks(target, toks, 'logical(0)');
  return [L.assign(target, '[' + joinToks(toks, '    ', L.lang === 'm' ? ' ...' : '') + ']')];
}

/** Lines assigning a list of vectors (R list, Python list, MATLAB cell), each built by `part(L, target, i)`. */
function listAssign(L, target, n, part, lit) {
  if (L.lang !== 'R') return [L.assign(target, L.list(Array.from({ length: n }, (_, i) => lit(i))))];
  const out = [target + ' <- list()'];
  for (let i = 0; i < n; i++) out.push(...part(L, target + '[[' + (i + 1) + ']]', i));
  return out;
}

// Tolerances: a relative 1e-6 on max(1, |expected|) by default; the keys a
// language can only approximate are looser. A post-hoc rule's differences,
// standard errors, and degrees of freedom are exact; what rests on its
// quantile (the critical value, the half-width, the interval's ends, and a
// p-value) is held to 1e-5 for the studentized range and Dunnett's quantile
// in every language (MATLAB's scripts compute Dunnett's value themselves,
// because multcompare's root search stops at about 1e-4, and Tukey's, because
// multcompare's studentized range is approximate on few degrees of freedom).
// SciPy's dunnett, which Python uses without blocks and with some spread to
// compare, finds its critical value by randomized quadrature and is held to
// 2e-3. The scripts check their own results with these tolerances, and
// test/analysis_scripts.test.mjs holds them to the same.
export function tolFor(key, lang, recipe) {
  // R's qtukey and ptukey are documented as accurate to about 4 digits; at a few
  // residual degrees of freedom they miss the analyzer's studentized range by up to
  // about 1.1e-5 relative (3 df), and so R alone is held to 5e-5 on these keys.
  if (/^posthoc (tukey|gameshowell) .*(critical value|crit|hw|lower|upper| p)$/.test(key)) return { rel: lang === 'R' || lang === 'tidy' ? 5e-5 : 1e-5 };
  if (/^posthoc dunnett .*(critical value|hw|lower|upper)$/.test(key)) {
    const A = recipe && recipe.several && recipe.several.anova;
    const scipy = lang === 'py' && A && !A.blocked && recipe.expect['ms within'] > 0;
    return { rel: scipy ? 2e-3 : 1e-5 };
  }
  if (/\bN\b|additional/.test(key)) return { abs: 1 + 1e-9 };
  if (/rinott/.test(key)) return { rel: 1e-4 };
  // A Wilcoxon interval under the normal approximation is a root found to 1e-4,
  // by a different root finder in each language.
  if (/(wilcoxon|shift|pseudo-median of differences|^rank design \d+).*(lower|upper)/.test(key)) return { rel: 2e-4 };
  return { rel: 1e-6 };
}

// The recipe the script being written comes from, for the tolerances of
// report lines named at run time. analysisScript sets it.
let current = null;

// The tolerance argument of a report call for `key`: none at the default
// 1e-6, a relative tolerance otherwise (an absolute one is made relative to
// the analyzer's value `want`).
function tolArg(L, key, want) {
  const t = tolFor(key, L.lang, current);
  if (t.abs != null) return ', ' + (typeof want === 'number' && Number.isFinite(want) ? t.abs / Math.max(1, Math.abs(want)) : 1e-6);
  return t.rel === 1e-6 ? '' : ', ' + t.rel;
}

/**
 * A report call for `name` with expression `expr`, carrying the analyzer's
 * value from the recipe's expect map (under `name` or `name [optional]`); a
 * null expect value, or none, leaves the analyzer column out.
 */
export function rep(L, recipe, name, expr) {
  const key = ascii(name);
  const has = k => Object.prototype.hasOwnProperty.call(recipe.expect, k);
  const want = has(key) ? recipe.expect[key] : has(key + ' [optional]') ? recipe.expect[key + ' [optional]'] : undefined;
  const a = want !== undefined && want !== null ? ', ' + lit(L, want) + tolArg(L, key, want) : '';
  const call = 'report(' + L.str(key) + ', ' + expr + a + ')';
  return L.lang === 'm' ? call + ';' : call;
}

// ── Header, settings, data ───────────────────────────────────────────────

// A comment of one or more lines broken at spaces before column `width`: the
// first line starts with `first`, and every later one with `cont`.
function commentLines(first, text, cont, width = 92) {
  const out = [];
  let line = first, fresh = true;
  for (const w of String(text).split(/ +/)) {
    if (!w) continue;
    if (!fresh && line.length + 1 + w.length > width) { out.push(line); line = cont; fresh = true; }
    line += (fresh ? '' : ' ') + w;
    fresh = false;
  }
  out.push(line);
  return out;
}

function header(recipe, L, csv, code) {
  const c = L.comment;
  const out = [c + ascii(recipe.title)];
  out.push(c + 'Written by ' + BY + ' on ' + stamp(new Date()) + '. It regenerates the page\'s results from the');
  out.push(c + (csv ? 'data it reads below. Edit the settings and rerun.' : 'data below. Edit the settings and rerun.'));
  out.push(c.trim());
  out.push(c + 'Choices on the page:');
  for (const [k, v] of Object.entries(recipe.provenance || {})) {
    if (v === undefined || v === null || v === '') continue;
    out.push(...commentLines(c + '  ', ascii(k) + ': ' + ascii(Array.isArray(v) ? v.join(', ') : String(v)), c + '    '));
  }
  let needs = 'Requires: ' + (typeof L.requires === 'function' ? L.requires(code) : L.requires);
  if (csv) {
    const files = csvFiles(recipe);
    needs += ' It also needs the data ' + (files.length === 1 ? 'file ' : 'files ') + listWords(files) + ' in the folder it runs from.';
  }
  out.push(...commentLines(c, needs, c + '  '));
  return out;
}

// Words joined as a list: "a", "a and b", "a, b, and c".
function listWords(a) {
  return a.length < 3 ? a.join(' and ') : a.slice(0, -1).join(', ') + ', and ' + a[a.length - 1];
}

// The distinct files a recipe's data are read from, in order.
function csvFiles(recipe) {
  return Array.from(new Set((recipe.csv || []).map(f => f.file)));
}

/**
 * One data vector with its ids, the sentence saying how it was formed, and
 * the ids left out, as lines of the language.
 * @param {object} L the language
 * @param {{ids?: Array, values: number[], dropped?: Array, how: string, name: string, response: string, unit?: string, pooled?: boolean}} d
 * @param {string} varName the vector's variable
 * @param {string} [idName] the ids' variable, or none to leave the ids out
 */
export function vectorBlock(L, { ids, values, dropped, how, name, response, unit, pooled }, varName, idName) {
  const c = L.comment;
  const out = [];
  const what = ascii(name) + ' (' + ascii(response) + (unit ? ', ' + ascii(unit) : '') + ')';
  if (pooled) {
    out.push(c + 'Every observation of ' + what + ', pooled across its replications');
    out.push(c + '(the override on the page; these are not independent).');
  } else {
    out.push(c + 'Replication outcomes of ' + what + ':');
    out.push(c + 'one value per replication, ' + ascii(how) + '.');
  }
  if (dropped && dropped.length) out.push(c + 'Replications that gave no outcome were left out: ' + dropped.map(ascii).join(', ') + '.');
  if (ids && idName) out.push(...idsAssign(L, idName, ids));
  out.push(...vecAssign(L, varName, values));
  return out;
}

// ── Page bodies ──────────────────────────────────────────────────────────
// BODIES[page][lang](recipe, L, { csv }) returns { body: string[], need:
// string[] }, `need` naming LIB snippets, and `csv` saying whether the script
// reads its data from files. The keys are 'R' (both R dialects), 'py', and 'm'.

export const BODIES = {};

const DESC_KEYS = ['n', 'mean', 'sd', 'se', 'min', 'q1', 'median', 'q3', 'max'];

/** Field access per language: d$k, d["k"], d.k. */
export const FIELD = { R: (v, k) => v + '$' + k, py: (v, k) => v + '["' + k + '"]', m: (v, k) => v + '.' + k };

/**
 * The Descriptives section on the vector `v`, with `describe()` from LIB's
 * descriptives; in Tidy R, on the column `col` of the tibble d_tbl, with
 * `describe_tbl()` from LIB's tidyDescriptives.
 */
export function descriptives(r, L, v, out, col = 'outcome') {
  out.push(L.sect('Descriptives of the ' + (r.data.pooled ? 'pooled observations' : 'replication outcomes')));
  out.push(L.tidy ? 'd <- d_tbl |> describe_tbl(' + col + ')' : L.assign('d', 'describe(' + v + ')'));
  for (const k of DESC_KEYS) out.push(rep(L, r, k, FIELD[L.lang]('d', k)));
}

// The descriptives snippet a body needs: describe() or, in Tidy R, describe_tbl().
const descNeed = L => (L.tidy ? 'tidyDescriptives' : 'descriptives');

// Tidy R: a test object the script built, printed through broom::tidy() after
// its report lines, behind the comment `why`. A `maybe` object is NULL where
// the helper did not call the test (data with no spread), and is then skipped.
// broom announces on stderr how it names a test's two degrees of freedom
// (var.test, oneway.test), which `twoDf` silences.
function tidyTest(out, L, obj, why, maybe = false, twoDf = false) {
  out.push(...commentLines(L.comment, why, L.comment));
  const show = twoDf ? 'print(suppressMessages(broom::tidy(' + obj + ')))' : 'print(broom::tidy(' + obj + '))';
  out.push(maybe ? 'if (!is.null(' + obj + ')) ' + show : show);
}

// What the tidied wilcox.test result can differ in from the report lines above it.
const WILCOX_OWN = 'Its estimate is wilcox.test\'s own, which under the normal approximation can differ in the third decimal from the Hodges-Lehmann estimate reported above, and where a few tied values leave an end of the interval undetermined, wilcox.test reports an interval anyway; the report lines follow the analyzer.';

/**
 * A report call for a yes/no result: the script's logical beside the
 * analyzer's, which the expect map holds as 1 or 0.
 */
export function repYesNo(L, recipe, name, expr) {
  const want = recipe.expect[name];
  const call = 'report(' + L.str(ascii(name)) + ', ' + expr + (want === 0 || want === 1 ? ', ' + L.bool(want === 1) : '') + ')';
  return L.lang === 'm' ? call + ';' : call;
}

// One System: descriptives, the t interval or the Wilcoxon signed-rank
// interval, the Shapiro-Wilk check, the chi-square interval on the variance,
// and the replication plan.
function oneBody(r, L) {
  const o = r.one, lang = L.lang, f = FIELD[lang], c = L.comment;
  const need = [descNeed(L)], out = [];
  descriptives(r, L, 'x', out, r.data.pooled ? 'observation' : 'outcome');
  if (o.interval && o.np) {
    need.push('signedRank');
    out.push(L.sect('Interval on the pseudo-median (Wilcoxon signed-rank)'));
    out.push(L.assign('sr', 'signed_rank(x, level)'));
    out.push(rep(L, r, 'pseudo-median', f('sr', 'estimate')), rep(L, r, 'V', f('sr', 'V')), rep(L, r, 'signed-rank p', f('sr', 'p')));
    out.push(repYesNo(L, r, 'exact', f('sr', 'exact')));
    out.push(rep(L, r, 'wilcoxon lower', f('sr', 'lo')), rep(L, r, 'wilcoxon upper', f('sr', 'hi')));
    if ('achieved level' in r.expect) out.push(rep(L, r, 'achieved level', f('sr', 'achieved')));
    if (L.tidy) tidyTest(out, L, 'sr$test', 'The signed-rank test as wilcox.test returns it, tidied by broom into a one-row tibble. ' + WILCOX_OWN);
  } else if (o.interval) {
    need.push('tInterval');
    out.push(L.sect('Interval on the mean (t)'));
    out.push(L.assign('ti', 't_interval(x, level)'));
    for (const [name, k] of [['df', 'df'], ['t quantile', 't'], ['half-width', 'hw'], ['lower', 'lo'], ['upper', 'hi']]) out.push(rep(L, r, name, f('ti', k)));
    if (L.tidy) tidyTest(out, L, 'ti$test', 'The t test as t.test returns it, tidied by broom into a one-row tibble (none when the outcomes are all equal, where t.test stops).', true);
  }
  if (o.checks) {
    need.push('shapiro');
    out.push(L.sect('Normality check on the replication outcomes'));
    const w = lit(L, r.expect['shapiro W [optional]']), p = lit(L, r.expect['shapiro p [optional]']);
    out.push(lang === 'm' ? "shapiro_check('shapiro', x, alpha, " + w + ', ' + p + ');' : 'shapiro_check("shapiro", x, ' + w + ', ' + p + ')');
  }
  if (o.variance) {
    need.push('varianceInterval');
    out.push(L.sect('Interval on the variance (chi-square)'));
    out.push(L.assign('vi', 'variance_interval(x, level)'));
    for (const [name, k] of [['s2', 's2'], ['chi2 lower quantile', 'chiLo'], ['chi2 upper quantile', 'chiHi'], ['variance lower', 'lo2'],
      ['variance upper', 'hi2'], ['sd lower', 'loS'], ['sd upper', 'hiS']]) out.push(rep(L, r, name, f('vi', k)));
  }
  if (o.plan) {
    need.push('planning');
    out.push(L.sect('Replications needed'));
    out.push(c + 'By half-width: the smallest R at which the t interval\'s half-width, with s held at its current');
    if (o.plan.relative) {
      out.push(c + 'value, is at most plan_h, set here to plan_rel percent of the current mean\'s absolute value.');
      out.push(L.assign('plan_h', 'plan_rel / 100 * abs(' + f('d', 'mean') + ')'));
    } else out.push(c + 'value, is at most plan_h.');
    out.push(L.assign('hp', 'plan_half_width(' + f('d', 'sd') + ', level, plan_h)'));
    out.push(rep(L, r, 'plan half-width target', 'plan_h'), rep(L, r, 'plan n for half-width', f('hp', 'n')), rep(L, r, 'plan half-width at n', f('hp', 'hwAtN')));
    out.push(c + 'By power: the smallest R at which a two-sided one-sample t test at alpha detects a shift of');
    out.push(c + 'plan_delta with probability plan_power.');
    out.push(L.assign('pp', 'plan_power_t1(' + f('d', 'sd') + ', plan_delta, alpha, plan_power)'));
    out.push(rep(L, r, 'plan delta', 'plan_delta'), rep(L, r, 'plan power target', 'plan_power'), rep(L, r, 'plan n for power', f('pp', 'n')), rep(L, r, 'plan power at n', f('pp', 'powerAtN')));
    out.push(c + 'The power the current replications already give against that shift.');
    if (lang === 'R') out.push('cur <- if (isTRUE(d$sd > 0 && plan_delta > 0)) power_t1(d$n, d$sd, plan_delta, alpha) else NaN');
    else if (lang === 'py') out.push('cur = power_t1(d["n"], d["sd"], plan_delta, alpha) if d["sd"] > 0 and plan_delta > 0 else np.nan');
    else out.push('cur = NaN;', 'if d.sd > 0 && plan_delta > 0, cur = power_t1(d.n, d.sd, plan_delta, alpha); end');
    out.push(rep(L, r, 'power at current R', 'cur'));
    if (o.np) {
      out.push(c + 'The rank procedure is sized from the t plan inflated by pi/3, the reciprocal of its efficiency');
      out.push(c + 'relative to the t under normal data.');
      const inf = k => (lang === 'R' ? 'ceiling(' + k + ' * pi / 3)' : lang === 'py' ? 'np.ceil(' + k + ' * np.pi / 3)' : 'ceil(' + k + ' * pi / 3)');
      out.push(rep(L, r, 'plan n for half-width (rank)', inf(f('hp', 'n'))), rep(L, r, 'plan n for power (rank)', inf(f('pp', 'n'))));
    }
  }
  return { body: out, need };
}
BODIES.one = { R: oneBody, py: oneBody, m: oneBody };

// The Shapiro-Wilk check of one design's outcomes, reported as '<prefix> W' and '<prefix> p'.
// The Shapiro-Wilk check of paired differences, skipped when paired_t found
// them equal up to rounding (sdD = 0): the test would read the rounding's own
// pattern as a shape. nameCode is code for the report name, xCode the
// differences, sdCode their sd, and wCode and pCode the analyzer's values.
function diffShapiro(L, nameCode, xCode, sdCode, wCode, pCode) {
  const msg = ': the differences are equal up to rounding, no spread to test';
  if (L.lang === 'R') return ['if (' + sdCode + ' > 0) shapiro_check(' + nameCode + ', ' + xCode + ', ' + wCode + ', ' + pCode + ') else cat(' + nameCode + ', ' + L.str(msg) + ', "\\n", sep = "")'];
  if (L.lang === 'py') return ['if ' + sdCode + ' > 0: shapiro_check(' + nameCode + ', ' + xCode + ', ' + wCode + ', ' + pCode + ')', 'else: print(' + nameCode + ' + ' + L.str(msg) + ')'];
  return ['if ' + sdCode + ' > 0, shapiro_check(' + nameCode + ', ' + xCode + ', alpha, ' + wCode + ', ' + pCode + '); else, fprintf(\'%s' + msg + '\\n\', ' + nameCode + '); end'];
}

function shapiroLine(r, L, prefix, v) {
  const w = lit(L, r.expect[prefix + ' W [optional]']), p = lit(L, r.expect[prefix + ' p [optional]']);
  return L.lang === 'm' ? 'shapiro_check(' + L.str(prefix) + ', ' + v + ', alpha, ' + w + ', ' + p + ');'
    : 'shapiro_check(' + L.str(prefix) + ', ' + v + ', ' + w + ', ' + p + ')';
}

// Two Systems, independent replications: descriptives of both designs; the
// Welch, pooled-variance t, or Wilcoxon rank-sum comparison; the checks a
// parametric comparison carries; the F ratio of the variances; and the
// replication plan, equal in each design.
function twoBody(r, L) {
  if (r.two.mode === 'paired') return twoPairedBody(r, L);
  const o = r.two, lang = L.lang, f = FIELD[lang], c = L.comment;
  const need = [descNeed(L)], out = [];
  const pooledLit = L.bool(o.pooled);
  need.push('shapiro');
  out.push(L.sect('Descriptives of the two designs'));
  if (L.tidy) out.push('da <- d_tbl |> filter(design == "A") |> describe_tbl(outcome)', 'db <- d_tbl |> filter(design == "B") |> describe_tbl(outcome)');
  else out.push(L.assign('da', 'describe(a)'), L.assign('db', 'describe(b)'));
  out.push(rep(L, r, 'R_A', f('da', 'n')), rep(L, r, 'R_B', f('db', 'n')), rep(L, r, 'mean A', f('da', 'mean')),
    rep(L, r, 'mean B', f('db', 'mean')), rep(L, r, 'sd A', f('da', 'sd')), rep(L, r, 'sd B', f('db', 'sd')));
  if (o.np) {
    need.push('signedRank', 'rankSum');
    out.push(L.sect('Wilcoxon rank-sum comparison of A and B'));
    out.push(c + 'The shift A - B is the Hodges-Lehmann estimate, the median of every difference between an');
    out.push(c + 'A outcome and a B outcome. W counts the (A, B) pairs in which the A outcome is the larger.');
    out.push(L.assign('rs', 'rank_sum(a, b, level)'));
    out.push(rep(L, r, 'median A', f('da', 'median')), rep(L, r, 'median B', f('db', 'median')));
    out.push(rep(L, r, 'shift', f('rs', 'estimate')), rep(L, r, 'W', f('rs', 'W')), rep(L, r, 'rank-sum p', f('rs', 'p')));
    out.push(repYesNo(L, r, 'exact', f('rs', 'exact')));
    out.push(rep(L, r, 'shift lower', f('rs', 'lo')), rep(L, r, 'shift upper', f('rs', 'hi')));
    if ('achieved level' in r.expect) out.push(rep(L, r, 'achieved level', f('rs', 'achieved')));
    if (L.tidy) tidyTest(out, L, 'rs$test', 'The rank-sum test as wilcox.test returns it, tidied by broom into a one-row tibble. ' + WILCOX_OWN);
  } else {
    need.push('twoSample');
    out.push(L.sect((o.pooled ? 'Pooled-variance t' : 'Welch') + ' comparison of A and B'));
    out.push(o.pooled
      ? c + 'The two sample variances pooled with weights R_A - 1 and R_B - 1, on R_A + R_B - 2 degrees of freedom.'
      : c + 'Welch\'s t, which lets the two designs have different variances (Welch-Satterthwaite df).');
    out.push(L.assign('w', 'two_sample_t(a, b, level, ' + pooledLit + ')'));
    out.push(rep(L, r, 'difference', f('w', 'diff')));
    if (o.pooled) out.push(rep(L, r, 'pooled sd', f('w', 'sp')));
    for (const [name, k] of [['se', 'se'], ['df', 'df'], ['t', 't'], ['p', 'p'], ['lower', 'lo'], ['upper', 'hi'], ['half-width', 'hw']]) out.push(rep(L, r, name, f('w', k)));
    if (L.tidy) tidyTest(out, L, 'w$test', (o.pooled ? 'The pooled-variance t test' : 'Welch\'s t test') + ' as t.test returns it, tidied by broom into a one-row tibble (none when neither design varies, where t.test stops).', true);
    out.push(L.sect(o.levene ? 'Checks: normality (Shapiro-Wilk) and equal variances (Levene)' : 'Checks: normality of each design\'s outcomes (Shapiro-Wilk)'));
    out.push(c + 'The t procedures take each design\'s replication outcomes as normal' + (o.levene ? ', and the pooled t takes their variances as equal' : '') + '.');
    out.push(shapiroLine(r, L, 'shapiro A', 'a'), shapiroLine(r, L, 'shapiro B', 'b'));
    if (o.levene) {
      need.push('levene');
      out.push(L.assign('lv', 'levene_test(' + L.list(['a', 'b']) + ')'));
      const F = rep(L, r, 'levene F', f('lv', 'F')), P = rep(L, r, 'levene p', f('lv', 'p'));
      const none = 'levene: no spread within any design to compare';
      if (lang === 'R') out.push('if (is.nan(lv$p)) cat("' + none + '\\n") else { ' + F + '; ' + P + ' }');
      else if (lang === 'py') out.push('if np.isnan(lv["p"]):', '    print("' + none + '")', 'else:', '    ' + F, '    ' + P);
      else out.push('if isnan(lv.p)', "    fprintf('" + none + "\\n');", 'else', '    ' + F, '    ' + P, 'end');
    }
  }
  if (o.fratio) {
    need.push('fRatio');
    out.push(L.sect('Variances of A and B (F ratio)'));
    out.push(c + 'F = s_A^2 / s_B^2 with its interval on sigma_A^2 / sigma_B^2. It assumes both designs\' outcomes');
    out.push(c + 'are normal, and unlike the comparison of means it does not become safe as R grows.');
    out.push(L.assign('fr', 'f_ratio(a, b, level)'));
    for (const [name, k] of [['F', 'F'], ['F df1', 'df1'], ['F df2', 'df2'], ['F p', 'p'], ['F lower', 'lo'], ['F upper', 'hi']]) out.push(rep(L, r, name, f('fr', k)));
    if (L.tidy) tidyTest(out, L, 'fr$test', 'The F test as var.test returns it, tidied by broom into a one-row tibble, its two degrees of freedom as num.df and den.df.', false, true);
    if (!o.np) out.push(c + 'Its normality check is the Shapiro-Wilk check of each design reported above.');
  }
  if (o.np) {
    // The rank procedure assumes no normality, but the F ratio does, and the
    // page checks it there.
    out.push(L.sect('Checks on the F ratio: normality of each design\'s outcomes (Shapiro-Wilk)'));
    out.push(c + 'Normality of each design\'s replication outcomes (Shapiro-Wilk), which the F ratio assumes.');
    out.push(shapiroLine(r, L, 'shapiro A', 'a'), shapiroLine(r, L, 'shapiro B', 'b'));
  }
  if (o.plan) {
    need.push('planning', 'planningTwo');
    const sds = f('da', 'sd') + ', ' + f('db', 'sd');
    out.push(L.sect('Replications needed, equal in each design'));
    out.push(c + 'By half-width: the smallest R per design at which the ' + (o.pooled ? 'pooled t' : 'Welch') + ' interval on A - B, with');
    out.push(c + 's_A and s_B held at their current values, has half-width at most plan_h.');
    out.push(L.assign('hp', 'plan_half_width_two(' + sds + ', level, plan_h, ' + pooledLit + ')'));
    out.push(rep(L, r, 'plan half-width target', 'plan_h'), rep(L, r, 'plan n per design for half-width', f('hp', 'n')), rep(L, r, 'plan half-width at n', f('hp', 'hwAtN')));
    out.push(c + 'By power: the smallest R per design at which a two-sided ' + (o.pooled ? 'pooled t' : 'Welch') + ' test at alpha detects a');
    out.push(c + 'difference of plan_delta with probability plan_power.');
    out.push(L.assign('pp', 'plan_power_two(' + sds + ', plan_delta, alpha, plan_power, ' + pooledLit + ')'));
    out.push(rep(L, r, 'plan delta', 'plan_delta'), rep(L, r, 'plan power target', 'plan_power'), rep(L, r, 'plan n per design for power', f('pp', 'n')), rep(L, r, 'plan power at n', f('pp', 'powerAtN')));
    out.push(c + 'The power the current replications already give, at the smaller of the two counts.');
    if (lang === 'R') out.push('cur <- if (sds_ok(da$sd, db$sd)) power_two(min(da$n, db$n), da$sd, db$sd, plan_delta, alpha, ' + pooledLit + ') else NaN');
    else if (lang === 'py') out.push('cur = power_two(min(da["n"], db["n"]), da["sd"], db["sd"], plan_delta, alpha, ' + pooledLit + ') if sds_ok(da["sd"], db["sd"]) else np.nan');
    else out.push('cur = NaN;', 'if sds_ok(da.sd, db.sd), cur = power_two(min(da.n, db.n), da.sd, db.sd, plan_delta, alpha, ' + pooledLit + '); end');
    out.push(rep(L, r, 'power at current R', 'cur'));
    if (o.np) {
      out.push(c + 'The rank procedure is sized from the t plan inflated by pi/3, the reciprocal of its efficiency');
      out.push(c + 'relative to the t under normal data.');
      const inf = k => (lang === 'R' ? 'ceiling(' + k + ' * pi / 3)' : lang === 'py' ? 'np.ceil(' + k + ' * np.pi / 3)' : 'ceil(' + k + ' * pi / 3)');
      out.push(rep(L, r, 'plan n per design for half-width (rank)', inf(f('hp', 'n'))), rep(L, r, 'plan n per design for power (rank)', inf(f('pp', 'n'))));
    }
  }
  return { body: out, need };
}

// Two Systems, paired replications: the paired t on the differences with the
// correlation across the pairs, or the Wilcoxon signed-rank procedure on the
// differences; the Shapiro-Wilk check of the differences under the t; and the
// replication plan, in pairs, from the one-sample t on the differences.
function twoPairedBody(r, L) {
  const o = r.two, lang = L.lang, f = FIELD[lang], c = L.comment;
  const need = ['pairedT'], out = [];
  out.push(L.sect('Paired comparison of A and B'));
  out.push(c + 'The differences d = a - b of the matched pairs. r is the correlation of the A and B outcomes');
  out.push(c + 'across the pairs; common random numbers are run to make it positive, which narrows the comparison.');
  out.push(L.assign('pr', 'paired_t(a, b, level)'));
  out.push(rep(L, r, 'pairs', f('pr', 'n')));
  if (o.np) {
    need.push('signedRank');
    out.push(L.sect('Wilcoxon signed-rank comparison of the matched pairs'));
    out.push(c + 'The pseudo-median of the differences is the Hodges-Lehmann estimate, the median of their Walsh');
    out.push(c + 'averages. V sums the ranks of the positive differences among the absolute ones; zero differences');
    out.push(c + 'are dropped before ranking.');
    out.push(L.assign('sr', 'signed_rank(' + f('pr', 'diffs') + ', level)'));
    out.push(rep(L, r, 'pseudo-median of differences', f('sr', 'estimate')), rep(L, r, 'V', f('sr', 'V')),
      rep(L, r, 'zero differences dropped', f('sr', 'zeros')), rep(L, r, 'signed-rank p', f('sr', 'p')));
    out.push(repYesNo(L, r, 'exact', f('sr', 'exact')));
    out.push(rep(L, r, 'wilcoxon lower', f('sr', 'lo')), rep(L, r, 'wilcoxon upper', f('sr', 'hi')));
    if ('achieved level' in r.expect) out.push(rep(L, r, 'achieved level', f('sr', 'achieved')));
  } else {
    for (const [name, k] of [['mean difference', 'meanD'], ['sd of differences', 'sdD'], ['se', 'se'], ['df', 'df'], ['t', 't'], ['p', 'p'],
      ['lower', 'lo'], ['upper', 'hi'], ['half-width', 'hw']]) out.push(rep(L, r, name, f('pr', k)));
  }
  out.push(rep(L, r, 'r', f('pr', 'r')));
  if (L.tidy) {
    out.push(c + 'The pairs summarised from pairs_tbl by dplyr: how many, and the mean and sd of the differences a - b.');
    out.push('print(pairs_tbl |> mutate(difference = a - b) |> summarise(pairs = n(), mean = mean(difference), sd = sd(difference)))');
  }
  if (L.tidy && o.np) tidyTest(out, L, 'sr$test', 'The signed-rank test on the differences as wilcox.test returns it, tidied by broom into a one-row tibble. ' + WILCOX_OWN);
  else if (L.tidy) tidyTest(out, L, 'pr$test', 'The paired t test as t.test returns it, tidied by broom into a one-row tibble (none when the differences are all equal, where t.test stops).', true);
  if (!o.np) {
    need.push('shapiro');
    out.push(L.sect('Normality of the differences (Shapiro-Wilk)'));
    out.push(c + 'The paired t takes the differences as normal; differences equal up to rounding have no shape to test.');
    out.push(...diffShapiro(L, L.str('shapiro differences'), f('pr', 'diffs'), f('pr', 'sdD'),
      lit(L, r.expect['shapiro differences W [optional]']), lit(L, r.expect['shapiro differences p [optional]'])));
  }
  if (o.plan) {
    need.push('planning');
    const sd = f('pr', 'sdD');
    out.push(L.sect('Replications needed, in pairs'));
    out.push(c + 'By half-width: the smallest number of pairs at which the paired t interval\'s half-width, with');
    out.push(c + 's_D held at its current value, is at most plan_h.');
    out.push(L.assign('hp', 'plan_half_width(' + sd + ', level, plan_h)'));
    out.push(rep(L, r, 'plan half-width target', 'plan_h'), rep(L, r, 'plan n for half-width', f('hp', 'n')), rep(L, r, 'plan half-width at n', f('hp', 'hwAtN')));
    out.push(c + 'By power: the smallest number of pairs at which a two-sided paired t test at alpha detects a');
    out.push(c + 'difference of plan_delta with probability plan_power.');
    out.push(L.assign('pp', 'plan_power_t1(' + sd + ', plan_delta, alpha, plan_power)'));
    out.push(rep(L, r, 'plan delta', 'plan_delta'), rep(L, r, 'plan power target', 'plan_power'), rep(L, r, 'plan n for power', f('pp', 'n')), rep(L, r, 'plan power at n', f('pp', 'powerAtN')));
    out.push(c + 'The power the current pairs already give against that difference.');
    if (lang === 'R') out.push('cur <- if (isTRUE(pr$sdD > 0)) power_t1(pr$n, pr$sdD, plan_delta, alpha) else NaN');
    else if (lang === 'py') out.push('cur = power_t1(pr["n"], pr["sdD"], plan_delta, alpha) if pr["sdD"] > 0 else np.nan');
    else out.push('cur = NaN;', 'if pr.sdD > 0, cur = power_t1(pr.n, pr.sdD, plan_delta, alpha); end');
    out.push(rep(L, r, 'power at current R', 'cur'));
    if (o.np) {
      out.push(c + 'The rank procedure is sized from the t plan inflated by pi/3, the reciprocal of its efficiency');
      out.push(c + 'relative to the t under normal data.');
      const inf = k => (lang === 'R' ? 'ceiling(' + k + ' * pi / 3)' : lang === 'py' ? 'np.ceil(' + k + ' * np.pi / 3)' : 'ceil(' + k + ' * pi / 3)');
      out.push(rep(L, r, 'plan n for half-width (rank)', inf(f('hp', 'n'))), rep(L, r, 'plan n for power (rank)', inf(f('pp', 'n'))));
    }
  }
  return { body: out, need };
}

BODIES.two = { R: twoBody, py: twoBody, m: twoBody };

// ── Several Systems ──────────────────────────────────────────────────────
// The means (or pseudo-medians) with simultaneous intervals and their figure,
// the Bonferroni family of differences (or of rank shifts), the analysis of
// variance with its post-hoc rules, the rank tests, the screen for the best,
// and the replication plans. Each section after the first two is present when
// its field of recipe.several is.

// A design's outcomes for a 0-based i: groups[[i + 1]], groups[i], groups{i + 1}.
const GROUP = { R: i => 'groups[[' + (i + 1) + ']]', py: i => 'groups[' + i + ']', m: i => 'groups{' + (i + 1) + '}' };
// A field of the element at 0-based i of a list: v[[i + 1]]$k, v[i]["k"], v{i + 1}.k.
const ELEM = { R: (v, i, k) => v + '[[' + (i + 1) + ']]$' + k, py: (v, i, k) => v + '[' + i + ']["' + k + '"]', m: (v, i, k) => v + '{' + (i + 1) + '}.' + k };
// A field over every element of a list, as a numeric vector.
const PLUCK = {
  R: (v, k) => 'sapply(' + v + ', function(e) e$' + k + ')',
  py: (v, k) => 'np.array([e["' + k + '"] for e in ' + v + '])',
  m: (v, k) => 'cellfun(@(e) e.' + k + ', ' + v + ')'
};

/** The comparisons of the family in the page's order: every pair i < j, or every design against the control. */
function familyPairs(r) {
  const { k, diffMode, ctrlIdx } = r.several, pairs = [];
  if (diffMode === 'control') { for (let i = 0; i < k; i++) if (i !== ctrlIdx) pairs.push([i, ctrlIdx]); }
  else for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) pairs.push([i, j]);
  return pairs;
}

// The figure comes last, so that every report line prints before a figure
// opens on screen (Python's plt.show waits until it is closed).
function sevBody(r, L) {
  const need = [], out = [];
  sevMeans(r, L, out, need);
  sevDiffs(r, L, out, need);
  if (r.several.anova) sevAnova(r, L, out, need);
  if (r.several.rank) sevRank(r, L, out, need);
  if (r.several.subset) sevSubset(r, L, out, need);
  sevPlan(r, L, out, need);
  return { body: out, need };
}

// The pairwise comparisons and the post-hoc pairs are formed at run time from
// the settings, so that a script whose control or family is edited compares
// what the edit asks for. Each pair's report lines carry the analyzer's value
// for that pair when the page compared it, looked up by the pair's label in
// vectors written out before the loop, and print alone otherwise.

// The pairs of a family as an expression of the settings: each design against
// the control (control is numbered from 1 in every language), or every pair
// i < j, in the page's order. Python's pairs count the designs from 0.
function pairsExpr(lang, byControl) {
  if (lang === 'R') return byControl ? 'lapply(setdiff(seq_len(k), control), function(i) c(i, control))' : 'combn(k, 2, simplify = FALSE)';
  if (lang === 'py') return byControl ? '[(i, control - 1) for i in range(k) if i != control - 1]' : '[(i, j) for i in range(k) for j in range(i + 1, k)]';
  return byControl ? "[setdiff(1:k, control)', repmat(control, k - 1, 1)]" : 'nchoosek(1:k, 2)';
}

// A report name formed at run time: `prefix`, the pair's label `lab`, and `suffix`.
function pairName(L, prefix, suffix) {
  const pre = L.str(prefix + ' '), suf = suffix ? L.str(suffix) : null;
  if (L.lang === 'R') return 'paste0(' + pre + ', lab' + (suf ? ', ' + suf : '') + ')';
  if (L.lang === 'py') return pre + ' + lab' + (suf ? ' + ' + suf : '');
  return '[' + pre + ' lab' + (suf ? ' ' + suf : '') + ']';
}

// A report call for one pair: the name from pairName, the script's value, and
// the analyzer's value at position pos of `pageVar` (none when pos is).
function pairRep(L, prefix, suffix, expr, pageVar) {
  const call = 'report(' + pairName(L, prefix, suffix) + ', ' + expr + ', page_at(' + pageVar + ', pos)' + tolArg(L, prefix + ' 1-2' + (suffix || ''), NaN) + ')';
  return L.lang === 'm' ? call + ';' : call;
}

// The line that sets lab, the pair's label "i-j" with the designs numbered
// from 1, and pos, its place in `labelsVar` (NA, None, or empty when the page
// made no such comparison), from 1-based design numbers `i` and `j` (Python's
// are 0-based and offset by 1 here).
function pairLabelLine(L, i, j, labelsVar) {
  if (L.lang === 'R') return 'lab <- paste0(' + i + ', "-", ' + j + '); pos <- match(lab, ' + labelsVar + ')';
  if (L.lang === 'py') return 'lab = str(' + i + ' + 1) + "-" + str(' + j + ' + 1); pos = ' + labelsVar + '.index(lab) if lab in ' + labelsVar + ' else None';
  return "lab = sprintf('%d-%d', " + i + ', ' + j + '); pos = find(strcmp(' + labelsVar + ', lab), 1);';
}

// The analyzer's values for the pairs it compared, one vector per report key,
// in the order of the labels in `labelsVar`: `items` are [suffix, variable,
// yes/no], each value read from the expect map under prefix, label, suffix.
function pageVectors(L, r, out, { prefix, labels, labelsVar, items }) {
  out.push(...strsAssign(L, labelsVar, labels));
  for (const [suffix, v, yesno] of items) {
    const vals = labels.map(lab => {
      const key = prefix + ' ' + lab + suffix;
      const w = Object.prototype.hasOwnProperty.call(r.expect, key) ? r.expect[key] : r.expect[key + ' [optional]'];
      return yesno ? (w === 1 ? true : w === 0 ? false : NaN) : (typeof w === 'number' ? w : NaN);
    });
    out.push(...pageAssign(L, v, vals));
  }
}

// The rank tests the page shows in place of the analysis of variance under
// the rank procedures: Kruskal-Wallis and Dunn's pairwise comparisons, or
// under pairing Friedman's test and Siegel and Castellan's, with the letters
// and each design's pseudo-median at the stated level.
function sevRank(r, L, out, need) {
  const S = r.several, K = S.rank, lang = L.lang, f = FIELD[lang], g = GROUP[lang], c = L.comment;
  need.push('holm', 'signedRank', K.paired ? 'friedman' : 'kruskal', 'letters');
  if (K.paired) {
    out.push(L.sect('Friedman\'s test and its pairwise comparisons'));
    out.push(...commentLines(c, 'Each replication is a block: its k outcomes are ranked among themselves, and the test asks whether some designs tend to rank higher than others. ' +
      'Each pair\'s difference of rank sums is standardized by sqrt(R k (k + 1) / 6) (Siegel and Castellan), its p-value adjusted by the rule in rank_adjust (holm or bonferroni)' +
      ', and a pair is declared different when the adjusted p is below alpha.', c));
  } else {
    out.push(L.sect('Kruskal-Wallis test and Dunn\'s pairwise comparisons'));
    out.push(...commentLines(c, 'Every outcome is pooled and ranked, and the test asks whether some designs tend to sit higher than others. ' +
      'Dunn\'s test compares each pair\'s mean rank with a z statistic on the pooled rank variance, its p-value adjusted by the rule in rank_adjust (holm or bonferroni)' +
      ', and a pair is declared different when the adjusted p is below alpha.', c));
  }
  out.push(c + 'The pairs, as design numbers' + (lang === 'py' ? ' counted from 0' : '') + '.');
  out.push(L.assign('rank_pairs', pairsLit(lang, K.pairs)));
  out.push(L.assign('rk', (K.paired ? 'friedman_pairs' : 'kruskal_dunn') + '(groups, alpha, rank_adjust, rank_pairs)'));
  if (K.paired) out.push(rep(L, r, 'friedman chi2', f('rk', 'chi2')), rep(L, r, 'friedman df', f('rk', 'df')), rep(L, r, 'friedman p', f('rk', 'p')));
  else out.push(rep(L, r, 'kruskal H', f('rk', 'H')), rep(L, r, 'kruskal df', f('rk', 'df')), rep(L, r, 'kruskal p', f('rk', 'p')));
  K.pairs.forEach(([i, j], q) => {
    const key = 'rank pair ' + pairLabel(i, j);
    const pf = k => ELEM[lang](f('rk', 'pairs'), q, k);
    out.push(rep(L, r, key + ' diff', pf('diff')), rep(L, r, key + ' se', pf('se')), rep(L, r, key + ' z', pf('z')), rep(L, r, key + ' p', pf('p')),
      rep(L, r, key + ' adjusted p', pf('pAdj')), repYesNo(L, r, key + ' different', pf('flagged')));
  });
  if (L.tidy) {
    if (K.paired) tidyTest(out, L, 'rk$test', 'Friedman\'s test as friedman.test returns it, tidied by broom into a one-row tibble.');
    out.push(c + 'The pairs above as one tibble, a row per pair (i and j are the design numbers).');
    out.push('print(bind_rows(rk$pairs))');
  }
  out.push(c + 'The compact letter display: designs that share a letter are not declared different.');
  const flagged = lang === 'R' ? 'Filter(Negate(is.null), lapply(rk$pairs, function(p) if (p$flagged) c(p$i, p$j) else NULL))'
    : lang === 'py' ? '[(p["i"], p["j"]) for p in rk["pairs"] if p["flagged"]]'
      : "cell2mat(cellfun(@(p) [p.i p.j], rk.pairs(cellfun(@(p) p.flagged, rk.pairs)), 'UniformOutput', false)')";
  out.push(L.assign('rank_flagged', flagged), L.assign('rank_cld', 'letter_groups(k, rank_flagged)'));
  for (let i = 0; i < S.k; i++) out.push(rep(L, r, 'rank letters ' + (i + 1), lang === 'R' ? 'rank_cld[' + (i + 1) + ']' : lang === 'py' ? 'rank_cld[' + i + ']' : 'rank_cld{' + (i + 1) + '}'));
  out.push(...commentLines(c, 'Each design\'s pseudo-median (the Hodges-Lehmann estimate) with its own Wilcoxon signed-rank interval at the stated level, as the page draws them beside the letters.', c));
  for (let i = 0; i < S.k; i++) {
    out.push(L.assign('sr', 'signed_rank(' + g(i) + ', level)'));
    const d = 'rank design ' + (i + 1) + ' ';
    out.push(rep(L, r, d + 'pseudo-median', f('sr', 'estimate')), rep(L, r, d + 'lower', f('sr', 'lo')), rep(L, r, d + 'upper', f('sr', 'hi')));
  }
}

// The screen for the best, under every procedure: the subset-selection
// screen with indifference zone epsilon and Rinott's second-stage sizes, or
// the reason the page gives for not running it.
function sevSubset(r, L, out, need) {
  const S = r.several, lang = L.lang, f = FIELD[lang], c = L.comment;
  need.push('subset');
  out.push(L.sect('Screen for the best'));
  out.push(...commentLines(c, 'Confidence 1 - alpha is split evenly between the screen and the second-stage sizing, each at 1 - alpha/2. ' +
    'A design survives when no other design\'s mean beats it by more than max(0, W_ij - epsilon), where W_ij = t sqrt(s_i^2/R_i + s_j^2/R_j) ' +
    'and t is the screen\'s t quantile; a survivor needs N = max(R, ceiling((h s / epsilon)^2)) replications in all for Rinott\'s second stage, h being Rinott\'s constant. ' +
    (S.np ? 'The screen works on means and standard deviations under every procedure; it has no rank version. ' : '') +
    'The best design is reported by its number on the page' + (lang === 'py' ? ', counted from 1.' : '.'), c));
  out.push(L.assign('ss', 'subset_selection(groups, alpha, epsilon, direction)'));
  if (!S.subset.ok) {
    out.push(...commentLines(c, 'The page does not run the screen: ' + ascii(S.subset.reason), c));
    if (lang === 'm') out.push("screen_text = 'not defined'; if ss.ok, screen_text = 'defined'; end", rep(L, r, 'screen', 'screen_text'));
    else out.push(rep(L, r, 'screen', lang === 'R' ? 'if (ss$ok) "defined" else "not defined"' : '"defined" if ss["ok"] else "not defined"'));
    return;
  }
  out.push(rep(L, r, 'screen t', f('ss', 't')), rep(L, r, 'rinott h', f('ss', 'h')), rep(L, r, 'best design', f('ss', 'best') + (lang === 'py' ? ' + 1' : '')));
  for (let i = 0; i < S.k; i++) {
    const d = 'design ' + (i + 1) + ' ';
    const at = k => (lang === 'R' ? 'ss$' + k + '[' + (i + 1) + ']' : lang === 'py' ? 'ss["' + k + '"][' + i + ']' : 'ss.' + k + '(' + (i + 1) + ')');
    out.push(repYesNo(L, r, d + 'survives', at('survivors')), rep(L, r, d + 'N', at('N')), rep(L, r, d + 'additional', at('additional')));
  }
  if (L.tidy) {
    out.push(c + 'The screen as one tibble, a row per design.');
    out.push('print(tibble(design = seq_len(k), survives = ss$survivors, N = ss$N, additional = ss$additional))');
  }
}

// Pairs of designs as a literal: a list of c(i, j) in R, tuples counted from
// 0 in Python, and a 2-column matrix in MATLAB.
function pairsLit(lang, pairs) {
  return lang === 'R' ? 'list(' + pairs.map(([i, j]) => 'c(' + (i + 1) + ', ' + (j + 1) + ')').join(', ') + ')'
    : lang === 'py' ? '[' + pairs.map(([i, j]) => '(' + i + ', ' + j + ')').join(', ') + ']'
      : '[' + pairs.map(([i, j]) => (i + 1) + ' ' + (j + 1)).join('; ') + ']';
}

// The analysis of variance: Levene's test of equal variances, the one-way or
// blocked table (or Welch's analysis), the Shapiro-Wilk check of the
// residuals, the post-hoc rule's pairs, and the compact letter display.
function sevAnova(r, L, out, need) {
  const S = r.several, A = S.anova, lang = L.lang, f = FIELD[lang], c = L.comment;
  const slug = A.ruleSlug;
  if (A.welch && A.welchBad.length) {
    // The page shows only the warning here: no table, no checks, no post hoc.
    out.push(L.sect('Welch\'s analysis of variance'));
    out.push(...commentLines(c, 'Welch\'s analysis weights each design by R_i / s_i^2, and so it needs two outcomes with some spread in every design; ' +
      ascii(A.welchBad.join(', ')) + ' ' + (A.welchBad.length === 1 ? 'has' : 'have') + ' none.', c));
    out.push(rep(L, r, 'welch anova', L.str('not defined')));
    return;
  }
  need.push('levene', 'shapiro');
  out.push(L.sect('Equal variances (Levene, median-centered)'));
  out.push(c + 'Brown and Forsythe\'s form of Levene\'s test: the analysis of variance of each outcome\'s distance from');
  out.push(c + 'its design\'s median' + (A.welch ? '. Welch\'s analysis does not assume equal variances, and so it is for reference.' : ', checking the equal variances the pooled analysis assumes.'));
  out.push(L.assign('lv', 'levene_test(groups)'));
  out.push(rep(L, r, 'levene F', f('lv', 'F')), rep(L, r, 'levene df1', f('lv', 'df1')), rep(L, r, 'levene df2', f('lv', 'df2')), rep(L, r, 'levene p', f('lv', 'p')));
  if (A.welch) {
    need.push('welchAnova', 'posthocWelch');
    if (lang === 'm') need.push('studrange');
    out.push(L.sect('Welch\'s analysis of variance'));
    out.push(c + 'Each design\'s mean weighted by R_i / s_i^2, nothing pooled' + (lang === 'R' ? ' (oneway.test with var.equal = FALSE).' : ', as R\'s oneway.test(var.equal = FALSE).'));
    out.push(L.assign('av', 'welch_anova(groups)'));
    out.push(rep(L, r, 'welch F', f('av', 'F')), rep(L, r, 'welch df1', f('av', 'df1')), rep(L, r, 'welch df2', f('av', 'df2')), rep(L, r, 'welch p', f('av', 'p')));
    if (L.tidy) tidyTest(out, L, 'av$test', 'Welch\'s analysis as oneway.test returns it, tidied by broom into a one-row tibble, its two degrees of freedom as num.df and den.df.', false, true);
  } else {
    need.push('anova');
    out.push(L.sect(A.blocked ? 'Analysis of variance with the replication as a block' : 'One-way analysis of variance'));
    if (A.blocked) out.push(...commentLines(c, 'The replications are paired across the designs, and so each is a block: the variation they share under common random numbers is its own row, and the designs are judged against the residual that remains.', c));
    out.push(L.assign('av', 'anova_table(groups, paired)'));
    out.push(rep(L, r, 'anova F', f('av', 'F')), rep(L, r, 'anova df1', f('av', 'dfb')), rep(L, r, 'anova df2', f('av', 'dfw')), rep(L, r, 'anova p', f('av', 'p')));
    out.push(rep(L, r, 'ss between', f('av', 'ssb')), rep(L, r, 'ss within', f('av', 'ssw')), rep(L, r, 'ms between', f('av', 'msb')), rep(L, r, 'ms within', f('av', 'msw')));
    if (A.blocked) out.push(rep(L, r, 'ss blocks', f('av', 'ssblk')), rep(L, r, 'df blocks', f('av', 'dfblk')), rep(L, r, 'block F', f('av', 'Fblock')), rep(L, r, 'block p', f('av', 'pBlock')));
    if (L.tidy) tidyTest(out, L, 'av$fit', 'The table as aov fits it, tidied by broom into a tibble, a row per source (none when nothing varies within the designs, where the table above is written out by hand).', true);
  }
  out.push(L.sect('Normality of the residuals (Shapiro-Wilk)'));
  out.push(...commentLines(c, 'The residuals (each outcome less its design\'s mean' + (A.blocked ? ' and its replication\'s effect' : '') +
    ') are what ' + (A.welch ? 'Welch\'s F' : 'the F test') + ' and the post-hoc rules take as normal.', c));
  out.push(shapiroLine(r, L, 'shapiro residuals', f('av', 'resid')));

  const rules = { tukey: 'Tukey-Kramer', lsd: 'Fisher\'s protected LSD', bonferroni: 'Bonferroni on the pooled variance', dunnett: 'Dunnett against the control',
    gameshowell: 'Games-Howell', bonferroniwelch: 'Bonferroni on the Welch pairs' };
  const dunnett = !A.welch && A.rule === 'dunnett';
  const ind = lang === 'R' ? '  ' : '    ';
  need.push('pageAt');
  out.push(L.sect('Post-hoc comparisons: ' + rules[slug]));
  out.push(...commentLines(c, 'Each pair\'s difference of means, mean_i - mean_j, with ' + (A.welch
    ? 'its own standard error sqrt(s_i^2/R_i + s_j^2/R_j) on its own Welch degrees of freedom'
    : 'the standard error sqrt(MS (1/R_i + 1/R_j)), where MS is the ' + (A.blocked ? 'residual mean square' : 'pooled mean square within')) +
    '; a pair whose interval excludes 0 is declared different' + (slug === 'lsd' ? ', but only when the F test rejects at alpha' : '') + '.' +
    (dunnett ? ' posthoc_pairs holds each design against the control, the design numbered control in the settings.' : ' posthoc_pairs holds every pair of designs.') +
    (lang === 'py' ? ' The designs are counted from 0 here.' : ''), c));
  out.push(L.assign('posthoc_pairs', pairsExpr(lang, dunnett)));
  out.push(rep(L, r, 'posthoc rule', L.str(slug)));
  if (A.welch) {
    out.push(L.assign('ph', 'posthoc_welch(groups, ' + L.str(A.rule) + ', alpha, posthoc_pairs)'));
  } else {
    need.push('posthoc');
    if (A.rule === 'dunnett') need.push('dunnett');
    if (A.rule === 'tukey' && lang === 'm') need.push('studrange');
    // control is numbered from 1, as on the page; the Python helper counts from 0.
    out.push(L.assign('ph', 'posthoc_pooled(groups, av, ' + L.str(A.rule) + ', alpha, posthoc_pairs, ' + (lang === 'py' ? 'control - 1' : 'control') + ')'));
    out.push(rep(L, r, 'posthoc ' + slug + ' critical value', f('ph', 'crit')));
    if (A.rule === 'lsd') out.push(repYesNo(L, r, 'posthoc lsd protected', f('ph', 'protected')));
    if (lang === 'R' && A.rule === 'tukey' && !L.tidy) {
      out.push(...commentLines(c, 'R\'s own TukeyHSD gives the same intervals (its diff is the later design less the earlier), where its qtukey is defined.', c));
      out.push('if (av$msw > 0 && av$dfw >= 2) print(TukeyHSD(av$fit, "design", conf.level = 1 - alpha))');
    }
  }
  // Each pair's report keys: [suffix, field, yes/no].
  const keys = [[' diff', 'diff'], [' se', 'se']];
  if (A.welch) keys.push([' df', 'df'], [' crit', 'crit']);
  keys.push([' hw', 'hw'], [' lower', 'lo'], [' upper', 'hi']);
  if (A.welch) keys.push([' p', 'p']);
  keys.push([' different', 'flagged', true]);
  const prefix = 'posthoc ' + slug;
  const varOf = suffix => 'page_posthoc' + suffix.replace(/ /g, '_');
  out.push(...commentLines(c, 'The analyzer\'s values for the pairs the page compared, in the order of page_posthoc_pairs, printed beside the script\'s' +
    (dunnett ? '; a pair the page did not compare (after control is edited) prints alone.' : '.'), c));
  pageVectors(L, r, out, { prefix, labels: A.pairs.map(([i, j]) => pairLabel(i, j)), labelsVar: 'page_posthoc_pairs', items: keys.map(([suffix, , yesno]) => [suffix, varOf(suffix), !!yesno]) });
  const field = k => (lang === 'R' ? 'p$' + k : lang === 'py' ? 'p["' + k + '"]' : 'p.' + k);
  const body = keys.map(([suffix, k]) => pairRep(L, prefix, suffix, field(k), varOf(suffix)));
  if (lang === 'R') out.push('for (p in ph$pairs) {', ind + pairLabelLine(L, 'p$i', 'p$j', 'page_posthoc_pairs'), ...body.map(x => ind + x), '}');
  else if (lang === 'py') out.push('for p in ph["pairs"]:', ind + pairLabelLine(L, 'p["i"]', 'p["j"]', 'page_posthoc_pairs'), ...body.map(x => ind + x));
  else out.push('for row = 1:numel(ph.pairs)', ind + 'p = ph.pairs{row}; ' + pairLabelLine(L, 'p.i', 'p.j', 'page_posthoc_pairs'), ...body.map(x => ind + x), 'end');
  if (L.tidy) {
    out.push(c + 'The pairs above as one tibble, a row per pair (i and j are the design numbers).');
    out.push('print(bind_rows(ph$pairs))');
    if (!A.welch && A.rule === 'tukey') {
      out.push(...commentLines(c, 'R\'s own TukeyHSD gives the same intervals, tidied by broom (its estimate is the later design less the earlier), where its qtukey is defined.', c));
      out.push('if (av$msw > 0 && av$dfw >= 2) print(broom::tidy(TukeyHSD(av$fit, "design", conf.level = 1 - alpha)))');
    }
  }
  if (A.letters) {
    need.push('letters');
    out.push(c + 'The compact letter display: designs that share a letter are not declared different.');
    const flagged = lang === 'R' ? 'Filter(Negate(is.null), lapply(ph$pairs, function(p) if (p$flagged) c(p$i, p$j) else NULL))'
      : lang === 'py' ? '[(p["i"], p["j"]) for p in ph["pairs"] if p["flagged"]]'
        : "cell2mat(cellfun(@(p) [p.i p.j], ph.pairs(cellfun(@(p) p.flagged, ph.pairs)), 'UniformOutput', false)')";
    out.push(L.assign('flagged_pairs', flagged));
    out.push(L.assign('cld', 'letter_groups(k, flagged_pairs)'));
    for (let i = 0; i < S.k; i++) out.push(rep(L, r, 'letters ' + (i + 1), lang === 'R' ? 'cld[' + (i + 1) + ']' : lang === 'py' ? 'cld[' + i + ']' : 'cld{' + (i + 1) + '}'));
  }
}

// The F test's power plan, on the standard deviation the page reads from the
// pooled analysis of variance (with blocks, the residual one): the table
// above when it ran, and a pooled table run here when the section above ran
// the rank tests or Welch's analysis, which pools nothing.
function sevPlanAnova(r, L, out, need) {
  const S = r.several, A = S.anovaPlan, lang = L.lang, f = FIELD[lang], c = L.comment;
  const what = 'For the ' + (A.blocked ? 'blocked ' : '') + 'F test: the smallest R per design at which the F test at alpha detects one design ' +
    'shifted by plan_delta from the others, which share a mean, with probability plan_power';
  const sq = v => (lang === 'py' ? 'np.sqrt(' : 'sqrt(') + f(v, 'msw') + ')';
  const held = ', on the ' + (A.blocked ? 'residual' : 'pooled') + ' standard deviation held at its current value.';
  if (A.sigmaFrom === 'anova') {
    out.push(...commentLines(c, what + held, c));
    out.push(L.assign('sigma', sq('av')));
  } else {
    need.push('anova');
    out.push(...commentLines(c, what + held + ' The page reads it from the pooled analysis of variance, ' +
      (S.np ? 'which the rank procedures do not report, and so it is run here.'
        : 'run here because Welch\'s analysis pools no variance; the F test\'s power needs one sigma, and so the plan assumes a common sigma across the designs.'), c));
    out.push(L.assign('av_pooled', 'anova_table(groups, paired)'));
    out.push(L.assign('sigma', sq('av_pooled')));
  }
  out.push(L.assign('ppa', 'plan_power_anova(k, sigma, plan_delta, alpha, plan_power, paired)'));
  out.push(rep(L, r, 'plan anova delta', 'plan_delta'), rep(L, r, 'plan anova power target', 'plan_power'), rep(L, r, 'plan anova n', f('ppa', 'n')), rep(L, r, 'plan anova power at n', f('ppa', 'powerAtN')));
  out.push(c + 'The power the current replications already give, at the smallest count.');
  if (lang === 'R') out.push('cur <- if (isTRUE(sigma > 0)) power_anova(min(lengths(groups)), k, sigma, plan_delta, alpha, paired) else NaN');
  else if (lang === 'py') out.push('cur = power_anova(min(len(g) for g in groups), k, sigma, plan_delta, alpha, paired) if sigma > 0 else np.nan');
  else out.push('cur = NaN;', 'if sigma > 0, cur = power_anova(min(cellfun(@numel, groups)), k, sigma, plan_delta, alpha, paired); end');
  out.push(rep(L, r, 'power at current R', 'cur'));
}

function sevMeans(r, L, out, need) {
  const S = r.several, lang = L.lang, f = FIELD[lang], el = ELEM[lang], c = L.comment;
  need.push('simultaneous');
  out.push(L.sect(S.np ? 'Pseudo-medians with simultaneous intervals (Wilcoxon signed-rank)' : 'Means with simultaneous intervals'));
  out.push(...commentLines(c, 'Each design\'s own ' + (S.np ? 'Wilcoxon signed-rank interval on its pseudo-median (the Hodges-Lehmann estimate, the median of its Walsh averages)' : 't interval on its mean') +
    ' at 1 - alpha/k, and so all k hold at once with confidence at least level (Bonferroni).' +
    (S.bench != null ? ' A design is above or below the benchmark when its interval excludes it.' : ''), c));
  out.push(L.assign('sm', 'simultaneous_means(groups, level)'));
  out.push(rep(L, r, 'k', 'k'), rep(L, r, 'per-interval level', f('sm', 'perLevel')));
  if (S.np) {
    need.push('signedRank');
    out.push(L.assign('srs', lang === 'R' ? 'lapply(groups, function(x) signed_rank(x, sm$perLevel))'
      : lang === 'py' ? '[signed_rank(x, sm["perLevel"]) for x in groups]'
        : "cellfun(@(x) signed_rank(x, sm.perLevel), groups, 'UniformOutput', false)"));
  }
  for (let i = 0; i < S.k; i++) {
    const d = 'design ' + (i + 1) + ' ';
    out.push(rep(L, r, d + 'R', el(f('sm', 'items'), i, 'n')));
    const lo = S.np ? el('srs', i, 'lo') : el(f('sm', 'items'), i, 'lo'), hi = S.np ? el('srs', i, 'hi') : el(f('sm', 'items'), i, 'hi');
    if (S.np) {
      out.push(rep(L, r, d + 'pseudo-median', el('srs', i, 'estimate')), rep(L, r, d + 'wilcoxon lower', lo), rep(L, r, d + 'wilcoxon upper', hi));
      out.push(repYesNo(L, r, d + 'exact', el('srs', i, 'exact')));
    } else {
      for (const k of ['mean', 'sd', 'se', 'df']) out.push(rep(L, r, d + k, el(f('sm', 'items'), i, k)));
      out.push(rep(L, r, d + 'lower', lo), rep(L, r, d + 'upper', hi));
    }
    if (S.bench != null) out.push(rep(L, r, d + 'vs benchmark', 'bench_word(' + lo + ', ' + hi + ', benchmark)'));
  }
  if (L.tidy && S.np) {
    out.push(...commentLines(c, 'Each design\'s signed-rank test as wilcox.test returns it, tidied by broom and bound into one tibble, a row per design, ' +
      'after the design\'s number and name from d_tbl. ' + WILCOX_OWN, c));
    out.push('print(bind_cols(distinct(d_tbl, design, name), bind_rows(lapply(srs, function(s) broom::tidy(s$test)))))');
  } else if (L.tidy) {
    out.push(...commentLines(c, 'The intervals above as one tibble, a row per design, after the design\'s number and name from d_tbl. ' +
      'It is not a tibble of tidied t.test results: those test each mean against 0, which is not the question here.', c));
    out.push('means_tbl <- bind_cols(distinct(d_tbl, design, name), bind_rows(sm$items))', 'print(means_tbl)');
  }
  if (!S.np) {
    need.push('shapiro');
    out.push(L.sect('Normality of each design\'s outcomes (Shapiro-Wilk)'));
    out.push(c + 'The t intervals take each design\'s replication outcomes as normal.');
    for (let i = 0; i < S.k; i++) out.push(shapiroLine(r, L, 'shapiro design ' + (i + 1), GROUP[lang](i)));
  }
}

function sevDiffs(r, L, out, need) {
  const S = r.several, lang = L.lang, f = FIELD[lang], c = L.comment;
  const labels = familyPairs(r).map(([i, j]) => pairLabel(i, j));
  const ind = lang === 'R' ? '  ' : '    ';
  need.push('pageAt');
  out.push(L.sect(S.np ? 'Pairwise rank comparisons (Bonferroni)' : 'Pairwise comparisons (Bonferroni)'));
  const each = S.np ? (S.paired ? 'Wilcoxon signed-rank interval on the pseudo-median of the paired differences' : 'Wilcoxon rank-sum interval on the shift (the Hodges-Lehmann estimate)')
    : (S.paired ? 'paired t interval on the differences within each block' : 'Welch interval');
  out.push(...commentLines(c, 'Every comparison\'s own ' + each + ' at 1 - alpha/C, for the comparisons in family_pairs' +
    (lang === 'py' ? ' (its designs counted from 0)' : '') + ': each design against the control when family is "control", and every pair of designs when it is "pairs". ' +
    'The adjusted p is C p capped at 1, and a comparison whose interval excludes 0 is declared different.', c));
  if (lang === 'R') out.push('family_pairs <- if (family == "control") ' + pairsExpr(lang, true) + ' else ' + pairsExpr(lang, false));
  else if (lang === 'py') out.push('family_pairs = ' + pairsExpr(lang, true) + ' if family == "control" else ' + pairsExpr(lang, false));
  else out.push("if strcmp(family, 'control'), family_pairs = " + pairsExpr(lang, true) + '; else, family_pairs = ' + pairsExpr(lang, false) + '; end');
  out.push(L.assign('C', lang === 'R' ? 'length(family_pairs)' : lang === 'py' ? 'len(family_pairs)' : 'size(family_pairs, 1)'), L.assign('per_c', '1 - alpha / C'));
  out.push(rep(L, r, 'C', 'C'), rep(L, r, 'per-comparison level', 'per_c'));
  if (!S.np && S.paired) out.push(c + 'Each paired t interval takes its pair\'s differences as normal, which the Shapiro-Wilk lines after it check.');
  else if (!S.np) out.push(...commentLines(c, 'The Welch intervals take each design\'s outcomes as normal, which the Shapiro-Wilk lines under the means check.', c));

  // The report keys of one comparison, in the page's order: [suffix, the
  // script's value, the variable holding the analyzer's, yes/no].
  const P = S.np ? 'shift' : 'diff';
  const adj = lang === 'R' ? 'min(1, C * ' + f('cmp', 'p') + ')' : lang === 'py' ? 'np.minimum(1, C * ' + f('cmp', 'p') + ')' : "min(1, C * " + f('cmp', 'p') + ", 'includenan')";
  const lo = f('cmp', 'lo'), hi = f('cmp', 'hi');
  const excl = lang === 'R' ? 'isTRUE(' + lo + ' > 0) || isTRUE(' + hi + ' < 0)' : lang === 'py' ? 'bool(' + lo + ' > 0 or ' + hi + ' < 0)' : lo + ' > 0 || ' + hi + ' < 0';
  const keys = S.np
    ? [['', 'estimate'], [' stat', S.paired ? 'V' : 'W'], [' lower', 'lo'], [' upper', 'hi'], [' p', 'p'], [' adjusted p', null, adj], [' exact', 'exact', null, true], [' excludes 0', null, excl, true]]
    : [['', S.paired ? 'meanD' : 'diff'], [' se', 'se'], [' df', 'df'], [' lower', 'lo'], [' upper', 'hi'], [' t', 't'], [' p', 'p'], [' adjusted p', null, adj], [' excludes 0', null, excl, true]];
  const varOf = suffix => 'page_' + P + suffix.replace(/ /g, '_');
  const items = keys.map(([suffix, , , yesno]) => [suffix, varOf(suffix), !!yesno]);
  const shapiro = !S.np && S.paired;
  if (shapiro) items.push([' W', 'page_shapiro_diff_W', false], [' p', 'page_shapiro_diff_p', false]);
  out.push(...commentLines(c, 'The analyzer\'s values for the comparisons the page made, in the order of page_family_pairs, printed beside the script\'s; ' +
    'a comparison the page did not make (after family or control is edited) prints alone.', c));
  pageVectors(L, r, out, { prefix: P, labels, labelsVar: 'page_family_pairs', items: items.slice(0, keys.length) });
  if (shapiro) pageVectors(L, r, out, { prefix: 'shapiro diff', labels, labelsVar: 'page_family_pairs', items: items.slice(keys.length) });
  if (L.tidy) {
    out.push(...commentLines(c, 'family_tests collects each comparison\'s test object, for the tibble after the last one' +
      (S.np ? '.' : '; t.test stops on two constant designs, and so such a comparison has no test object and is left out.'), c), 'family_tests <- list()');
  }

  // The comparison itself, for designs i and j (Python's counted from 0).
  const g = v => (lang === 'R' ? 'groups[[' + v + ']]' : lang === 'py' ? 'groups[' + v + ']' : 'groups{' + v + '}');
  let call;
  if (S.np) {
    need.push('signedRank');   // the rank-sum snippet also needs its midranks and bisection
    if (!S.paired) need.push('rankSum');
    call = S.paired ? 'signed_rank(' + g('i') + ' - ' + g('j') + ', per_c)' : 'rank_sum(' + g('i') + ', ' + g('j') + ', per_c)';
  } else {
    need.push(S.paired ? 'pairedT' : 'twoSample');
    call = S.paired ? 'paired_t(' + g('i') + ', ' + g('j') + ', per_c)' : 'two_sample_t(' + g('i') + ', ' + g('j') + ', per_c, ' + L.bool(false) + ')';
  }
  const body = [L.assign('cmp', call)];
  keys.forEach(([suffix, k, expr]) => body.push(pairRep(L, P, suffix, expr || f('cmp', k), varOf(suffix))));
  // The figure of this section draws every comparison, and so each one's interval is collected as it runs.
  const collect = r.fig && r.fig.section === 'diffs';
  if (collect) {
    const mid = f('cmp', S.np ? 'estimate' : S.paired ? 'meanD' : 'diff');
    if (lang === 'R') body.push('fam_mid <- c(fam_mid, ' + mid + '); fam_lo <- c(fam_lo, cmp$lo); fam_hi <- c(fam_hi, cmp$hi); fam_lab <- c(fam_lab, paste(i, "-", j))');
    else if (lang === 'py') body.push('fam_mid.append(' + mid + '); fam_lo.append(cmp["lo"]); fam_hi.append(cmp["hi"]); fam_lab.append(f"{i + 1} - {j + 1}")');
    else body.push('fam_mid(end + 1) = ' + mid + '; fam_lo(end + 1) = cmp.lo; fam_hi(end + 1) = cmp.hi; fam_lab{end + 1} = sprintf(\'%d - %d\', i, j);');
    out.push(c + 'Each comparison\'s interval is kept for the figure at the end.',
      lang === 'R' ? 'fam_mid <- fam_lo <- fam_hi <- numeric(0); fam_lab <- character(0)' : lang === 'py' ? 'fam_mid, fam_lo, fam_hi, fam_lab = [], [], [], []' : 'fam_mid = []; fam_lo = []; fam_hi = []; fam_lab = {};');
  }
  if (shapiro) {
    need.push('shapiro');
    const nm = pairName(L, 'shapiro diff', '');
    // Differences equal up to rounding (sdD = 0) have no shape to test.
    body.push(...diffShapiro(L, nm, f('cmp', 'diffs'), f('cmp', 'sdD'), 'page_at(page_shapiro_diff_W, pos)', 'page_at(page_shapiro_diff_p, pos)'));
  }
  if (L.tidy) body.push('family_tests[[lab]] <- cmp$test');
  if (lang === 'R') out.push('for (p in family_pairs) {', ind + 'i <- p[1]; j <- p[2]; ' + pairLabelLine(L, 'i', 'j', 'page_family_pairs'), ...body.map(x => ind + x), '}');
  else if (lang === 'py') out.push('for i, j in family_pairs:', ind + pairLabelLine(L, 'i', 'j', 'page_family_pairs'), ...body.map(x => ind + x));
  else out.push('for row = 1:C', ind + 'i = family_pairs(row, 1); j = family_pairs(row, 2); ' + pairLabelLine(L, 'i', 'j', 'page_family_pairs'), ...body.map(x => ind + x), 'end');

  if (L.tidy) {
    out.push(...commentLines(c, 'Every comparison\'s test as ' + (S.np ? 'wilcox.test' : 't.test') + ' returns it, at 1 - alpha/C, tidied by broom and bound into one tibble, a row per pair; its p-values are not adjusted.' +
      (S.np ? ' ' + WILCOX_OWN : ''), c));
    out.push('family_tbl <- bind_rows(lapply(family_tests, broom::tidy), .id = "pair")',
      'if (nrow(family_tbl)) print(select(family_tbl, pair, any_of(c("estimate", "statistic", "parameter", "p.value", "conf.low", "conf.high"))))');
  }
}

function sevPlan(r, L, out, need) {
  const S = r.several, lang = L.lang, f = FIELD[lang], c = L.comment;
  need.push('planning', 'planningTwo', 'planningSeveral');
  out.push(L.sect('Replications per design needed, equal in each design'));
  out.push(...commentLines(c, 'For the means: the smallest R per design at which every interval at 1 - alpha/k has half-width at most ' +
    'plan_means_h. The widest belongs to the design with the largest s, held at its current value.', c));
  out.push(L.assign('sds', PLUCK[lang](lang === 'R' ? 'sm$items' : lang === 'py' ? 'sm["items"]' : 'sm.items', 'sd')));
  out.push(L.assign('hpm', 'plan_half_width(max(sds), 1 - alpha / k, plan_means_h)'));
  out.push(rep(L, r, 'plan means half-width target', 'plan_means_h'), rep(L, r, 'plan means n', f('hpm', 'n')), rep(L, r, 'plan means half-width at n', f('hpm', 'hwAtN')));
  if (S.paired) {
    need.push('pairedT');
    out.push(...commentLines(c, 'For the differences under pairing: the smallest R at which every paired interval of family_pairs, at 1 - alpha/C, has ' +
      'half-width at most plan_diffs_h. The widest belongs to the pair whose differences vary most, with that standard deviation (paired_t\'s, which is 0 for differences equal up to rounding) held at its current value. ' +
      'Standard deviations that agree to about twelve digits count as tied, and a tie goes to the first such pair in the family\'s order. ' +
      'The page takes the first largest of its own values, whose last digits can round differently, and so on such a tie it can name a later pair.', c));
    if (lang === 'R') {
      out.push('sd_d <- sapply(family_pairs, function(p) paired_t(groups[[p[1]]], groups[[p[2]]], level)$sdD)',
        'hpd <- plan_half_width(max(sd_d), 1 - alpha / C, plan_diffs_h)',
        'worst <- which(sd_d >= max(sd_d) * (1 - 1e-12))[1]',
        'widest <- if (is.nan(hpd$n)) "none" else paste(family_pairs[[worst]], collapse = "-")');
    } else if (lang === 'py') {
      out.push('sd_d = np.array([paired_t(groups[i], groups[j], level)["sdD"] for i, j in family_pairs])',
        'hpd = plan_half_width(max(sd_d), 1 - alpha / C, plan_diffs_h)',
        'worst = int(np.flatnonzero(sd_d >= sd_d.max() * (1 - 1e-12))[0])',
        'widest = "none" if np.isnan(hpd["n"]) else "-".join(str(v + 1) for v in family_pairs[worst])');
    } else {
      out.push('sd_d = zeros(1, size(family_pairs, 1));',
        'for q = 1:numel(sd_d), pq = paired_t(groups{family_pairs(q, 1)}, groups{family_pairs(q, 2)}, level); sd_d(q) = pq.sdD; end',
        'hpd = plan_half_width(max(sd_d), 1 - alpha / C, plan_diffs_h);',
        'worst = find(sd_d >= max(sd_d) * (1 - 1e-12), 1);',
        "if isnan(hpd.n), widest = 'none'; else, widest = sprintf('%d-%d', family_pairs(worst, :)); end");
    }
  } else {
    out.push(...commentLines(c, 'For the differences: the smallest R per design at which every Welch interval of family_pairs, at ' +
      '1 - alpha/C, has half-width at most plan_diffs_h, with each design\'s s held at its current value.', c));
    out.push(L.assign('hpd', 'plan_half_width_family(sds, level, family_pairs, plan_diffs_h)'));
    if (lang === 'R') out.push('widest <- if (is.nan(hpd$n)) "none" else paste(hpd$pair, collapse = "-")');
    else if (lang === 'py') out.push('widest = "none" if hpd["pair"] is None else "-".join(str(v + 1) for v in hpd["pair"])');
    else out.push("if isnan(hpd.n), widest = 'none'; else, widest = sprintf('%d-%d', hpd.pair); end");
  }
  out.push(rep(L, r, 'plan diffs half-width target', 'plan_diffs_h'), rep(L, r, 'plan diffs n', f('hpd', 'n')), rep(L, r, 'plan diffs half-width at n', f('hpd', 'hwAtN')),
    rep(L, r, 'plan diffs widest pair', 'widest'));
  if (S.anovaPlan) sevPlanAnova(r, L, out, need);
  if (S.np) {
    const inf = k => (lang === 'R' ? 'ceiling(' + k + ' * pi / 3)' : lang === 'py' ? 'np.ceil(' + k + ' * np.pi / 3)' : 'ceil(' + k + ' * pi / 3)');
    out.push(c + 'The rank procedures are sized from the t plans inflated by pi/3, the reciprocal of their efficiency');
    out.push(c + 'relative to the t under normal data.');
    out.push(rep(L, r, 'plan means n (rank)', inf(f('hpm', 'n'))), rep(L, r, 'plan diffs n (rank)', inf(f('hpd', 'n'))));
    if (S.anovaPlan) out.push(rep(L, r, 'plan anova n (rank)', inf(f('ppa', 'n'))));
  }
}

BODIES.several = { R: sevBody, py: sevBody, m: sevBody };

// ── Steady State ─────────────────────────────────────────────────────────

// The records of a run as the Data block writes them: every replication in
// order, numbered from 1 as on the page, each with its id, its times t (empty
// when the observations carry none), and its values v.
function recordsBlock(L, r) {
  const R = r.records, c = L.comment, lang = L.lang, out = [];
  const what = ascii(R.name) + ' (' + ascii(R.response) + (R.unit ? ', ' + ascii(R.unit) : '') + ')';
  const timed = R.reps.some(x => x.t);
  out.push(...commentLines(c, 'The records of ' + what + ', every replication in order, numbered from 1 as on the page: ' +
    (R.kind === 'time'
      ? 'a time-persistent state, each record the time t it changed and its new value v. A value holds until the next record, and the last until end_time, or for no time when end_time is NaN.'
      : R.kind === 'reps'
        ? 'one value v per replication, its outcome, with no time stamps (t is empty).'
        : 'tally observations v' + (timed ? ', each with the time t it was recorded.' : ', with no time stamps (t is empty).')), c));
  const empty = R.reps.filter(r => !r.v.length).map(r => ascii(r.id));
  if (empty.length) out.push(...commentLines(c, 'Replications holding no records (ids): ' + empty.join(', ') + '.', c));
  out.push(...recordsKindLines(L, r));
  const tLit = r => (r.t ? L.vec(r.t) : lang === 'R' ? 'NULL' : lang === 'py' ? 'None' : '[]');
  if (lang === 'R') {
    // Each replication's vectors are built in t_ and v_ as short statements (see rChunks).
    out.push('reps <- list()');
    R.reps.forEach((r, i) => {
      if (r.t) out.push(...vecAssign(L, 't_', r.t));
      out.push(...vecAssign(L, 'v_', r.v));
      out.push('reps[[' + (i + 1) + ']] <- list(id = ' + L.str(r.id) + ', t = ' + (r.t ? 't_' : 'NULL') + ', v = v_)');
    });
    if (R.reps.length) out.push('rm(' + (R.reps.some(r => r.t) ? 't_, ' : '') + 'v_)');
  } else if (lang === 'py') {
    out.push('reps = [');
    R.reps.forEach(r => out.push('    dict(id=' + L.str(r.id) + ', t=' + tLit(r) + ', v=' + L.vec(r.v) + '),'));
    out.push(']');
  } else {
    out.push("reps = struct('id', {}, 't', {}, 'v', {});");
    R.reps.forEach((r, i) => out.push('reps(' + (i + 1) + ") = struct('id', " + L.str(r.id) + ", 't', " + tLit(r) + ", 'v', " + L.vec(r.v) + ');'));
  }
  return out;
}

// A loop reporting one line per batch (or lag), each beside the analyzer's
// value where the page had one: `name` is the report name with %d for the
// number, `count` the script's count, `value(i)` the script's value at loop
// index i, and `page` the analyzer's values, held in `pageVar` and assigned in
// `hoist`.
function loopReport(L, out, { name, count, value, page, pageVar, indent = '', hoist }) {
  const lang = L.lang;
  const tol = tolArg(L, name.replace('%d', '1'), NaN);
  // The analyzer's values go in `hoist`, outside any block, so that R reads
  // them as short top-level statements (see rChunks).
  hoist.push(L.comment + 'The analyzer\'s values for ' + pageVar + ', printed beside the script\'s.', ...vecAssign(L, pageVar, page));
  if (lang === 'R') {
    out.push(indent + 'for (i in seq_len(' + count + ')) report(sprintf(' + L.str(name) + ', i), ' + value('i') + ', if (i <= length(' + pageVar + ')) ' + pageVar + '[i]' + tol + ')');
  } else if (lang === 'py') {
    out.push(indent + 'for i in range(' + count + '):',
      indent + '    report(' + L.str(name) + ' % (i + 1), ' + value('i') + ', ' + pageVar + '[i] if i < len(' + pageVar + ') else None' + tol + ')');
  } else {
    out.push(indent + 'for i = 1:' + count,
      indent + '    if i <= numel(' + pageVar + '), report(sprintf(' + L.str(name) + ', i), ' + value('i') + ', ' + pageVar + '(i)' + tol + '); else, report(sprintf(' + L.str(name) + ', i), ' + value('i') + '); end',
      indent + 'end');
  }
}

// Steady State: the warm-up plot's averages, the series after truncation, its
// batch means with Fishman's test and a figure of them, and the series'
// autocorrelation. The settings are read at run time, and so a script whose
// align, cut, lumped, replication, batch_count, or batch_size is edited runs
// the analysis the page would run with them.
function steadyBody(r, L) {
  const S = r.steady, lang = L.lang, c = L.comment, e = r.expect, f = FIELD[lang];
  const need = ['timeWeighted', 'alignment', 'batchMeans', 'tInterval', 'acf'], out = [];
  const time = S.kind === 'time';
  const ind = lang === 'py' ? '    ' : lang === 'R' ? '  ' : '    ';
  const at = (v, i) => (lang === 'py' ? v + '[' + (i === 'mid' ? 'mid - 1' : i === 'end' ? '-1' : i - 1) + ']'
    : lang === 'R' ? v + '[' + (i === 'end' ? 'L' : i) + ']' : v + '(' + i + ')');

  // Warm-up.
  out.push(L.sect('Warm-up: the average across replications, smoothed'));
  out.push(...commentLines(c, 'ybar, the ensemble average, is the mean across the replications at each observation index or time bin; the moving average smooths it, and the cumulative average is the mean of ybar so far. The page draws all three; the first point, the middle one, and the last are reported here.', c));
  const warmLines = [rep(L, r, 'warm-up ybar at 1', at('ybar', 1)), rep(L, r, 'warm-up ybar at mid', at('ybar', 'mid')),
    rep(L, r, 'warm-up moving average at mid', at('smooth', 'mid')), rep(L, r, 'warm-up cumulative average at end', at('cum', 'end'))];
  if (lang === 'R') {
    out.push('if (align == "index") {', '  ybar <- align_by_index(reps)', '} else {',
      '  al <- align_by_time(reps, kind, n_bins, end_time, start)', '  ybar <- al$ybar', '}',
      'L <- length(ybar); mid <- ceiling(L / 2)', 'smooth <- moving_average(ybar, w); cum <- cumulative_average(ybar)',
      rep(L, r, 'warm-up points', 'L'), 'if (L > 0) {', ...warmLines.map(x => ind + x), '}',
      'if (align == "time") {', ind + rep(L, r, 'warm-up bin width', 'al$edges[2] - al$edges[1]'),
      ind + rep(L, r, 'warm-up empty bins', 'sum(!is.finite(ybar))'), '}');
  } else if (lang === 'py') {
    out.push('if align == "index":', '    ybar = align_by_index(reps)', 'else:',
      '    edges, ybar = align_by_time(reps, kind, n_bins, end_time, start)',
      'L = len(ybar); mid = int(np.ceil(L / 2))', 'smooth = moving_average(ybar, w); cum = cumulative_average(ybar)',
      rep(L, r, 'warm-up points', 'L'), 'if L > 0:', ...warmLines.map(x => ind + x),
      'if align == "time":', ind + rep(L, r, 'warm-up bin width', 'edges[1] - edges[0]'),
      ind + rep(L, r, 'warm-up empty bins', 'int(np.sum(~np.isfinite(ybar)))'));
  } else {
    out.push("if strcmp(align, 'index')", '    ybar = align_by_index(reps);', 'else',
      '    [edges, ybar] = align_by_time(reps, kind, n_bins, end_time, start);', 'end',
      'L = numel(ybar); mid = ceil(L / 2);', 'smooth = moving_average(ybar, w); cum = cumulative_average(ybar);',
      rep(L, r, 'warm-up points', 'L'), 'if L > 0', ...warmLines.map(x => ind + x), 'end',
      "if strcmp(align, 'time')", ind + rep(L, r, 'warm-up bin width', 'edges(2) - edges(1)'),
      ind + rep(L, r, 'warm-up empty bins', 'sum(~isfinite(ybar))'), 'end');
  }

  // The series after truncation.
  out.push(L.sect('The series batching works on'));
  out.push(...commentLines(c, 'One replication with its warm-up cut, or, when lumped, every replication cut and then joined end to end. ' +
    (time ? 'Cut by time, the state in force at the cut becomes the first record, at the cut time, and so the first batch counts the time from the cut to the next record. ' : '') +
    'b_first is where the kept series starts in the original one (tally, counted from 0), and b_end where the kept trajectory ends.', c));
  if (lang === 'R') {
    out.push('if (lumped && length(reps) > 1) {',
      '  kept <- lump_reps(reps, kind, align, cut, end_time)',
      '  bt <- kept$t; bv <- kept$v; b_end <- kept$t_end; b_first <- 0',
      '} else {',
      '  kept <- truncate_rep(reps[[replication]]$t, reps[[replication]]$v, kind, align, cut)',
      '  bt <- kept$t; bv <- kept$v; b_first <- if (length(kept$idx)) kept$idx[1] - 1 else NaN',
      '  b_end <- if (kind == "time" && length(bv)) trajectory_end(bt, end_time) else NaN',
      '}');
  } else if (lang === 'py') {
    out.push('if lumped and len(reps) > 1:',
      '    kept = lump_reps(reps, kind, align, cut, end_time)',
      '    bt, bv, b_end, b_first = kept["t"], kept["v"], kept["t_end"], 0',
      'else:',
      '    bt, bv, idx = truncate_rep(reps[replication - 1]["t"], reps[replication - 1]["v"], kind, align, cut)',
      '    b_first = int(idx[0]) if len(idx) else np.nan',
      '    b_end = trajectory_end(bt, end_time) if kind == "time" and len(bv) else np.nan');
  } else {
    out.push('if lumped && numel(reps) > 1',
      '    kept = lump_reps(reps, kind, align, cut, end_time);',
      '    bt = kept.t; bv = kept.v; b_end = kept.t_end; b_first = 0;',
      'else',
      '    [bt, bv, idx] = truncate_rep(reps(replication).t, reps(replication).v, kind, align, cut);',
      '    b_first = NaN; if ~isempty(idx), b_first = idx(1) - 1; end',
      "    b_end = NaN; if strcmp(kind, 'time') && ~isempty(bv), b_end = trajectory_end(bt, end_time); end",
      'end');
  }

  // Batch means.
  out.push(L.sect('Batch means'));
  out.push(...commentLines(c, 'The t interval on the batch means at level, their lag-one autocorrelation r1, and Fishman\'s test of no positive correlation, which is one-sided: a large C, with a small p, says neighboring batch means still move together and the batches are too short.', c));
  const nb = S.batchOk ? e.batches : 0;
  const pageOf = key => Array.from({ length: nb }, (_, i) => e['batch ' + (i + 1) + ' ' + key]);
  const hoistB = [];
  const ok = [];
  ok.push(rep(L, r, 'batches', f('bm', 'b')), rep(L, r, 'batch size', f('bm', 'size')), rep(L, r, 'batch start', f('bm', 'start')),
    rep(L, r, 'records used', f('bm', 'nUsed')));
  const elem = (v, k) => (i => (lang === 'py' ? f(v, k) + '[' + i + ']' : lang === 'R' ? f(v, k) + '[' + i + ']' : f(v, k) + '(' + i + ')'));
  const loops = [];
  loopReport(L, loops, { name: 'batch %d mean', count: f('bm', 'b'), value: elem('bm', 'means'), page: pageOf('mean'), pageVar: 'page_means', hoist: hoistB });
  if (time) loopReport(L, loops, { name: 'batch %d records', count: f('bm', 'b'), value: elem('bm', 'records'), page: pageOf('records'), pageVar: 'page_records', hoist: hoistB });
  out.push(...hoistB, L.assign('bm', 'batch_means(bt, bv, kind, b_end, batch_count, batch_size, level, b_first)'));
  ok.push(...loops);
  ok.push(rep(L, r, time ? 'leftover duration' : 'leftover observations', f('bm', 'leftover')));
  for (const [name, k] of [['mean of batch means', 'mean'], ['sd of batch means', 'sd'], ['se', 'se'], ['df', 'df'], ['t quantile', 't'],
    ['half-width', 'hw'], ['lower', 'lo'], ['upper', 'hi'], ['lag-one r1', 'r1'], ['fishman C', 'C'], ['fishman p', 'p']]) ok.push(rep(L, r, name, f('bm', k)));
  if (L.tidy) tidyTest(ok, L, 'bm$test', 'The t test on the batch means as t.test returns it, tidied by broom into a one-row tibble (none when the batch means are all equal, where t.test stops).', true);
  const notOk = rep(L, r, 'batch means', L.str('not defined'));
  if (lang === 'R') {
    out.push('if (!bm$ok) {', ind + notOk, ind + 'cat(bm$reason, "\\n", sep = "")', '} else {', ...ok.map(x => ind + x), '}');
  } else if (lang === 'py') {
    out.push('if not bm["ok"]:', ind + notOk, ind + 'print(bm["reason"])', 'else:', ...ok.map(x => ind + x));
  } else {
    out.push('if ~bm.ok', ind + notOk, ind + "fprintf('%s\\n', bm.reason);", 'else', ...ok.map(x => ind + x), 'end');
  }

  // The autocorrelation of the kept series.
  const acfN = Object.keys(e).filter(k => /^acf lag \d+$/.test(k)).length;
  out.push(L.sect('Autocorrelation of the series after truncation'));
  out.push(...commentLines(c, 'As the page\'s correlogram: lags 1 to min(max_lag, n/4), of which the first five are reported. ' +
    (time ? 'The trajectory is first averaged over n_steps equal intervals of simulation time because its records arrive at uneven times, and the correlogram is drawn only when every interval is covered.'
      : 'It needs at least 8 observations.'), c));
  const tooShort = 'The series after truncation is too short for its autocorrelation.';
  const report5 = [], hoistA = [];
  loopReport(L, report5, { hoist: hoistA, name: 'acf lag %d', count: lang === 'R' ? 'length(ac)' : lang === 'py' ? 'len(ac)' : 'numel(ac)',
    value: i => (lang === 'm' ? 'ac(' + i + ')' : 'ac[' + i + ']'), page: Array.from({ length: acfN }, (_, j) => e['acf lag ' + (j + 1)]), pageVar: 'page_acf', indent: ind });
  if (lang === 'R') {
    out.push(...hoistA, 'max_lag <- 400; n_steps <- 2000', 'series <- NULL');
    if (time) out.push('if (length(bv) && isTRUE(b_end > bt[1])) {', '  s <- resample_tw(bt, bv, bt[1], b_end, n_steps)', '  if (all(is.finite(s))) series <- s', '}');
    else out.push('if (length(bv) >= 8) series <- bv');
    out.push('n_lags <- if (is.null(series)) 0 else min(max_lag, floor(length(series) / 4))',
      'if (n_lags >= 1) {', ind + 'ac <- acf_lags(series, min(5, n_lags))', ...report5, '} else cat("' + tooShort + '\\n")');
  } else if (lang === 'py') {
    out.push(...hoistA, 'max_lag = 400; n_steps = 2000', 'series = None');
    if (time) out.push('if len(bv) and b_end > bt[0]:', '    s = resample_tw(bt, bv, bt[0], b_end, n_steps)', '    if np.all(np.isfinite(s)): series = s');
    else out.push('if len(bv) >= 8: series = bv');
    out.push('n_lags = 0 if series is None else min(max_lag, len(series) // 4)',
      'if n_lags >= 1:', ind + 'ac = acf_lags(series, min(5, n_lags))', ...report5, 'else:', ind + 'print("' + tooShort + '")');
  } else {
    out.push(...hoistA, 'max_lag = 400; n_steps = 2000;', 'series = [];');
    if (time) out.push('if ~isempty(bv) && b_end > bt(1)', '    s = resample_tw(bt, bv, bt(1), b_end, n_steps);', '    if all(isfinite(s)), series = s; end', 'end');
    else out.push('if numel(bv) >= 8, series = bv; end');
    out.push('n_lags = min(max_lag, floor(numel(series) / 4));',
      'if n_lags >= 1', ind + 'ac = acf_lags(series, min(5, n_lags));', ...report5, 'else', ind + "fprintf('" + tooShort + "\\n');", 'end');
  }

  return { body: out, need };
}
BODIES.steady = { R: steadyBody, py: steadyBody, m: steadyBody };

// ── Summary and Plots ────────────────────────────────────────────────────

// The first `max` ids, then how many more there are: a script that reads its
// data from files may hold any number of replications.
function idList(ids, max = 20) {
  const head = ids.slice(0, max).map(ascii).join(', ');
  return ids.length > max ? head + ', and ' + (ids.length - max).toLocaleString('en-US') + ' more' : head;
}

// The replication outcomes of the datasets ticked under Equal variances, which
// Levene's test compares; the script has no records for any but the shown one.
function spreadBlock(L, S) {
  const c = L.comment, out = [''];
  out.push(...commentLines(c, 'spread_groups holds the replication outcomes of the datasets ticked under Equal variances, which Levene\'s test compares, in order: ' +
    S.names.map((n, i) => (i + 1) + ': ' + ascii(n)).join('; ') + '.', c));
  out.push(...listAssign(L, 'spread_groups', S.groups.length, (L2, t, i) => vecAssign(L2, t, S.groups[i]), i => L.vec(S.groups[i])));
  return out;
}

// Summary and Plots: each replication's count and outcome, the descriptives
// of the outcomes, every replication together, the t interval over the
// outcomes, the Shapiro-Wilk test of the outcomes, Levene's test across the
// ticked datasets, and a figure of the outcomes.
function exploreBody(r, L, { csv = false } = {}) {
  const X = r.explore, lang = L.lang, c = L.comment, e = r.expect, f = FIELD[lang];
  const need = [descNeed(L), 'timeWeighted', 'explore'], out = [];
  const R = r.records, tally = X.kind === 'tally';
  const ind = lang === 'R' ? '  ' : '    ';

  // Each replication. A script that reads its data from files writes out the
  // analyzer's values for the first REP_LINES_MAX replications only (see
  // recipes.js), and each later line looks its value up by position, finds
  // none, and prints alone.
  out.push(L.sect('Each replication: its observations and its outcome'));
  out.push(...commentLines(c, 'A replication\'s outcome is ' + ascii(r.outcomes.how) + '; a replication with no records gives none (NaN).' +
    (tally ? ' Its sd, min, and max describe its own observations.' : ''), c));
  const shown = csv ? Math.min(R.ids.length, REP_LINES_MAX) : R.ids.length, cut = shown < R.ids.length;
  const page = k => R.ids.slice(0, shown).map(id => e['rep ' + id + ' ' + k]);
  out.push(c + 'The analyzer\'s values, in replication order, printed beside the script\'s.');
  if (cut) {
    need.push('pageAt');
    out.push(...commentLines(c, 'They are written out for the first ' + shown.toLocaleString('en-US') + ' of the ' + R.ids.length.toLocaleString('en-US') + ' replications only, which keeps a script that reads its data from files small; ' +
      'the lines for the later replications print without an analyzer column.', c));
  }
  for (const k of repKeys(X.kind)) out.push(...vecAssign(L, 'page_' + k, page(k)));
  // The analyzer's value for this replication: page_k at i, or by position when the vectors stop short.
  const pg = k => (cut ? 'page_at(page_' + k + ', pos)' : lang === 'm' ? 'page_' + k + '(i)' : 'page_' + k + '[i]');
  if (lang === 'R') out.push('outcome <- vapply(reps, rep_outcome, numeric(1), kind = kind, end_time = end_time)');
  else if (lang === 'py') out.push('outcome = np.array([rep_outcome(r, kind, end_time) for r in reps], dtype=float)');
  else out.push('outcome = arrayfun(@(r) rep_outcome(r, kind, end_time), reps);');
  out.push(rep(L, r, 'replications', lang === 'R' ? 'length(reps)' : lang === 'py' ? 'len(reps)' : 'numel(reps)'));
  out.push(rep(L, r, 'observations', lang === 'R' ? 'sum(lengths(lapply(reps, function(r) r$v)))' : lang === 'py' ? 'sum(len(r["v"]) for r in reps)' : 'sum(arrayfun(@(r) numel(r.v), reps))'));
  if (lang === 'R') {
    out.push('for (i in seq_along(reps)) {',
      ind + 'v <- reps[[i]]$v; p <- paste("rep", reps[[i]]$id)' + (cut ? '; pos <- if (i <= length(page_n)) i else NA' : ''),
      ind + 'report(paste(p, "n"), length(v), ' + pg('n') + ')',
      ind + 'report(paste(p, "outcome"), outcome[i], ' + pg('outcome') + ')');
    if (tally) out.push(ind + 'report(paste(p, "sd"), if (length(v) > 1) sd(v) else NaN, ' + pg('sd') + ')',
      ind + 'report(paste(p, "min"), if (length(v)) min(v) else NaN, ' + pg('min') + ')',
      ind + 'report(paste(p, "max"), if (length(v)) max(v) else NaN, ' + pg('max') + ')');
    out.push('}');
    if (L.tidy) out.push(c + 'The outcomes as a tibble, a row per replication (NaN where a replication gave none).',
      'out_tbl <- tibble(rep_id = vapply(reps, function(r) r$id, ""), outcome = outcome)');
  } else if (lang === 'py') {
    out.push('for i, r in enumerate(reps):',
      ind + 'v = np.asarray(r["v"], float); p = "rep " + r["id"]' + (cut ? '; pos = i if i < len(page_n) else None' : ''),
      ind + 'report(p + " n", len(v), ' + pg('n') + ')',
      ind + 'report(p + " outcome", outcome[i], ' + pg('outcome') + ')');
    if (tally) out.push(ind + 'report(p + " sd", v.std(ddof=1) if len(v) > 1 else np.nan, ' + pg('sd') + ')',
      ind + 'report(p + " min", v.min() if len(v) else np.nan, ' + pg('min') + ')',
      ind + 'report(p + " max", v.max() if len(v) else np.nan, ' + pg('max') + ')');
  } else {
    out.push('for i = 1:numel(reps)',
      ind + "v = reps(i).v; p = ['rep ' reps(i).id];" + (cut ? ' pos = []; if i <= numel(page_n), pos = i; end' : ''),
      ind + "report([p ' n'], numel(v), " + pg('n') + ');',
      ind + "report([p ' outcome'], outcome(i), " + pg('outcome') + ');');
    if (tally) out.push(ind + 's = NaN; if numel(v) > 1, s = std(v); end',
      ind + "report([p ' sd'], s, " + pg('sd') + ');',
      ind + 'lo = NaN; hi = NaN; if ~isempty(v), lo = min(v); hi = max(v); end',
      ind + "report([p ' min'], lo, " + pg('min') + ');',
      ind + "report([p ' max'], hi, " + pg('max') + ');');
    out.push('end');
  }

  // The outcomes.
  if (X.outcomes) {
    out.push(L.sect('Descriptives of the replication outcomes'));
    if (r.outcomes.dropped.length) out.push(...commentLines(c, 'Replications that gave no outcome are left out: ' + idList(r.outcomes.dropped) + '.', c));
    out.push(L.assign('x', lang === 'R' ? 'outcome[is.finite(outcome)]' : lang === 'py' ? 'outcome[np.isfinite(outcome)]' : 'outcome(isfinite(outcome))'));
    out.push(L.tidy ? 'd <- out_tbl |> filter(is.finite(outcome)) |> describe_tbl(outcome)' : L.assign('d', 'describe(x)'));
    for (const k of DESC_KEYS) out.push(rep(L, r, k, f('d', k)));
  }

  // Every replication together.
  if (X.pooled) {
    out.push(L.sect('Pooled observations, for description only'));
    out.push(...commentLines(c, 'Every observation of every replication together. They come from within runs and are correlated with their neighbors, and so they carry no standard error and no test here.', c));
    if (L.tidy) out.push('po <- records_tbl |> describe_tbl(v)');
    else {
      out.push(L.assign('obs', lang === 'R' ? 'unlist(lapply(reps, function(r) r$v))' : lang === 'py' ? 'np.concatenate([np.asarray(r["v"], float) for r in reps])' : '[reps.v]'));
      out.push(L.assign('po', 'describe(obs)'));
    }
    for (const k of DESC_KEYS) if (k !== 'se') out.push(rep(L, r, 'pooled ' + k, f('po', k)));
  }
  if (X.timeTotal) {
    out.push(L.sect('All replications together, time-weighted'));
    out.push(...commentLines(c, 'The area under every replication\'s state over the total time covered: every value weighted by how long it held.', c));
    out.push(L.assign('tw', 'tw_total(reps, end_time)'));
    out.push(rep(L, r, 'time-weighted mean', f('tw', 'mean')), rep(L, r, 'time covered', f('tw', 'duration')));
  }

  // The t interval over the outcomes.
  if (X.interval) {
    need.push('tInterval');
    out.push(L.sect('Confidence interval over the replication outcomes (t)'));
    out.push(L.assign('ti', 't_interval(x, level)'));
    for (const [name, k] of [['interval df', 'df'], ['interval t quantile', 't'], ['interval half-width', 'hw'], ['interval lower', 'lo'], ['interval upper', 'hi']]) out.push(rep(L, r, name, f('ti', k)));
    if (L.tidy) tidyTest(out, L, 'ti$test', 'The t test as t.test returns it, tidied by broom into a one-row tibble (none when the outcomes are all equal, where t.test stops).', true);
  }

  // Normality, on the outcomes only.
  if (X.checks) {
    need.push('shapiro');
    out.push(L.sect('Normality of the replication outcomes (Shapiro-Wilk)'));
    out.push(...commentLines(c, 'The test assumes independent values, which the replication outcomes are and pooled observations are not, and so it is made on the outcomes only.', c));
    const w = lit(L, e['shapiro W [optional]']), p = lit(L, e['shapiro p [optional]']);
    if (L.tidy) {
      out.push('sw <- shapiro_check("shapiro", x, ' + w + ', ' + p + ')');
      tidyTest(out, L, 'sw', 'The test as shapiro.test returns it, tidied by broom into a one-row tibble (none when the check is not made).', true);
    } else out.push(lang === 'm' ? "shapiro_check('shapiro', x, alpha, " + w + ', ' + p + ');' : 'shapiro_check("shapiro", x, ' + w + ', ' + p + ')');
  }

  // Equal variances.
  if (X.spreadOmitted) {
    const O = X.spreadOmitted;
    out.push(L.sect('Equal variances across datasets (Levene, median-centered)'));
    out.push(...commentLines(c, 'The page runs Levene\'s test across ' + listWords(O.names.map(ascii)) + ', but their ' + O.count.toLocaleString('en-US') +
      ' replication outcomes would take this script past the ' + MAX_NUMBERS.toLocaleString('en-US') + ' numbers it writes out, and so the test is left out here.', c));
  }
  if (X.spread) {
    need.push('levene');
    out.push(L.sect('Equal variances across datasets (Levene, median-centered)'));
    out.push(...commentLines(c, 'The one-way analysis of variance of each outcome\'s absolute deviation from its own dataset\'s median (Brown and Forsythe\'s form), across the datasets in spread_groups.', c));
    out.push(L.assign('lv', 'levene_test(spread_groups)'));
    out.push(rep(L, r, 'levene F', f('lv', 'F')), rep(L, r, 'levene df1', f('lv', 'df1')), rep(L, r, 'levene df2', f('lv', 'df2')), rep(L, r, 'levene p', f('lv', 'p')));
    if (L.tidy) tidyTest(out, L, 'lv$test', 'The analysis of variance of the distances as anova(lm(distance ~ group)) returns it, each group a dataset, tidied by broom into a tibble (none when the distances do not vary within any dataset).', true);
  }

  return { body: out, need };
}
BODIES.explore = { R: exploreBody, py: exploreBody, m: exploreBody };

function settingsBlock(recipe, L) {
  const out = [L.sect('Settings')];
  // A page may say which settings the script reads and which choices are written into its code.
  for (const note of recipe.settingsNote || []) out.push(...commentLines(L.comment, ascii(note), L.comment));
  out.push(L.assign('level', String(recipe.level)), L.assign('alpha', '1 - level'));
  for (const [k, v] of Object.entries(recipe.settings || {})) out.push(L.assign(k, lit(L, v)));
  out.push(L.comment + CHECK_NOTE, L.assign('check_details', L.bool(false)), L.lang === 'm' ? 'report_start(check_details);' : 'report_start(check_details)');
  return out;
}

const CHECK_NOTE = 'Set check_details to print each result beside the value the page showed.';

// The matched pairs of a paired comparison: the pair labels and the A and B
// outcomes in step, with what was left out and why.
function pairsBlock(L, r) {
  const P = r.pairs, c = L.comment, out = [];
  const what = ascii(P.response) + (P.unit ? ', ' + ascii(P.unit) : '');
  // A name that already ends in its letter (such as "Design A") is not followed by the letter again.
  const named = (n, letter) => ascii(n) + (new RegExp('\\b' + letter + '$').test(ascii(n)) ? '' : ' (' + letter + ')');
  out.push(...commentLines(c, 'Matched pairs of replication outcomes (' + what + '): a holds ' + named(P.nameA, 'A') + ' and b holds ' +
    named(P.nameB, 'B') + ', matched by ' + (P.by === 'id' ? 'replication id' : 'position, each pair named by its A and B ids') + '.', c));
  out.push(...commentLines(c, 'Each outcome of A is ' + ascii(P.howA) + (P.howA === P.howB ? ', and so is each of B.' : ', and each of B is ' + ascii(P.howB) + '.'), c));
  const left = (ids, what) => { if (ids.length) out.push(...commentLines(c, what + ' were left out: ' + ids.map(ascii).join(', ') + '.', c)); };
  left(P.droppedA, 'Replications of A that gave no outcome');
  left(P.droppedB, 'Replications of B that gave no outcome');
  left(P.unmatchedA, 'Replications of A with no partner in B');
  left(P.unmatchedB, 'Replications of B with no partner in A');
  out.push(...idsAssign(L, 'pair_id', P.ids));
  out.push(...vecAssign(L, 'a', P.a), ...vecAssign(L, 'b', P.b));
  return out;
}

// The Data block: the embedded data with the commented lines that read the
// same data from their CSV files, or in CSV mode those lines alone, live.
function dataBlock(recipe, L, csv) {
  const out = [L.sect('Data')];
  if (csv) out.push(...csvReadBlock(L, recipe, { live: true }));
  else {
    if (recipe.data) out.push(...vectorBlock(L, recipe.data, 'x', 'rep_id'));
    if (recipe.pairs) out.push(...pairsBlock(L, recipe));
    if (recipe.dataA) {
      out.push(L.comment + 'Design A.', ...vectorBlock(L, recipe.dataA, 'a', 'rep_id_a'));
      out.push('', L.comment + 'Design B.', ...vectorBlock(L, recipe.dataB, 'b', 'rep_id_b'));
    }
    if (recipe.groups) out.push(...groupsBlock(L, recipe));
    if (recipe.records) out.push(...recordsBlock(L, recipe));
    const read = csvReadBlock(L, recipe, { live: false });
    if (read.length) out.push('', ...read);
  }
  if (L.tidy) out.push(...tidyDataBlock(recipe, L));
  if (recipe.spread) out.push(...spreadBlock(L, recipe.spread));
  return out;
}

// Tidy R: the same data as a long tibble, one row per value, beside the
// vectors the helpers take. Each is one statement on one line (see rChunks).
function tidyDataBlock(recipe, L) {
  const c = L.comment, out = [''];
  if (recipe.data) {
    if (recipe.data.pooled) out.push(c + 'The same observations as a tibble, one row per observation.', 'd_tbl <- tibble(observation = x)');
    else out.push(c + 'The same outcomes as a tibble, one row per replication.', 'd_tbl <- tibble(rep_id = rep_id, outcome = x)');
  }
  if (recipe.pairs) out.push(c + 'The same pairs as a tibble, one row per pair.', 'pairs_tbl <- tibble(pair_id = pair_id, a = a, b = b)');
  if (recipe.dataA) {
    out.push(c + 'The same outcomes as one long tibble, one row per replication, design naming A or B.',
      'd_tbl <- bind_rows(tibble(design = "A", outcome = a), tibble(design = "B", outcome = b))');
  }
  if (recipe.groups) {
    const paired = recipe.groups.paired;
    out.push(...commentLines(c, 'The same outcomes as one long tibble, one row per replication: design is the design\'s number, name its name' +
      (paired ? ', and block the block it belongs to.' : '.'), c));
    out.push('d_tbl <- tibble(design = factor(rep(seq_len(k), lengths(groups))), name = rep(design_names, lengths(groups)), ' +
      (paired ? 'block = rep(block_id, times = k), ' : '') + 'outcome = unlist(groups))');
  }
  if (recipe.records) {
    // One value per replication has nothing to count and no times, and so its
    // records get no per-replication summary.
    const summary = recipe.records.kind !== 'reps';
    out.push(...commentLines(c, 'The same records as one long tibble, one row per record: rep_id names its replication, t its time (NA when the records carry none), and v its value.' +
      (summary ? ' From it, dplyr counts each replication\'s records and finds the times of its first and last (a replication with no records has no row).' : ''), c));
    out.push('records_tbl <- bind_rows(lapply(reps, function(r) tibble(rep_id = r$id, t = if (is.null(r$t)) NA_real_ else r$t, v = r$v)))');
    if (summary) out.push('if (nrow(records_tbl)) print(records_tbl |> summarise(records = n(), first_t = min(t), last_t = max(t), .by = rep_id))');
  }
  return out.length > 1 ? out : [];
}

// The designs of Several Systems: their names, numbered as on the page, and
// each design's replication outcomes, with what was left out and why. Under
// pairing the outcomes are aligned block by block.
function groupsBlock(L, r) {
  const G = r.groups, c = L.comment, out = [];
  const what = ascii(G.response) + (G.unit ? ', ' + ascii(G.unit) : '');
  out.push(...commentLines(c, 'The designs, numbered as on the page; groups holds each design\'s replication outcomes (' + what + ').', c));
  G.names.forEach((n, i) => out.push(...commentLines(c + '  ' + (i + 1) + ': ', ascii(n) + ', each outcome ' + ascii(G.how[i]) + '.', c + '     ')));
  const left = (lists, why) => {
    const parts = lists.map((d, i) => (d.length ? (i + 1) + ': ' + d.map(ascii).join(', ') : null)).filter(Boolean);
    if (parts.length) out.push(...commentLines(c, why + ' were left out (design: ids): ' + parts.join('; ') + '.', c));
  };
  left(G.dropped, 'Replications that gave no outcome');
  if (G.paired) {
    left(G.unmatched, 'Replications with no partner in every design');
    out.push(...commentLines(c, 'The replications are paired across the designs (common random numbers), matched by ' +
      (G.by === 'id' ? 'replication id' : 'position, each block named by its replication ids in every design') +
      ': element b of every design belongs to block b, and block_id names it.', c));
    out.push(...idsAssign(L, 'block_id', G.ids));
  } else {
    out.push(c + 'rep_ids holds the ids of each design\'s replications, in step with its outcomes.');
    out.push(...listAssign(L, 'rep_ids', G.ids.length, (L2, t, i) => idsAssign(L2, t, G.ids[i]), i => idsLit(L, G.ids[i])));
  }
  out.push(...strsAssign(L, 'design_names', G.names));
  out.push(...listAssign(L, 'groups', G.values.length, (L2, t, i) => vecAssign(L2, t, G.values[i]), i => L.vec(G.values[i])));
  out.push(L.assign('k', String(G.names.length)));
  out.push(L.assign('paired', L.bool(G.paired)));
  return out;
}

// ── The CSV files that hold the same data ────────────────────────────────
// Beside the data block, every script shows the lines that read the same data
// from the files the Import page saves (Export on a dataset's row), named by
// recipe.csv. Each language reads in its plain idiom: R's read.csv with the
// replication ids kept as text, Python's csv module (NumPy's genfromtxt fills
// a blank in a column of whole numbers with -1 and stumbles on a text id after
// numeric ones), and MATLAB's readtable with the ids typed as text (left to
// itself it types a mostly numeric id column as numbers, reading 007 as 7 and
// a text id among them as NaN). Tidy R wraps R's read in as_tibble(). A
// response header such as "busy servers" is rewritten by every language, and
// so the value column of an Observations CSV is taken by position, as its last
// column. A blank outcome in a Replication summary CSV is a replication that
// gave none, dropped before any matching by id or position, as the page drops
// it. In CSV mode (past the cap) the same lines run in place of the data.

// The comment that marks a read line in a script that keeps its own data:
// removing it leaves exactly the line the script would run.
const READ_MARK = { R: '#   ', py: '#   ', m: '%   ' };

// The reader of one file, as an expression: `file` is the file's name, or
// with `raw` an expression of the language that gives it.
function readExpr(L, file, { raw = false } = {}) {
  const f = raw ? file : L.str(file);
  if (L.lang === 'R') {
    const r = 'read.csv(' + f + ', comment.char = "#", colClasses = c(replication = "character"))';
    return L.tidy ? 'as_tibble(' + r + ')' : r;
  }
  return 'read_csv(' + f + ')';
}

// Python's reader: the rows of a file as lists of text, after the # lines and
// the header, which the lines below take by position.
const PY_READ_CSV = [
  'import csv',
  'def read_csv(file):   # the rows of a CSV file the analyzer saved, as text, its # lines and header skipped',
  '    with open(file, encoding="utf-8", newline="") as fh:',
  '        return list(csv.reader(s for s in fh if not s.startswith("#")))[1:]'
];

// MATLAB's reader, as an anonymous function: readtable with the options it
// detects, the replication column set to text and every other one to numbers
// (from a file with no records, readtable could not tell they are numbers).
const M_READ_CSV = [
  "read_csv = @(f) readtable(f, setvartype(setvartype(detectImportOptions(f, 'CommentStyle', '#', 'VariableNamingRule', 'preserve'), 'double'), 'replication', 'string'));   % a CSV file the analyzer saved, its # lines skipped, its ids read as text, and its other columns as numbers"
];

// Python: each id's outcome at its first row, in the order the ids first
// appear, which is how the page matches replications by id.
const PY_FIRST_OUTCOMES = [
  'def first_outcomes(rows):   # each id\'s outcome at its first row, in the order the ids first appear',
  '    out = {}',
  '    for r in rows: out.setdefault(r[0], float(r[2]))',
  '    return out'
];

const DROP_NOTE = 'a blank mean (no outcome) is dropped';

// One Replication summary CSV read into `v` with its blank outcomes dropped:
// R and MATLAB keep the table in `v`, and Python keeps its rows.
function readOutcomes(L, v, file) {
  const c = '   ' + L.comment;
  if (L.lang === 'R') return [v + ' <- ' + readExpr(L, file), v + ' <- ' + v + '[is.finite(' + v + '$mean), ]' + c + DROP_NOTE];
  if (L.lang === 'py') return [v + ' = [r for r in ' + readExpr(L, file) + ' if r[2]]' + c + 'columns replication, n_obs, mean; ' + DROP_NOTE];
  return [v + ' = ' + readExpr(L, file) + ';', v + ' = ' + v + '(isfinite(' + v + '.mean), :);' + c + DROP_NOTE];
}

// The ids and the outcomes of a table read by readOutcomes.
function idsOf(L, v) {
  return L.lang === 'R' ? v + '$replication' : L.lang === 'py' ? '[r[0] for r in ' + v + ']' : v + ".replication'";
}
function outcomesOf(L, v) {
  return L.lang === 'R' ? v + '$mean' : L.lang === 'py' ? 'np.array([float(r[2]) for r in ' + v + '])' : v + ".mean'";
}

// One System: the outcomes (and their ids), or the pooled observations.
function readOne(L, r, file) {
  const lang = L.lang, c = '   ' + L.comment, out = [];
  if (r.data.pooled) {
    const last = 'the last column holds the values';
    if (lang === 'R') out.push('obs <- ' + readExpr(L, file), 'x <- as.numeric(obs[[ncol(obs)]])' + c + last);
    else if (lang === 'py') out.push('x = np.array([float(r[-1]) for r in ' + readExpr(L, file) + '])' + c + last);
    else out.push('obs = ' + readExpr(L, file) + ';', "x = obs{:, end}';" + c + last);
    return out;
  }
  out.push(...readOutcomes(L, 'd', file));
  if (r.data.ids) out.push(L.assign('rep_id', idsOf(L, 'd')));
  out.push(L.assign('x', outcomesOf(L, 'd')));
  return out;
}

// Two Systems: each design's outcomes and ids, or the pairs matched as the
// page matched them, by replication id or by position.
function readTwo(L, r, fileA, fileB) {
  const lang = L.lang, c = '   ' + L.comment, out = [];
  out.push(...readOutcomes(L, 'da', fileA), ...readOutcomes(L, 'db', fileB));
  if (!r.pairs) {
    out.push(L.assign('rep_id_a', idsOf(L, 'da')), L.assign('a', outcomesOf(L, 'da')));
    out.push(L.assign('rep_id_b', idsOf(L, 'db')), L.assign('b', outcomesOf(L, 'db')));
    return out;
  }
  if (r.pairs.by === 'id') {
    if (lang === 'R') {
      out.push('keep <- !duplicated(da$replication) & da$replication %in% db$replication' + c + 'each id of A once, where B has it too',
        'pair_id <- da$replication[keep]', 'a <- da$mean[keep]', 'b <- db$mean[match(pair_id, db$replication)]' + c + 'match finds the first row with the id');
    } else if (lang === 'py') {
      out.push(...PY_FIRST_OUTCOMES, 'first_a, first_b = first_outcomes(da), first_outcomes(db)',
        'pair_id = [s for s in first_a if s in first_b]', 'a = np.array([first_a[s] for s in pair_id])', 'b = np.array([first_b[s] for s in pair_id])');
    } else {
      out.push("id_a = da.replication'; id_b = db.replication';",
        "[~, ia] = unique(id_a, 'stable'); ia = ia(ismember(id_a(ia), id_b));" + c + 'each id of A once, where B has it too',
        '[~, jb] = ismember(id_a(ia), id_b);' + c + 'ismember finds the first position of each id in B',
        "pair_id = id_a(ia); a = da.mean(ia)'; b = db.mean(jb)';");
    }
  } else if (lang === 'R') {
    out.push('m <- min(nrow(da), nrow(db))' + c + 'pair the first m outcomes of A and B in order',
      'pair_id <- paste(da$replication[seq_len(m)], db$replication[seq_len(m)], sep = "/")', 'a <- da$mean[seq_len(m)]', 'b <- db$mean[seq_len(m)]');
  } else if (lang === 'py') {
    out.push('m = min(len(da), len(db))' + c + 'pair the first m outcomes of A and B in order',
      'pair_id = [ra[0] + "/" + rb[0] for ra, rb in zip(da, db)]', 'a = ' + outcomesOf(L, 'da[:m]'), 'b = ' + outcomesOf(L, 'db[:m]'));
  } else {
    out.push('m = min(height(da), height(db));' + c + 'pair the first m outcomes of A and B in order',
      "pair_id = da.replication(1:m)' + \"/\" + db.replication(1:m)';",
      "a = da.mean(1:m)'; b = db.mean(1:m)';");
  }
  return out;
}

// Several Systems: every design's outcomes and ids, or under pairing the
// blocks matched as the page matched them.
function readSeveral(L, r, files) {
  const G = r.groups, lang = L.lang, c = '   ' + L.comment, out = [];
  const paired = G.paired, byId = paired && G.by === 'id';
  if (lang === 'R') {
    out.push(L.assign('files', L.strs(files)), L.assign('design_names', L.strs(G.names)),
      'reads <- lapply(files, function(f) {', '  d <- ' + readExpr(L, 'f', { raw: true }),
      '  d[is.finite(d$mean), ]' + c + DROP_NOTE, '})');
    if (!paired) out.push('rep_ids <- lapply(reads, function(d) d$replication)', 'groups <- lapply(reads, function(d) d$mean)');
    else if (byId) {
      out.push('block_id <- unique(reads[[1]]$replication)' + c + 'the first design\'s ids in order, each once',
        'for (d in reads[-1]) block_id <- block_id[block_id %in% d$replication]' + c + 'kept where every design has them',
        'groups <- lapply(reads, function(d) d$mean[match(block_id, d$replication)])');
    } else {
      out.push('m <- min(sapply(reads, nrow))' + c + 'block b holds outcome b of every design, up to the shortest',
        'block_id <- do.call(paste, c(lapply(reads, function(d) d$replication[seq_len(m)]), sep = "/"))',
        'groups <- lapply(reads, function(d) d$mean[seq_len(m)])');
    }
    out.push('k <- length(groups)', 'paired <- ' + L.bool(paired));
  } else if (lang === 'py') {
    out.push(L.assign('files', L.strs(files)), L.assign('design_names', L.strs(G.names)),
      'reads = [[r for r in read_csv(f) if r[2]] for f in files]' + c + 'columns replication, n_obs, mean; ' + DROP_NOTE);
    if (!paired) out.push('rep_ids = [[r[0] for r in rows] for rows in reads]', 'groups = [np.array([float(r[2]) for r in rows]) for rows in reads]');
    else if (byId) {
      out.push(...PY_FIRST_OUTCOMES, 'firsts = [first_outcomes(rows) for rows in reads]',
        'block_id = [s for s in firsts[0] if all(s in f for f in firsts)]' + c + 'the first design\'s ids that every design has',
        'groups = [np.array([f[s] for s in block_id]) for f in firsts]');
    } else {
      out.push('m = min(len(rows) for rows in reads)' + c + 'block b holds outcome b of every design, up to the shortest',
        'block_id = ["/".join(rows[i][0] for rows in reads) for i in range(m)]',
        'groups = [np.array([float(r[2]) for r in rows[:m]]) for rows in reads]');
    }
    out.push('k = len(groups)', 'paired = ' + L.bool(paired));
  } else {
    const ids = paired ? 'ids' : 'rep_ids';
    out.push(L.assign('files', L.strs(files)), L.assign('design_names', L.strs(G.names)),
      'k = numel(files);', 'groups = cell(1, k); ' + ids + ' = cell(1, k);', 'for j = 1:k',
      '    d = ' + readExpr(L, 'files{j}', { raw: true }) + ';', '    d = d(isfinite(d.mean), :);' + c + DROP_NOTE,
      '    ' + ids + "{j} = d.replication';", "    groups{j} = d.mean';", 'end');
    if (byId) {
      out.push("[~, i1] = unique(ids{1}, 'stable'); block_id = ids{1}(i1);" + c + 'the first design\'s ids in order, each once',
        'for j = 2:k, block_id = block_id(ismember(block_id, ids{j})); end' + c + 'kept where every design has them',
        'for j = 1:k, [~, at] = ismember(block_id, ids{j}); groups{j} = groups{j}(at); end');
    } else if (paired) {
      out.push('m = min(cellfun(@numel, groups));' + c + 'block b holds outcome b of every design, up to the shortest',
        'block_id = ids{1}(1:m); for j = 2:k, block_id = block_id + "/" + ids{j}(1:m); end',
        'for j = 1:k, groups{j} = groups{j}(1:m); end');
    }
    out.push('paired = ' + L.bool(paired) + ';');
  }
  return out;
}

// The records of a run: every replication the Replication summary CSV lists,
// in its order, with the rows the Observations CSV holds for it (none for an
// empty one). kind and end_time come with the records unless the Settings
// block already assigns them.
function readRecords(L, r, obsFile, repFile) {
  const R = r.records, lang = L.lang, c = '   ' + L.comment, out = [];
  const timed = R.timed;
  const cols = timed ? 'columns replication, time, and the values' : 'columns replication and the values';
  const every = 'every replication in order, an empty one included';
  const meta = recordsKindLines(L, r);
  if (lang === 'R') {
    out.push('obs <- ' + readExpr(L, obsFile) + c + cols, 'ids <- ' + readExpr(L, repFile) + '$replication' + c + every, ...meta,
      'by_rep <- factor(obs$replication, levels = unique(ids))' + c + 'each record\'s replication, in the order of ids',
      'v_by <- split(as.numeric(obs[[ncol(obs)]]), by_rep)' + c + 'the values, one vector per replication');
    if (timed) out.push('t_by <- split(as.numeric(obs$time), by_rep)');
    out.push('at <- match(ids, levels(by_rep))' + c + 'each replication\'s place among them, matched at once (by name in a loop, slow with many replications)',
      'reps <- lapply(seq_along(ids), function(i) list(id = ids[i], t = ' + (timed ? 't_by[[at[i]]]' : 'NULL') + ', v = v_by[[at[i]]]))');
  } else if (lang === 'py') {
    out.push('obs = ' + readExpr(L, obsFile) + c + cols, ...meta, 'by_rep = {}',
      'for r in obs: by_rep.setdefault(r[0], []).append(r)',
      'reps = []', 'for s in [r[0] for r in ' + readExpr(L, repFile) + ']:' + c + every, '    o = by_rep.get(s, [])',
      '    reps.append(dict(id=s, t=' + (timed ? 'np.array([float(r[1]) for r in o])' : 'None') + ', v=np.array([float(r[-1]) for r in o])))');
  } else {
    out.push('obs = ' + readExpr(L, obsFile) + ';' + c + cols, 'rl = ' + readExpr(L, repFile) + ';' + c + every, ...meta,
      '[~, at] = ismember(obs.replication, rl.replication);' + c + 'each record\'s replication, as its row in rl',
      '[at, order] = sort(at); obs = obs(order, :);' + c + 'the records grouped by replication, in their order within each',
      'n = accumarray(at, 1, [height(rl), 1]); last = cumsum(n);' + c + 'how many records each replication holds, and where its last one is',
      "reps = struct('id', {}, 't', {}, 'v', {});", 'for i = 1:height(rl)', '    o = obs(last(i) - n(i) + 1:last(i), :);',
      "    reps(i) = struct('id', char(rl.replication(i)), 't', " + (timed ? "o.time'" : '[]') + ", 'v', o{:, end}');", 'end');
  }
  return out;
}

// kind and end_time, for a recipe whose Settings block does not assign them.
function recordsKindLines(L, r) {
  const R = r.records, settings = r.settings || {}, out = [];
  if (!('kind' in settings)) out.push(L.assign('kind', L.str(R.kind)));
  if (!('end_time' in settings)) out.push(L.assign('end_time', R.endTime == null ? L.nan : String(R.endTime)));
  return out;
}

// The file name, and the dataset it holds where two datasets of a recipe
// share one file name: their names slug alike, and the Import page would
// save both under it.
function csvClashes(entries) {
  const byFile = new Map();
  for (const e of entries) {
    if (!byFile.has(e.file)) byFile.set(e.file, new Set());
    byFile.get(e.file).add(e.dataset);
  }
  return Array.from(byFile).filter(([, names]) => names.size > 1).map(([file, names]) => ({ file, names: Array.from(names) }));
}

/**
 * The lines that read a recipe's data from the CSV files the Import page saves
 * (`recipe.csv`), assigning every name the data block assigns, in the same
 * order of replications, with blank outcomes dropped and pairs or blocks
 * matched as the page matched them. With `live: false` every line is a
 * comment: a few lines saying which files hold the data, and then the read
 * lines, each behind READ_MARK, whose removal leaves the line itself. With
 * `live: true` the read lines are code under a comment naming the files.
 * Empty when the recipe names no file.
 * @param {object|string} L the language, or its key ('R', 'tidy', 'py', 'm')
 * @param {object} recipe
 * @param {{live?: boolean}} [opts]
 * @returns {string[]}
 */
export function csvReadBlock(L, recipe, { live = false } = {}) {
  if (typeof L === 'string') {
    if (!Object.prototype.hasOwnProperty.call(LANG, L)) throw new RangeError('csvReadBlock: unknown language ' + L);
    L = LANG[L];
  }
  const files = recipe.csv || [];
  if (!files.length) return [];
  const role = k => (files.find(f => f.role === k) || {}).file;
  const c = L.comment;
  let code, head;
  if (recipe.records) {
    code = readRecords(L, recipe, role('records'), role('replication list'));
    head = 'the files the Import page saves for ' + ascii(recipe.records.name) + ' (Export, then Observations CSV and Replication summary CSV)';
  } else if (recipe.groups) {
    code = readSeveral(L, recipe, recipe.groups.names.map((_, i) => role('group ' + (i + 1))));
    head = 'the files the Import page saves for the designs (Export on each one\'s row, then Replication summary CSV)';
  } else if (recipe.dataA || recipe.pairs) {
    code = readTwo(L, recipe, role('a'), role('b'));
    head = 'the files the Import page saves for A and B (Export on each one\'s row, then Replication summary CSV)';
  } else if (recipe.data) {
    code = readOne(L, recipe, role('x'));
    head = 'the file the Import page saves for ' + ascii(recipe.data.name) + ' (Export, then ' + (recipe.data.pooled ? 'Observations CSV' : 'Replication summary CSV') + ')';
  } else return [];
  if (L.lang === 'py') code = [...PY_READ_CSV, ...code];
  else if (L.lang === 'm') code = [...M_READ_CSV, ...code];
  const names = csvFiles(recipe), one = names.length === 1;
  let text = live
    ? 'The data are read from ' + listWords(names) + ', which the Data ' + (one ? 'button beside the script buttons saves (Export on the Import page saves the same file). '
      : 'buttons beside the script buttons save (Export on the Import page saves the same files). ') +
      'Run the script from the folder that holds ' + (one ? 'that file, or give its full path below.' : 'them, or give their full paths below.')
    : 'To read the same data from ' + head + ', replace the block above with these lines.';
  if (recipe.records && !live) text += ' The replication summary lists every replication, an empty one included, which the observations file has no row for.';
  if (L.tidy) text += ' Where readr is installed, readr::read_csv(file, comment = "#", col_types = readr::cols(replication = "c")) reads them too.';
  for (const k of csvClashes(files)) {
    text += ' ' + k.names.map(ascii).join(' and ') + ' both save to ' + k.file + '; save one under another name and change it here.';
  }
  const out = commentLines(c, text, c);
  out.push(...(live ? code : code.map(l => READ_MARK[L.lang] + l)));
  return out;
}

// The body with the printed parts of its output marked: a heading printed
// under every section that reports a result (report_section, which prints
// nothing when check_details is set), and the one-line summary of the checks
// (report_summary) after the last of them, before any figure.
const SECTION_RE = { R: /^## (.*) ----$/, py: /^# ---- (.*) ----$/, m: /^%% (.*)$/ };
const PRINTS_RE = /\b(report|shapiro_check)\(/;
function headings(body, L) {
  const lines = body.join('\n').split('\n');
  const re = SECTION_RE[L.lang], end = L.lang === 'm' ? ';' : '';
  const heads = [];
  lines.forEach((ln, i) => { const m = re.exec(ln); if (m) heads.push([i, m[1]]); });
  const out = [];
  let last = -1;
  heads.forEach(([i, title], h) => {
    const stop = h + 1 < heads.length ? heads[h + 1][0] : lines.length;
    if (lines.slice(i + 1, stop).some(x => PRINTS_RE.test(x) && !/^\s*(#|%)/.test(x))) heads[h].push(true);
  });
  for (let h = 0; h < heads.length; h++) if (heads[h][2]) last = h;
  const summaryAt = last >= 0 ? (last + 1 < heads.length ? heads[last + 1][0] : lines.length) : -1;
  lines.forEach((ln, i) => {
    if (i === summaryAt) out.push('report_summary()' + end);
    out.push(ln);
    const h = heads.find(x => x[0] === i);
    if (h && h[2]) out.push('report_section(' + L.str(h[1]) + ')' + end);
  });
  if (summaryAt === lines.length) out.push('report_summary()' + end);
  return out;
}

/**
 * The script of a recipe in one language. With `csv`, the script holds no
 * data: its Data block is the live read block, which reads the data from the
 * CSV files the recipe names (`recipe.csv`) in the folder the script runs
 * from. A recipe marked `csvOnly` holds no data to embed and is always
 * written this way.
 * @param {object} recipe
 * @param {'m'|'R'|'tidy'|'py'} lang
 * @param {{csv?: boolean}} [opts]
 * @returns {string}
 */
export function analysisScript(recipe, lang, { csv = false } = {}) {
  const L = Object.prototype.hasOwnProperty.call(LANG, lang) ? LANG[lang] : null;
  if (!L) throw new RangeError('analysisScript: unknown language ' + lang);
  const page = Object.prototype.hasOwnProperty.call(BODIES, recipe.page) ? BODIES[recipe.page] : null;
  if (!page || !page[L.lang]) throw new RangeError('analysisScript: unknown page ' + recipe.page);
  const snippets = LIB[L.lang];   // both R dialects share LIB.R
  current = recipe;
  const fromCsv = !!(csv || recipe.csvOnly);
  if (fromCsv && !(recipe.csv && recipe.csv.length)) throw new RangeError('analysisScript: the recipe names no CSV file to read');
  const { body, need } = page[L.lang](recipe, L, { csv: fromCsv });
  // The figures the page's view shows, drawn after every result is printed.
  const figs = figureBlock(recipe, L);
  const helpers = Array.from(new Set((need || []).concat(figs.need))).map(k => {
    const s = snippets[k];
    if (!s) throw new RangeError('analysisScript: no ' + lang + ' snippet ' + k);
    return s.trim();
  });
  const figLib = FIG[L.tidy ? 'tidy' : L.lang];
  for (const k of figs.fig) {
    if (!figLib[k]) throw new RangeError('analysisScript: no ' + lang + ' figure helper ' + k);
    helpers.push(figLib[k].trim());
  }
  const main = [...settingsBlock(recipe, L), ...dataBlock(recipe, L, fromCsv), ...headings(body.concat(figs.lines), L)];
  const lines = header(recipe, L, fromCsv, main.join('\n'));
  lines.push('', ...L.prelude(helpers.concat(main).join('\n')));
  if (lang !== 'm') lines.push('', snippets.report.trim(), '', ...helpers.flatMap(h => [h, '']));
  lines.push(...main);
  if (lang === 'm') lines.push('', '%% Local functions', LIB.m.report.trim(), '', ...helpers.flatMap(h => [h, '']));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '') + '\n';
}

/**
 * The report lines of a script's output: name to number (yes/no to 1/0, NaN
 * and Inf in any case to NaN and Infinity) or string. A report line is
 * "name: value", optionally followed by "   (analyzer: value)"; the name is
 * everything before the first colon and space.
 * @param {string} text
 * @returns {Map<string, number|string>}
 */
export function parseReport(text) {
  const out = new Map();
  for (const raw of String(text).split(/\r?\n/)) {
    const m = /^(.+?): (.*)$/.exec(raw);
    if (!m) continue;
    const v = m[2].replace(/\s+\(analyzer: .*\)$/, '').trim();
    if (v === 'yes') out.set(m[1], 1);
    else if (v === 'no') out.set(m[1], 0);
    else if (/^[-+]?(nan|inf)$/i.test(v)) out.set(m[1], /nan/i.test(v) ? NaN : v[0] === '-' ? -Infinity : Infinity);
    else if (/^[-+]?(\d+\.?\d*([eE][-+]?\d+)?|\.\d+([eE][-+]?\d+)?)$/.test(v)) out.set(m[1], Number(v));
    else out.set(m[1], v);
  }
  return out;
}
