// Literal MATLAB code for the figures the "Regenerate these results in"
// scripts draw: one local function per kind of figure the Output Analyzer's
// pages show, plus the helpers they share (common). Core MATLAB graphics only,
// no toolbox, and nothing newer than R2021a. Each helper takes its required
// arguments in order and then one optional struct o of options, read with
// fig_opt, and draws one new figure. Pure text; the script writer chooses
// which snippets to include, and always includes common with any of them.
//
// The snippets are template literals, and so none of them may contain a
// backtick or a dollar sign followed by a brace. In a MATLAB char vector a
// single quote is doubled.

export const FIG_M = {};

// ── common ───────────────────────────────────────────────────────────────

FIG_M.common = `
function c = fig_colors()
% The figure colors as RGB triples: data points and series (est, #2b6cb0),
% intervals and means (truth, #1a1a1a), a flagged interval (miss, #c0392b),
% survivors and highlights (ok, #2e7d32), reference lines and excluded
% stretches (muted, #9e9e9e), and the cut line and letters (accent, #8c1d40).
c = struct('est', [43 108 176] / 255, 'truth', [26 26 26] / 255, ...
           'miss', [192 57 43] / 255, 'ok', [46 125 50] / 255, ...
           'muted', [158 158 158] / 255, 'accent', [140 29 64] / 255);
end

function v = fig_opt(o, name, default)
% The option o.(name), or default when o is missing or empty or lacks it.
if nargin < 1 || isempty(o) || ~isstruct(o) || ~isfield(o, name) || isempty(o.(name))
    v = default;
else
    v = o.(name);
end
end

function fig_size(w, h)
% Sets the current figure to w by h inches.
f = gcf;
f.Units = 'inches';
f.Position(3:4) = [w, h];
end

function r = fig_range(v)
% The smallest and largest finite values of v, widened by 1 on each side
% when they are equal, and [0, 1] when v holds no finite value.
v = v(isfinite(v));
if isempty(v)
    r = [0, 1];
    return;
end
r = [min(v), max(v)];
if r(2) - r(1) <= 1e-10 * max([1, abs(r)])   % a range that is only rounding has no width either
    r = mean(r) + [-1, 1];
end
end

function r = fig_pad(r, frac)
% The range r widened on each side by the fraction frac of its width.
w = r(2) - r(1);
r = [r(1) - frac * w, r(2) + frac * w];
end

function f = fig_flags(v, n)
% A logical column of n flags from v, all false when v is empty.
f = false(n, 1);
if ~isempty(v)
    v = logical(v(:));
    f(1:min(n, numel(v))) = v(1:min(n, numel(v)));
end
end

function s = fig_text_cell(v, n)
% Labels as a cell array of char vectors (numbers become text), or the
% numbers 1 to n when v is empty.
if isempty(v)
    v = 1:n;
end
if isnumeric(v)
    v = arrayfun(@(t) num2str(t), v(:)', 'UniformOutput', false);
end
s = cellstr(v);
end

function fig_labels(ttl, xlab, ylab)
% Writes the title and the axis labels.
c = fig_colors();
title(ttl, 'Interpreter', 'none', 'Color', c.truth);
xlabel(xlab, 'Interpreter', 'none');
ylabel(ylab, 'Interpreter', 'none');
end

function fig_empty(ttl)
% An empty frame with the title and the words "nothing to draw".
c = fig_colors();
axis([0, 1, 0, 1]);
box on;
set(gca, 'XTick', [], 'YTick', []);
title(ttl, 'Interpreter', 'none', 'Color', c.truth);
text(0.5, 0.5, 'nothing to draw', 'HorizontalAlignment', 'center', ...
     'Color', c.muted, 'Interpreter', 'none');
end

function fig_band(x0, x1, color)
% A light shaded band from x0 to x1 over the full height of the axes.
yl = ylim;
patch([x0, x1, x1, x0], [yl(1), yl(1), yl(2), yl(2)], color, ...
      'FaceAlpha', 0.15, 'EdgeColor', 'none');
end

function h = fig_vline(x, color, style, width)
% A vertical line at x over the full height of the axes.
yl = ylim;
h = plot([x, x], yl, 'Color', color, 'LineStyle', style, 'LineWidth', width);
end

function h = fig_hline(y, color, style, width)
% A horizontal line at y over the full width of the axes.
xl = xlim;
h = plot(xl, [y, y], 'Color', color, 'LineStyle', style, 'LineWidth', width);
end

function [px, py] = fig_segments(x0, y0, x1, y1)
% Many line segments joined into one line broken by NaN, for a single plot call.
n = numel(x0);
px = [x0(:)'; x1(:)'; NaN(1, n)];
py = [y0(:)'; y1(:)'; NaN(1, n)];
px = px(:);
py = py(:);
end

function h = fig_steps(x, y, color, style, width)
% A step function holding each y until the next x.
[sx, sy] = stairs(x(:), y(:));
h = plot(sx, sy, 'Color', color, 'LineStyle', style, 'LineWidth', width);
end
`;

// ── strips ───────────────────────────────────────────────────────────────

FIG_M.strips = `
function fig_strips(values, labels, xlab, ttl, o)
% Rows of dots, one row per vector in the cell array values, each with its
% interval from o.lo to o.hi (center o.mid) drawn under the dots, a dashed
% reference line at o.ref, and a solid line at the mean of all the values
% when o.mean_line is true.
if nargin < 5, o = struct(); end
if ~iscell(values), values = {values}; end
c = fig_colors();
nr = numel(values);
labels = fig_text_cell(labels, nr);
mid = fig_opt(o, 'mid', []);
lo = fig_opt(o, 'lo', []);
hi = fig_opt(o, 'hi', []);
ref = fig_opt(o, 'ref', NaN);
mean_line = fig_opt(o, 'mean_line', false);
figure;
fig_size(6.5, 1.2 + 0.8 * nr);
all_values = [];
for i = 1:nr
    v = values{i}(:);
    all_values = [all_values; v(isfinite(v))]; %#ok<AGROW>
end
if isempty(all_values)
    fig_empty(ttl);
    return;
end
hold on;
box on;
xlim(fig_pad(fig_range([all_values; mid(:); lo(:); hi(:); ref]), 0.05));
ylim([0.4, nr + 0.6]);
set(gca, 'YDir', 'reverse', 'YTick', 1:nr, 'YTickLabel', labels, ...
         'TickLabelInterpreter', 'none');
if isfinite(ref)
    fig_vline(ref, c.muted, '--', 1.2);
end
for i = 1:nr
    v = values{i}(:);
    v = v(isfinite(v));
    % Spread the dots up and down a little in a fixed pattern (the
    % golden-ratio sequence), so that equal values do not hide each other.
    k = (1:numel(v))';
    y = i - 0.12 + 0.3 * (mod(k * 0.618034, 1) - 0.5);
    scatter(v, y, 30, c.est, 'filled', 'MarkerFaceAlpha', 0.6);
    % The row's interval sits just below its dots.
    if numel(lo) >= i && numel(hi) >= i && isfinite(lo(i)) && isfinite(hi(i))
        yi = i + 0.28;
        plot([lo(i), hi(i)], [yi, yi], 'Color', c.truth, 'LineWidth', 2);
        plot([lo(i), lo(i)], yi + [-0.08, 0.08], 'Color', c.truth, 'LineWidth', 2);
        plot([hi(i), hi(i)], yi + [-0.08, 0.08], 'Color', c.truth, 'LineWidth', 2);
        if numel(mid) >= i && isfinite(mid(i))
            plot(mid(i), yi, 'o', 'Color', c.truth, 'MarkerFaceColor', c.truth, ...
                 'MarkerSize', 6);
        end
    end
end
if mean_line
    m = mean(all_values);
    fig_vline(m, c.truth, '-', 1.5);
    text(m, 0.4, ' mean', 'Color', c.truth, 'VerticalAlignment', 'top', ...
         'Interpreter', 'none');
end
fig_labels(ttl, xlab, '');
hold off;
end
`;

// ── intervals ────────────────────────────────────────────────────────────

FIG_M.intervals = `
function fig_intervals(mid, lo, hi, labels, xlab, ttl, o)
% A forest plot: one interval per row from lo to hi with a dot at mid, row 1
% at the top. Options: ref (a dashed reference line), flagged, muted, and ok
% (logical per row), right (a cell array of texts printed right of the
% intervals), and brackets (an n-by-2 matrix of rows joined by a bracket).
if nargin < 7, o = struct(); end
c = fig_colors();
mid = mid(:);
lo = lo(:);
hi = hi(:);
n = numel(mid);
labels = fig_text_cell(labels, n);
ref = fig_opt(o, 'ref', NaN);
flagged = fig_flags(fig_opt(o, 'flagged', []), n);
muted = fig_flags(fig_opt(o, 'muted', []), n);
ok = fig_flags(fig_opt(o, 'ok', []), n);
right = fig_opt(o, 'right', {});
if ~iscell(right), right = cellstr(right); end
brackets = fig_opt(o, 'brackets', zeros(0, 2));
figure;
fig_size(6.5, max(1.8, 1.0 + 0.35 * n));
if n == 0
    fig_empty(ttl);
    return;
end
hold on;
box on;
xr = fig_pad(fig_range([mid; lo; hi; ref]), 0.05);
ylim([0.5, n + 0.5]);
set(gca, 'YDir', 'reverse', 'YTick', 1:n, 'YTickLabel', labels, ...
         'TickLabelInterpreter', 'none');
fig_labels(ttl, xlab, '');

% Give each bracket the leftmost column where it overlaps no bracket already
% placed there, taking the shorter spans first.
nb = size(brackets, 1);
column = zeros(nb, 1);
[~, order] = sort(abs(brackets(:, 2) - brackets(:, 1)));
for k = order(:)'
    a = min(brackets(k, :));
    b = max(brackets(k, :));
    j = 1;
    while true
        clash = false;
        for m = find(column == j)'
            if a <= max(brackets(m, :)) && min(brackets(m, :)) <= b
                clash = true;
            end
        end
        if ~clash, break; end
        j = j + 1;
    end
    column(k) = j;
end
ncol = max([0; column]);

% Widen the axes to the right so the texts and the brackets fit: estimate
% the text width from its length in characters, and give each bracket
% column 12 points.
has_right = any(~cellfun(@isempty, right));
ax = gca;
ax.Units = 'points';
width_pt = ax.Position(3);
ax.Units = 'normalized';
text_frac = 0;
if has_right
    nchar = max(cellfun(@numel, right));
    text_frac = max(0.12, (nchar * 0.55 * ax.FontSize + 8) / width_pt);
end
col_frac = 12 / width_pt;
span = (xr(2) - xr(1)) / (1 - text_frac - ncol * col_frac);
xlim(xr);
ticks = get(gca, 'XTick');
xlim([xr(1), xr(1) + span]);
set(gca, 'XTick', ticks);   % no tick labels under the texts and brackets

if isfinite(ref)
    fig_vline(ref, c.muted, '--', 1.2);
end
for i = 1:n
    % Precedence: muted, then flagged, then ok, then the default.
    color = c.truth;
    style = '-';
    face = c.truth;
    if ok(i), color = c.ok; face = c.ok; end
    if flagged(i), color = c.miss; style = '--'; face = 'w'; end
    if muted(i), color = c.muted; style = '--'; face = 'w'; end
    a = lo(i);
    b = hi(i);
    if ~isnan(a) && ~isnan(b)
        % An infinite end runs to the edge of the data area, with no tick.
        plot([max(a, xr(1)), min(b, xr(2))], [i, i], 'Color', color, ...
             'LineStyle', style, 'LineWidth', 2);
        if isfinite(a)
            plot([a, a], i + [-0.18, 0.18], 'Color', color, 'LineWidth', 2);
        end
        if isfinite(b)
            plot([b, b], i + [-0.18, 0.18], 'Color', color, 'LineWidth', 2);
        end
    end
    if isfinite(mid(i))
        plot(mid(i), i, 'o', 'Color', color, 'MarkerFaceColor', face, ...
             'MarkerSize', 6, 'LineWidth', 1.5);
    end
    if numel(right) >= i && ~isempty(right{i})
        tc = c.accent;
        if ok(i), tc = c.ok; end
        if muted(i), tc = c.muted; end
        text(xr(2) + 4 / width_pt * span, i, right{i}, 'Color', tc, ...
             'FontWeight', 'bold', 'Interpreter', 'none');
    end
end
% Each bracket: a vertical line from row i to row j with short ticks
% pointing left at both ends.
for k = 1:nb
    x = xr(2) + (text_frac + (column(k) - 0.4) * col_frac) * span;
    tick = 4 / width_pt * span;
    a = min(brackets(k, :));
    b = max(brackets(k, :));
    plot([x - tick, x, x, x - tick], [a, a, b, b], 'Color', c.truth, 'LineWidth', 0.75);
end
hold off;
end
`;

// ── pairsByRep ───────────────────────────────────────────────────────────

FIG_M.pairsByRep = `
function fig_pairs_by_rep(a, b, ids, o)
% Matched pairs side by side, one column per replication: design A as a
% filled dot, design B as a hollow dot, joined by a dashed line.
% Options: xlab and title.
if nargin < 4, o = struct(); end
c = fig_colors();
a = a(:);
b = b(:);
n = numel(a);
ids = fig_text_cell(ids, n);
ttl = fig_opt(o, 'title', 'Pairs by replication');
figure;
fig_size(6.5, 3.5);
if n == 0
    fig_empty(ttl);
    return;
end
hold on;
box on;
x = (1:n)';
xlim([0.5, n + 0.5]);
ylim(fig_pad(fig_range([a; b]), 0.08));
[px, py] = fig_segments(x, a, x, b);
plot(px, py, 'Color', c.muted, 'LineStyle', '--');
ha = plot(x, a, 'o', 'Color', c.est, 'MarkerFaceColor', c.est, 'MarkerSize', 6);
hb = plot(x, b, 'o', 'Color', c.est, 'MarkerFaceColor', 'w', 'MarkerSize', 6, ...
          'LineWidth', 1.2);
% Label at most about 20 columns.
every = ceil(n / 20);
shown = 1:every:n;
set(gca, 'XTick', shown, 'XTickLabel', ids(shown), 'TickLabelInterpreter', 'none');
legend([ha, hb], {'A', 'B'}, 'Location', 'best', 'Interpreter', 'none');
fig_labels(ttl, fig_opt(o, 'xlab', 'Replication id'), 'Replication outcome');
hold off;
end
`;

// ── pairsSlopes ──────────────────────────────────────────────────────────

FIG_M.pairsSlopes = `
function fig_pairs_slopes(a, b, o)
% Matched pairs as slopes from design A (left) to design B (right): solid
% when a pair differs in the same direction as the mean difference, dashed
% gray otherwise, with each design's mean as a short thick bar.
% Options: label_a, label_b, and title.
if nargin < 3, o = struct(); end
c = fig_colors();
a = a(:);
b = b(:);
ttl = fig_opt(o, 'title', 'Pairs as slopes');
figure;
fig_size(5, 4.5);
both = isfinite(a) & isfinite(b);
if ~any(both)
    fig_empty(ttl);
    return;
end
hold on;
box on;
xlim([0.6, 2.4]);
ylim(fig_pad(fig_range([a; b]), 0.08));
d = a(both) - b(both);
same = sign(d) == sign(mean(d));
a_pair = a(both);
b_pair = b(both);
[px, py] = fig_segments(ones(sum(~same), 1), a_pair(~same), ...
                        2 * ones(sum(~same), 1), b_pair(~same));
plot(px, py, 'Color', c.muted, 'LineStyle', '--');
[px, py] = fig_segments(ones(sum(same), 1), a_pair(same), ...
                        2 * ones(sum(same), 1), b_pair(same));
plot(px, py, 'Color', c.est, 'LineWidth', 1);
ma = mean(a(isfinite(a)));
mb = mean(b(isfinite(b)));
plot([0.9, 1.1], [ma, ma], 'Color', c.truth, 'LineWidth', 4);
plot([1.9, 2.1], [mb, mb], 'Color', c.truth, 'LineWidth', 4);
set(gca, 'XTick', [1, 2], 'TickLabelInterpreter', 'none', 'XTickLabel', ...
    {fig_opt(o, 'label_a', 'A'), fig_opt(o, 'label_b', 'B')});
fig_labels(ttl, 'Design', 'Replication outcome');
hold off;
end
`;

// ── hist ─────────────────────────────────────────────────────────────────

FIG_M.hist = `
function fig_hist(x, edges, xlab, ttl)
% A histogram of x over the bin edges (counts), each bin [e(k), e(k+1))
% except the last, which also holds its right edge.
c = fig_colors();
x = x(isfinite(x));
figure;
fig_size(6.5, 4);
if isempty(x)
    fig_empty(ttl);
    return;
end
if numel(edges) < 2
    r = fig_range(x);
    edges = linspace(r(1), r(2), 11);
end
h = histogram(x, edges, 'FaceColor', c.est, 'EdgeColor', 'w', 'FaceAlpha', 1);
box on;
% Leave a little room above the tallest bar, and label whole counts only.
ylim([0, 1.05 * max(1, max(h.Values))]);
ticks = get(gca, 'YTick');
set(gca, 'YTick', ticks(ticks == round(ticks)));
fig_labels(ttl, xlab, 'Frequency');
end
`;

// ── ecdf ─────────────────────────────────────────────────────────────────

FIG_M.ecdf = `
function fig_ecdf(x, xlab, ttl)
% The empirical cumulative distribution function of x as a step function.
c = fig_colors();
s = sort(x(isfinite(x)));
s = s(:);
n = numel(s);
figure;
fig_size(6.5, 4);
if n == 0
    fig_empty(ttl);
    return;
end
hold on;
box on;
r = fig_range(s);
pad = 0.05 * (r(2) - r(1));
xlim([r(1) - 2 * pad, r(2) + 2 * pad]);
ylim([-0.02, 1.02]);
% The steps start a little left of the smallest value at 0 and end a little
% right of the largest at 1.
fig_steps([s(1) - pad; s; s(n) + pad], [0; (1:n)' / n; 1], c.est, '-', 1.5);
set(gca, 'YTick', 0:0.25:1);
fig_labels(ttl, xlab, 'Cumulative fraction');
hold off;
end
`;

// ── box ──────────────────────────────────────────────────────────────────

FIG_M.box = `
function fig_box(x, xlab, ttl)
% One horizontal box plot of x: the box spans Tukey's hinges (as R's
% fivenum), a thick line marks the median, the whiskers reach the most
% extreme values within 1.5 hinge spreads, outliers are hollow circles, and
% the mean is a hollow diamond.
c = fig_colors();
s = sort(x(isfinite(x)));
s = s(:);
n = numel(s);
figure;
fig_size(6.5, 2.6);
if n == 0
    fig_empty(ttl);
    return;
end
hold on;
box on;
% Tukey's hinges: the medians of the lower and upper halves, each half
% holding the median when n is odd.
depth = [1, floor((n + 3) / 2) / 2, (n + 1) / 2, n + 1 - floor((n + 3) / 2) / 2, n];
five = 0.5 * (s(floor(depth)) + s(ceil(depth)));
q1 = five(2);
med = five(3);
q3 = five(4);
reach = 1.5 * (q3 - q1);
inside = s(s >= q1 - reach & s <= q3 + reach);
w_lo = min(inside);
w_hi = max(inside);
outside = s(s < q1 - reach | s > q3 + reach);
xlim(fig_pad(fig_range(s), 0.05));
ylim([0.4, 1.6]);
plot([w_lo, q1], [1, 1], 'Color', c.est, 'LineWidth', 1.5);
plot([q3, w_hi], [1, 1], 'Color', c.est, 'LineWidth', 1.5);
plot([w_lo, w_lo], [0.88, 1.12], 'Color', c.est, 'LineWidth', 1.5);
plot([w_hi, w_hi], [0.88, 1.12], 'Color', c.est, 'LineWidth', 1.5);
patch([q1, q3, q3, q1], [0.75, 0.75, 1.25, 1.25], c.est, 'FaceAlpha', 0.15, ...
      'EdgeColor', c.est, 'LineWidth', 1.5);
plot([med, med], [0.75, 1.25], 'Color', c.est, 'LineWidth', 3);
plot(outside, ones(size(outside)), 'o', 'Color', c.est, 'MarkerFaceColor', 'w');
plot(mean(s), 1, 'd', 'Color', c.truth, 'MarkerFaceColor', 'w', 'MarkerSize', 9, ...
     'LineWidth', 1.5);
set(gca, 'YTick', []);
fig_labels(ttl, xlab, '');
hold off;
end
`;

// ── qq ───────────────────────────────────────────────────────────────────

FIG_M.qq = `
function fig_qq(x, ylab, ttl, o)
% A normal quantile-quantile plot of x: the sorted values against standard
% normal quantiles at R's plotting positions (ppoints), and a dashed line
% through the first and third quartiles (as R's qqline). Option: xlab.
if nargin < 4, o = struct(); end
c = fig_colors();
s = sort(x(isfinite(x)));
s = s(:);
n = numel(s);
figure;
fig_size(5.5, 4.5);
if n == 0
    fig_empty(ttl);
    return;
end
hold on;
box on;
if n <= 10, a = 3 / 8; else, a = 1 / 2; end
p = ((1:n)' - a) / (n + 1 - 2 * a);
z = -sqrt(2) * erfcinv(2 * p);   % the standard normal quantile, without a toolbox
xlim(fig_pad(fig_range(z), 0.06));
ylim(fig_pad(fig_range(s), 0.06));
% The sample quartiles by linear interpolation (R's type 7).
if n > 1
    q = interp1(0:n - 1, s, (n - 1) * [0.25, 0.75]);
else
    q = [s(1), s(1)];
end
zq = -sqrt(2) * erfcinv(2 * [0.25, 0.75]);
slope = (q(2) - q(1)) / (zq(2) - zq(1));
xl = xlim;
plot(xl, q(1) + slope * (xl - zq(1)), 'Color', c.truth, 'LineStyle', '--', 'LineWidth', 1.2);
plot(z, s, 'o', 'Color', c.est, 'MarkerFaceColor', c.est, 'MarkerSize', 5);
fig_labels(ttl, fig_opt(o, 'xlab', 'Standard normal quantile'), ylab);
hold off;
end
`;

// ── series ───────────────────────────────────────────────────────────────

FIG_M.series = `
function fig_series(x, y, xlab, ylab, ttl, o)
% y against x as dots (o.type = 'points', the default), a line ('line'), or
% a step function holding each y until the next x ('step'). When o.fence is
% finite, everything left of it is gray over a shaded band, and a dashed line
% marks the fence.
if nargin < 6, o = struct(); end
c = fig_colors();
x = x(:);
y = y(:);
n = numel(x);
type = fig_opt(o, 'type', 'points');
fence = fig_opt(o, 'fence', NaN);
figure;
fig_size(6.5, 4);
if ~any(isfinite(x) & isfinite(y))
    fig_empty(ttl);
    return;
end
hold on;
box on;
xlim(fig_pad(fig_range([x; fence]), 0.02));
ylim(fig_pad(fig_range(y), 0.05));
before = false(n, 1);
if isfinite(fence)
    fig_band(min(xlim), fence, c.muted);
    before = x < fence;
end
if strcmp(type, 'points')
    if n > 2000, ms = 5; elseif n > 200, ms = 8; else, ms = 12; end
    plot(x(before), y(before), '.', 'Color', c.muted, 'MarkerSize', ms);
    plot(x(~before), y(~before), '.', 'Color', c.est, 'MarkerSize', ms);
else
    % The gray part runs on to the first point at the fence, so the two
    % parts meet.
    k = find(before, 1, 'last');
    if isempty(k), k = 0; end
    gray = 1:min(k + 1, n);
    blue = min(k + 1, n):n;
    if k == 0, gray = []; blue = 1:n; end
    if strcmp(type, 'step')
        if ~isempty(gray), fig_steps(x(gray), y(gray), c.muted, '-', 1); end
        fig_steps(x(blue), y(blue), c.est, '-', 1);
    else
        plot(x(gray), y(gray), 'Color', c.muted, 'LineWidth', 1);
        plot(x(blue), y(blue), 'Color', c.est, 'LineWidth', 1);
    end
end
if isfinite(fence)
    fig_vline(fence, c.accent, '--', 1.5);
end
fig_labels(ttl, xlab, ylab);
hold off;
end
`;

// ── running ──────────────────────────────────────────────────────────────

FIG_M.running = `
function fig_running(x, y, xlab, ylab, ttl)
% A line of y against x, with a dashed line at the last finite value.
c = fig_colors();
x = x(:);
y = y(:);
figure;
fig_size(6.5, 4);
last = find(isfinite(y), 1, 'last');
if isempty(last)
    fig_empty(ttl);
    return;
end
hold on;
box on;
xlim(fig_pad(fig_range(x), 0.02));
ylim(fig_pad(fig_range(y), 0.05));
plot(x, y, 'Color', c.est, 'LineWidth', 1.5);
h = fig_hline(y(last), c.truth, '--', 1.2);
legend(h, {'final value'}, 'Location', 'best', 'Interpreter', 'none');
fig_labels(ttl, xlab, ylab);
hold off;
end
`;

// ── lag ──────────────────────────────────────────────────────────────────

FIG_M.lag = `
function fig_lag(x, k, xlab, ylab, ttl)
% A lag plot: each value x(i) against the value k steps later, x(i + k), on
% equal axes spanning the whole series, with a dashed identity line.
c = fig_colors();
x = x(:);
n = numel(x);
figure;
fig_size(5, 5);
if n <= k
    fig_empty(ttl);
    return;
end
now_v = x(1:n - k);
later = x(1 + k:n);
keep = isfinite(now_v) & isfinite(later);
if ~any(keep)
    fig_empty(ttl);
    return;
end
hold on;
box on;
r = fig_pad(fig_range(x), 0.05);
xlim(r);
ylim(r);
axis square;
plot(r, r, 'Color', c.muted, 'LineStyle', '--');
plot(now_v(keep), later(keep), 'o', 'Color', c.est, 'MarkerFaceColor', c.est, 'MarkerSize', 4);
fig_labels(ttl, xlab, ylab);
hold off;
end
`;

// ── acf ──────────────────────────────────────────────────────────────────

FIG_M.acf = `
function fig_acf(r, o)
% A correlogram: the autocorrelation r(k) at lag k as a stem at k * o.step,
% with dashed lines at plus and minus o.band and, when o.mark is finite, a
% dashed green line at o.mark labeled o.mark_label. Options: step, band,
% xlab, title, mark, and mark_label.
if nargin < 2, o = struct(); end
c = fig_colors();
r = r(:);
n = numel(r);
step = fig_opt(o, 'step', 1);
band = fig_opt(o, 'band', NaN);
ttl = fig_opt(o, 'title', 'Autocorrelation');
mark = fig_opt(o, 'mark', NaN);
mark_label = fig_opt(o, 'mark_label', '');
figure;
fig_size(6.5, 4);
if ~any(isfinite(r))
    fig_empty(ttl);
    return;
end
hold on;
box on;
lags = (1:n)' * step;
xlim([0, (n + 1) * step]);
yr = fig_pad(fig_range([r; 0; band; -band]), 0.08);
ylim(yr);
fig_hline(0, c.muted, '-', 1);
if isfinite(band)
    fig_hline(band, c.muted, '--', 1);
    fig_hline(-band, c.muted, '--', 1);
end
[px, py] = fig_segments(lags, zeros(n, 1), lags, r);
plot(px, py, 'Color', c.est, 'LineWidth', 1.2);
if n <= 120
    plot(lags, r, 'o', 'Color', c.est, 'MarkerFaceColor', c.est, 'MarkerSize', 4);
end
if isfinite(mark)
    xl = xlim;
    label = [' ', mark_label, ' '];
    if mark > xl(2)
        % A mark beyond the last lag goes at the right edge, and says so.
        mark = xl(2) - 0.006 * (xl(2) - xl(1));
        label = [' ', mark_label, ' (past the axis) '];
    end
    fig_vline(mark, c.ok, '--', 1.5);
    side = 'left';
    if mark > mean(xl), side = 'right'; end
    text(mark, yr(2) - 0.02 * (yr(2) - yr(1)), label, 'Color', c.ok, ...
         'HorizontalAlignment', side, ...
         'VerticalAlignment', 'top', 'Interpreter', 'none');
end
fig_labels(ttl, fig_opt(o, 'xlab', 'Lag'), 'Autocorrelation');
hold off;
end
`;

// ── warmup ───────────────────────────────────────────────────────────────

FIG_M.warmup = `
function fig_warmup(x, ybar, smooth, cumavg, cut, xlab, ylab, ttl, o)
% Welch's warm-up plot: the average across replications (thin gray), its
% moving average (blue), and the cumulative average (dashed), with the
% warm-up period up to cut shaded and the cut marked. When o.end_lo is
% finite, a dotted line marks where the shortest run ends.
if nargin < 9, o = struct(); end
c = fig_colors();
x = x(:);
end_lo = fig_opt(o, 'end_lo', NaN);
figure;
fig_size(6.5, 4.8);
if ~any(isfinite(x) & isfinite(ybar(:)))
    fig_empty(ttl);
    return;
end
hold on;
box on;
xlim(fig_pad(fig_range([x; cut; end_lo]), 0.02));
ylim(fig_pad(fig_range([ybar(:); smooth(:); cumavg(:)]), 0.05));
handles = gobjects(0);
names = {};
if cut > min(x)
    fig_band(min(xlim), cut, c.muted);
end
% NaN entries leave gaps in the lines rather than being joined across.
handles(end + 1) = plot(x, ybar(:), 'Color', c.muted, 'LineWidth', 0.75);
names{end + 1} = 'average across replications';
handles(end + 1) = plot(x, smooth(:), 'Color', c.est, 'LineWidth', 2);
names{end + 1} = 'moving average';
handles(end + 1) = plot(x, cumavg(:), 'Color', c.truth, 'LineStyle', '--', 'LineWidth', 1.2);
names{end + 1} = 'cumulative average';
if cut > min(x)
    handles(end + 1) = fig_vline(cut, c.accent, '--', 1.5);
    names{end + 1} = 'cut';
end
if isfinite(end_lo)
    fig_vline(end_lo, c.muted, ':', 1.5);
    yl = ylim;
    text(end_lo, yl(1) + 0.02 * (yl(2) - yl(1)), 'shortest run ends ', ...
         'Color', c.muted, 'Rotation', 90, ...
         'HorizontalAlignment', 'left', 'VerticalAlignment', 'bottom', 'Interpreter', 'none');
end
% The legend goes below the axes, where it covers none of the lines.
legend(handles, names, 'Location', 'southoutside', 'NumColumns', 2, ...
       'Interpreter', 'none');
fig_labels(ttl, xlab, ylab);
hold off;
end
`;

// ── batches ──────────────────────────────────────────────────────────────

FIG_M.batches = `
function fig_batches(x, y, starts, ends, means, xlab, ylab, ttl, o)
% Batch means: the series y against x (dots, or a step function when o.step
% is true), a dotted line at each batch boundary, and a thick green segment
% at each batch's mean. When o.exclude_to is finite, the series left of it is
% gray over a shaded band; o.joins marks where concatenated replications meet.
if nargin < 9, o = struct(); end
c = fig_colors();
x = x(:);
y = y(:);
starts = starts(:);
ends = ends(:);
means = means(:);
as_step = fig_opt(o, 'step', false);
exclude_to = fig_opt(o, 'exclude_to', NaN);
joins = fig_opt(o, 'joins', []);
figure;
fig_size(6.5, 4);
if ~any(isfinite(x) & isfinite(y))
    fig_empty(ttl);
    return;
end
hold on;
box on;
xlim(fig_pad(fig_range([x; starts; ends; exclude_to]), 0.02));
ylim(fig_pad(fig_range([y; means]), 0.05));
before = false(size(x));
if isfinite(exclude_to)
    fig_band(min(xlim), exclude_to, c.muted);
    before = x < exclude_to;
end
if as_step
    % The gray part runs on to the first point past the cut, so the parts meet.
    k = find(before, 1, 'last');
    if isempty(k)
        fig_steps(x, y, c.est, '-', 1);
    else
        fig_steps(x(1:min(k + 1, end)), y(1:min(k + 1, end)), c.muted, '-', 1);
        if k < numel(x)
            fig_steps(x(k + 1:end), y(k + 1:end), c.est, '-', 1);
        end
    end
else
    if numel(x) > 2000, ms = 5; elseif numel(x) > 200, ms = 8; else, ms = 12; end
    plot(x(before), y(before), '.', 'Color', c.muted, 'MarkerSize', ms);
    plot(x(~before), y(~before), '.', 'Color', c.est, 'MarkerSize', ms);
end
for b = [starts; ends(end:end)]'
    fig_vline(b, c.muted, ':', 1);
end
for j = joins(:)'
    fig_vline(j, c.accent, ':', 1.5);
end
[px, py] = fig_segments(starts, means, ends, means);
plot(px, py, 'Color', c.ok, 'LineWidth', 3);
fig_labels(ttl, xlab, ylab);
hold off;
end
`;
