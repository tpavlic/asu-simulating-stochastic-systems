// A figure as a script that redraws it: MATLAB, R (base graphics), or Python
// (matplotlib), with the plotted data embedded, so a reader can open the
// figure in the tool they know and restyle it there. Pure functions, no DOM.
//
// A figure spec is
//   { name, title, xLabel, yLabel, xlim, ylim, xTicks, yTicks, series }
// where `name` is an identifier (letters, digits, underscores), `xlim` and
// `ylim` are [lo, hi] or null, `xTicks`/`yTicks` are { at, labels } for a
// categorical axis or null, and `series` is a list of records drawn in order:
//   { kind: 'points',   x, y, label?, color, hollow?, marker?: 'o'|'d' }
//   { kind: 'line',     x, y, label?, color, dash?: boolean|'dotted', width? }
//   { kind: 'step',     x, y, label?, color, dash? }   value y[i] holds from x[i] to x[i+1]
//   { kind: 'bars',     edges, heights, label?, color }
//   { kind: 'hline',    y, label?, color, dash? }
//   { kind: 'vline',    x, label?, color, dash? }
//   { kind: 'segments', x0, y0, x1, y1, label?, color, dash?, width? }
//   { kind: 'band',     x, lo, hi, label?, color }
//   { kind: 'span',     x0, x1, label?, color }        a shaded vertical stretch
//   { kind: 'rects',    x0, y0, x1, y1, label?, color }
//   { kind: 'text',     x, y, text, color, anchor?: 'start'|'middle'|'end' }
// `color` is a CSS hex color. A record with a label appears in the legend.

const WRAP = 92;

function hexRgb(c) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim());
  if (!m) return [0.33, 0.33, 0.33];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map(x => x / 255);
}

function hex(c) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim());
  return m ? '#' + m[1].toUpperCase() : '#555555';
}

// Typographic characters that a script file is better off without.
function plain(s) {
  return String(s == null ? '' : s)
    .replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
    .replace(/\u00a0/g, ' ').replace(/\u2212/g, '-').replace(/\u00b7/g, '-').replace(/\u2026/g, '...')
    .replace(/[\r\n]+/g, ' ');
}

function numToken(v, nan) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return nan;
  return String(v);
}

// Numbers joined by ", " and wrapped to WRAP columns, each continuation line
// prefixed by `cont` (MATLAB needs an ellipsis before a line break inside
// brackets).
function joinNums(a, nan, indent, cont) {
  const parts = Array.from(a, v => numToken(v, nan));
  const lines = [];
  let line = '';
  for (const p of parts) {
    if (line && line.length + p.length + 2 > WRAP) { lines.push(line + ','); line = ''; }
    line += (line ? ', ' : '') + p;
  }
  lines.push(line);
  return lines.join(cont + '\n' + indent);
}

function sanitizeName(name) {
  let s = String(name || 'figure').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!s) s = 'figure';
  if (!/^[A-Za-z]/.test(s)) s = 'fig_' + s;
  return s.slice(0, 60);
}

function dashOf(rec) { return rec.dash === 'dotted' ? 'dotted' : rec.dash ? 'dashed' : 'solid'; }

const SERIES_KINDS = new Set(['points', 'line', 'step', 'bars', 'hline', 'vline', 'segments', 'band', 'span', 'rects', 'text']);

/**
 * Checks a spec's shape, returning it with its name sanitized, or throwing.
 * @param {object} spec
 */
export function normalizeSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new TypeError('a figure spec is required');
  const out = Object.assign({}, spec);
  out.name = sanitizeName(spec.name);
  out.series = Array.isArray(spec.series) ? spec.series.filter(r => r && SERIES_KINDS.has(r.kind)) : [];
  if (!isLim(out.xlim)) out.xlim = autoLim(out.series, 'x');
  if (!isLim(out.ylim)) out.ylim = autoLim(out.series, 'y');
  // Tick positions ascend, with their labels carried along (MATLAB insists).
  for (const k of ['xTicks', 'yTicks']) {
    const t = out[k];
    if (!t || !Array.isArray(t.at)) { out[k] = null; continue; }
    const order = t.at.map((v, i) => i).sort((i, j) => t.at[i] - t.at[j]);
    out[k] = { at: order.map(i => t.at[i]), labels: order.map(i => String(t.labels && t.labels[i] != null ? t.labels[i] : '')) };
  }
  return out;
}

function isLim(l) { return Array.isArray(l) && l.length === 2 && Number.isFinite(l[0]) && Number.isFinite(l[1]) && l[1] > l[0]; }

// The range of every value a series puts on one axis, padded a little, or
// [0, 1] when nothing lands there.
function autoLim(series, axis) {
  let lo = Infinity, hi = -Infinity;
  const take = a => { if (a == null) return; for (const v of (typeof a === 'number' ? [a] : a)) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } };
  for (const r of series) {
    if (axis === 'x') { take(r.x); take(r.edges); take(r.x0); take(r.x1); }
    else { take(r.y); take(r.heights); take(r.y0); take(r.y1); take(r.lo); take(r.hi); if (r.kind === 'bars') take(0); }
  }
  if (!(hi > lo)) return Number.isFinite(lo) ? [lo - 1, lo + 1] : [0, 1];
  const pad = (hi - lo) * 0.05;
  return [lo - pad, hi + pad];
}

// ── MATLAB ───────────────────────────────────────────────────────────────

function mStr(s) { return "'" + plain(s).replace(/'/g, "''") + "'"; }
function mVec(a) { return '[' + joinNums(a, 'NaN', '    ', ' ...') + ']'; }
function mRgb(c) { return '[' + hexRgb(c).map(v => v.toFixed(4)).join(' ') + ']'; }
function mStyle(rec) { return dashOf(rec) === 'dotted' ? ':' : dashOf(rec) === 'dashed' ? '--' : '-'; }
function mName(rec, i) { return rec.label ? ", 'DisplayName', " + mStr(rec.label) : ", 'HandleVisibility', 'off'"; }

/**
 * The figure as a MATLAB script.
 * @param {object} spec
 * @returns {string}
 */
export function matlabScript(spec) {
  const s = normalizeSpec(spec);
  const L = [];
  L.push('% ' + plain(s.title || s.name));
  L.push('% Written by the Output Analyzer. The data are embedded below, and so this');
  L.push('% script stands alone; edit the plotting calls to restyle the figure.');
  L.push('');
  L.push("fig = figure('Color', 'w');");
  L.push("ax = axes(fig); hold(ax, 'on'); box(ax, 'on'); grid(ax, 'on');");
  if (s.xlim) L.push('xlim(ax, ' + mVec(s.xlim) + ');');
  if (s.ylim) L.push('ylim(ax, ' + mVec(s.ylim) + ');');
  L.push('');
  let legendItems = 0;
  s.series.forEach((rec, i) => {
    const k = i + 1;
    const c = mRgb(rec.color);
    if (rec.label) legendItems++;
    switch (rec.kind) {
      case 'points':
        L.push('x' + k + ' = ' + mVec(rec.x) + ';');
        L.push('y' + k + ' = ' + mVec(rec.y) + ';');
        L.push("plot(ax, x" + k + ', y' + k + ", 'LineStyle', 'none', 'Marker', '" + (rec.marker === 'd' ? 'd' : 'o') + "', 'MarkerSize', 5, ...");
        L.push("    'MarkerEdgeColor', " + c + ", 'MarkerFaceColor', " + (rec.hollow ? "'none'" : c) + mName(rec) + ');');
        break;
      case 'line':
      case 'step':
        L.push('x' + k + ' = ' + mVec(rec.x) + ';');
        L.push('y' + k + ' = ' + mVec(rec.y) + ';');
        L.push((rec.kind === 'step' ? 'stairs' : 'plot') + '(ax, x' + k + ', y' + k + ", '" + mStyle(rec) + "', 'Color', " + c + ", 'LineWidth', " + (rec.width || 1.5) + mName(rec) + ');');
        break;
      case 'bars':
        L.push('edges' + k + ' = ' + mVec(rec.edges) + ';');
        L.push('counts' + k + ' = ' + mVec(rec.heights) + ';');
        L.push("histogram(ax, 'BinEdges', edges" + k + ", 'BinCounts', counts" + k + ", 'FaceColor', " + c + ", 'FaceAlpha', 0.35, 'EdgeColor', " + c + mName(rec) + ');');
        break;
      case 'hline':
        L.push('plot(ax, xlim(ax), [' + numToken(rec.y, 'NaN') + ' ' + numToken(rec.y, 'NaN') + "], '" + mStyle(rec) + "', 'Color', " + c + ", 'LineWidth', 1.5" + mName(rec) + ');');
        break;
      case 'vline':
        L.push('plot(ax, [' + numToken(rec.x, 'NaN') + ' ' + numToken(rec.x, 'NaN') + "], ylim(ax), '" + mStyle(rec) + "', 'Color', " + c + ", 'LineWidth', 1.5" + mName(rec) + ');');
        break;
      case 'segments':
        L.push('x0_' + k + ' = ' + mVec(rec.x0) + ';');
        L.push('x1_' + k + ' = ' + mVec(rec.x1) + ';');
        L.push('y0_' + k + ' = ' + mVec(rec.y0) + ';');
        L.push('y1_' + k + ' = ' + mVec(rec.y1) + ';');
        L.push('h' + k + ' = plot(ax, [x0_' + k + '; x1_' + k + '], [y0_' + k + '; y1_' + k + "], '" + mStyle(rec) + "', 'Color', " + c + ", 'LineWidth', " + (rec.width || 1.5) + ');');
        L.push("set(h" + k + ", 'HandleVisibility', 'off');");
        if (rec.label) L.push("if ~isempty(h" + k + "), set(h" + k + "(1), 'HandleVisibility', 'on', 'DisplayName', " + mStr(rec.label) + '); end');
        break;
      case 'band':
        L.push('x' + k + ' = ' + mVec(rec.x) + ';');
        L.push('lo' + k + ' = ' + mVec(rec.lo) + ';');
        L.push('hi' + k + ' = ' + mVec(rec.hi) + ';');
        L.push('fill(ax, [x' + k + ', fliplr(x' + k + ')], [lo' + k + ', fliplr(hi' + k + ')], ' + c + ", 'FaceAlpha', 0.25, 'EdgeColor', 'none'" + mName(rec) + ');');
        break;
      case 'span':
        L.push('yl' + k + ' = ylim(ax);');
        L.push('fill(ax, [' + [rec.x0, rec.x1, rec.x1, rec.x0].map(v => numToken(v, 'NaN')).join(' ') + '], [yl' + k + '(1) yl' + k + '(1) yl' + k + '(2) yl' + k + '(2)], ' + c + ", 'FaceAlpha', 0.15, 'EdgeColor', 'none'" + mName(rec) + ');');
        break;
      case 'rects':
        L.push('x0_' + k + ' = ' + mVec(rec.x0) + ';');
        L.push('x1_' + k + ' = ' + mVec(rec.x1) + ';');
        L.push('y0_' + k + ' = ' + mVec(rec.y0) + ';');
        L.push('y1_' + k + ' = ' + mVec(rec.y1) + ';');
        L.push('patch(ax, [x0_' + k + '; x1_' + k + '; x1_' + k + '; x0_' + k + '], [y0_' + k + '; y0_' + k + '; y1_' + k + '; y1_' + k + '], ' + c + ", 'FaceAlpha', 0.25, 'EdgeColor', " + c + ", 'LineWidth', 1.5" + mName(rec) + ');');
        break;
      case 'text': {
        const xs = Array.isArray(rec.x) || ArrayBuffer.isView(rec.x) ? rec.x : [rec.x];
        const ys = Array.isArray(rec.y) || ArrayBuffer.isView(rec.y) ? rec.y : [rec.y];
        const ts = Array.isArray(rec.text) ? rec.text : [rec.text];
        const ha = rec.anchor === 'end' ? 'right' : rec.anchor === 'middle' ? 'center' : 'left';
        L.push('text(ax, ' + mVec(xs) + ', ' + mVec(ys) + ', {' + Array.from(ts, mStr).join(', ') + "}, 'Color', " + c + ", 'HorizontalAlignment', '" + ha + "', 'FontWeight', 'bold', 'Interpreter', 'none');");
        break;
      }
      default: break;
    }
  });
  L.push('');
  if (s.xTicks) { L.push('xticks(ax, ' + mVec(s.xTicks.at) + ');'); L.push('xticklabels(ax, {' + s.xTicks.labels.map(mStr).join(', ') + '});'); }
  if (s.yTicks) { L.push('yticks(ax, ' + mVec(s.yTicks.at) + ');'); L.push('yticklabels(ax, {' + s.yTicks.labels.map(mStr).join(', ') + '});'); }
  // Labels are literal text: an underscore in a response name is not a subscript.
  L.push("set(ax, 'TickLabelInterpreter', 'none');");
  if (s.xLabel) L.push('xlabel(ax, ' + mStr(s.xLabel) + ", 'Interpreter', 'none');");
  if (s.yLabel) L.push('ylabel(ax, ' + mStr(s.yLabel) + ", 'Interpreter', 'none');");
  if (s.title) L.push('title(ax, ' + mStr(s.title) + ", 'Interpreter', 'none');");
  if (legendItems) L.push("legend(ax, 'show', 'Location', 'best', 'Interpreter', 'none');");
  L.push("hold(ax, 'off');");
  L.push('% savefig(fig, ' + mStr(s.name + '.fig') + ');');
  return L.join('\n') + '\n';
}

// ── R ────────────────────────────────────────────────────────────────────

function rStr(s) { return '"' + plain(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
function rVec(a) { return 'c(' + joinNums(a, 'NA', '  ', '') + ')'; }
function rLty(rec) { return dashOf(rec) === 'dotted' ? 3 : dashOf(rec) === 'dashed' ? 2 : 1; }

/**
 * The figure as an R script using base graphics.
 * @param {object} spec
 * @returns {string}
 */
export function rScript(spec) {
  const s = normalizeSpec(spec);
  const L = [];
  L.push('# ' + plain(s.title || s.name));
  L.push('# Written by the Output Analyzer. The data are embedded below, and so this');
  L.push('# script stands alone; edit the plotting calls to restyle the figure.');
  L.push('');
  const leg = { labels: [], col: [], pch: [], lty: [], lwd: [], fill: [] };
  const addLeg = (rec, pch, lty, fill) => {
    if (!rec.label) return;
    leg.labels.push(rStr(rec.label)); leg.col.push(rStr(hex(rec.color)));
    leg.pch.push(pch); leg.lty.push(lty); leg.lwd.push(rec.width || 1.5); leg.fill.push(fill ? 'adjustcolor(' + rStr(hex(rec.color)) + ', 0.35)' : 'NA');
  };
  // The data first, so the axes can be sized before anything is drawn.
  s.series.forEach((rec, i) => {
    const k = i + 1;
    if (rec.kind === 'points' || rec.kind === 'line' || rec.kind === 'step') { L.push('x' + k + ' <- ' + rVec(rec.x)); L.push('y' + k + ' <- ' + rVec(rec.y)); }
    else if (rec.kind === 'bars') { L.push('edges' + k + ' <- ' + rVec(rec.edges)); L.push('counts' + k + ' <- ' + rVec(rec.heights)); }
    else if (rec.kind === 'segments' || rec.kind === 'rects') { L.push('x0_' + k + ' <- ' + rVec(rec.x0)); L.push('x1_' + k + ' <- ' + rVec(rec.x1)); L.push('y0_' + k + ' <- ' + rVec(rec.y0)); L.push('y1_' + k + ' <- ' + rVec(rec.y1)); }
    else if (rec.kind === 'band') { L.push('x' + k + ' <- ' + rVec(rec.x)); L.push('lo' + k + ' <- ' + rVec(rec.lo)); L.push('hi' + k + ' <- ' + rVec(rec.hi)); }
  });
  L.push('');
  // A categorical axis gets a margin wide enough for its labels.
  if (s.yTicks) L.push('par(mar = c(4.5, ' + (4.5 + 0.45 * Math.max(0, ...s.yTicks.labels.map(l => plain(l).length))).toFixed(1) + ', 3.5, 1))');
  else L.push('par(mar = c(4.5, 4.5, 3.5, 1))');
  L.push('plot(NA, xlim = ' + rVec(s.xlim) + ', ylim = ' + rVec(s.ylim) +
    ', xlab = ' + rStr(s.xLabel) + ', ylab = ' + rStr(s.yLabel) + ', main = ' + rStr(s.title) +
    (s.xTicks ? ', xaxt = "n"' : '') + (s.yTicks ? ', yaxt = "n"' : '') + ', las = 1)');
  L.push('grid(col = "gray85", lty = 1)');
  if (s.xTicks) L.push('axis(1, at = ' + rVec(s.xTicks.at) + ', labels = c(' + s.xTicks.labels.map(rStr).join(', ') + '))');
  if (s.yTicks) L.push('axis(2, at = ' + rVec(s.yTicks.at) + ', labels = c(' + s.yTicks.labels.map(rStr).join(', ') + '), las = 1)');
  s.series.forEach((rec, i) => {
    const k = i + 1;
    const c = rStr(hex(rec.color));
    switch (rec.kind) {
      case 'points': {
        const pch = rec.marker === 'd' ? (rec.hollow ? 5 : 23) : (rec.hollow ? 21 : 19);
        L.push('points(x' + k + ', y' + k + ', pch = ' + pch + ', col = ' + c + (rec.hollow ? ', bg = "white"' : pch === 23 ? ', bg = "white"' : '') + ', cex = 0.9)');
        addLeg(rec, pch, 'NA', false);
        break;
      }
      case 'line':
      case 'step':
        L.push('lines(x' + k + ', y' + k + (rec.kind === 'step' ? ', type = "s"' : '') + ', col = ' + c + ', lty = ' + rLty(rec) + ', lwd = ' + (rec.width || 1.5) + ')');
        addLeg(rec, 'NA', rLty(rec), false);
        break;
      case 'bars':
        L.push('rect(head(edges' + k + ', -1), 0, tail(edges' + k + ', -1), counts' + k + ', col = adjustcolor(' + c + ', 0.35), border = ' + c + ')');
        addLeg(rec, 'NA', 'NA', true);
        break;
      case 'hline':
        L.push('abline(h = ' + numToken(rec.y, 'NA') + ', col = ' + c + ', lty = ' + rLty(rec) + ', lwd = 1.5)');
        addLeg(rec, 'NA', rLty(rec), false);
        break;
      case 'vline':
        L.push('abline(v = ' + numToken(rec.x, 'NA') + ', col = ' + c + ', lty = ' + rLty(rec) + ', lwd = 1.5)');
        addLeg(rec, 'NA', rLty(rec), false);
        break;
      case 'segments':
        L.push('segments(x0_' + k + ', y0_' + k + ', x1_' + k + ', y1_' + k + ', col = ' + c + ', lty = ' + rLty(rec) + ', lwd = ' + (rec.width || 1.5) + ')');
        addLeg(rec, 'NA', rLty(rec), false);
        break;
      case 'band':
        L.push('polygon(c(x' + k + ', rev(x' + k + ')), c(lo' + k + ', rev(hi' + k + ')), col = adjustcolor(' + c + ', 0.25), border = NA)');
        addLeg(rec, 'NA', 'NA', true);
        break;
      case 'span':
        L.push('rect(' + numToken(rec.x0, 'NA') + ', par("usr")[3], ' + numToken(rec.x1, 'NA') + ', par("usr")[4], col = adjustcolor(' + c + ', 0.15), border = NA)');
        addLeg(rec, 'NA', 'NA', true);
        break;
      case 'rects':
        L.push('rect(x0_' + k + ', y0_' + k + ', x1_' + k + ', y1_' + k + ', col = adjustcolor(' + c + ', 0.25), border = ' + c + ', lwd = 1.5)');
        addLeg(rec, 'NA', 'NA', true);
        break;
      case 'text': {
        const xs = Array.isArray(rec.x) || ArrayBuffer.isView(rec.x) ? rec.x : [rec.x];
        const ys = Array.isArray(rec.y) || ArrayBuffer.isView(rec.y) ? rec.y : [rec.y];
        const ts = Array.isArray(rec.text) ? rec.text : [rec.text];
        const adj = rec.anchor === 'end' ? 1 : rec.anchor === 'middle' ? 0.5 : 0;
        L.push('text(' + rVec(xs) + ', ' + rVec(ys) + ', labels = c(' + Array.from(ts, rStr).join(', ') + '), col = ' + c + ', adj = c(' + adj + ', 0.5), font = 2)');
        break;
      }
      default: break;
    }
  });
  if (leg.labels.length) {
    L.push('legend("topright", legend = c(' + leg.labels.join(', ') + '), col = c(' + leg.col.join(', ') + '),');
    L.push('       pch = c(' + leg.pch.join(', ') + '), lty = c(' + leg.lty.join(', ') + '), lwd = c(' + leg.lwd.join(', ') + '),');
    L.push('       fill = c(' + leg.fill.join(', ') + '), border = NA, bty = "n", pt.bg = "white")');
  }
  L.push('# dev.copy(pdf, ' + rStr(s.name + '.pdf') + '); dev.off()');
  return L.join('\n') + '\n';
}

// ── Python ───────────────────────────────────────────────────────────────

function pyStr(s) { return '"' + plain(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
function pyVec(a) { return 'np.array([' + joinNums(a, 'np.nan', '    ', '') + '])'; }
function pyLs(rec) { return dashOf(rec) === 'dotted' ? ':' : dashOf(rec) === 'dashed' ? '--' : '-'; }
function pyLabel(rec) { return rec.label ? ', label=' + pyStr(rec.label) : ''; }

/**
 * The figure as a Python script using matplotlib.
 * @param {object} spec
 * @returns {string}
 */
export function pythonScript(spec) {
  const s = normalizeSpec(spec);
  const L = [];
  L.push('# ' + plain(s.title || s.name));
  L.push('# Written by the Output Analyzer. The data are embedded below, and so this');
  L.push('# script stands alone; edit the plotting calls to restyle the figure.');
  L.push('');
  L.push('import numpy as np');
  L.push('import matplotlib.pyplot as plt');
  if (s.series.some(r => r.kind === 'rects')) L.push('from matplotlib.patches import Rectangle');
  L.push('');
  L.push('fig, ax = plt.subplots(figsize=(8, 4.5))');
  L.push('ax.grid(True, color="0.85", linewidth=0.8)');
  L.push('ax.set_axisbelow(True)');
  L.push('');
  let legendItems = 0;
  s.series.forEach((rec, i) => {
    const k = i + 1;
    const c = pyStr(hex(rec.color));
    if (rec.label) legendItems++;
    switch (rec.kind) {
      case 'points':
        L.push('x' + k + ' = ' + pyVec(rec.x));
        L.push('y' + k + ' = ' + pyVec(rec.y));
        L.push('ax.plot(x' + k + ', y' + k + ', linestyle="none", marker=' + (rec.marker === 'd' ? '"D"' : '"o"') + ', markersize=5, color=' + c + (rec.hollow ? ', markerfacecolor="white"' : '') + pyLabel(rec) + ')');
        break;
      case 'line':
      case 'step':
        L.push('x' + k + ' = ' + pyVec(rec.x));
        L.push('y' + k + ' = ' + pyVec(rec.y));
        L.push('ax.' + (rec.kind === 'step' ? 'step' : 'plot') + '(x' + k + ', y' + k + (rec.kind === 'step' ? ', where="post"' : '') + ', linestyle="' + pyLs(rec) + '", color=' + c + ', linewidth=' + (rec.width || 1.5) + pyLabel(rec) + ')');
        break;
      case 'bars':
        L.push('edges' + k + ' = ' + pyVec(rec.edges));
        L.push('counts' + k + ' = ' + pyVec(rec.heights));
        L.push('ax.bar(edges' + k + '[:-1], counts' + k + ', width=np.diff(edges' + k + '), align="edge", color=' + c + ', alpha=0.35, edgecolor=' + c + ', linewidth=1' + pyLabel(rec) + ')');
        break;
      case 'hline':
        L.push('ax.axhline(' + numToken(rec.y, 'np.nan') + ', linestyle="' + pyLs(rec) + '", color=' + c + ', linewidth=1.5' + pyLabel(rec) + ')');
        break;
      case 'vline':
        L.push('ax.axvline(' + numToken(rec.x, 'np.nan') + ', linestyle="' + pyLs(rec) + '", color=' + c + ', linewidth=1.5' + pyLabel(rec) + ')');
        break;
      case 'segments':
        L.push('x0_' + k + ' = ' + pyVec(rec.x0));
        L.push('x1_' + k + ' = ' + pyVec(rec.x1));
        L.push('y0_' + k + ' = ' + pyVec(rec.y0));
        L.push('y1_' + k + ' = ' + pyVec(rec.y1));
        L.push('for j in range(len(x0_' + k + ')):');
        L.push('    ax.plot([x0_' + k + '[j], x1_' + k + '[j]], [y0_' + k + '[j], y1_' + k + '[j]], linestyle="' + pyLs(rec) + '", color=' + c + ', linewidth=' + (rec.width || 1.5) + (rec.label ? ', label=' + pyStr(rec.label) + ' if j == 0 else None' : '') + ')');
        break;
      case 'band':
        L.push('x' + k + ' = ' + pyVec(rec.x));
        L.push('lo' + k + ' = ' + pyVec(rec.lo));
        L.push('hi' + k + ' = ' + pyVec(rec.hi));
        L.push('ax.fill_between(x' + k + ', lo' + k + ', hi' + k + ', color=' + c + ', alpha=0.25, linewidth=0' + pyLabel(rec) + ')');
        break;
      case 'span':
        L.push('ax.axvspan(' + numToken(rec.x0, 'np.nan') + ', ' + numToken(rec.x1, 'np.nan') + ', color=' + c + ', alpha=0.15, linewidth=0' + pyLabel(rec) + ')');
        break;
      case 'rects':
        L.push('x0_' + k + ' = ' + pyVec(rec.x0));
        L.push('x1_' + k + ' = ' + pyVec(rec.x1));
        L.push('y0_' + k + ' = ' + pyVec(rec.y0));
        L.push('y1_' + k + ' = ' + pyVec(rec.y1));
        L.push('for j in range(len(x0_' + k + ')):');
        L.push('    ax.add_patch(Rectangle((x0_' + k + '[j], y0_' + k + '[j]), x1_' + k + '[j] - x0_' + k + '[j], y1_' + k + '[j] - y0_' + k + '[j], facecolor=' + c + ', alpha=0.25, edgecolor=' + c + ', linewidth=1.5' + (rec.label ? ', label=' + pyStr(rec.label) + ' if j == 0 else None' : '') + '))');
        break;
      case 'text': {
        const xs = Array.isArray(rec.x) || ArrayBuffer.isView(rec.x) ? rec.x : [rec.x];
        const ys = Array.isArray(rec.y) || ArrayBuffer.isView(rec.y) ? rec.y : [rec.y];
        const ts = Array.isArray(rec.text) ? rec.text : [rec.text];
        const ha = rec.anchor === 'end' ? 'right' : rec.anchor === 'middle' ? 'center' : 'left';
        L.push('for xt, yt, st in zip(' + pyVec(xs) + ', ' + pyVec(ys) + ', [' + Array.from(ts, pyStr).join(', ') + ']):');
        L.push('    ax.text(xt, yt, st, color=' + c + ', ha="' + ha + '", va="center", fontweight="bold")');
        break;
      }
      default: break;
    }
  });
  L.push('');
  if (s.xlim) L.push('ax.set_xlim(' + numToken(s.xlim[0], 'None') + ', ' + numToken(s.xlim[1], 'None') + ')');
  if (s.ylim) L.push('ax.set_ylim(' + numToken(s.ylim[0], 'None') + ', ' + numToken(s.ylim[1], 'None') + ')');
  if (s.xTicks) { L.push('ax.set_xticks(' + pyVec(s.xTicks.at) + ')'); L.push('ax.set_xticklabels([' + s.xTicks.labels.map(pyStr).join(', ') + '])'); }
  if (s.yTicks) { L.push('ax.set_yticks(' + pyVec(s.yTicks.at) + ')'); L.push('ax.set_yticklabels([' + s.yTicks.labels.map(pyStr).join(', ') + '])'); }
  if (s.xLabel) L.push('ax.set_xlabel(' + pyStr(s.xLabel) + ')');
  if (s.yLabel) L.push('ax.set_ylabel(' + pyStr(s.yLabel) + ')');
  if (s.title) L.push('ax.set_title(' + pyStr(s.title) + ')');
  if (legendItems) L.push('ax.legend()');
  L.push('fig.tight_layout()');
  L.push('# fig.savefig(' + pyStr(s.name + '.png') + ', dpi=200)');
  L.push('plt.show()');
  return L.join('\n') + '\n';
}

/** The three writers by file extension. */
export const SCRIPT_WRITERS = {
  m: { label: 'M', name: 'MATLAB', write: matlabScript, mime: 'text/x-matlab' },
  R: { label: 'R', name: 'R', write: rScript, mime: 'text/x-r' },
  py: { label: 'PY', name: 'Python', write: pythonScript, mime: 'text/x-python' }
};

export { sanitizeName };
