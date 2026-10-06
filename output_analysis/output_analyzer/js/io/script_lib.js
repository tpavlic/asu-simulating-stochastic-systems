// Literal R, Python, and MATLAB code the "Regenerate these results in" scripts
// are assembled from: the report helper every script carries, and the
// statistical functions each language lacks. Pure text; the writers in
// analysis_scripts.js choose which to include. Each snippet defines the
// functions its key names and nothing else, so that a body emitter can list
// what it needs and get exactly that.
//
// The report line format is the contract with test/analysis_scripts.test.mjs:
//   name: value   (analyzer: value)
// with %.10g for numbers, yes/no for booleans, NaN for a missing number in
// every language, and the string itself otherwise.
//
// The snippets are template literals, and so none of them may contain a
// backtick or a dollar sign followed by a brace. Both R dialects (base and
// tidy) share LIB.R.

export const LIB = { R: {}, py: {}, m: {} };

// ── report ───────────────────────────────────────────────────────────────

LIB.R.report = `
report <- function(name, value, analyzer = NULL) {
  fmt <- function(v) {
    if (length(v) == 0 || (length(v) == 1 && is.na(v))) return("NaN")
    if (is.logical(v)) return(if (isTRUE(v)) "yes" else "no")
    if (is.numeric(v)) return(sprintf("%.10g", as.numeric(v)))
    as.character(v)
  }
  cat(sprintf("%s: %s%s\\n", name, fmt(value),
              if (is.null(analyzer)) "" else sprintf("   (analyzer: %s)", fmt(analyzer))))
}
`;

LIB.py.report = `
def report(name, value, analyzer=None):
    """Prints one result as 'name: value   (analyzer: value)'."""
    def fmt(v):
        if v is None:
            return "NaN"
        if isinstance(v, (bool, np.bool_)):
            return "yes" if v else "no"
        if isinstance(v, (int, float, np.integer, np.floating)):
            v = float(v)
            if np.isnan(v):
                return "NaN"
            if np.isinf(v):
                return "Inf" if v > 0 else "-Inf"
            return f"{v:.10g}"
        return str(v)
    tail = "" if analyzer is None else f"   (analyzer: {fmt(analyzer)})"
    print(f"{name}: {fmt(value)}{tail}")
`;

LIB.m.report = `
function report(name, value, analyzer)
% Prints one result as "name: value   (analyzer: value)".
tail = '';
if nargin >= 3
    tail = sprintf('   (analyzer: %s)', report_fmt(analyzer));
end
fprintf('%s: %s%s\\n', name, report_fmt(value), tail);
end

function s = report_fmt(v)
% One value as a report line prints it: %.10g for a number, yes/no for a
% logical, NaN for a missing number, and the text itself otherwise.
if isempty(v) && ~ischar(v) && ~isstring(v)
    s = 'NaN';
elseif islogical(v)
    s = 'no'; if v, s = 'yes'; end
elseif isnumeric(v)
    s = sprintf('%.10g', v);
else
    s = char(v);
end
end
`;

// ── descriptives: n, mean, sd, se, min, quartiles (R's type 7), max ───────
// One outcome has no spread to estimate: its sd and se are NaN, and each of
// its quartiles is the value itself, identically in all three languages.

LIB.R.descriptives = `
describe <- function(x) {
  n <- length(x)
  s <- if (n > 1) sd(x) else NaN   # one outcome has no spread to estimate
  q <- quantile(x, c(0.25, 0.5, 0.75), type = 7, names = FALSE)
  list(n = n, mean = mean(x), sd = s, se = s / sqrt(n),
       min = min(x), q1 = q[1], median = q[2], q3 = q[3], max = max(x))
}
`;

LIB.py.descriptives = `
def describe(x):
    """n, mean, sd (n - 1), se, min, quartiles by linear interpolation (R's type 7), max."""
    x = np.asarray(x, float)
    q1, med, q3 = np.quantile(x, [0.25, 0.5, 0.75])   # numpy's default is R's type 7
    sd = x.std(ddof=1) if len(x) > 1 else float("nan")   # one outcome has no spread to estimate
    return dict(n=len(x), mean=x.mean(), sd=sd, se=sd / np.sqrt(len(x)), min=x.min(),
                q1=q1, median=med, q3=q3, max=x.max())
`;

LIB.m.descriptives = `
function d = describe(x)
% n, mean, sd (n - 1), se, min, quartiles by linear interpolation (R's type 7), max.
x = x(:); n = numel(x); s = sort(x);
if n > 1
    sd = std(x);
    q = @(p) interp1(0:n-1, s, (n - 1) * p);   % R's type 7: h = (n - 1) p
else
    sd = NaN;   % one outcome has no spread to estimate
    q = @(p) s(1);
end
d = struct('n', n, 'mean', mean(x), 'sd', sd, 'se', sd / sqrt(n), 'min', s(1), ...
           'q1', q(0.25), 'median', q(0.5), 'q3', q(0.75), 'max', s(n));
end
`;

// ── t interval on a mean ─────────────────────────────────────────────────
// Outcomes that are all equal have no spread: the interval is the mean
// itself, as the analyzer reports it, and t.test (which stops on constant
// data) is not called.

LIB.R.tInterval = `
t_interval <- function(x, level) {
  n <- length(x); df <- n - 1; tq <- qt(1 - (1 - level) / 2, df)
  if (sd(x) == 0) return(list(df = df, t = tq, hw = 0, lo = mean(x), hi = mean(x)))
  tt <- t.test(x, conf.level = level)
  list(df = unname(tt$parameter), t = tq, hw = unname(diff(tt$conf.int)) / 2,
       lo = tt$conf.int[1], hi = tt$conf.int[2])
}
`;
LIB.py.tInterval = `
def t_interval(x, level):
    """mean +/- t * s / sqrt(n), as scipy's t.interval."""
    x = np.asarray(x, float); n = len(x); df = n - 1
    tq = stats.t.ppf(1 - (1 - level) / 2, df)
    se = x.std(ddof=1) / np.sqrt(n)
    if se == 0:
        return dict(df=df, t=tq, hw=0.0, lo=x.mean(), hi=x.mean())
    lo, hi = stats.t.interval(level, df, loc=x.mean(), scale=se)
    return dict(df=df, t=tq, hw=(hi - lo) / 2, lo=lo, hi=hi)
`;
LIB.m.tInterval = `
function r = t_interval(x, level)
% mean +/- t * s / sqrt(n), as ttest's confidence interval.
x = x(:); df = numel(x) - 1; tq = tinv(1 - (1 - level) / 2, df);
if std(x) == 0
    r = struct('df', df, 't', tq, 'hw', 0, 'lo', mean(x), 'hi', mean(x)); return;
end
[~, ~, ci, st] = ttest(x, 0, 'Alpha', 1 - level);
r = struct('df', st.df, 't', tq, 'hw', (ci(2) - ci(1)) / 2, 'lo', ci(1), 'hi', ci(2));
end
`;

// ── Wilcoxon signed-rank with the Hodges-Lehmann estimate and interval ───
// The exact distribution is used below 50 values when none is tied and none
// equals mu, and otherwise the normal approximation with continuity and tie
// corrections, as the analyzer does. R is told which through wilcox.test's
// exact argument, because R 4.4 and later would otherwise use an exact
// distribution under ties too. Python and MATLAB carry the procedure in full,
// since neither ships the interval.

LIB.R.signedRank = `
signed_rank <- function(x, level, mu = 0) {
  n <- length(x); a <- 1 - level; d <- x - mu
  exact <- n < 50 && all(d != 0) && !any(duplicated(abs(d)))
  wt <- suppressWarnings(wilcox.test(x, mu = mu, conf.int = TRUE, conf.level = level,
                                     exact = exact, correct = TRUE))
  # The pseudo-median is the median of the Walsh averages, the Hodges-Lehmann
  # estimate. Under the normal approximation, wilcox.test reports instead a root of
  # its score equation, which can differ from the median in the third decimal, and so
  # the median is computed here.
  w <- outer(x, x, "+") / 2
  est <- median(w[upper.tri(w, diag = TRUE)])
  achieved <- NaN
  if (exact) {
    # The level the exact interval achieves, as wilcox.test forms it (older versions
    # of R do not attach it to the interval).
    qu <- qsignrank(a / 2, n)
    if (psignrank(qu, n) <= a / 2 + 10 * .Machine$double.eps) qu <- qu + 1
    achieved <- if (qu == 0) 1 else 1 - 2 * psignrank(qu - 1, n)
  }
  lo <- wt$conf.int[1]; hi <- wt$conf.int[2]
  # Outcomes that are all equal leave the inverted test nothing to search, and
  # wilcox.test returns no interval; the analyzer reports the common value as both ends.
  if (n > 0 && min(x) == max(x)) { lo <- x[1]; hi <- x[1] }
  list(V = unname(wt$statistic), p = wt$p.value, exact = exact, estimate = est,
       lo = lo, hi = hi, achieved = achieved)
}
`;
LIB.py.signedRank = `
def _signrank_cdf(n):
    """P(V <= v) for v = 0..n(n+1)/2: counts of subsets of 1..n by their sum, over 2^n."""
    c = np.zeros(n * (n + 1) // 2 + 1); c[0] = 1.0
    for k in range(1, n + 1):
        c[k:] = c[k:] + c[:-k]
    return np.cumsum(c) / 2.0 ** n

def _midranks(a):
    """Average ranks and the sizes of the tied groups."""
    a = np.asarray(a, float)
    _, counts = np.unique(a, return_counts=True)
    return stats.rankdata(a), counts[counts > 1].astype(float)

def _bisect(f, lo, hi, tol):
    """Root of a monotone step function by bisection to tol, in place of R's uniroot."""
    flo, fhi = f(lo), f(hi)
    if flo == 0: return lo
    if fhi == 0: return hi
    if flo * fhi > 0: return np.nan
    for _ in range(200):
        if hi - lo <= tol: break
        mid = (lo + hi) / 2; fm = f(mid)
        if fm == 0: return mid
        if fm * flo < 0: hi = mid
        else: lo, flo = mid, fm
    return (lo + hi) / 2

def _sr_z(x, dd, zq):
    """The corrected standardized signed-rank statistic of x - dd, less zq."""
    dx = x - dd; dx = dx[dx != 0]; mm = len(dx)
    rr, tt = _midranks(np.abs(dx)); Vd = rr[dx > 0].sum()
    mean = mm * (mm + 1) / 4; tie = float(np.sum(tt ** 3 - tt))
    sigma = np.sqrt(mm * (mm + 1) * (2 * mm + 1) / 24 - tie / 48)
    if sigma == 0: return np.nan   # every difference is zero: no statistic to form
    corr = 0.0 if zq == 0 else np.sign(Vd - mean) * 0.5
    return (Vd - mean - corr) / sigma - zq

def signed_rank(x, level, mu=0.0):
    """Wilcoxon signed-rank test with the Hodges-Lehmann estimate (the median of the Walsh
    averages) and its interval, as R's wilcox.test(x, conf.int=True)."""
    x = np.asarray(x, float); n = len(x); alpha = 1 - level
    d = x - mu; d = d[d != 0]; m = len(d); zeros = n - m
    r, ties = _midranks(np.abs(d))
    V = float(r[d > 0].sum())
    exact = bool(m < 50 and len(ties) == 0 and zeros == 0)
    if m == 0:
        p = np.nan
    elif exact:
        cdf = _signrank_cdf(m)
        p = 1 - cdf[int(V) - 1] if V > m * (m + 1) / 4 else cdf[int(V)]
        p = min(1.0, 2 * p)
    else:
        mean = m * (m + 1) / 4; tie = float(np.sum(ties ** 3 - ties))
        sigma = np.sqrt(m * (m + 1) * (2 * m + 1) / 24 - tie / 48)
        z = (V - mean - np.sign(V - mean) * 0.5) / sigma
        p = 2 * min(stats.norm.cdf(z), stats.norm.sf(z))
    i, j = np.triu_indices(n)
    w = np.sort((x[i] + x[j]) / 2)   # the Walsh averages, each value paired with itself as well
    est = float(np.median(w)) if n else np.nan
    lo = hi = ach = np.nan
    if n and exact:
        # The order statistics of the Walsh averages, stepping the quantile up
        # when it sits exactly on the tail probability, as wilcox.test does.
        cdf = _signrank_cdf(n)
        qu = int(np.searchsorted(cdf, alpha / 2 * (1 - 1e-12)))
        if cdf[qu] <= alpha / 2 + 10 * np.finfo(float).eps: qu += 1
        if qu == 0:
            lo, hi, ach = -np.inf, np.inf, 0.0
        else:
            ql = n * (n + 1) // 2 - qu
            ach = 2 * cdf[qu - 1]; lo = w[qu - 1]; hi = w[ql]
    elif n >= 2 and x.min() == x.max():
        # Outcomes that are all equal: the interval is the common value at both ends.
        lo = hi = float(x[0]); ach = alpha
    elif n >= 2:
        # The approximate test inverted: the shifts at which the statistic meets +/-z.
        zq = stats.norm.ppf(1 - alpha / 2)
        lo = _bisect(lambda dd: _sr_z(x, dd, zq), x.min(), x.max(), 1e-4)
        hi = _bisect(lambda dd: _sr_z(x, dd, -zq), x.min(), x.max(), 1e-4)
        ach = alpha
    return dict(n=n, V=V, p=p, exact=exact, estimate=est, lo=lo, hi=hi, zeros=zeros,
                achieved=(1 - ach) if np.isfinite(ach) else np.nan)
`;
LIB.m.signedRank = `
function cdf = signrank_cdf(n)
% P(V <= v) for v = 0..n(n+1)/2: counts of subsets of 1..n by their sum, over 2^n.
c = zeros(1, n * (n + 1) / 2 + 1); c(1) = 1;
for k = 1:n
    c(k+1:end) = c(k+1:end) + c(1:end-k);
end
cdf = cumsum(c) / 2^n;
end

function [r, ties] = midranks(a)
% Average ranks and the sizes of the tied groups.
r = tiedrank(a(:));
[~, ~, grp] = unique(a(:));
counts = accumarray(grp, 1);
ties = counts(counts > 1);
end

function x = bisect_root(f, lo, hi, tol)
% Root of a monotone step function by bisection to tol, in place of R's uniroot.
flo = f(lo); fhi = f(hi);
if flo == 0, x = lo; return; end
if fhi == 0, x = hi; return; end
if flo * fhi > 0, x = NaN; return; end
for it = 1:200
    if hi - lo <= tol, break; end
    mid = (lo + hi) / 2; fm = f(mid);
    if fm == 0, x = mid; return; end
    if fm * flo < 0, hi = mid; else, lo = mid; flo = fm; end
end
x = (lo + hi) / 2;
end

function s = sr_z(x, dd, zq)
% The corrected standardized signed-rank statistic of x - dd, less zq.
dx = x - dd; dx = dx(dx ~= 0); mm = numel(dx);
[rr, tt] = midranks(abs(dx)); Vd = sum(rr(dx > 0));
mn = mm * (mm + 1) / 4; tie = sum(tt.^3 - tt);
sigma = sqrt(mm * (mm + 1) * (2 * mm + 1) / 24 - tie / 48);
if sigma == 0, s = NaN; return; end   % every difference is zero: no statistic to form
if zq == 0, corr = 0; else, corr = sign(Vd - mn) * 0.5; end
s = (Vd - mn - corr) / sigma - zq;
end

function r = signed_rank(x, level, mu)
% Wilcoxon signed-rank test with the Hodges-Lehmann estimate (the median of the Walsh
% averages) and its interval, as R's wilcox.test(x, conf.int = TRUE). MATLAB's signrank
% gives the p-value only, and it switches to its normal approximation at a different n.
if nargin < 3, mu = 0; end
x = x(:)'; n = numel(x); alpha = 1 - level;
d = x - mu; d = d(d ~= 0); m = numel(d); zeros_ = n - m;
[rk, ties] = midranks(abs(d));
V = sum(rk(d > 0));
exact = m < 50 && isempty(ties) && zeros_ == 0;
if m == 0
    p = NaN;
elseif exact
    cdf = signrank_cdf(m);
    if V > m * (m + 1) / 4, p = 1 - cdf(V); else, p = cdf(V + 1); end
    p = min(1, 2 * p);
else
    mn = m * (m + 1) / 4; tie = sum(ties.^3 - ties);
    sigma = sqrt(m * (m + 1) * (2 * m + 1) / 24 - tie / 48);
    z = (V - mn - sign(V - mn) * 0.5) / sigma;
    p = 2 * min(normcdf(z), normcdf(-z));
end
[I, J] = find(triu(true(n)));
w = sort((x(I) + x(J)) / 2);
est = median(w); lo = NaN; hi = NaN; ach = NaN;
if n > 0 && exact
    % The order statistics of the Walsh averages, stepping the quantile up when it
    % sits exactly on the tail probability, as wilcox.test does.
    cdf = signrank_cdf(n);
    qu = find(cdf >= alpha / 2 * (1 - 1e-12), 1) - 1;
    if cdf(qu + 1) <= alpha / 2 + 10 * eps, qu = qu + 1; end
    if qu == 0
        lo = -Inf; hi = Inf; ach = 0;
    else
        ql = n * (n + 1) / 2 - qu;
        ach = 2 * cdf(qu); lo = w(qu); hi = w(ql + 1);
    end
elseif n >= 2 && min(x) == max(x)
    % Outcomes that are all equal: the interval is the common value at both ends.
    lo = x(1); hi = x(1); ach = alpha;
elseif n >= 2
    % The approximate test inverted: the shifts at which the statistic meets +/-z.
    zq = norminv(1 - alpha / 2);
    lo = bisect_root(@(dd) sr_z(x, dd, zq), min(x), max(x), 1e-4);
    hi = bisect_root(@(dd) sr_z(x, dd, -zq), min(x), max(x), 1e-4);
    ach = alpha;
end
if isfinite(ach), ach = 1 - ach; end
r = struct('n', n, 'V', V, 'p', p, 'exact', exact, 'estimate', est, 'lo', lo, 'hi', hi, 'zeros', zeros_, 'achieved', ach);
end
`;

// ── Chi-square interval on a variance ────────────────────────────────────

LIB.R.varianceInterval = `
variance_interval <- function(x, level) {
  n <- length(x); df <- n - 1; s2 <- var(x); a <- 1 - level
  q <- qchisq(c(a / 2, 1 - a / 2), df)   # chi-square quantiles at alpha/2 and 1 - alpha/2
  list(s2 = s2, chiLo = q[1], chiHi = q[2], lo2 = df * s2 / q[2], hi2 = df * s2 / q[1],
       loS = sqrt(df * s2 / q[2]), hiS = sqrt(df * s2 / q[1]))
}
`;
LIB.py.varianceInterval = `
def variance_interval(x, level):
    """[(n-1) s^2 / chi2_{1-a/2}, (n-1) s^2 / chi2_{a/2}] on n - 1 degrees of freedom."""
    x = np.asarray(x, float); df = len(x) - 1; s2 = x.var(ddof=1); a = 1 - level
    qlo, qhi = stats.chi2.ppf([a / 2, 1 - a / 2], df)
    return dict(s2=s2, chiLo=qlo, chiHi=qhi, lo2=df * s2 / qhi, hi2=df * s2 / qlo,
                loS=np.sqrt(df * s2 / qhi), hiS=np.sqrt(df * s2 / qlo))
`;
LIB.m.varianceInterval = `
function r = variance_interval(x, level)
% [(n-1) s^2 / chi2_{1-a/2}, (n-1) s^2 / chi2_{a/2}] on n - 1 degrees of freedom (vartest gives the same).
x = x(:); df = numel(x) - 1; s2 = var(x); a = 1 - level;
qlo = chi2inv(a / 2, df); qhi = chi2inv(1 - a / 2, df);
r = struct('s2', s2, 'chiLo', qlo, 'chiHi', qhi, 'lo2', df * s2 / qhi, 'hi2', df * s2 / qlo, ...
           'loS', sqrt(df * s2 / qhi), 'hiS', sqrt(df * s2 / qlo));
end
`;

// ── Shapiro-Wilk ─────────────────────────────────────────────────────────
// R and SciPy ship it. MATLAB's Statistics and Machine Learning Toolbox has
// swtest from R2026b, taking the level as a name-value argument; earlier
// releases have none, and the File Exchange function of the same name takes
// it as a second argument. Both return [h, p, W], and the script runs the
// check only when one of them is on the path.

LIB.R.shapiro = `
shapiro_check <- function(name, x, analyzerW = NULL, analyzerP = NULL) {
  if (length(x) < 3 || length(x) > 5000 || min(x) == max(x)) {
    cat(sprintf("%s: too few values, too many, or no spread to test\\n", name)); return(invisible())
  }
  sw <- shapiro.test(x)
  report(paste(name, "W"), unname(sw$statistic), analyzerW)
  report(paste(name, "p"), sw$p.value, analyzerP)
}
`;
LIB.py.shapiro = `
def shapiro_check(name, x, analyzer_w=None, analyzer_p=None):
    x = np.asarray(x, float)
    if len(x) < 3 or len(x) > 5000 or x.min() == x.max():
        print(f"{name}: too few values, too many, or no spread to test"); return
    W, p = stats.shapiro(x)
    report(f"{name} W", W, analyzer_w)
    report(f"{name} p", p, analyzer_p)
`;
LIB.m.shapiro = `
function shapiro_check(name, x, alpha, analyzerW, analyzerP)
% The Shapiro-Wilk test, if a swtest function is on the path: the toolbox's own
% from R2026b, or the File Exchange function of that name in earlier releases.
x = x(:);
if numel(x) < 3 || numel(x) > 5000 || min(x) == max(x)
    fprintf('%s: too few values, too many, or no spread to test\\n', name); return;
end
if exist('swtest', 'file') == 2
    try
        [~, p, W] = swtest(x, 'Alpha', alpha);   % the toolbox's swtest
    catch
        [~, p, W] = swtest(x, alpha);            % the File Exchange swtest
    end
    if nargin < 4, report([name ' W'], W); else, report([name ' W'], W, analyzerW); end
    if nargin < 5, report([name ' p'], p); else, report([name ' p'], p, analyzerP); end
else
    fprintf('%s: no Shapiro-Wilk function on the path (swtest, in the toolbox from R2026b, would run here)\\n', name);
end
end
`;

// ── Replication planning: half-width and power searches ──────────────────
// The smallest n >= 2 that meets a target, searched upward from the normal
// approximation and then back down, which is valid because the half-width
// falls and the power rises with n. A search past its cap (ten million
// replications, or 10^15 for a half-width on one mean, as the analyzer
// allows) has no answer, which the scripts print as NaN.

LIB.R.planning = `
smallest_n <- function(ok, start, cap = 1e7) {
  n <- max(2, ceiling(start))
  if (!isTRUE(n <= cap)) return(NaN)
  while (n <= cap && !ok(n)) n <- n + 1
  if (n > cap) return(NaN)
  while (n > 2 && ok(n - 1)) n <- n - 1
  n
}
hw_t <- function(n, sd, level) qt(1 - (1 - level) / 2, n - 1) * sd / sqrt(n)
plan_half_width <- function(sd, level, h) {
  if (!isTRUE(h > 0) || !is.finite(h) || !is.finite(sd) || sd < 0) return(list(n = NaN, hwAtN = NaN))
  n <- smallest_n(function(n) hw_t(n, sd, level) <= h, (qnorm(1 - (1 - level) / 2) * sd / h)^2, 1e15)
  list(n = n, hwAtN = if (is.na(n)) NaN else hw_t(n, sd, level))
}
power_t1 <- function(n, sd, delta, alpha) {
  # Two-sided power of the one-sample t test, both tails counted (power.t.test(strict = TRUE)).
  q <- qt(1 - alpha / 2, n - 1); ncp <- delta * sqrt(n) / sd
  pt(q, n - 1, ncp, lower.tail = FALSE) + pt(-q, n - 1, ncp)
}
plan_power_t1 <- function(sd, delta, alpha, power) {
  if (!is.finite(delta) || delta == 0 || !is.finite(sd) || sd <= 0 || !isTRUE(power > 0 && power < 1) ||
      !isTRUE(alpha > 0 && alpha < 1)) return(list(n = NaN, powerAtN = NaN))
  n <- smallest_n(function(n) power_t1(n, sd, delta, alpha) >= power,
                  ((qnorm(1 - alpha / 2) + qnorm(power)) * sd / delta)^2)
  list(n = n, powerAtN = if (is.na(n)) NaN else power_t1(n, sd, delta, alpha))
}
`;
LIB.py.planning = `
def smallest_n(ok, start, cap=1e7):
    """The smallest n >= 2 at which ok(n) holds, or nan past the cap."""
    if not np.isfinite(start) or max(2, np.ceil(start)) > cap: return np.nan
    n = max(2, int(np.ceil(start)))
    while n <= cap and not ok(n): n += 1
    if n > cap: return np.nan
    while n > 2 and ok(n - 1): n -= 1
    return n

def hw_t(n, sd, level):
    return stats.t.ppf(1 - (1 - level) / 2, n - 1) * sd / np.sqrt(n)

def plan_half_width(sd, level, h):
    if not (h > 0) or not np.isfinite(h) or not np.isfinite(sd) or sd < 0: return dict(n=np.nan, hwAtN=np.nan)
    n = smallest_n(lambda n: hw_t(n, sd, level) <= h, (stats.norm.ppf(1 - (1 - level) / 2) * sd / h) ** 2, 1e15)
    return dict(n=n, hwAtN=np.nan if np.isnan(n) else hw_t(n, sd, level))

def power_t1(n, sd, delta, alpha):
    """Two-sided power of the one-sample t test, both tails counted."""
    q = stats.t.ppf(1 - alpha / 2, n - 1); ncp = delta * np.sqrt(n) / sd
    return stats.nct.sf(q, n - 1, ncp) + stats.nct.cdf(-q, n - 1, ncp)

def plan_power_t1(sd, delta, alpha, power):
    if (not np.isfinite(delta) or delta == 0 or not np.isfinite(sd) or not sd > 0
            or not 0 < power < 1 or not 0 < alpha < 1):
        return dict(n=np.nan, powerAtN=np.nan)
    n = smallest_n(lambda n: power_t1(n, sd, delta, alpha) >= power,
                   ((stats.norm.ppf(1 - alpha / 2) + stats.norm.ppf(power)) * sd / delta) ** 2)
    return dict(n=n, powerAtN=np.nan if np.isnan(n) else power_t1(n, sd, delta, alpha))
`;
LIB.m.planning = `
function n = smallest_n(ok, start, cap)
% The smallest n >= 2 at which ok(n) holds, or NaN past the cap.
if nargin < 3, cap = 1e7; end
n = max(2, ceil(start));
if ~(n <= cap), n = NaN; return; end
while n <= cap && ~ok(n), n = n + 1; end
if n > cap, n = NaN; return; end
while n > 2 && ok(n - 1), n = n - 1; end
end

function h = hw_t(n, sd, level)
h = tinv(1 - (1 - level) / 2, n - 1) * sd / sqrt(n);
end

function r = plan_half_width(sd, level, h)
r = struct('n', NaN, 'hwAtN', NaN);
if ~(h > 0) || ~isfinite(h) || ~isfinite(sd) || sd < 0, return; end
n = smallest_n(@(n) hw_t(n, sd, level) <= h, (norminv(1 - (1 - level) / 2) * sd / h)^2, 1e15);
if ~isnan(n), r = struct('n', n, 'hwAtN', hw_t(n, sd, level)); end
end

function p = power_t1(n, sd, delta, alpha)
% Two-sided power of the one-sample t test, both tails counted (sampsizepwr('t', ...) agrees).
q = tinv(1 - alpha / 2, n - 1); ncp = delta * sqrt(n) / sd;
p = 1 - nctcdf(q, n - 1, ncp) + nctcdf(-q, n - 1, ncp);
end

function r = plan_power_t1(sd, delta, alpha, power)
r = struct('n', NaN, 'powerAtN', NaN);
if ~isfinite(delta) || delta == 0 || ~isfinite(sd) || ~(sd > 0) || ~(power > 0 && power < 1) || ~(alpha > 0 && alpha < 1), return; end
n = smallest_n(@(n) power_t1(n, sd, delta, alpha) >= power, ((norminv(1 - alpha / 2) + norminv(power)) * sd / delta)^2);
if ~isnan(n), r = struct('n', n, 'powerAtN', power_t1(n, sd, delta, alpha)); end
end
`;
