// The "Regenerate these results in" scripts: a recipe (see recipes.js)
// becomes a MATLAB, R, or Python script holding the data the page analyzed,
// the choices it made, and code that recomputes every number the page shows,
// printing each beside the analyzer's own value. Pure functions, no DOM.
//
// A script is assembled from: a header comment (title, stamp, choices,
// requirements), the report helper, the helpers the body needs (MATLAB puts
// these after the body as local functions), a Settings block, a Data block,
// and the page's body. BODIES[page][lang] builds the body and names the
// helpers it needs from script_lib.js.
//
// Every script is 7-bit ASCII: each string that reaches one (a title, a
// dataset name, a provenance value, a report name) goes through ascii().

import { plain, joinNums, sanitizeName, kebabName } from './scripts.js';
import { LIB } from './script_lib.js';

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
    prelude: () => ['import numpy as np', 'from scipy import stats', 'from scipy import integrate, optimize', 'np.set_printoptions(precision=10)'],
    requires: 'Python 3 with NumPy and SciPy 1.11 or later (Matplotlib, if installed, draws any figure).'
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

/** The writers by language key, with the button label and the file-name rule. */
export const ANALYSIS_WRITERS = {
  m: { label: 'MATLAB', name: 'MATLAB', ext: 'm', mime: 'text/x-matlab' },
  R: { label: 'Base R', name: 'base R', ext: 'R', mime: 'text/x-r' },
  tidy: { label: 'Tidy R', name: 'R with the tidyverse', ext: 'R', mime: 'text/x-r', suffix: '-tidy' },
  py: { label: 'Python', name: 'Python', ext: 'py', mime: 'text/x-python' }
};

// Tidy R is the R syntax with the tidyverse loaded. Its bodies are the Base R
// ones until the emitters consult L.tidy for the tibble, dplyr, broom, and
// ggplot2 forms. Both dialects report L.lang === 'R' and share LIB.R.
LANG.tidy = Object.assign({}, LANG.R, {
  tidy: true,
  prelude: () => ['suppressPackageStartupMessages({ library(tibble); library(dplyr); library(tidyr); library(broom); library(ggplot2) })', 'options(digits = 10)'],
  requires: 'R with tibble, dplyr, tidyr, broom, and ggplot2.'
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

/**
 * A report call for `name` with expression `expr`, carrying the analyzer's
 * value from the recipe's expect map (under `name` or `name [optional]`); a
 * null expect value, or none, leaves the analyzer column out.
 */
export function rep(L, recipe, name, expr) {
  const key = ascii(name);
  const has = k => Object.prototype.hasOwnProperty.call(recipe.expect, k);
  const want = has(key) ? recipe.expect[key] : has(key + ' [optional]') ? recipe.expect[key + ' [optional]'] : undefined;
  const a = want !== undefined && want !== null ? ', ' + lit(L, want) : '';
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

function header(recipe, L) {
  const c = L.comment;
  const out = [c + ascii(recipe.title)];
  out.push(c + 'Written by ' + BY + ' on ' + stamp(new Date()) + '. It regenerates the page\'s results from the');
  out.push(c + 'data below. Edit the settings and rerun.');
  out.push(c.trim());
  out.push(c + 'Choices on the page:');
  for (const [k, v] of Object.entries(recipe.provenance || {})) {
    if (v === undefined || v === null || v === '') continue;
    out.push(...commentLines(c + '  ', ascii(k) + ': ' + ascii(Array.isArray(v) ? v.join(', ') : String(v)), c + '    '));
  }
  out.push(...commentLines(c, 'Requires: ' + L.requires, c + '  '));
  return out;
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
  if (ids && idName) {
    const numeric = ids.every(i => i !== '' && Number.isFinite(Number(i)));
    out.push(L.assign(idName, numeric ? L.vec(ids.map(Number)) : L.strs(ids.map(String))));
  }
  out.push(L.assign(varName, L.vec(values)));
  return out;
}

// ── Page bodies ──────────────────────────────────────────────────────────
// BODIES[page][lang] returns { body: string[], need: string[] }, `need`
// naming LIB snippets. The keys are 'R' (both R dialects), 'py', and 'm'.

export const BODIES = {};

const DESC_KEYS = ['n', 'mean', 'sd', 'se', 'min', 'q1', 'median', 'q3', 'max'];

/** Field access per language: d$k, d["k"], d.k. */
export const FIELD = { R: (v, k) => v + '$' + k, py: (v, k) => v + '["' + k + '"]', m: (v, k) => v + '.' + k };

/** The Descriptives section on the vector `v`, with `describe()` from LIB's descriptives. */
export function descriptives(r, L, v, out) {
  out.push(L.sect('Descriptives of the ' + (r.data.pooled ? 'pooled observations' : 'replication outcomes')));
  out.push(L.assign('d', 'describe(' + v + ')'));
  for (const k of DESC_KEYS) out.push(rep(L, r, k, FIELD[L.lang]('d', k)));
}

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
  const need = ['descriptives'], out = [];
  descriptives(r, L, 'x', out);
  if (o.interval && o.np) {
    need.push('signedRank');
    out.push(L.sect('Interval on the pseudo-median (Wilcoxon signed-rank)'));
    out.push(L.assign('sr', 'signed_rank(x, level)'));
    out.push(rep(L, r, 'pseudo-median', f('sr', 'estimate')), rep(L, r, 'V', f('sr', 'V')), rep(L, r, 'signed-rank p', f('sr', 'p')));
    out.push(repYesNo(L, r, 'exact', f('sr', 'exact')));
    out.push(rep(L, r, 'wilcoxon lower', f('sr', 'lo')), rep(L, r, 'wilcoxon upper', f('sr', 'hi')));
    if ('achieved level' in r.expect) out.push(rep(L, r, 'achieved level', f('sr', 'achieved')));
  } else if (o.interval) {
    need.push('tInterval');
    out.push(L.sect('Interval on the mean (t)'));
    out.push(L.assign('ti', 't_interval(x, level)'));
    for (const [name, k] of [['df', 'df'], ['t quantile', 't'], ['half-width', 'hw'], ['lower', 'lo'], ['upper', 'hi']]) out.push(rep(L, r, name, f('ti', k)));
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
    out.push(c + 'value, is at most plan_h' + (o.plan.relative ? ' (' + o.plan.rel + '% of the current mean)' : '') + '.');
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
  const o = r.two, lang = L.lang, f = FIELD[lang], c = L.comment;
  const need = ['descriptives'], out = [];
  const pooledLit = L.bool(o.pooled);
  need.push('shapiro');
  out.push(L.sect('Descriptives of the two designs'));
  out.push(L.assign('da', 'describe(a)'), L.assign('db', 'describe(b)'));
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
    out.push(L.sect('Checks'));
    out.push(c + 'Normality of each design\'s replication outcomes (Shapiro-Wilk)' + (o.levene ? ', and equal variances' : '') + '.');
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
    if (!o.np) out.push(c + 'Its normality check is the Shapiro-Wilk check of each design reported above.');
  }
  if (o.np) {
    // The rank procedure assumes no normality, but the F ratio does, and the
    // page checks it there.
    out.push(L.sect('Checks on the F ratio'));
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
BODIES.two = { R: twoBody, py: twoBody, m: twoBody };

function settingsBlock(recipe, L) {
  const out = [L.sect('Settings'), L.assign('level', String(recipe.level)), L.assign('alpha', '1 - level')];
  for (const [k, v] of Object.entries(recipe.settings || {})) out.push(L.assign(k, lit(L, v)));
  return out;
}

function dataBlock(recipe, L) {
  const out = [L.sect('Data')];
  if (recipe.data) out.push(...vectorBlock(L, recipe.data, 'x', 'rep_id'));
  if (recipe.dataA) {
    out.push(L.comment + 'Design A.', ...vectorBlock(L, recipe.dataA, 'a', 'rep_id_a'));
    out.push('', L.comment + 'Design B.', ...vectorBlock(L, recipe.dataB, 'b', 'rep_id_b'));
  }
  return out;
}

/**
 * The script of a recipe in one language.
 * @param {object} recipe
 * @param {'m'|'R'|'tidy'|'py'} lang
 * @returns {string}
 */
export function analysisScript(recipe, lang) {
  const L = Object.prototype.hasOwnProperty.call(LANG, lang) ? LANG[lang] : null;
  if (!L) throw new RangeError('analysisScript: unknown language ' + lang);
  const page = Object.prototype.hasOwnProperty.call(BODIES, recipe.page) ? BODIES[recipe.page] : null;
  if (!page || !page[L.lang]) throw new RangeError('analysisScript: unknown page ' + recipe.page);
  const snippets = LIB[L.lang];   // both R dialects share LIB.R
  const { body, need } = page[L.lang](recipe, L);
  const helpers = Array.from(new Set(need || [])).map(k => {
    const s = snippets[k];
    if (!s) throw new RangeError('analysisScript: no ' + lang + ' snippet ' + k);
    return s.trim();
  });
  const lines = header(recipe, L);
  lines.push('', ...L.prelude());
  if (lang !== 'm') lines.push('', snippets.report.trim(), '', ...helpers.flatMap(h => [h, '']));
  lines.push(...settingsBlock(recipe, L), ...dataBlock(recipe, L), ...body);
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
