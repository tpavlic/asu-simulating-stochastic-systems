// The figures of the "Regenerate these results in" scripts: every figure the
// page shows in the view the reader had open when the script was written,
// each drawn by one call to a helper the script carries (figure_lib_r.js,
// figure_lib_tidy.js, figure_lib_py.js, figure_lib_m.js). The calls name the
// variables the page bodies in analysis_scripts.js compute, and so a body
// and its figures change together. Pure functions, no DOM.
//
// FIGURES[page](r, L) returns { notes, calls, fig, need }: comments saying
// what is drawn, the lines that draw the figures, the helper keys they call
// (figure_lib_*.js), and any statistical snippets they need beyond the body's
// (script_lib.js). figureBlock wraps the calls in the script's Figures section.
//
// The helpers' contract, the same in every dialect. R and Python take the
// options by name; MATLAB takes the required arguments in order and then one
// struct o of options. Labels are character vectors (MATLAB: cell arrays), a
// list of vectors is an R list, a Python list, or a MATLAB cell array, and
// brackets are rows of two 1-based row numbers. Every helper opens a figure
// of its own, skips NaN values, widens a zero-width range, draws an empty
// frame for no data, and prints and warns nothing on valid input.
//   fig_strips(values, labels, xlab, title; mid, lo, hi, ref, mean_line):
//     a row of dots per vector, each with its interval under it.
//   fig_intervals(mid, lo, hi, labels, xlab, title; ref, flagged, muted,
//     right, brackets, ok): a forest plot, row 1 at the top; flagged rows red
//     and dashed, muted rows gray, ok rows green; text at each row's right,
//     and a bracket joining each pair of rows given.
//   fig_pairs_by_rep(a, b, ids; xlab, title) and
//   fig_pairs_slopes(a, b; label_a, label_b, title): matched pairs.
//   fig_hist(x, edges, xlab, title), fig_ecdf(x, xlab, title),
//   fig_box(x, xlab, title), fig_qq(x, ylab, title; xlab).
//   fig_series(x, y, xlab, ylab, title; type "points" | "line" | "step", fence)
//   and fig_running(x, y, xlab, ylab, title): a run and its running mean.
//   fig_lag(x, k, xlab, ylab, title) and fig_acf(r; step, band, xlab, title,
//     mark, mark_label): the lag plot and the correlogram from lag 1.
//   fig_warmup(x, ybar, smooth, cumavg, cut, xlab, ylab, title; end_lo).
//   fig_batches(x, y, starts, ends, means, xlab, ylab, title; step,
//     exclude_to, joins).
// Colors: EST #2b6cb0 for data, TRUTH #1a1a1a for intervals and means, MISS
// #c0392b for a flagged row, OK #2e7d32, MUTED #9e9e9e, and ACCENT #8c1d40 for
// a cut or fence.

import { FIG_R } from './figure_lib_r.js';
import { FIG_TIDY } from './figure_lib_tidy.js';
import { FIG_PY } from './figure_lib_py.js';
import { FIG_M } from './figure_lib_m.js';

/** The figure helpers by dialect key: 'R', 'tidy', 'py', 'm'. */
export const FIG = { R: FIG_R, tidy: FIG_TIDY, py: FIG_PY, m: FIG_M };

// ── Code builders ────────────────────────────────────────────────────────
// Each takes the language L (from analysis_scripts.js) and returns code.

/** A field of a list (R), dict (Python), or struct (MATLAB). */
export const fld = (L, v, k) => (L.lang === 'R' ? v + '$' + k : L.lang === 'py' ? v + '["' + k + '"]' : v + '.' + k);

/** A vector of expressions. */
export const vecOf = (L, exprs) => (L.lang === 'R' ? 'c(' + exprs.join(', ') + ')' : '[' + exprs.join(', ') + ']');

/** A list of vectors: an R list, a Python list, a MATLAB cell array. */
export const listOf = (L, exprs) => (L.lang === 'R' ? 'list(' + exprs.join(', ') + ')' : L.lang === 'py' ? '[' + exprs.join(', ') + ']' : '{' + exprs.join(', ') + '}');

/** A vector of strings, each folded to ASCII by `str`. */
export const strsOf = (L, a) => (L.lang === 'R' ? 'c(' + a.map(L.str).join(', ') + ')' : L.lang === 'py' ? '[' + a.map(L.str).join(', ') + ']' : '{' + a.map(L.str).join(', ') + '}');

/** A logical expression as the language writes "x or y". */
export const orOf = (L, a, b) => (L.lang === 'R' ? 'isTRUE(' + a + ' || ' + b + ')' : L.lang === 'py' ? 'bool(' + a + ' or ' + b + ')' : '(' + a + ' || ' + b + ')');

/** Replication ids as text, whether the script holds them as numbers or strings. */
export function idText(L, v) {
  if (L.lang === 'R') return 'as.character(' + v + ')';
  if (L.lang === 'py') return '[str(int(s)) if isinstance(s, (int, float, np.integer, np.floating)) and float(s).is_integer() else str(s) for s in ' + v + ']';
  return 'cellstr(string(' + v + '))';
}

/**
 * The lines of one helper call: positional arguments, then named options
 * (undefined ones left out). R and Python pass the options by name; MATLAB
 * gathers them in a struct o, set field by field, passed last.
 * @param {object} L
 * @param {string} name
 * @param {string[]} pos
 * @param {Record<string, string|undefined>} [opts]
 */
export function call(L, name, pos, opts = {}) {
  const entries = Object.entries(opts).filter(([, v]) => v !== undefined && v !== null);
  if (L.lang === 'm') {
    if (!entries.length) return [name + '(' + pos.join(', ') + ');'];
    return ['o = struct();', ...entries.map(([k, v]) => 'o.' + k + ' = ' + v + ';'), name + '(' + pos.join(', ') + ', o);'];
  }
  const eq = L.lang === 'R' ? ' = ' : '=';
  const args = pos.concat(entries.map(([k, v]) => k + eq + v));
  const one = name + '(' + args.join(', ') + ')';
  if (one.length <= 96) return [one];
  // A long call keeps its arguments on lines of their own, indented under the name.
  const pad = ' '.repeat(name.length + 1), out = [];
  let line = name + '(';
  args.forEach((a, i) => {
    const piece = a + (i < args.length - 1 ? ',' : ')');
    if (line.length + piece.length + 1 > 96 && line.trim() !== name + '(') { out.push(line.replace(/ +$/, '')); line = pad; }
    line += piece + (i < args.length - 1 ? ' ' : '');
  });
  out.push(line);
  return out;
}

// ── One System ───────────────────────────────────────────────────────────

// The outcomes (or the pooled observations) as one row of dots, with the
// interval under them and a line at their mean.
function oneFigures(r, L) {
  const o = r.one, F = r.fig;
  const opts = { mean_line: L.bool(true) };
  if (o.interval) {
    const [m, lo, hi] = o.np ? [fld(L, 'sr', 'estimate'), fld(L, 'sr', 'lo'), fld(L, 'sr', 'hi')]
      : [fld(L, 'd', 'mean'), fld(L, 'ti', 'lo'), fld(L, 'ti', 'hi')];
    Object.assign(opts, { mid: vecOf(L, [m]), lo: vecOf(L, [lo]), hi: vecOf(L, [hi]) });
  }
  const what = (o.np ? 'the Wilcoxon signed-rank interval on the pseudo-median' : 'the t interval on the mean');
  return {
    notes: [(r.data.pooled ? 'The pooled observations' : 'The replication outcomes') + ' as dots, with their mean' + (o.interval ? ' and ' + what + ' under them.' : '.')],
    calls: call(L, 'fig_strips', [listOf(L, ['x']), strsOf(L, [F.label]), L.str(F.xlab), L.str(F.title)], opts),
    fig: ['strips']
  };
}

// ── Two Systems ──────────────────────────────────────────────────────────

function twoFigures(r, L) {
  return r.two.mode === 'paired' ? twoPairedFigures(r, L) : twoIndependentFigures(r, L);
}

// Each design's outcomes with its own interval (a t interval, or the
// Wilcoxon signed-rank interval under the rank procedure), and the interval
// on the difference A - B against zero, flagged when it excludes zero.
function twoIndependentFigures(r, L) {
  const o = r.two, F = r.fig, calls = [], need = [];
  const own = o.np ? 'signed_rank' : 't_interval';
  need.push(o.np ? 'signedRank' : 'tInterval');
  calls.push(L.assign('ia', own + '(a, level)'), L.assign('ib', own + '(b, level)'));
  const mid = o.np ? [fld(L, 'ia', 'estimate'), fld(L, 'ib', 'estimate')] : [fld(L, 'da', 'mean'), fld(L, 'db', 'mean')];
  calls.push(...call(L, 'fig_strips', [listOf(L, ['a', 'b']), strsOf(L, F.labels), L.str('Replication outcome'), L.str('Replication outcomes and each design\'s interval')],
    { mid: vecOf(L, mid), lo: vecOf(L, [fld(L, 'ia', 'lo'), fld(L, 'ib', 'lo')]), hi: vecOf(L, [fld(L, 'ia', 'hi'), fld(L, 'ib', 'hi')]) }));
  const v = o.np ? 'rs' : 'w';
  const [m, lo, hi] = [fld(L, v, o.np ? 'estimate' : 'diff'), fld(L, v, 'lo'), fld(L, v, 'hi')];
  calls.push(...call(L, 'fig_intervals', [vecOf(L, [m]), vecOf(L, [lo]), vecOf(L, [hi]), strsOf(L, ['A - B']),
    L.str(o.np ? 'Shift in location, A - B' : 'Difference in means, A - B'), L.str('The difference against zero')],
  { ref: '0', flagged: vecOf(L, [orOf(L, lo + ' > 0', hi + ' < 0')]) }));
  return {
    notes: ['Each design\'s replication outcomes with its own ' + (o.np ? 'Wilcoxon signed-rank interval' : 't interval') + ', and the interval on the ' +
      (o.np ? 'shift' : 'difference') + ' A - B, drawn in red when it excludes zero.'],
    calls, need, fig: ['strips', 'intervals']
  };
}

// The differences with their interval against zero, and the pairs: by
// replication (A filled, B hollow, joined) or as slopes from A to B.
function twoPairedFigures(r, L) {
  const o = r.two, F = r.fig, calls = [];
  const [m, lo, hi] = o.np ? [fld(L, 'sr', 'estimate'), fld(L, 'sr', 'lo'), fld(L, 'sr', 'hi')]
    : [fld(L, 'pr', 'meanD'), fld(L, 'pr', 'lo'), fld(L, 'pr', 'hi')];
  calls.push(...call(L, 'fig_strips', [listOf(L, [fld(L, 'pr', 'diffs')]), strsOf(L, ['A - B']), L.str('Difference A - B in each matched pair'),
    L.str('Paired differences')], { mid: vecOf(L, [m]), lo: vecOf(L, [lo]), hi: vecOf(L, [hi]), ref: '0' }));
  const slope = F.view === 'slope';
  if (slope) calls.push(...call(L, 'fig_pairs_slopes', ['a', 'b'], { label_a: L.str(F.labels[0]), label_b: L.str(F.labels[1]) }));
  else {
    calls.push(...call(L, 'fig_pairs_by_rep', ['a', 'b', idText(L, 'pair_id')],
      { xlab: L.str(r.pairs.by === 'id' ? 'Replication id' : 'Replication ids, A/B') }));
  }
  return {
    notes: ['The differences of the matched pairs with their ' + (o.np ? 'Wilcoxon signed-rank interval' : 'paired t interval') + ', and the pairs ' +
      (slope ? 'as slopes from A to B, solid where a pair differs in the direction of the mean difference.' : 'by replication, A filled and B hollow.')],
    calls, fig: ['strips', slope ? 'pairsSlopes' : 'pairsByRep']
  };
}

// ── Several Systems ──────────────────────────────────────────────────────

// A field of every element of a list (R list, Python list of dicts, MATLAB cell array) as a vector.
const pluck = (L, v, k) => (L.lang === 'R' ? 'sapply(' + v + ', function(e) e$' + k + ')'
  : L.lang === 'py' ? 'np.array([e["' + k + '"] for e in ' + v + '], dtype=float)' : 'cellfun(@(e) e.' + k + ', ' + v + ')');

// The rows of a design-level figure in the page's order, best first: ord
// lists the designs by mean (largest first when bigger is better), and
// row_of gives each design's row.
function orderLines(L, means) {
  if (L.lang === 'R') return ['row_means <- ' + means, 'ord <- order(row_means, decreasing = direction == "max")', 'row_of <- match(seq_len(k), ord)'];
  if (L.lang === 'py') {
    return ['row_means = ' + means, 'ord = np.argsort(-row_means if direction == "max" else row_means, kind="stable")',
      'row_of = np.empty(k, dtype=int)', 'row_of[ord] = np.arange(1, k + 1)'];
  }
  return ['row_means = ' + means + ';', "if strcmp(direction, 'max'), [~, ord] = sort(row_means, 'descend'); else, [~, ord] = sort(row_means); end",
    'row_of = zeros(1, k); row_of(ord) = 1:k;'];
}

// A vector, or the labels, taken in the order ord.
const inOrd = (L, v, strs = false) => (L.lang === 'R' ? v + '[ord]' : L.lang === 'py' ? (strs ? '[' + v + '[i] for i in ord]' : 'np.asarray(' + v + ')[ord]') : v + '(ord)');

// The brackets of the pairs a post-hoc rule declared different, as rows: from
// a list of pairs with fields i, j, and flagged.
function bracketsFromPairs(L, pairs) {
  if (L.lang === 'R') return ['fl <- Filter(function(p) isTRUE(p$flagged), ' + pairs + ')', 'brackets <- if (length(fl)) t(sapply(fl, function(p) row_of[c(p$i, p$j)])) else NULL'];
  if (L.lang === 'py') return ['brackets = [(row_of[p["i"]], row_of[p["j"]]) for p in ' + pairs + ' if p["flagged"]]'];
  return ['fl = ' + pairs + '(cellfun(@(p) logical(p.flagged), ' + pairs + '));', 'brackets = zeros(numel(fl), 2);',
    'for q = 1:numel(fl), brackets(q, :) = row_of([fl{q}.i, fl{q}.j]); end'];
}

function severalFigures(r, L) {
  const S = r.several, F = r.fig, resp = r.groups.response, calls = [], fig = [], notes = [];
  calls.push(L.lang === 'm' ? 'design_labels = ' + strsOf(L, F.labels) + ';' : L.assign('design_labels', strsOf(L, F.labels)));
  const items = fld(L, 'sm', 'items');
  if (F.section === 'means') {
    const src = S.np ? 'srs' : items;
    calls.push(L.assign('iv_lo', pluck(L, src, 'lo')), L.assign('iv_hi', pluck(L, src, 'hi')));
    const opts = {};
    if (S.bench != null) {
      calls.push(L.assign('bench_flag', L.lang === 'R' ? '(iv_lo > benchmark) %in% TRUE | (iv_hi < benchmark) %in% TRUE' : '(iv_lo > benchmark) | (iv_hi < benchmark)'));
      Object.assign(opts, { ref: 'benchmark', flagged: 'bench_flag' });
    }
    calls.push(...call(L, 'fig_intervals', [pluck(L, src, S.np ? 'estimate' : 'mean'), 'iv_lo', 'iv_hi', 'design_labels',
      L.str((S.np ? 'Pseudo-median of ' : 'Mean of ') + resp), L.str((S.np ? 'Pseudo-medians' : 'Means') + ' with simultaneous intervals')], opts));
    fig.push('intervals');
    notes.push('Each design\'s ' + (S.np ? 'pseudo-median' : 'mean') + ' with its simultaneous interval' + (S.bench != null ? ', drawn in red when it excludes the benchmark (the dashed line).' : '.'));
  } else if (F.section === 'diffs') {
    calls.push(...call(L, 'fig_intervals', ['fam_mid', 'fam_lo', 'fam_hi', 'fam_lab', L.str((S.np ? 'Shift in location of ' : 'Difference in means of ') + resp),
      L.str('Pairwise comparisons (Bonferroni)')], { ref: '0', flagged: L.lang === 'R' ? '(fam_lo > 0) %in% TRUE | (fam_hi < 0) %in% TRUE' : L.lang === 'py' ? '(np.array(fam_lo) > 0) | (np.array(fam_hi) < 0)' : '(fam_lo > 0) | (fam_hi < 0)' }));
    fig.push('intervals');
    notes.push('Every comparison of the family with its interval, collected as the comparisons above ran, drawn in red when it excludes zero.');
  } else if (F.section === 'anova' && S.anova && !S.anova.welchBad.length) {
    const A = S.anova, dunnett = !A.welch && A.rule === 'dunnett';
    calls.push(...call(L, 'fig_qq', [fld(L, 'av', 'resid'), L.str('Residual'), L.str('Residuals, normal quantile-quantile plot')]));
    calls.push(...orderLines(L, pluck(L, items, 'mean')));
    let right;
    if (A.letters) right = inOrd(L, 'cld', true);
    else if (dunnett) {
      if (L.lang === 'R') right = 'ifelse(seq_len(k) == control, "control", "")[ord]';
      else if (L.lang === 'py') right = '["control" if i == control - 1 else "" for i in ord]';
      else { calls.push("row_text = repmat({''}, 1, k); row_text{control} = 'control';"); right = 'row_text(ord)'; }
    }
    calls.push(...bracketsFromPairs(L, fld(L, 'ph', 'pairs')));
    calls.push(L.assign('iv_lo', pluck(L, items, 'lo')), L.assign('iv_hi', pluck(L, items, 'hi')));
    calls.push(...call(L, 'fig_intervals', [inOrd(L, 'row_means'), inOrd(L, 'iv_lo'), inOrd(L, 'iv_hi'),
      inOrd(L, 'design_labels', true), L.str('Mean of ' + resp), L.str('Designs, best first, with letter groups and the pairs declared different')],
    { right, brackets: 'brackets' }));
    const pp = fld(L, 'ph', 'pairs');
    const lab = L.lang === 'R' ? 'sapply(' + pp + ', function(p) paste(p$i, "-", p$j))' : L.lang === 'py' ? '[f"{p[\'i\'] + 1} - {p[\'j\'] + 1}" for p in ' + pp + ']'
      : "cellfun(@(p) sprintf('%d - %d', p.i, p.j), " + pp + ", 'UniformOutput', false)";
    const flag = L.lang === 'R' ? 'sapply(' + pp + ', function(p) isTRUE(p$flagged))' : L.lang === 'py' ? '[bool(p["flagged"]) for p in ' + pp + ']' : 'cellfun(@(p) logical(p.flagged), ' + pp + ')';
    calls.push(...call(L, 'fig_intervals', [pluck(L, pp, 'diff'), pluck(L, pp, 'lo'), pluck(L, pp, 'hi'), lab, L.str('Difference in means of ' + resp),
      L.str('Post-hoc comparisons')], { ref: '0', flagged: flag }));
    fig.push('qq', 'intervals');
    notes.push('The residuals\' normal quantile-quantile plot; the designs, best first, each with its simultaneous interval, its letters, and a bracket joining each pair the post-hoc rule declared different; and the post-hoc intervals, red where a pair was declared different.');
  } else if (F.section === 'anova' && S.rank) {
    if (L.lang === 'R') calls.push('hl <- lapply(groups, function(x) signed_rank(x, level))');
    else if (L.lang === 'py') calls.push('hl = [signed_rank(x, level) for x in groups]');
    else calls.push("hl = cellfun(@(x) signed_rank(x, level), groups, 'UniformOutput', false);");
    calls.push(...orderLines(L, pluck(L, 'hl', 'estimate')));
    if (L.lang === 'R') calls.push('brackets <- if (length(rank_flagged)) t(sapply(rank_flagged, function(p) row_of[p])) else NULL');
    else if (L.lang === 'py') calls.push('brackets = [(row_of[i], row_of[j]) for i, j in rank_flagged]');
    else calls.push('brackets = []; if ~isempty(rank_flagged), brackets = [reshape(row_of(rank_flagged(:, 1)), [], 1), reshape(row_of(rank_flagged(:, 2)), [], 1)]; end');
    calls.push(L.assign('iv_lo', pluck(L, 'hl', 'lo')), L.assign('iv_hi', pluck(L, 'hl', 'hi')));
    calls.push(...call(L, 'fig_intervals', [inOrd(L, 'row_means'), inOrd(L, 'iv_lo'), inOrd(L, 'iv_hi'),
      inOrd(L, 'design_labels', true), L.str('Pseudo-median of ' + resp), L.str('Designs, best first, with letter groups and the pairs declared different')],
    { right: inOrd(L, 'rank_cld', true), brackets: 'brackets' }));
    fig.push('intervals');
    notes.push('The designs, best first, each with its pseudo-median and Wilcoxon signed-rank interval, its letters, and a bracket joining each pair declared different.');
  } else if (F.section === 'subset' && S.subset && S.subset.ok) {
    calls.push(...orderLines(L, pluck(L, items, 'mean')));
    const surv = L.lang === 'R' ? 'ss$survivors[ord]' : L.lang === 'py' ? 'np.asarray(ss["survivors"], dtype=bool)[ord]' : 'logical(ss.survivors(ord))';
    calls.push(L.assign('survives', surv));
    const right = L.lang === 'R' ? 'ifelse(survives, "survives", "eliminated")' : L.lang === 'py' ? '["survives" if s else "eliminated" for s in survives]'
      : "row_text";
    if (L.lang === 'm') calls.push("row_text = repmat({'eliminated'}, 1, k); row_text(survives) = {'survives'};");
    calls.push(L.assign('iv_lo', pluck(L, items, 'lo')), L.assign('iv_hi', pluck(L, items, 'hi')));
    calls.push(...call(L, 'fig_intervals', [inOrd(L, 'row_means'), inOrd(L, 'iv_lo'), inOrd(L, 'iv_hi'),
      inOrd(L, 'design_labels', true), L.str('Mean of ' + resp), L.str('Screen for the best')],
    { right, ok: 'survives', muted: L.lang === 'py' ? '~survives' : '!survives'.replace('!', L.lang === 'm' ? '~' : '!') }));
    fig.push('intervals');
    notes.push('The designs, best first, each with its simultaneous interval: the survivors of the screen in green, and the eliminated designs in gray.');
  } else return { calls: [] };
  return { notes, calls, fig };
}

// ── Steady State ─────────────────────────────────────────────────────────

// The warm-up section: Welch's plot of the ensemble average, its moving
// average, and its cumulative average, with the cut. The batch section: the
// correlogram of the series after truncation with the batch size marked, each
// batch mean against the next, and the series with its batches.
function steadyFigures(r, L) {
  const S = r.steady, F = r.fig, time = S.kind === 'time', resp = F.response, calls = [];
  if (F.section === 'warmup') {
    if (L.lang === 'R') calls.push('x <- if (align == "index") seq_along(ybar) else (al$edges[-1] + al$edges[-length(al$edges)]) / 2');
    else if (L.lang === 'py') calls.push('x = np.arange(1, L + 1) if align == "index" else (edges[1:] + edges[:-1]) / 2');
    else calls.push("if strcmp(align, 'index'), x = 1:L; else, x = (edges(2:end) + edges(1:end - 1)) / 2; end");
    const xlab = L.lang === 'R' ? 'if (align == "index") "Observation index" else "Simulation time (bin centers)"'
      : L.lang === 'py' ? '"Observation index" if align == "index" else "Simulation time (bin centers)"' : null;
    if (L.lang === 'm') calls.push("xlab = 'Simulation time (bin centers)'; if strcmp(align, 'index'), xlab = 'Observation index'; end");
    calls.push(...call(L, 'fig_warmup', ['x', 'ybar', 'smooth', 'cum', 'cut', xlab || 'xlab',
      L.str(F.nReps > 1 ? 'Average ' + resp + ' across replications' : resp), L.str('Warm-up: the average across replications')]));
    return { notes: ['Welch\'s warm-up plot: the average across replications, its moving average over w points on each side, and its cumulative average, with the stretch before the cut shaded.'],
      calls, fig: ['warmup'] };
  }
  if (!S.batchOk) return { calls: [] };
  const ind = L.lang === 'R' ? '  ' : '    ';
  const inner = [];
  // The correlogram, at every lag the page draws.
  const step = time ? (L.lang === 'R' ? '(b_end - bt[1]) / n_steps' : L.lang === 'py' ? '(b_end - bt[0]) / n_steps' : '(b_end - bt(1)) / n_steps') : '1';
  const markLabel = time ? (L.lang === 'R' ? 'paste("batch length", signif(bm$size, 4))' : L.lang === 'py' ? 'f"batch length {bm[\'size\']:.4g}"' : "sprintf('batch length %.4g', bm.size)")
    : (L.lang === 'R' ? 'paste("batch size", bm$size)' : L.lang === 'py' ? 'f"batch size {bm[\'size\']:g}"' : "sprintf('batch size %g', bm.size)");
  const acfCall = call(L, 'fig_acf', [L.lang === 'm' ? 'acf_lags(series, n_lags)' : 'acf_lags(series, n_lags)'],
    { step, band: L.lang === 'R' ? '2 / sqrt(length(series))' : L.lang === 'py' ? '2 / np.sqrt(len(series))' : '2 / sqrt(numel(series))',
      xlab: L.str(time ? 'Lag (time units)' : 'Lag (observations)'), title: L.str('Autocorrelation after truncation'),
      mark: fld(L, 'bm', 'size'), mark_label: markLabel });
  if (L.lang === 'R') inner.push('if (n_lags >= 1) {', ...acfCall.map(x => ind + x), '}');
  else if (L.lang === 'py') inner.push('if n_lags >= 1:', ...acfCall.map(x => ind + x));
  else inner.push('if n_lags >= 1', ...acfCall.map(x => ind + x), 'end');
  // Each batch mean against the next.
  const lagCall = call(L, 'fig_lag', [fld(L, 'bm', 'means'), '1', L.str('Batch mean j'), L.str('Batch mean j + 1'), L.str('Neighboring batch means')]);
  if (L.lang === 'R') inner.push('if (bm$b >= 3) {', ...lagCall.map(x => ind + x), '}');
  else if (L.lang === 'py') inner.push('if bm["b"] >= 3:', ...lagCall.map(x => ind + x));
  else inner.push('if bm.b >= 3', ...lagCall.map(x => ind + x), 'end');
  // The series the batches were formed on, with each batch's span and mean.
  if (time) {
    if (L.lang === 'R') inner.push('bx <- bt; b_starts <- bm$start + (seq_len(bm$b) - 1) * bm$size');
    else if (L.lang === 'py') inner.push('bx = bt; b_starts = bm["start"] + np.arange(bm["b"]) * bm["size"]');
    else inner.push('bx = bt; b_starts = bm.start + (0:bm.b - 1) * bm.size;');
  } else if (L.lang === 'R') inner.push('bx <- seq_along(bv); b_starts <- (seq_len(bm$b) - 1) * bm$size + 0.5');
  else if (L.lang === 'py') inner.push('bx = np.arange(1, len(bv) + 1); b_starts = np.arange(bm["b"]) * bm["size"] + 0.5');
  else inner.push('bx = 1:numel(bv); b_starts = (0:bm.b - 1) * bm.size + 0.5;');
  inner.push(...call(L, 'fig_batches', ['bx', 'bv', 'b_starts', 'b_starts + ' + fld(L, 'bm', 'size'), fld(L, 'bm', 'means'),
    L.str(time ? 'Simulation time' : 'Observation (after the cut)'), L.str(resp), L.str('The series and its batch means')], { step: L.bool(time) }));
  if (L.lang === 'R') calls.push('if (bm$ok) {', ...inner.map(x => ind + x), '}');
  else if (L.lang === 'py') calls.push('if bm["ok"]:', ...inner.map(x => ind + x));
  else calls.push('if bm.ok', ...inner.map(x => ind + x), 'end');
  return {
    notes: ['The correlogram of the series after truncation with the batch ' + (time ? 'length' : 'size') + ' marked; each batch mean against the next, ' +
      'which should show no trend when the batches are long enough; and the series with each batch\'s span and mean.'],
    calls, fig: ['acf', 'lag', 'batches']
  };
}

// ── Summary and Plots ────────────────────────────────────────────────────

// Lines per language, chosen by L.
const by = (L, R, py, m) => (L.lang === 'R' ? R : L.lang === 'py' ? py : m);

// The values a distribution figure draws: every observation pooled, or the outcomes x.
function valuesLine(L, pooled) {
  if (!pooled) return [by(L, 'plot_v <- x', 'plot_v = x', 'plot_v = x;')];
  return [by(L, 'plot_v <- unlist(lapply(reps, function(r) r$v))', 'plot_v = np.concatenate([np.asarray(r["v"], float) for r in reps])', 'plot_v = [reps.v];')];
}

// The open section's figures: the distribution (histogram, empirical CDF, and
// box plot), one replication's run (its series, running mean, and, for tally
// data, a lag plot and correlogram), the replications (a dot plot and their
// intervals), or the normal quantile-quantile plot.
function exploreFigures(r, L) {
  const F = r.fig, calls = [], need = [], fig = [], notes = [];
  const tally = F.kind === 'tally', resp = F.response;
  if (F.section === 'dist') {
    calls.push(...valuesLine(L, F.pooledDist));
    calls.push(by(L, 'nb <- max(5, ceiling(sqrt(length(plot_v))))', 'nb = max(5, int(np.ceil(np.sqrt(len(plot_v)))))', 'nb = max(5, ceil(sqrt(numel(plot_v))));'));
    calls.push(by(L, 'edges <- if (max(plot_v) > min(plot_v)) seq(min(plot_v), max(plot_v), length.out = nb + 1) else plot_v[1] + c(-0.5, 0.5)',
      'edges = np.linspace(plot_v.min(), plot_v.max(), nb + 1) if plot_v.max() > plot_v.min() else plot_v[0] + np.array([-0.5, 0.5])',
      'if max(plot_v) > min(plot_v), edges = linspace(min(plot_v), max(plot_v), nb + 1); else, edges = plot_v(1) + [-0.5, 0.5]; end'));
    const xlab = F.pooledDist ? resp : F.outcomeAxis, what = F.pooledDist ? 'Pooled observations' : 'Replication outcomes';
    calls.push(...call(L, 'fig_hist', ['plot_v', 'edges', L.str(xlab), L.str(what + ': histogram')]));
    calls.push(...call(L, 'fig_ecdf', ['plot_v', L.str(xlab), L.str(what + ': empirical CDF')]));
    fig.push('hist', 'ecdf');
    if (F.nOut >= 5) { calls.push(...call(L, 'fig_box', ['x', L.str(F.outcomeAxis), L.str('Replication outcomes: box plot')])); fig.push('box'); }
    notes.push('The histogram has max(5, ceiling(sqrt(n))) equal-width bins from the smallest value to the largest, as the page draws it' +
      (F.nOut >= 5 ? '; the box plot is always of the replication outcomes.' : '.'));
  } else if (F.section === 'run') {
    const k = F.rep;
    calls.push(by(L, 'rv <- reps[[' + k + ']]$v; rt <- reps[[' + k + ']]$t', 'rv = np.asarray(reps[' + (k - 1) + ']["v"], float); rt = reps[' + (k - 1) + ']["t"]',
      'rv = reps(' + k + ').v; rt = reps(' + k + ').t;'));
    const title = 'Replication ' + F.repId;
    if (tally) {
      const useT = F.axis === 'time';
      calls.push(useT ? by(L, 'xs <- if (is.null(rt)) seq_along(rv) else rt', 'xs = np.arange(1, len(rv) + 1) if rt is None else np.asarray(rt, float)', 'xs = rt; if isempty(xs), xs = 1:numel(rv); end')
        : by(L, 'xs <- seq_along(rv)', 'xs = np.arange(1, len(rv) + 1)', 'xs = 1:numel(rv);'));
      const xlab = useT ? 'Time' : 'Observation number';
      calls.push(...call(L, 'fig_series', ['xs', 'rv', L.str(xlab), L.str(resp), L.str(title + ': observations')], { type: L.str('points') }));
      calls.push(...call(L, 'fig_running', ['xs', by(L, 'cumsum(rv) / seq_along(rv)', 'np.cumsum(rv) / np.arange(1, len(rv) + 1)', 'cumsum(rv) ./ (1:numel(rv))'),
        L.str(xlab), L.str('Running mean'), L.str(title + ': running mean')]));
      need.push('acf');
      const lagCalls = [...call(L, 'fig_lag', ['rv', 'k_lag', L.str('Observation i'), L.str('Observation i + k'), L.str(title + ': lag plot')]),
        ...call(L, 'fig_acf', ['acf_lags(rv, n_lags)'], { band: by(L, '2 / sqrt(length(rv))', '2 / np.sqrt(len(rv))', '2 / sqrt(numel(rv))'),
          title: L.str(title + ': autocorrelation'), mark: 'k_lag', mark_label: by(L, 'paste("lag", k_lag)', 'f"lag {k_lag}"', "sprintf('lag %d', k_lag)") })];
      const ind = L.lang === 'R' ? '  ' : '    ';
      calls.push(L.comment + 'The lag k of the page, held to the lags the correlogram draws: 1 to min(400, n/4).');
      calls.push(by(L, 'n_lags <- min(400, floor(length(rv) / 4)); k_lag <- min(' + F.lag + ', n_lags)',
        'n_lags = min(400, len(rv) // 4); k_lag = min(' + F.lag + ', n_lags)', 'n_lags = min(400, floor(numel(rv) / 4)); k_lag = min(' + F.lag + ', n_lags);'));
      if (L.lang === 'R') calls.push('if (length(rv) >= 8 && n_lags >= 1) {', ...lagCalls.map(x => ind + x), '}');
      else if (L.lang === 'py') calls.push('if len(rv) >= 8 and n_lags >= 1:', ...lagCalls.map(x => ind + x));
      else calls.push('if numel(rv) >= 8 && n_lags >= 1', ...lagCalls.map(x => ind + x), 'end');
      fig.push('series', 'running', 'lag', 'acf');
      notes.push('Replication ' + F.repId + ', the one the page showed: its observations, their running mean, and, with eight or more, the lag plot at lag k and the correlogram.');
    } else {
      calls.push(L.comment + 'The state holds each value until the next record, and the last until end_time when the data give one.');
      calls.push(...by(L, ['te <- if (is.finite(end_time)) end_time else rt[length(rt)]', 'sx <- c(rt, te); sy <- c(rv, rv[length(rv)])',
        'area <- cumsum(rv * diff(sx)); at <- sx[-1]; later <- at > rt[1]'],
      ['te = end_time if np.isfinite(end_time) else rt[-1]', 'sx = np.append(np.asarray(rt, float), te); sy = np.append(rv, rv[-1])',
        'area = np.cumsum(rv * np.diff(sx)); at = sx[1:]; later = at > sx[0]'],
      ['te = end_time; if ~isfinite(te), te = rt(end); end', "sx = [rt(:)', te]; sy = [rv(:)', rv(end)];",
        "area = cumsum(rv(:)' .* diff(sx)); at = sx(2:end); later = at > sx(1);"]));
      calls.push(...call(L, 'fig_series', ['sx', 'sy', L.str('Time'), L.str(resp), L.str(title + ': the state over time')], { type: L.str('step') }));
      calls.push(...call(L, 'fig_running', [by(L, 'at[later]', 'at[later]', 'at(later)'), by(L, '(area / (at - rt[1]))[later]', '(area / (at - sx[0]))[later]', 'area(later) ./ (at(later) - sx(1))'),
        L.str('Time'), L.str('Running time-weighted mean'), L.str(title + ': running time-weighted mean')]));
      fig.push('series', 'running');
      notes.push('Replication ' + F.repId + ', the one the page showed: the state over time, and its running time-weighted mean.');
    }
  } else if (F.section === 'reps') {
    calls.push(...call(L, 'fig_strips', [listOf(L, ['x']), strsOf(L, ['']), L.str(F.outcomeAxis), L.str('Replication outcomes')], { mean_line: L.bool(true) }));
    need.push('tInterval');
    calls.push(L.assign('ta', 't_interval(x, level)'));
    if (tally) {
      calls.push(L.comment + 'Each replication\'s own t interval over its observations, for the first 60 with two or more.');
      calls.push(...by(L, ['keep <- head(Filter(function(r) length(r$v) >= 2, reps), 60)', 'per <- lapply(keep, function(r) t_interval(r$v, level))',
        'f_mid <- c(mean(x), vapply(keep, function(r) mean(r$v), numeric(1)))', 'f_lo <- c(ta$lo, vapply(per, function(p) p$lo, numeric(1)))',
        'f_hi <- c(ta$hi, vapply(per, function(p) p$hi, numeric(1)))', 'f_lab <- c("all replications", vapply(keep, function(r) paste("replication", r$id), ""))'],
      ['keep = [rp for rp in reps if len(rp["v"]) >= 2][:60]', 'per = [t_interval(np.asarray(rp["v"], float), level) for rp in keep]',
        'f_mid = [np.mean(x)] + [np.mean(rp["v"]) for rp in keep]', 'f_lo = [ta["lo"]] + [p["lo"] for p in per]', 'f_hi = [ta["hi"]] + [p["hi"] for p in per]',
        'f_lab = ["all replications"] + ["replication " + str(rp["id"]) for rp in keep]'],
      ['keep = find(arrayfun(@(rp) numel(rp.v) >= 2, reps)); keep = keep(1:min(60, end));', "f_mid = mean(x); f_lo = ta.lo; f_hi = ta.hi; f_lab = {'all replications'};",
        'for q = keep', '    p = t_interval(reps(q).v, level);', "    f_mid(end + 1) = mean(reps(q).v); f_lo(end + 1) = p.lo; f_hi(end + 1) = p.hi; f_lab{end + 1} = ['replication ' char(reps(q).id)];", 'end']));
      calls.push(...call(L, 'fig_intervals', ['f_mid', 'f_lo', 'f_hi', 'f_lab', L.str(F.outcomeAxis), L.str('t intervals')], { ref: by(L, 'mean(x)', 'np.mean(x)', 'mean(x)') }));
    } else {
      calls.push(...call(L, 'fig_intervals', [vecOf(L, [by(L, 'mean(x)', 'np.mean(x)', 'mean(x)')]), vecOf(L, [fld(L, 'ta', 'lo')]), vecOf(L, [fld(L, 'ta', 'hi')]),
        strsOf(L, ['all replications']), L.str(F.outcomeAxis), L.str('t interval over the replication outcomes')]));
    }
    fig.push('strips', 'intervals');
    notes.push('The replication outcomes as dots with their mean, and the t interval over them' + (tally ? ' above each replication\'s own interval over its observations.' : '.'));
  } else if (F.section === 'normality') {
    calls.push(...valuesLine(L, F.pooledQQ));
    calls.push(...call(L, 'fig_qq', ['plot_v', L.str(F.pooledQQ ? resp : F.outcomeAxis), L.str((F.pooledQQ ? 'Pooled observations' : 'Replication outcomes') + ': normal quantile-quantile plot')]));
    fig.push('qq');
    notes.push('The normal quantile-quantile plot: each sorted value against the normal quantile at its plotting position (R\'s ppoints), with a dashed line through the quartiles (R\'s qqline).');
  } else return { calls: [] };
  return { notes, calls, need, fig };
}

/** The figure emitters by page. */
export const FIGURES = { one: oneFigures, two: twoFigures, several: severalFigures, steady: steadyFigures, explore: exploreFigures };

/**
 * The Figures section of a script, or nothing when the page's view shows no
 * figure: a comment saying what is drawn, the calls, and in Python the guard
 * that skips the figures when Matplotlib is not installed and the one call
 * that shows them all.
 * @param {object} r the recipe
 * @param {object} L the language
 * @returns {{ lines: string[], fig: string[], need: string[] }}
 */
export function figureBlock(r, L) {
  const make = Object.prototype.hasOwnProperty.call(FIGURES, r.page) ? FIGURES[r.page] : null;
  const got = make ? make(r, L) : null;
  if (!got || !got.calls.length) return { lines: [], fig: [], need: [] };
  const c = L.comment, lines = [L.sect('Figures')];
  for (const n of got.notes || []) lines.push(...wrapComment(c, n));
  if (L.lang === 'R' && !L.tidy) lines.push(c + 'Each figure replaces the last on screen; in RStudio, the arrows of the Plots pane step back through them.');
  if (L.lang === 'R' && L.tidy) lines.push(c + 'In RStudio, the arrows of the Plots pane step back through the figures.');
  if (L.lang === 'py') {
    lines.push('try:', '    import matplotlib', 'except ImportError:', '    matplotlib = None',
      'if matplotlib is None:', '    print("Matplotlib is not installed, and so the figures are skipped.")', 'else:',
      ...got.calls.map(x => '    ' + x), '    show_figures()');
  } else lines.push(...got.calls);
  return { lines, fig: Array.from(new Set(['common', ...got.fig])), need: got.need || [] };
}

function wrapComment(c, text) {
  const out = [];
  let line = c;
  for (const w of text.split(/ +/)) {
    if (line.length > c.length && line.length + 1 + w.length > 92) { out.push(line); line = c; }
    line += (line.length > c.length ? ' ' : '') + w;
  }
  out.push(line);
  return out;
}
