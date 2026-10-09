// Literal R, Python, and MATLAB code the "Regenerate these results in" scripts
// are assembled from: the report helper every script carries, and the
// statistical functions each language lacks. Pure text; the writers in
// analysis_scripts.js choose which to include. Each snippet defines the
// functions its key names and nothing else, so that a body emitter can list
// what it needs and get exactly that.
//
// Every result goes through one report helper. By default it prints the
// result under its section's heading as an aligned name and value, and
// remembers whether the value agrees with the analyzer's, which
// report_summary() then sums up in one line. With check_details set (as
// test/analysis_scripts.test.mjs sets it), it prints the contract instead:
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
# report() prints one result and checks it against the value the Output
# Analyzer's page showed (analyzer), within a relative tolerance tol.
report_state <- new.env()
report_start <- function(details) {
  report_state$details <- isTRUE(details)
  report_state$n <- 0
  report_state$bad <- character(0)
}
report_fmt <- function(v, digits = 10) {
  if (length(v) == 0 || (length(v) == 1 && is.na(v))) return("NaN")
  if (is.logical(v)) return(if (isTRUE(v)) "yes" else "no")
  if (is.numeric(v)) return(sprintf(paste0("%.", digits, "g"), as.numeric(v)))
  as.character(v)
}
report_agrees <- function(v, a, tol) {
  if (length(v) == 0) v <- NaN
  if (length(v) != 1) return(FALSE)
  if (is.logical(v) || is.logical(a)) return(isTRUE(as.logical(v) == as.logical(a)))
  if (is.character(v) || is.character(a)) return(identical(as.character(v), as.character(a)))
  v <- as.numeric(v); a <- as.numeric(a)
  if (is.na(v) || is.na(a)) return(is.na(v) && is.na(a))
  if (is.infinite(v) || is.infinite(a)) return(v == a)
  abs(v - a) <= tol * max(1, abs(a))
}
report <- function(name, value, analyzer = NULL, tol = 1e-6) {
  if (report_state$details) {
    cat(sprintf("%s: %s%s\\n", name, report_fmt(value),
                if (is.null(analyzer)) "" else sprintf("   (analyzer: %s)", report_fmt(analyzer))))
  } else {
    cat(sprintf("  %-36s %s\\n", name, report_fmt(value, 7)))
  }
  if (is.null(analyzer)) return(invisible(NULL))
  report_state$n <- report_state$n + 1
  if (!report_agrees(value, analyzer, tol)) {
    report_state$bad <- c(report_state$bad,
      sprintf("%s: %s here, %s on the page", name, report_fmt(value), report_fmt(analyzer)))
  }
  invisible(NULL)
}
report_section <- function(title, tag = NULL) {
  # The section's heading, and under it any tag saying why the section is there.
  if (report_state$details) return(invisible(NULL))
  cat("\\n", title, "\\n", sep = "")
  if (!is.null(tag)) cat(tag, "\\n", sep = "")
  cat(strrep("-", max(nchar(title), nchar(tag))), "\\n", sep = "")
}
report_summary <- function() {
  n <- report_state$n; bad <- report_state$bad
  if (n == 0) return(invisible(NULL))
  if (length(bad) == 0) {
    cat(sprintf("\\nAll %d results agree with the values on the Output Analyzer's page.\\n", n))
  } else {
    cat(sprintf("\\n%d of %d results differ from the values on the Output Analyzer's page:\\n", length(bad), n))
    cat(paste0("  ", bad, "\\n"), sep = "")
  }
  invisible(NULL)
}
`;

LIB.py.report = `
# report() prints one result and checks it against the value the Output
# Analyzer's page showed (analyzer), within a relative tolerance tol.
_report = {"details": False, "n": 0, "bad": []}


def report_start(details):
    _report.update(details=bool(details), n=0, bad=[])


def report_fmt(v, digits=10):
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
        return f"{v:.{digits}g}"
    return str(v)


def report_agrees(v, a, tol):
    if isinstance(v, (bool, np.bool_)) or isinstance(a, (bool, np.bool_)):
        return bool(v) == bool(a)
    if isinstance(v, str) or isinstance(a, str):
        return str(v) == str(a)
    v = np.nan if v is None else float(v)
    a = float(a)
    if np.isnan(v) or np.isnan(a):
        return bool(np.isnan(v) and np.isnan(a))
    if np.isinf(v) or np.isinf(a):
        return v == a
    return abs(v - a) <= tol * max(1.0, abs(a))


def report(name, value, analyzer=None, tol=1e-6):
    if _report["details"]:
        tail = "" if analyzer is None else f"   (analyzer: {report_fmt(analyzer)})"
        print(f"{name}: {report_fmt(value)}{tail}")
    else:
        print(f"  {name:<36} {report_fmt(value, 7)}")
    if analyzer is None:
        return
    _report["n"] += 1
    if not report_agrees(value, analyzer, tol):
        _report["bad"].append(f"{name}: {report_fmt(value)} here, {report_fmt(analyzer)} on the page")


def report_section(title, tag=None):
    # The section's heading, and under it any tag saying why the section is there.
    if _report["details"]:
        return
    print("\\n" + title)
    if tag:
        print(tag)
    print("-" * max(len(title), len(tag or "")))


def report_summary():
    n, bad = _report["n"], _report["bad"]
    if n == 0:
        return
    if not bad:
        print(f"\\nAll {n} results agree with the values on the Output Analyzer's page.")
    else:
        print(f"\\n{len(bad)} of {n} results differ from the values on the Output Analyzer's page:")
        for line in bad:
            print("  " + line)
`;

LIB.m.report = `
function report_start(details)
% Starts the record of results checked against the Output Analyzer's page.
report_store('start', details);
end

function report(name, value, analyzer, tol)
% Prints one result and checks it against the value the Output Analyzer's
% page showed (analyzer), within a relative tolerance tol (1e-6 unless given).
if nargin < 4, tol = 1e-6; end
has = nargin >= 3 && ~(isnumeric(analyzer) && isempty(analyzer));
if report_store('details')
    tail = '';
    if has, tail = sprintf('   (analyzer: %s)', report_fmt(analyzer, 10)); end
    fprintf('%s: %s%s\\n', name, report_fmt(value, 10), tail);
else
    fprintf('  %-36s %s\\n', name, report_fmt(value, 7));
end
if has
    report_store('add', report_agrees(value, analyzer, tol), ...
        sprintf('%s: %s here, %s on the page', name, report_fmt(value, 10), report_fmt(analyzer, 10)));
end
end

function report_section(title, tag)
% The section's heading, and under it any tag saying why the section is there.
if report_store('details'), return; end
if nargin < 2, tag = ''; end
fprintf('\\n%s\\n', title);
if ~isempty(tag), fprintf('%s\\n', tag); end
fprintf('%s\\n', repmat('-', 1, max(numel(title), numel(tag))));
end

function report_summary()
[n, bad] = report_store('get');
if n == 0, return; end
if isempty(bad)
    fprintf('\\nAll %d results agree with the values on the Output Analyzer''s page.\\n', n);
else
    fprintf('\\n%d of %d results differ from the values on the Output Analyzer''s page:\\n', numel(bad), n);
    fprintf('  %s\\n', bad{:});
end
end

function varargout = report_store(op, varargin)
% The record behind report(): whether to print details, and how many results
% were checked and which of them differ. A local function keeps it between calls.
persistent details n bad
if isempty(details), details = false; n = 0; bad = {}; end
switch op
    case 'start', details = logical(varargin{1}); n = 0; bad = {};
    case 'details', varargout{1} = details;
    case 'add', n = n + 1; if ~varargin{1}, bad{end + 1} = varargin{2}; end
    case 'get', varargout{1} = n; varargout{2} = bad;
end
end

function ok = report_agrees(v, a, tol)
if isempty(v), v = NaN; end
if islogical(v) || islogical(a)
    ok = isscalar(v) && logical(v) == logical(a);
elseif ischar(v) || isstring(v) || ischar(a) || isstring(a)
    ok = strcmp(string(v), string(a));
elseif isnan(v) || isnan(a)
    ok = isnan(v) && isnan(a);
elseif isinf(v) || isinf(a)
    ok = v == a;
else
    ok = abs(v - a) <= tol * max(1, abs(a));
end
end

function s = report_fmt(v, digits)
% One value as a report line prints it: a number to the given significant
% digits, yes/no for a logical, NaN for a missing number, and the text itself.
if isempty(v) && ~ischar(v) && ~isstring(v)
    s = 'NaN';
elseif islogical(v)
    s = 'no'; if v, s = 'yes'; end
elseif isnumeric(v)
    s = sprintf(['%.' num2str(digits) 'g'], v);
else
    s = char(v);
end
end
`;

// ── The analyzer's value for one pair of designs ─────────────────────────
// Several Systems forms its pairs at run time and looks up the analyzer's
// value for each by its position pos among the pairs the page compared: none
// (NULL, None, or empty, for which report prints no analyzer column) when
// the page did not compare that pair.

LIB.R.pageAt = `
page_at <- function(v, pos) if (is.na(pos)) NULL else v[pos]
`;
LIB.py.pageAt = `
def page_at(v, pos):
    """The analyzer's value at position pos of v, or None when the page had none."""
    return None if pos is None else v[pos]
`;
LIB.m.pageAt = `
function a = page_at(v, pos)
% The analyzer's value at position pos of v, or empty when the page had none.
if isempty(pos), a = []; else, a = v(pos); end
end
`;

// ── descriptives: n, mean, sd, se, min, quartiles (R's type 7), max ───────
// One outcome has no spread to estimate: its sd and se are NaN, and each of
// its quartiles is the value itself, identically in all three languages.
// Outcomes that are all equal (the minimum equals the maximum) have sd
// exactly 0, as the analyzer reports it; NumPy's std and MATLAB's std can
// leave rounding error there (0.1 repeated three times gives about 1.7e-17).

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
    if len(x) < 2:
        sd = float("nan")   # one outcome has no spread to estimate
    else:
        sd = 0.0 if x.min() == x.max() else x.std(ddof=1)   # all equal: exactly 0
    return dict(n=len(x), mean=x.mean(), sd=sd, se=sd / np.sqrt(len(x)), min=x.min(),
                q1=q1, median=med, q3=q3, max=x.max())
`;

LIB.m.descriptives = `
function d = describe(x)
% n, mean, sd (n - 1), se, min, quartiles by linear interpolation (R's type 7), max.
x = x(:); n = numel(x); s = sort(x);
if n > 1
    if s(1) == s(n), sd = 0; else, sd = std(x); end   % all equal: exactly 0
    q = @(p) interp1(0:n-1, s, (n - 1) * p);   % R's type 7: h = (n - 1) p
else
    sd = NaN;   % one outcome has no spread to estimate
    q = @(p) s(1);
end
d = struct('n', n, 'mean', mean(x), 'sd', sd, 'se', sd / sqrt(n), 'min', s(1), ...
           'q1', q(0.25), 'median', q(0.5), 'q3', q(0.75), 'max', s(n));
end
`;

// ── Tidy R: the descriptives by dplyr, and the outcomes figure by ggplot2 ──
// Used by the Tidy R script only. describe_tbl gives the same nine numbers
// as describe(), with sd and se missing (printed NaN) for a single value.

LIB.R.tidyDescriptives = `
describe_tbl <- function(data, col) {
  # n, mean, sd, se, min, quartiles (R's type 7), and max of one column of a tibble, by dplyr's
  # summarise, as a list. One value has no spread to estimate, and its sd and se are missing.
  data |>
    summarise(n = n(), mean = mean({{ col }}), sd = sd({{ col }}), se = sd / sqrt(n),
              min = min({{ col }}), q1 = quantile({{ col }}, 0.25, names = FALSE),
              median = median({{ col }}), q3 = quantile({{ col }}, 0.75, names = FALSE),
              max = max({{ col }})) |>
    as.list()
}
`;
LIB.R.tidyFigure = `
plot_outcomes <- function(data, col, label) {
  # A histogram of one column with the page's bins: max(5, ceiling(sqrt(n))) equal-width bins from
  # the smallest value to the largest (one bin of width 1 when all are equal), each holding its
  # left edge and the last both edges. Its normal quantile-quantile plot follows, at R's ppoints
  # positions, with the line through the quartiles, as qqnorm() and qqline() draw them.
  x <- pull(data, {{ col }})
  nb <- max(5, ceiling(sqrt(length(x))))
  breaks <- if (max(x) > min(x)) seq(min(x), max(x), length.out = nb + 1) else x[1] + c(-0.5, 0.5)
  p1 <- ggplot(data, aes({{ col }})) +
    geom_histogram(breaks = breaks, closed = "left", fill = "gray80", color = "black") +
    labs(x = label, y = "count", title = "Replication outcomes")
  p2 <- ggplot(data, aes(sample = {{ col }})) +
    stat_qq() + stat_qq_line(linetype = "dashed") +
    labs(x = "theoretical quantiles", y = "sample quantiles", title = "Normal Q-Q plot")
  print(p1)
  print(p2)
}
`;

// ── t interval on a mean ─────────────────────────────────────────────────
// Outcomes that are all equal have no spread: the interval is the mean
// itself, as the analyzer reports it, and t.test (which stops on constant
// data) is not called.

LIB.R.tInterval = `
t_interval <- function(x, level) {
  n <- length(x); df <- n - 1; tq <- qt(1 - (1 - level) / 2, df)
  if (min(x) == max(x)) return(list(df = df, t = tq, hw = 0, lo = mean(x), hi = mean(x), test = NULL))
  tt <- t.test(x, conf.level = level)
  # test is t.test's own result (an htest object), kept for anyone who wants it whole.
  list(df = unname(tt$parameter), t = tq, hw = unname(diff(tt$conf.int)) / 2,
       lo = tt$conf.int[1], hi = tt$conf.int[2], test = tt)
}
`;
LIB.py.tInterval = `
def t_interval(x, level):
    """mean +/- t * s / sqrt(n), as scipy's t.interval."""
    x = np.asarray(x, float); n = len(x); df = n - 1
    tq = stats.t.ppf(1 - (1 - level) / 2, df)
    if x.min() == x.max():
        return dict(df=df, t=tq, hw=0.0, lo=x.mean(), hi=x.mean())
    se = x.std(ddof=1) / np.sqrt(n)
    lo, hi = stats.t.interval(level, df, loc=x.mean(), scale=se)
    return dict(df=df, t=tq, hw=(hi - lo) / 2, lo=lo, hi=hi)
`;
LIB.m.tInterval = `
function r = t_interval(x, level)
% mean +/- t * s / sqrt(n), as ttest's confidence interval.
x = x(:); df = numel(x) - 1; tq = tinv(1 - (1 - level) / 2, df);
if min(x) == max(x)
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
// exact argument because R 4.4 and later would otherwise use an exact
// distribution under ties too. Python and MATLAB carry the procedure in full
// because neither ships the interval. Under the approximation, a few tied
// values can leave the inverted test short of significance at one end of
// the range or both: the analyzer then reports that end as undetermined (NaN)
// and keeps the requested level, where wilcox.test lowers the level until an
// interval exists, which moves the other end too. R finds the ends by hand
// in that case.

LIB.R.signedRank = `
signed_rank_z <- function(x, d) {
  # The standardized signed-rank statistic of x - d, with the continuity and tie
  # corrections, as wilcox.test inverts it for the interval.
  xd <- x - d; xd <- xd[xd != 0]; m <- length(xd)
  r <- rank(abs(xd)); tt <- table(r)
  zd <- sum(r[xd > 0]) - m * (m + 1) / 4
  (zd - sign(zd) * 0.5) / sqrt(m * (m + 1) * (2 * m + 1) / 24 - sum(tt^3 - tt) / 48)
}
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
  if (!exact && n >= 2 && min(x) < max(x)) {
    # The approximate test inverted at the requested level: the lower end is the shift at
    # which the statistic falls to z, the upper end the one at which it falls to -z. When
    # even the smallest shift (or the largest) leaves the statistic short of that, the end
    # is undetermined, and the other end is found at this level by the same search.
    zq <- qnorm(1 - a / 2)
    zmin <- signed_rank_z(x, min(x)); zmax <- signed_rank_z(x, max(x))
    if (zmin < zq || zmax > -zq) {
      end <- function(z0, at) {
        if (at == z0) return(if (z0 > 0) min(x) else max(x))
        # The analyzer bisects to 1e-4 instead, and so the last digits can differ.
        uniroot(function(dd) signed_rank_z(x, dd) - z0, c(min(x), max(x)), tol = 1e-4)$root
      }
      lo <- if (zmin < zq) NaN else end(zq, zmin)
      hi <- if (zmax > -zq) NaN else end(-zq, zmax)
    }
  }
  list(V = unname(wt$statistic), p = wt$p.value, exact = exact, estimate = est,
       lo = lo, hi = hi, achieved = achieved, zeros = sum(d == 0), test = wt)
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
    x = np.asarray(x, float); df = len(x) - 1; a = 1 - level
    s2 = 0.0 if x.min() == x.max() else x.var(ddof=1)   # all equal: exactly 0
    qlo, qhi = stats.chi2.ppf([a / 2, 1 - a / 2], df)
    return dict(s2=s2, chiLo=qlo, chiHi=qhi, lo2=df * s2 / qhi, hi2=df * s2 / qlo,
                loS=np.sqrt(df * s2 / qhi), hiS=np.sqrt(df * s2 / qlo))
`;
LIB.m.varianceInterval = `
function r = variance_interval(x, level)
% [(n-1) s^2 / chi2_{1-a/2}, (n-1) s^2 / chi2_{a/2}] on n - 1 degrees of freedom (vartest gives the same).
x = x(:); df = numel(x) - 1; a = 1 - level;
if min(x) == max(x), s2 = 0; else, s2 = var(x); end   % all equal: exactly 0
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
  report_verdict(sw$p.value, alpha)
  invisible(sw)
}
# The check's verdict at alpha, in words, under its W and p.
report_verdict <- function(p, alpha) {
  if (report_state$details || !is.finite(p)) return(invisible())
  cat(if (p < alpha) sprintf("    p < %g: these values do not look normal\\n", alpha)
      else sprintf("    p >= %g: no evidence against normality\\n", alpha))
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
    report_verdict(p, alpha)


def report_verdict(p, alpha):
    """The check's verdict at alpha, in words, under its W and p."""
    if _report["details"] or not np.isfinite(p):
        return
    if p < alpha:
        print(f"    p < {alpha:g}: these values do not look normal")
    else:
        print(f"    p >= {alpha:g}: no evidence against normality")
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
    % The toolbox's swtest takes name-value arguments (its nargin is negative), and the
    % File Exchange's takes alpha as its second argument.
    if nargin('swtest') < 0
        [~, p, W] = swtest(x, 'Alpha', alpha);
    else
        [~, p, W] = swtest(x, alpha);
    end
    if nargin < 4, report([name ' W'], W); else, report([name ' W'], W, analyzerW); end
    if nargin < 5, report([name ' p'], p); else, report([name ' p'], p, analyzerP); end
    % The check's verdict at alpha, in words, under its W and p.
    if ~report_store('details') && isfinite(p)
        if p < alpha
            fprintf('    p < %g: these values do not look normal\\n', alpha);
        else
            fprintf('    p >= %g: no evidence against normality\\n', alpha);
        end
    end
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

// ── Two-sample t: Welch's or the pooled-variance t ───────────────────────
// Two designs that are each constant leave nothing for t.test (which stops)
// or SciPy (which returns NaN) to work on. The difference is then known
// exactly, and the analyzer reports it with no width: Welch's test is decided
// by whether the two constants differ (t = 0 and p = 1 when they are equal),
// and the pooled t divides the difference by a zero standard error, which is
// undefined when the constants are equal.

LIB.R.twoSample = `
two_sample_t <- function(a, b, level, pooled) {
  # Welch's t (var.equal = FALSE) or the pooled-variance t (var.equal = TRUE) on mean(a) - mean(b).
  n1 <- length(a); n2 <- length(b); d <- mean(a) - mean(b)
  sp <- if (pooled) sqrt(((n1 - 1) * var(a) + (n2 - 1) * var(b)) / (n1 + n2 - 2)) else NaN
  if (min(a) == max(a) && min(b) == max(b)) {
    # Neither design varies, and t.test stops on such data. The difference is known exactly,
    # with no width; Welch's t is +/-Inf (p = 0) when the constants differ and 0 (p = 1) when
    # they are equal, and the pooled t divides by a zero standard error (NaN when equal).
    t <- if (d != 0) sign(d) * Inf else if (pooled) NaN else 0
    return(list(diff = d, se = 0, df = n1 + n2 - 2, t = t, p = if (is.nan(t)) NaN else if (t == 0) 1 else 0,
                lo = d, hi = d, hw = 0, sp = sp, test = NULL))
  }
  tt <- t.test(a, b, conf.level = level, var.equal = pooled)
  list(diff = d, se = unname(tt$stderr), df = unname(tt$parameter), t = unname(tt$statistic),
       p = tt$p.value, lo = tt$conf.int[1], hi = tt$conf.int[2], hw = diff(tt$conf.int) / 2, sp = sp, test = tt)
}
`;
LIB.py.twoSample = `
def two_sample_t(a, b, level, pooled):
    """Welch's t (equal_var=False) or the pooled-variance t (equal_var=True) on mean(a) - mean(b)."""
    a = np.asarray(a, float); b = np.asarray(b, float); n1, n2 = len(a), len(b)
    d = a.mean() - b.mean()
    sp = np.sqrt(((n1 - 1) * a.var(ddof=1) + (n2 - 1) * b.var(ddof=1)) / (n1 + n2 - 2)) if pooled else np.nan
    if a.min() == a.max() and b.min() == b.max():
        # Neither design varies, and ttest_ind would return NaN. The difference is known
        # exactly, with no width; Welch's t is +/-inf (p = 0) when the constants differ and 0
        # (p = 1) when they are equal, and the pooled t divides by a zero standard error (NaN
        # when equal).
        t = np.sign(d) * np.inf if d != 0 else (np.nan if pooled else 0.0)
        p = np.nan if np.isnan(t) else (1.0 if t == 0 else 0.0)
        return dict(diff=d, se=0.0, df=n1 + n2 - 2, t=t, p=p, lo=d, hi=d, hw=0.0, sp=sp)
    va, vb = a.var(ddof=1) / n1, b.var(ddof=1) / n2
    se = sp * np.sqrt(1 / n1 + 1 / n2) if pooled else np.sqrt(va + vb)
    if a.min() == a.max() or b.min() == b.max():
        # One design constant: ttest_ind warns of precision loss on a sample whose values
        # are all equal, although nothing is lost, and so the test is formed from its
        # definition here (the same numbers ttest_ind returns).
        df = n1 + n2 - 2 if pooled else (va + vb) ** 2 / (va ** 2 / (n1 - 1) + vb ** 2 / (n2 - 1))
        t = d / se; hw = stats.t.ppf(1 - (1 - level) / 2, df) * se
        return dict(diff=d, se=se, df=df, t=t, p=min(1.0, 2 * stats.t.sf(abs(t), df)),
                    lo=d - hw, hi=d + hw, hw=hw, sp=sp)
    res = stats.ttest_ind(a, b, equal_var=pooled)
    ci = res.confidence_interval(level)
    return dict(diff=d, se=se, df=res.df, t=res.statistic, p=res.pvalue,
                lo=ci.low, hi=ci.high, hw=(ci.high - ci.low) / 2, sp=sp)
`;
LIB.m.twoSample = `
function r = two_sample_t(a, b, level, pooled)
% Welch's t ('unequal') or the pooled-variance t ('equal') on mean(a) - mean(b).
a = a(:); b = b(:); n1 = numel(a); n2 = numel(b); d = mean(a) - mean(b);
if pooled, sp = sqrt(((n1 - 1) * var(a) + (n2 - 1) * var(b)) / (n1 + n2 - 2)); else, sp = NaN; end
if min(a) == max(a) && min(b) == max(b)
    % Neither design varies, and ttest2 would return NaN. The difference is known exactly,
    % with no width; Welch's t is +/-Inf (p = 0) when the constants differ and 0 (p = 1) when
    % they are equal, and the pooled t divides by a zero standard error (NaN when equal).
    if d ~= 0, t = sign(d) * Inf; elseif pooled, t = NaN; else, t = 0; end
    if isnan(t), p = NaN; elseif t == 0, p = 1; else, p = 0; end
    r = struct('diff', d, 'se', 0, 'df', n1 + n2 - 2, 't', t, 'p', p, 'lo', d, 'hi', d, 'hw', 0, 'sp', sp);
    return;
end
if pooled, vt = 'equal'; else, vt = 'unequal'; end
[~, p, ci, st] = ttest2(a, b, 'Alpha', 1 - level, 'Vartype', vt);
if pooled, se = sp * sqrt(1 / n1 + 1 / n2); else, se = sqrt(var(a) / n1 + var(b) / n2); end
r = struct('diff', d, 'se', se, 'df', st.df, 't', st.tstat, 'p', p, ...
           'lo', ci(1), 'hi', ci(2), 'hw', (ci(2) - ci(1)) / 2, 'sp', sp);
end
`;

// ── Wilcoxon rank-sum with the Hodges-Lehmann shift and its interval ─────
// The exact distribution is used when both samples are under 50 and no
// value is tied, and otherwise the normal approximation with continuity and
// tie corrections, as the analyzer does; R is told which through
// wilcox.test's exact argument. Two cases need care. When each design is
// constant, every shifted sample is one tie, the inverted test has nothing
// to search, and the analyzer reports the one possible shift as both ends
// (wilcox.test stops there). And when even the largest possible shift
// leaves the approximate test short of significance, as with a few tied
// outcomes, the analyzer reports no interval end where wilcox.test reports
// the end of the range of shifts. Python and MATLAB carry the procedure in
// full because neither ships the interval; MATLAB's ranksum gives the p-value
// only. These need the signedRank helpers for midranks and bisection.

LIB.R.rankSum = `
rank_sum_z <- function(a, b, d) {
  # The standardized rank-sum statistic of a - d against b, with the continuity and tie
  # corrections, as wilcox.test inverts it for the interval.
  nx <- length(a); ny <- length(b); N <- nx + ny
  r <- rank(c(a - d, b)); tt <- table(r)
  dz <- sum(r[seq_len(nx)]) - nx * (nx + 1) / 2 - nx * ny / 2
  (dz - sign(dz) * 0.5) / sqrt(nx * ny / 12 * ((N + 1) - sum(tt^3 - tt) / (N * (N - 1))))
}
rank_sum <- function(a, b, level) {
  nx <- length(a); ny <- length(b); al <- 1 - level
  exact <- nx < 50 && ny < 50 && !any(duplicated(c(a, b)))
  flat <- min(a) == max(a) && min(b) == max(b)
  wt <- suppressWarnings(wilcox.test(a, b, conf.int = !flat, conf.level = level,
                                     exact = exact, correct = TRUE))
  # The shift is the median of every difference between an A outcome and a B outcome,
  # the Hodges-Lehmann estimate. Under the normal approximation, wilcox.test reports
  # instead a root of its score equation, which can differ from the median in the
  # third decimal, and so the median is computed here.
  est <- median(outer(a, b, "-"))
  lo <- min(a) - max(b); hi <- lo   # each design constant: the one possible shift
  achieved <- NaN
  if (!flat) { lo <- wt$conf.int[1]; hi <- wt$conf.int[2] }
  if (exact) {
    # The level the exact interval achieves, as wilcox.test forms it (older versions
    # of R do not attach it to the interval).
    qu <- qwilcox(al / 2, nx, ny)
    if (pwilcox(qu, nx, ny) <= al / 2 + 10 * .Machine$double.eps) qu <- qu + 1
    achieved <- if (qu == 0) 1 else 1 - 2 * pwilcox(qu - 1, nx, ny)
  } else if (!flat) {
    # An end the approximate test never reaches is left undetermined, as the analyzer does.
    zq <- qnorm(1 - al / 2)
    if (rank_sum_z(a, b, min(a) - max(b)) < zq) lo <- NaN
    if (rank_sum_z(a, b, max(a) - min(b)) > -zq) hi <- NaN
  }
  list(W = unname(wt$statistic), p = wt$p.value, exact = exact, estimate = est,
       lo = lo, hi = hi, achieved = achieved, test = wt)
}
`;
LIB.py.rankSum = `
def _wilcox_cdf(m, n):
    """P(U <= u) for u = 0..mn, the Mann-Whitney U of untied samples of sizes m and n: the
    counts are the coefficients of a Gaussian binomial, built one value of the first sample
    at a time."""
    mx = m * n
    c = np.zeros(mx + 1); c[0] = 1.0
    for i in range(1, m + 1):
        d = c.copy()
        d[n + i:] -= c[:mx + 1 - (n + i)]   # times (1 - q^(n+i))
        for r in range(i):                   # divided by (1 - q^i): a running sum with stride i
            d[r::i] = np.cumsum(d[r::i])
        c = d
    return np.cumsum(c) / c.sum()

def _rs_z(a, b, dd, zq):
    """The corrected standardized rank-sum statistic of a - dd against b, less zq."""
    nx, ny = len(a), len(b); N = nx + ny
    rr, tt = _midranks(np.concatenate([a - dd, b]))
    Wd = rr[:nx].sum() - nx * (nx + 1) / 2
    mean = nx * ny / 2; tie = float(np.sum(tt ** 3 - tt))
    sigma = np.sqrt(nx * ny / 12 * ((N + 1) - tie / (N * (N - 1))))
    if sigma == 0: return np.nan   # every value tied: no statistic to form
    corr = 0.0 if zq == 0 else np.sign(Wd - mean) * 0.5
    return (Wd - mean - corr) / sigma - zq

def rank_sum(a, b, level):
    """Wilcoxon rank-sum test with the Hodges-Lehmann shift (the median of the a - b
    differences) and its interval, as R's wilcox.test(a, b, conf.int=True)."""
    a = np.asarray(a, float); b = np.asarray(b, float); nx, ny = len(a), len(b); N = nx + ny
    alpha = 1 - level
    r, ties = _midranks(np.concatenate([a, b]))
    W = float(r[:nx].sum() - nx * (nx + 1) / 2)
    exact = bool(nx < 50 and ny < 50 and len(ties) == 0)
    cdf = _wilcox_cdf(nx, ny) if exact else None
    if exact:
        p = 1 - cdf[int(W) - 1] if W > nx * ny / 2 else cdf[int(W)]
        p = min(1.0, 2 * p)
    else:
        mean = nx * ny / 2; tie = float(np.sum(ties ** 3 - ties))
        sigma = np.sqrt(nx * ny / 12 * ((N + 1) - tie / (N * (N - 1))))
        if sigma == 0:
            p = np.nan   # every value tied: no test to make
        else:
            z = (W - mean - np.sign(W - mean) * 0.5) / sigma
            p = 2 * min(stats.norm.cdf(z), stats.norm.sf(z))
    diffs = np.sort((a[:, None] - b[None, :]).ravel())
    est = float(np.median(diffs))
    if exact:
        # The order statistics of the differences, stepping the quantile up when it sits
        # exactly on the tail probability, as wilcox.test does.
        qu = int(np.searchsorted(cdf, alpha / 2 * (1 - 1e-12)))
        if cdf[qu] <= alpha / 2 + 10 * np.finfo(float).eps: qu += 1
        if qu == 0:
            lo, hi, ach = -np.inf, np.inf, 0.0
        else:
            ql = nx * ny - qu
            ach = 2 * cdf[qu - 1]; lo = diffs[qu - 1]; hi = diffs[ql]
    elif a.min() == a.max() and b.min() == b.max():
        # Each design constant: the one possible shift is both ends.
        lo = hi = float(a[0] - b[0]); ach = alpha
    else:
        # The approximate test inverted: the shifts at which the statistic meets +/-z. An
        # end the statistic never reaches is left undetermined (NaN).
        zq = stats.norm.ppf(1 - alpha / 2)
        lo = _bisect(lambda dd: _rs_z(a, b, dd, zq), a.min() - b.max(), a.max() - b.min(), 1e-4)
        hi = _bisect(lambda dd: _rs_z(a, b, dd, -zq), a.min() - b.max(), a.max() - b.min(), 1e-4)
        ach = alpha
    return dict(W=W, p=p, exact=exact, estimate=est, lo=lo, hi=hi,
                achieved=(1 - ach) if np.isfinite(ach) else np.nan)
`;
LIB.m.rankSum = `
function cdf = wilcox_cdf(m, n)
% P(U <= u) for u = 0..mn, the Mann-Whitney U of untied samples of sizes m and n (the
% coefficients of a Gaussian binomial, built one value of the first sample at a time).
mx = m * n; c = zeros(1, mx + 1); c(1) = 1;
for i = 1:m
    d = c;
    d(n+i+1:end) = d(n+i+1:end) - c(1:mx+1-(n+i));   % times (1 - q^(n+i))
    for u = i:mx                                      % divided by (1 - q^i)
        d(u+1) = d(u+1) + d(u-i+1);
    end
    c = d;
end
cdf = cumsum(c) / sum(c);
end

function s = rs_z(a, b, dd, zq)
% The corrected standardized rank-sum statistic of a - dd against b, less zq.
nx = numel(a); ny = numel(b); N = nx + ny;
[rr, tt] = midranks([a - dd, b]);
Wd = sum(rr(1:nx)) - nx * (nx + 1) / 2;
mn = nx * ny / 2; tie = sum(tt.^3 - tt);
sigma = sqrt(nx * ny / 12 * ((N + 1) - tie / (N * (N - 1))));
if sigma == 0, s = NaN; return; end   % every value tied: no statistic to form
if zq == 0, corr = 0; else, corr = sign(Wd - mn) * 0.5; end
s = (Wd - mn - corr) / sigma - zq;
end

function r = rank_sum(a, b, level)
% Wilcoxon rank-sum test with the Hodges-Lehmann shift (the median of the a - b
% differences) and its interval, as R's wilcox.test(a, b, conf.int = TRUE). MATLAB's
% ranksum gives the p-value only.
a = a(:)'; b = b(:)'; nx = numel(a); ny = numel(b); N = nx + ny; alpha = 1 - level;
[rk, ties] = midranks([a b]);
W = sum(rk(1:nx)) - nx * (nx + 1) / 2;
exact = nx < 50 && ny < 50 && isempty(ties);
if exact
    cdf = wilcox_cdf(nx, ny);
    if W > nx * ny / 2, p = 1 - cdf(W); else, p = cdf(W + 1); end
    p = min(1, 2 * p);
else
    mn = nx * ny / 2; tie = sum(ties.^3 - ties);
    sigma = sqrt(nx * ny / 12 * ((N + 1) - tie / (N * (N - 1))));
    if sigma == 0
        p = NaN;   % every value tied: no test to make
    else
        z = (W - mn - sign(W - mn) * 0.5) / sigma;
        p = 2 * min(normcdf(z), normcdf(-z));
    end
end
diffs = sort(reshape(a' - b, 1, []));
est = median(diffs);
if exact
    % The order statistics of the differences, stepping the quantile up when it sits
    % exactly on the tail probability, as wilcox.test does.
    qu = find(cdf >= alpha / 2 * (1 - 1e-12), 1) - 1;
    if cdf(qu + 1) <= alpha / 2 + 10 * eps, qu = qu + 1; end
    if qu == 0
        lo = -Inf; hi = Inf; ach = 0;
    else
        ql = nx * ny - qu;
        ach = 2 * cdf(qu); lo = diffs(qu); hi = diffs(ql + 1);
    end
elseif min(a) == max(a) && min(b) == max(b)
    % Each design constant: the one possible shift is both ends.
    lo = a(1) - b(1); hi = lo; ach = alpha;
else
    % The approximate test inverted: the shifts at which the statistic meets +/-z. An end
    % the statistic never reaches is left undetermined (NaN).
    zq = norminv(1 - alpha / 2);
    lo = bisect_root(@(dd) rs_z(a, b, dd, zq), min(a) - max(b), max(a) - min(b), 1e-4);
    hi = bisect_root(@(dd) rs_z(a, b, dd, -zq), min(a) - max(b), max(a) - min(b), 1e-4);
    ach = alpha;
end
if isfinite(ach), ach = 1 - ach; end
r = struct('W', W, 'p', p, 'exact', exact, 'estimate', est, 'lo', lo, 'hi', hi, 'achieved', ach);
end
`;

// ── F ratio of two variances ─────────────────────────────────────────────
// A B with no spread makes F infinite (p = 0, as var.test reports), and two
// sets with no spread make it undefined. A set whose values are all equal
// (its minimum equals its maximum) has variance exactly 0, which R's var
// gives but NumPy's var and MATLAB's var can miss by rounding error (vartest2
// then reports F = 0 for two constant sets), and so Python and MATLAB set it.

LIB.R.fRatio = `
f_ratio <- function(a, b, level) {
  vt <- var.test(a, b, conf.level = level)
  list(F = unname(vt$statistic), df1 = unname(vt$parameter[1]), df2 = unname(vt$parameter[2]),
       p = vt$p.value, lo = vt$conf.int[1], hi = vt$conf.int[2], test = vt)
}
`;
LIB.py.fRatio = `
def f_ratio(a, b, level):
    """F = s_a^2 / s_b^2 on (n_a - 1, n_b - 1) degrees of freedom, the two-sided p, and the
    interval [F / F_{1-a/2}, F / F_{a/2}], as R's var.test."""
    a = np.asarray(a, float); b = np.asarray(b, float); df1, df2 = len(a) - 1, len(b) - 1
    va = 0.0 if a.min() == a.max() else a.var(ddof=1)   # all equal: exactly 0
    vb = 0.0 if b.min() == b.max() else b.var(ddof=1); al = 1 - level
    if vb > 0:
        F = va / vb
    else:
        # B has no spread: F is infinite (p = 0, as var.test gives), or undefined when A has
        # none either.
        F = np.inf if va > 0 else np.nan
    p = np.nan if np.isnan(F) else min(1.0, 2 * min(stats.f.cdf(F, df1, df2), stats.f.sf(F, df1, df2)))
    return dict(F=F, df1=df1, df2=df2, p=p,
                lo=F / stats.f.ppf(1 - al / 2, df1, df2), hi=F / stats.f.ppf(al / 2, df1, df2))
`;
LIB.m.fRatio = `
function r = f_ratio(a, b, level)
% F = s_a^2 / s_b^2 with its two-sided p and interval, as vartest2 (and R's var.test).
a = a(:); b = b(:);
if min(a) == max(a) || min(b) == max(b)
    % A set whose values are all equal has variance exactly 0, which var can miss by rounding
    % error. F is then 0, infinite (p = 0), or undefined when both sets are constant.
    df1 = numel(a) - 1; df2 = numel(b) - 1; al = 1 - level;
    va = 0; if min(a) < max(a), va = var(a); end
    vb = 0; if min(b) < max(b), vb = var(b); end
    F = va / vb;
    if isnan(F), p = NaN; elseif isinf(F), p = 0; else, p = min(1, 2 * min(fcdf(F, df1, df2), fcdf(F, df1, df2, 'upper'))); end
    r = struct('F', F, 'df1', df1, 'df2', df2, 'p', p, ...
               'lo', F / finv(1 - al / 2, df1, df2), 'hi', F / finv(al / 2, df1, df2));
    return;
end
[~, p, ci, st] = vartest2(a, b, 'Alpha', 1 - level);
r = struct('F', st.fstat, 'df1', st.df1, 'df2', st.df2, 'p', p, 'lo', ci(1), 'hi', ci(2));
end
`;

// ── Levene's test, median-centered (Brown-Forsythe) ──────────────────────
// The one-way analysis of variance of each value's distance from its own
// group's median. Distances that do not vary within any group make F
// infinite (p = 0) when they differ between groups, as the analyzer reports,
// and leave nothing to compare when they do not, as when every group is
// constant. As in the analyzer, "do not vary" means a within sum of squares
// of the distances at most 1e-24 of the outcomes' own uncentered sum of
// squares (the distances carry the outcomes' rounding): two outcomes per
// group lie at distances from their median that are equal only up to
// rounding, and the built-in tests report that rounding error as an F near
// 1e30, or as a small F when the between part is rounding error too.

LIB.R.levene = `
levene_test <- function(groups) {
  # anova(lm(distance ~ group)): each outcome's distance from its own group's median.
  outcome <- unlist(groups); group <- factor(rep(seq_along(groups), lengths(groups)))
  distance <- abs(outcome - ave(outcome, group, FUN = median)); k <- length(groups); N <- length(outcome)
  tiny <- 1e-24 * sum(outcome^2)   # below this, a sum of squares is rounding error
  if (sum((distance - ave(distance, group))^2) <= tiny) {
    # The distances do not vary within any group: F is infinite (p = 0) when they differ
    # between groups, and there is nothing to compare when they do not (every group constant).
    between <- sum((ave(distance, group) - mean(distance))^2) > tiny
    return(list(F = if (between) Inf else NaN, df1 = k - 1, df2 = N - k, p = if (between) 0 else NaN, test = NULL))
  }
  tab <- anova(lm(distance ~ group))
  list(F = tab[["F value"]][1], df1 = tab$Df[1], df2 = tab$Df[2], p = tab[["Pr(>F)"]][1], test = tab)
}
`;
LIB.py.levene = `
def levene_test(groups):
    """Brown and Forsythe's form of Levene's test: scipy's levene with center='median'."""
    groups = [np.asarray(g, float) for g in groups]
    k = len(groups); N = sum(len(g) for g in groups)
    z = [np.abs(g - np.median(g)) for g in groups]
    tiny = 1e-24 * sum(float(np.sum(g ** 2)) for g in groups)   # below this, a sum of squares is rounding error
    if sum(float(np.sum((zi - zi.mean()) ** 2)) for zi in z) <= tiny:
        zbar = np.concatenate(z).mean()
        # The distances do not vary within any group: F is infinite (p = 0) when they differ
        # between groups, and there is nothing to compare when they do not (every group constant).
        between = sum(len(zi) * (zi.mean() - zbar) ** 2 for zi in z) > tiny
        return dict(F=np.inf if between else np.nan, df1=k - 1, df2=N - k, p=0.0 if between else np.nan)
    res = stats.levene(*groups, center="median")
    return dict(F=res.statistic, df1=k - 1, df2=N - k, p=res.pvalue)
`;
LIB.m.levene = `
function r = levene_test(groups)
% Brown and Forsythe's form of Levene's test: vartestn with 'BrownForsythe'.
k = numel(groups);
y = cell2mat(cellfun(@(v) v(:), groups(:), 'UniformOutput', false));
g = repelem((1:k)', cellfun(@numel, groups(:)));
N = numel(y); z = zeros(N, 1); zm = zeros(N, 1);
for i = 1:k
    in = g == i; z(in) = abs(y(in) - median(y(in))); zm(in) = mean(z(in));
end
tiny = 1e-24 * sum(y.^2);   % below this, a sum of squares is rounding error
if sum((z - zm).^2) <= tiny
    % The distances do not vary within any group: F is infinite (p = 0) when they differ
    % between groups, and there is nothing to compare when they do not (every group constant).
    between = sum((zm - mean(z)).^2) > tiny;
    if between, F = Inf; p = 0; else, F = NaN; p = NaN; end
    r = struct('F', F, 'df1', k - 1, 'df2', N - k, 'p', p); return;
end
[p, st] = vartestn(y, g, 'TestType', 'BrownForsythe', 'Display', 'off');
r = struct('F', st.fstat, 'df1', st.df(1), 'df2', st.df(2), 'p', p);
end
`;

// ── Planning for two designs with equal replications per design ──────────
// The standard error with n replications in each design is
// sqrt((s1^2 + s2^2) / n); the two tests differ only in the degrees of
// freedom, 2(n - 1) for the pooled t and the Welch-Satterthwaite value
// otherwise. A standard deviation that is not positive, a target that is not
// positive, or a difference of zero has no plan, which the scripts print as
// NaN. These use smallest_n from the planning snippet.

LIB.R.planningTwo = `
welch_df_equal <- function(s1, s2, n) (s1^2 + s2^2)^2 / (s1^4 + s2^4) * (n - 1)
hw_two <- function(n, s1, s2, level, pooled) {
  df <- if (pooled) 2 * (n - 1) else welch_df_equal(s1, s2, n)
  qt(1 - (1 - level) / 2, df) * sqrt((s1^2 + s2^2) / n)
}
sds_ok <- function(s1, s2) isTRUE(is.finite(s1) && is.finite(s2) && s1 > 0 && s2 > 0)
plan_half_width_two <- function(s1, s2, level, h, pooled) {
  if (!sds_ok(s1, s2) || !isTRUE(is.finite(h) && h > 0)) return(list(n = NaN, hwAtN = NaN))
  n <- smallest_n(function(n) hw_two(n, s1, s2, level, pooled) <= h,
                  (qnorm(1 - (1 - level) / 2) * sqrt(s1^2 + s2^2) / h)^2)
  list(n = n, hwAtN = if (is.na(n)) NaN else hw_two(n, s1, s2, level, pooled))
}
power_two <- function(n, s1, s2, delta, alpha, pooled) {
  # Two-sided power with both tails counted: for the pooled t this is power.t.test(type =
  # "two.sample", strict = TRUE) at sd = sqrt((s1^2 + s2^2) / 2), and for Welch's test the
  # noncentral-t approximation at the Welch degrees of freedom.
  df <- if (pooled) 2 * (n - 1) else welch_df_equal(s1, s2, n)
  q <- qt(1 - alpha / 2, df); ncp <- delta / sqrt((s1^2 + s2^2) / n)
  pt(q, df, ncp, lower.tail = FALSE) + pt(-q, df, ncp)
}
plan_power_two <- function(s1, s2, delta, alpha, power, pooled) {
  if (!sds_ok(s1, s2) || !isTRUE(is.finite(delta) && delta != 0) || !isTRUE(power > 0 && power < 1) ||
      !isTRUE(alpha > 0 && alpha < 1)) return(list(n = NaN, powerAtN = NaN))
  n <- smallest_n(function(n) power_two(n, s1, s2, delta, alpha, pooled) >= power,
                  (qnorm(1 - alpha / 2) + qnorm(power))^2 * (s1^2 + s2^2) / delta^2)
  list(n = n, powerAtN = if (is.na(n)) NaN else power_two(n, s1, s2, delta, alpha, pooled))
}
`;
LIB.py.planningTwo = `
def welch_df_equal(s1, s2, n):
    return (s1 ** 2 + s2 ** 2) ** 2 / (s1 ** 4 + s2 ** 4) * (n - 1)

def hw_two(n, s1, s2, level, pooled):
    df = 2 * (n - 1) if pooled else welch_df_equal(s1, s2, n)
    return stats.t.ppf(1 - (1 - level) / 2, df) * np.sqrt((s1 ** 2 + s2 ** 2) / n)

def sds_ok(s1, s2):
    return bool(np.isfinite(s1) and np.isfinite(s2) and s1 > 0 and s2 > 0)

def plan_half_width_two(s1, s2, level, h, pooled):
    if not sds_ok(s1, s2) or not (np.isfinite(h) and h > 0): return dict(n=np.nan, hwAtN=np.nan)
    n = smallest_n(lambda n: hw_two(n, s1, s2, level, pooled) <= h,
                   (stats.norm.ppf(1 - (1 - level) / 2) * np.sqrt(s1 ** 2 + s2 ** 2) / h) ** 2)
    return dict(n=n, hwAtN=np.nan if np.isnan(n) else hw_two(n, s1, s2, level, pooled))

def power_two(n, s1, s2, delta, alpha, pooled):
    """Two-sided power with both tails counted: the pooled t exactly, Welch's test by the
    noncentral-t approximation at the Welch degrees of freedom."""
    df = 2 * (n - 1) if pooled else welch_df_equal(s1, s2, n)
    q = stats.t.ppf(1 - alpha / 2, df); ncp = delta / np.sqrt((s1 ** 2 + s2 ** 2) / n)
    return stats.nct.sf(q, df, ncp) + stats.nct.cdf(-q, df, ncp)

def plan_power_two(s1, s2, delta, alpha, power, pooled):
    if (not sds_ok(s1, s2) or not np.isfinite(delta) or delta == 0 or not 0 < power < 1
            or not 0 < alpha < 1):
        return dict(n=np.nan, powerAtN=np.nan)
    n = smallest_n(lambda n: power_two(n, s1, s2, delta, alpha, pooled) >= power,
                   (stats.norm.ppf(1 - alpha / 2) + stats.norm.ppf(power)) ** 2 * (s1 ** 2 + s2 ** 2) / delta ** 2)
    return dict(n=n, powerAtN=np.nan if np.isnan(n) else power_two(n, s1, s2, delta, alpha, pooled))
`;
LIB.m.planningTwo = `
function df = welch_df_equal(s1, s2, n)
df = (s1^2 + s2^2)^2 / (s1^4 + s2^4) * (n - 1);
end

function h = hw_two(n, s1, s2, level, pooled)
if pooled, df = 2 * (n - 1); else, df = welch_df_equal(s1, s2, n); end
h = tinv(1 - (1 - level) / 2, df) * sqrt((s1^2 + s2^2) / n);
end

function ok = sds_ok(s1, s2)
ok = isfinite(s1) && isfinite(s2) && s1 > 0 && s2 > 0;
end

function r = plan_half_width_two(s1, s2, level, h, pooled)
r = struct('n', NaN, 'hwAtN', NaN);
if ~sds_ok(s1, s2) || ~(isfinite(h) && h > 0), return; end
n = smallest_n(@(n) hw_two(n, s1, s2, level, pooled) <= h, (norminv(1 - (1 - level) / 2) * sqrt(s1^2 + s2^2) / h)^2);
if ~isnan(n), r = struct('n', n, 'hwAtN', hw_two(n, s1, s2, level, pooled)); end
end

function p = power_two(n, s1, s2, delta, alpha, pooled)
% Two-sided power with both tails counted: the pooled t exactly (sampsizepwr agrees),
% Welch's test by the noncentral-t approximation at the Welch degrees of freedom.
if pooled, df = 2 * (n - 1); else, df = welch_df_equal(s1, s2, n); end
q = tinv(1 - alpha / 2, df); ncp = delta / sqrt((s1^2 + s2^2) / n);
p = 1 - nctcdf(q, df, ncp) + nctcdf(-q, df, ncp);
end

function r = plan_power_two(s1, s2, delta, alpha, power, pooled)
r = struct('n', NaN, 'powerAtN', NaN);
if ~sds_ok(s1, s2) || ~isfinite(delta) || delta == 0 || ~(power > 0 && power < 1) || ~(alpha > 0 && alpha < 1), return; end
n = smallest_n(@(n) power_two(n, s1, s2, delta, alpha, pooled) >= power, (norminv(1 - alpha / 2) + norminv(power))^2 * (s1^2 + s2^2) / delta^2);
if ~isnan(n), r = struct('n', n, 'powerAtN', power_two(n, s1, s2, delta, alpha, pooled)); end
end
`;

// ── Paired t on matched pairs ────────────────────────────────────────────
// The paired t test on the differences d = a - b, the interval on their mean,
// and the correlation of a and b across the pairs. Differences that are all
// equal leave t.test nothing to work on (it stops; SciPy and MATLAB return
// NaN or warn), and so the analyzer's values are given by hand there. As in
// the analyzer, "all equal" allows the rounding of the subtraction: max(d) -
// min(d) at most 8 eps times the largest |a| or |b| (0.1 - 0.3 and 0.2 - 0.4
// differ in their last bit). The hand-written values are the mean
// difference with no width, and t infinite (p = 0), or undefined when every
// difference is zero. A design whose outcomes are all equal has no
// correlation with the other, which is NaN in every language.

LIB.R.pairedT = `
paired_t <- function(a, b, level) {
  d <- a - b; n <- length(d); m <- mean(d)
  r <- if (min(a) == max(a) || min(b) == max(b)) NaN else cor(a, b)
  if (max(d) - min(d) <= 8 * .Machine$double.eps * max(abs(c(a, b)))) {   # equal up to rounding
    t <- if (m != 0) sign(m) * Inf else NaN
    return(list(n = n, meanD = m, sdD = 0, se = 0, df = n - 1, t = t, p = if (is.nan(t)) NaN else 0,
                lo = m, hi = m, hw = 0, r = r, diffs = d, test = NULL))
  }
  tt <- t.test(a, b, paired = TRUE, conf.level = level)
  s <- sd(d)
  list(n = n, meanD = m, sdD = s, se = s / sqrt(n), df = unname(tt$parameter), t = unname(tt$statistic),
       p = tt$p.value, lo = tt$conf.int[1], hi = tt$conf.int[2], hw = diff(tt$conf.int) / 2, r = r, diffs = d, test = tt)
}
`;
LIB.py.pairedT = `
def paired_t(a, b, level):
    """The paired t test on d = a - b (ttest_rel), the interval on the mean difference, and the
    correlation of a and b."""
    a = np.asarray(a, float); b = np.asarray(b, float); d = a - b; n = len(d); m = d.mean()
    r = np.nan if a.min() == a.max() or b.min() == b.max() else np.corrcoef(a, b)[0, 1]
    if np.ptp(d) <= 8 * np.finfo(float).eps * max(np.abs(a).max(), np.abs(b).max()):   # equal up to rounding
        t = np.sign(m) * np.inf if m != 0 else np.nan
        return dict(n=n, meanD=m, sdD=0.0, se=0.0, df=n - 1, t=t, p=np.nan if np.isnan(t) else 0.0,
                    lo=m, hi=m, hw=0.0, r=r, diffs=d)
    res = stats.ttest_rel(a, b); ci = res.confidence_interval(level); s = d.std(ddof=1)
    return dict(n=n, meanD=m, sdD=s, se=s / np.sqrt(n), df=res.df, t=res.statistic, p=res.pvalue,
                lo=ci.low, hi=ci.high, hw=(ci.high - ci.low) / 2, r=r, diffs=d)
`;
LIB.m.pairedT = `
function r = paired_t(a, b, level)
% The paired t test on d = a - b (ttest on two vectors), the interval on the mean difference,
% and the correlation of a and b.
a = a(:); b = b(:); d = a - b; n = numel(d); m = mean(d);
if min(a) == max(a) || min(b) == max(b), rho = NaN; else, rho = corr(a, b); end
if max(d) - min(d) <= 8 * eps * max(abs([a; b]))   % equal up to rounding
    if m ~= 0, t = sign(m) * Inf; p = 0; else, t = NaN; p = NaN; end
    r = struct('n', n, 'meanD', m, 'sdD', 0, 'se', 0, 'df', n - 1, 't', t, 'p', p, ...
               'lo', m, 'hi', m, 'hw', 0, 'r', rho, 'diffs', d);
    return;
end
[~, p, ci, st] = ttest(a, b, 'Alpha', 1 - level);
s = std(d);
r = struct('n', n, 'meanD', m, 'sdD', s, 'se', s / sqrt(n), 'df', st.df, 't', st.tstat, 'p', p, ...
           'lo', ci(1), 'hi', ci(2), 'hw', (ci(2) - ci(1)) / 2, 'r', rho, 'diffs', d);
end
`;

// ── Simultaneous intervals: each design's own t interval at 1 - alpha/k ──
// By Bonferroni's inequality the k intervals hold at once with confidence at
// least the stated level. A design whose outcomes are all equal has no
// spread: its interval is the mean itself, as the analyzer reports it, and
// t.test (which stops on constant data) is not called.

LIB.R.simultaneous = `
simultaneous_means <- function(groups, level) {
  k <- length(groups); per <- 1 - (1 - level) / k
  items <- lapply(groups, function(x) {
    n <- length(x); m <- mean(x)
    if (min(x) == max(x)) return(list(n = n, mean = m, sd = 0, se = 0, df = n - 1, lo = m, hi = m))
    tt <- t.test(x, conf.level = per)
    list(n = n, mean = m, sd = sd(x), se = sd(x) / sqrt(n), df = n - 1, lo = tt$conf.int[1], hi = tt$conf.int[2])
  })
  list(k = k, perLevel = per, items = items)
}
bench_word <- function(lo, hi, bench) {
  # The interval against the benchmark: "above" or "below" when it excludes it, and otherwise
  # "contains", the word in the page's table. An end that is not a number declares no side.
  if (isTRUE(lo > bench)) "above" else if (isTRUE(hi < bench)) "below" else "contains"
}
`;
LIB.py.simultaneous = `
def simultaneous_means(groups, level):
    """Each design's own t interval at 1 - alpha/k, which hold jointly at the stated level by Bonferroni."""
    k = len(groups); per = 1 - (1 - level) / k
    items = []
    for x in groups:
        x = np.asarray(x, float); n = len(x); m = x.mean()
        if x.min() == x.max():
            # Outcomes that are all equal: the interval is the mean itself.
            items.append(dict(n=n, mean=m, sd=0.0, se=0.0, df=n - 1, lo=m, hi=m)); continue
        sd = x.std(ddof=1); se = sd / np.sqrt(n)
        lo, hi = stats.t.interval(per, n - 1, loc=m, scale=se)
        items.append(dict(n=n, mean=m, sd=sd, se=se, df=n - 1, lo=lo, hi=hi))
    return dict(k=k, perLevel=per, items=items)

def bench_word(lo, hi, bench):
    """The interval against the benchmark: "above" or "below" when it excludes it, and otherwise
    "contains", the word in the page's table. An end that is not a number declares no side."""
    return "above" if lo > bench else "below" if hi < bench else "contains"
`;
LIB.m.simultaneous = `
function r = simultaneous_means(groups, level)
% Each design's own t interval at 1 - alpha/k, which hold jointly at the stated level by Bonferroni.
k = numel(groups); per = 1 - (1 - level) / k;
items = cell(1, k);
for i = 1:k
    x = groups{i}(:); n = numel(x); m = mean(x);
    if min(x) == max(x)
        % Outcomes that are all equal: the interval is the mean itself.
        items{i} = struct('n', n, 'mean', m, 'sd', 0, 'se', 0, 'df', n - 1, 'lo', m, 'hi', m);
        continue;
    end
    [~, ~, ci] = ttest(x, 0, 'Alpha', 1 - per);
    items{i} = struct('n', n, 'mean', m, 'sd', std(x), 'se', std(x) / sqrt(n), 'df', n - 1, 'lo', ci(1), 'hi', ci(2));
end
r = struct('k', k, 'perLevel', per, 'items', {items});
end

function w = bench_word(lo, hi, bench)
% The interval against the benchmark: 'above' or 'below' when it excludes it, and otherwise
% 'contains', the word in the page's table. An end that is not a number declares no side.
if lo > bench, w = 'above'; elseif hi < bench, w = 'below'; else, w = 'contains'; end
end
`;

// ── Holm's step-down adjustment (R has p.adjust) ─────────────────────────

LIB.R.holm = `
adjust_p <- function(p, method) p.adjust(p, method = method)   # "bonferroni" or "holm"
`;
LIB.py.holm = `
def adjust_p(p, method):
    """Bonferroni (C p, capped at 1) or Holm's step-down, as R's p.adjust."""
    p = np.asarray(p, float); C = len(p)
    if method == "bonferroni": return np.minimum(1.0, C * p)
    order = np.argsort(p)
    # The sorted p-values times C, C - 1, ..., 1, made nondecreasing and capped at 1.
    stepped = np.minimum(1.0, np.maximum.accumulate((C - np.arange(C)) * p[order]))
    out = np.empty(C); out[order] = stepped
    return out
`;
LIB.m.holm = `
function out = adjust_p(p, method)
% Bonferroni (C p, capped at 1) or Holm's step-down, as R's p.adjust.
p = p(:)'; C = numel(p);
% A missing p-value stays missing ('includenan'), as in R and the analyzer.
if strcmp(method, 'bonferroni'), out = min(1, C * p, 'includenan'); return; end
[ps, order] = sort(p);
stepped = min(1, cummax((C:-1:1) .* ps, 'includenan'), 'includenan');   % the sorted p-values times C, C - 1, ..., 1, made nondecreasing
out = zeros(1, C); out(order) = stepped;
end
`;

// ── Planning for several designs ─────────────────────────────────────────
// For a family of Welch intervals with n replications in every design, the
// smallest n at which the widest comparison meets the target. The widest is
// usually the pair with the largest s_i^2 + s_j^2, but a pair with very
// unequal standard deviations has fewer degrees of freedom and can be wider at
// small n, and so every comparison is checked. A standard deviation that is
// not positive, in any design, has no plan, as on the page. The power of the
// analysis of variance's F test is here too. These use hw_two from
// planningTwo and smallest_n from planning.

LIB.R.planningSeveral = `
plan_half_width_family <- function(sds, level, pairs, h) {
  # The smallest n per design at which every comparison's Welch interval at 1 - alpha/C is at
  # most h wide on each side; pairs is a list of c(i, j). Returns n, the half-width at n, and the
  # widest pair at n.
  C <- length(pairs); per <- 1 - (1 - level) / C
  none <- list(n = NaN, hwAtN = NaN, pair = c(NA, NA))
  if (!isTRUE(is.finite(h) && h > 0) || !all(is.finite(sds) & sds > 0)) return(none)
  widest <- function(n) {
    hws <- sapply(pairs, function(p) hw_two(n, sds[p[1]], sds[p[2]], per, FALSE))
    list(hw = max(hws), pair = pairs[[which.max(hws)]])
  }
  smax <- max(sapply(pairs, function(p) sqrt(sds[p[1]]^2 + sds[p[2]]^2)))
  n <- smallest_n(function(n) widest(n)$hw <= h, (qnorm(1 - (1 - per) / 2) * smax / h)^2)
  if (is.nan(n)) return(none)
  w <- widest(n)
  list(n = n, hwAtN = w$hw, pair = w$pair)
}
power_anova <- function(n, k, sigma, delta, alpha, blocked) {
  # Power of the F test when one of k designs is shifted by delta: lambda = n delta^2 (k - 1) / (k sigma^2).
  dfw <- if (blocked) (k - 1) * (n - 1) else k * (n - 1)
  lambda <- n * delta^2 * (k - 1) / (k * sigma^2)
  pf(qf(1 - alpha, k - 1, dfw), k - 1, dfw, ncp = lambda, lower.tail = FALSE)
}
plan_power_anova <- function(k, sigma, delta, alpha, power, blocked) {
  if (!isTRUE(is.finite(sigma) && sigma > 0) || !isTRUE(is.finite(delta) && delta != 0) ||
      !isTRUE(power > 0 && power < 1) || !isTRUE(alpha > 0 && alpha < 1)) return(list(n = NaN, powerAtN = NaN))
  n <- smallest_n(function(n) power_anova(n, k, sigma, delta, alpha, blocked) >= power,
                  (qnorm(1 - alpha / 2) + qnorm(power))^2 * sigma^2 * k / ((k - 1) * delta^2))
  list(n = n, powerAtN = if (is.nan(n)) NaN else power_anova(n, k, sigma, delta, alpha, blocked))
}
`;
LIB.py.planningSeveral = `
def plan_half_width_family(sds, level, pairs, h):
    """The smallest n per design at which every comparison's Welch interval at 1 - alpha/C is at
    most h wide on each side; pairs is a list of (i, j). Returns n, the half-width at n, and the
    widest pair at n."""
    sds = np.asarray(sds, float); C = len(pairs); per = 1 - (1 - level) / C
    none = dict(n=np.nan, hwAtN=np.nan, pair=None)
    if not (np.isfinite(h) and h > 0) or not np.all(np.isfinite(sds) & (sds > 0)): return none
    def widest(n):
        hws = [hw_two(n, sds[i], sds[j], per, False) for i, j in pairs]
        m = int(np.argmax(hws)); return hws[m], pairs[m]
    smax = max(np.sqrt(sds[i] ** 2 + sds[j] ** 2) for i, j in pairs)
    n = smallest_n(lambda n: widest(n)[0] <= h, (stats.norm.ppf(1 - (1 - per) / 2) * smax / h) ** 2)
    if np.isnan(n): return none
    hw, pair = widest(n)
    return dict(n=n, hwAtN=hw, pair=pair)

def power_anova(n, k, sigma, delta, alpha, blocked):
    """Power of the F test when one of k designs is shifted by delta: lambda = n delta^2 (k - 1) / (k sigma^2)."""
    dfw = (k - 1) * (n - 1) if blocked else k * (n - 1)
    lam = n * delta ** 2 * (k - 1) / (k * sigma ** 2)
    return stats.ncf.sf(stats.f.ppf(1 - alpha, k - 1, dfw), k - 1, dfw, lam)

def plan_power_anova(k, sigma, delta, alpha, power, blocked):
    if (not (np.isfinite(sigma) and sigma > 0) or not (np.isfinite(delta) and delta != 0)
            or not 0 < power < 1 or not 0 < alpha < 1):
        return dict(n=np.nan, powerAtN=np.nan)
    n = smallest_n(lambda n: power_anova(n, k, sigma, delta, alpha, blocked) >= power,
                   (stats.norm.ppf(1 - alpha / 2) + stats.norm.ppf(power)) ** 2 * sigma ** 2 * k / ((k - 1) * delta ** 2))
    return dict(n=n, powerAtN=np.nan if np.isnan(n) else power_anova(n, k, sigma, delta, alpha, blocked))
`;
LIB.m.planningSeveral = `
function r = plan_half_width_family(sds, level, pairs, h)
% The smallest n per design at which every comparison's Welch interval at 1 - alpha/C is at
% most h wide on each side; pairs is a 2-column matrix of (i, j). Returns n, the half-width at
% n, and the widest pair at n.
C = size(pairs, 1); per = 1 - (1 - level) / C;
r = struct('n', NaN, 'hwAtN', NaN, 'pair', [NaN NaN]);
if ~(isfinite(h) && h > 0) || ~all(isfinite(sds) & sds > 0), return; end
smax = max(sqrt(sds(pairs(:, 1)).^2 + sds(pairs(:, 2)).^2));
n = smallest_n(@(n) widest_hw(n, sds, pairs, per) <= h, (norminv(1 - (1 - per) / 2) * smax / h)^2);
if isnan(n), return; end
[hw, m] = widest_hw(n, sds, pairs, per);
r = struct('n', n, 'hwAtN', hw, 'pair', pairs(m, :));
end

function [hw, m] = widest_hw(n, sds, pairs, per)
% The widest comparison's half-width at n, and its row in pairs (the first, on a tie).
hws = arrayfun(@(q) hw_two(n, sds(pairs(q, 1)), sds(pairs(q, 2)), per, false), 1:size(pairs, 1));
[hw, m] = max(hws);
end

function p = power_anova(n, k, sigma, delta, alpha, blocked)
% Power of the F test when one of k designs is shifted by delta: lambda = n delta^2 (k - 1) / (k sigma^2).
if blocked, dfw = (k - 1) * (n - 1); else, dfw = k * (n - 1); end
lambda = n * delta^2 * (k - 1) / (k * sigma^2);
p = 1 - ncfcdf(finv(1 - alpha, k - 1, dfw), k - 1, dfw, lambda);
end

function r = plan_power_anova(k, sigma, delta, alpha, power, blocked)
r = struct('n', NaN, 'powerAtN', NaN);
if ~(isfinite(sigma) && sigma > 0) || ~(isfinite(delta) && delta ~= 0) || ~(power > 0 && power < 1) || ~(alpha > 0 && alpha < 1), return; end
n = smallest_n(@(n) power_anova(n, k, sigma, delta, alpha, blocked) >= power, (norminv(1 - alpha / 2) + norminv(power))^2 * sigma^2 * k / ((k - 1) * delta^2));
if ~isnan(n), r = struct('n', n, 'powerAtN', power_anova(n, k, sigma, delta, alpha, blocked)); end
end
`;

// ── One-way and randomized-block analysis of variance ────────────────────
// The tables come from aov, f_oneway, and anova1 or anova2. When no design
// varies within itself (or, with blocks, nothing is left once the designs
// and the blocks are removed), their residual is rounding error or empty,
// and so the table is written out as the analyzer reports it: F is infinite
// (p = 0) when the means differ and undefined when they do not. As in the
// analyzer, a sum of squares at most 1e-24 of the outcomes' uncentered sum
// of squares is rounding error: 0.1, 0.3, and 0.7 each repeated three times
// leave a residual near 1e-32, which aov turns into an F near 6e31. The
// residual sum of squares the rule tests is summed directly from each
// residual: found by subtraction, as anova1 and anova2 find it, it carries
// error near 1e-16 of the total.

LIB.R.anova = `
anova_table <- function(groups, blocked) {
  # summary(aov(outcome ~ design)), or with the replication as a block
  # summary(aov(outcome ~ design + block)); fit is aov's own result.
  outcome <- unlist(groups); design <- factor(rep(seq_along(groups), lengths(groups)))
  k <- length(groups); n <- lengths(groups); means <- sapply(groups, mean); grand <- mean(outcome)
  ssb <- sum(n * (means - grand)^2)
  if (blocked) {
    R <- n[1]; block <- factor(rep(seq_len(R), k)); bm <- rowMeans(do.call(cbind, groups))
    ssblk <- k * sum((bm - grand)^2)
    # Summed from each residual y - mean_i - mean_r + mean, not found by subtraction.
    ssw <- sum(sapply(seq_len(k), function(i) sum((groups[[i]] - means[i] - bm + grand)^2)))
  } else {
    bm <- NULL; ssw <- sum(sapply(groups, function(x) sum((x - mean(x))^2)))
  }
  tiny <- 1e-24 * sum(outcome^2)   # below this, a sum of squares is rounding error
  no_spread_F <- function(ss) if (ss > tiny) Inf else NaN   # F with nothing left within the designs
  pval <- function(f, d1, d2) if (is.nan(f)) NaN else pf(f, d1, d2, lower.tail = FALSE)
  fit <- NULL
  if (ssw > tiny) {
    fit <- if (blocked) aov(outcome ~ design + block) else aov(outcome ~ design)
    tab <- summary(fit)[[1]]   # rows: the designs, the blocks (when blocked), the residuals
    e <- nrow(tab)
    res <- list(ssb = tab[1, "Sum Sq"], dfb = tab[1, "Df"], msb = tab[1, "Mean Sq"], F = tab[1, "F value"], p = tab[1, "Pr(>F)"],
                ssw = tab[e, "Sum Sq"], dfw = tab[e, "Df"], msw = tab[e, "Mean Sq"])
    if (blocked) res <- c(res, list(ssblk = tab[2, "Sum Sq"], dfblk = tab[2, "Df"], msblk = tab[2, "Mean Sq"],
                                    Fblock = tab[2, "F value"], pBlock = tab[2, "Pr(>F)"]))
    # Barely above "no spread", aov's residual can itself be rounding error; an F that is not
    # finite then comes from the sums of squares taken directly, as the analyzer takes them.
    if (!is.finite(res$F)) { res$F <- (ssb / res$dfb) / (ssw / res$dfw); res$p <- pval(res$F, res$dfb, res$dfw) }
    if (blocked && !is.finite(res$Fblock)) {
      res$Fblock <- (ssblk / res$dfblk) / (ssw / res$dfw); res$pBlock <- pval(res$Fblock, res$dfblk, res$dfw)
    }
  } else {
    dfb <- k - 1; dfw <- if (blocked) (k - 1) * (R - 1) else length(outcome) - k
    res <- list(ssb = ssb, dfb = dfb, msb = ssb / dfb, ssw = 0, dfw = dfw, msw = 0)
    res$F <- no_spread_F(ssb); res$p <- pval(res$F, dfb, dfw)
    if (blocked) {
      res <- c(res, list(ssblk = ssblk, dfblk = R - 1, msblk = ssblk / (R - 1)))
      res$Fblock <- no_spread_F(ssblk); res$pBlock <- pval(res$Fblock, R - 1, dfw)
    }
  }
  res$means <- means; res$n <- n; res$grandMean <- grand; res$blockMeans <- bm; res$fit <- fit
  # The residuals: each outcome less its design's mean and, with blocks, its replication's effect.
  # With nothing left within the designs they are all 0 (computed, they would be rounding error).
  res$resid <- unlist(lapply(seq_along(groups), function(i) groups[[i]] - means[i] - (if (blocked) bm - grand else 0)))
  if (res$ssw == 0) res$resid[] <- 0
  res
}
`;
LIB.py.anova = `
def anova_table(groups, blocked):
    """One-way analysis of variance (scipy's f_oneway for F and p, the sums of squares written
    out), or with the replication as a block the randomized-block table, written out."""
    groups = [np.asarray(g, float) for g in groups]; k = len(groups)
    means = np.array([g.mean() for g in groups]); n = np.array([len(g) for g in groups])
    y = np.concatenate(groups); grand = y.mean()
    tiny = 1e-24 * float(np.sum(y ** 2))   # below this, a sum of squares is rounding error
    no_spread_F = lambda ss: np.inf if ss > tiny else np.nan   # F with nothing left within the designs
    pval = lambda f, d1, d2: np.nan if np.isnan(f) else stats.f.sf(f, d1, d2)
    ssb = float(np.sum(n * (means - grand) ** 2))
    if blocked:
        R = int(n[0]); bm = np.column_stack(groups).mean(axis=1)
        ssblk = float(k * np.sum((bm - grand) ** 2))
        # Summed from each residual y - mean_i - mean_r + mean, not found by subtraction.
        ssw = float(sum(np.sum((g - means[i] - bm + grand) ** 2) for i, g in enumerate(groups)))
        if ssw <= tiny: ssw = 0.0
        dfb, dfblk, dfw = k - 1, R - 1, (k - 1) * (R - 1)
        msb, msblk, msw = ssb / dfb, ssblk / dfblk, ssw / dfw
        F, Fb = (msb / msw, msblk / msw) if ssw > 0 else (no_spread_F(ssb), no_spread_F(ssblk))
        # The residuals: each outcome less its design's mean and its replication's effect; with
        # nothing left within the designs they are all 0 (computed, they would be rounding error).
        resid = np.concatenate([g - means[i] - (bm - grand) for i, g in enumerate(groups)])
        if ssw == 0: resid = np.zeros_like(resid)
        return dict(ssb=ssb, dfb=dfb, msb=msb, F=F, p=pval(F, dfb, dfw), ssblk=ssblk, dfblk=dfblk, msblk=msblk,
                    Fblock=Fb, pBlock=pval(Fb, dfblk, dfw), ssw=ssw, dfw=dfw, msw=msw,
                    means=means, n=n, grandMean=grand, blockMeans=bm, resid=resid)
    ssw = float(sum(np.sum((g - g.mean()) ** 2) for g in groups)); dfb, dfw = k - 1, len(y) - k
    if ssw > tiny:
        res = stats.f_oneway(*groups); F, p = float(res.statistic), float(res.pvalue)
        if not np.isfinite(F):
            # Barely above "no spread", f_oneway's within sum of squares can come out 0; F then
            # comes from the sums of squares taken directly, as the analyzer takes them.
            F = (ssb / dfb) / (ssw / dfw); p = pval(F, dfb, dfw)
    else:
        ssw = 0.0; F = no_spread_F(ssb); p = pval(F, dfb, dfw)
    msb, msw = ssb / dfb, ssw / dfw
    resid = np.concatenate([g - means[i] for i, g in enumerate(groups)])
    if ssw == 0: resid = np.zeros_like(resid)   # nothing left within the designs
    return dict(ssb=ssb, dfb=dfb, msb=msb, F=F, p=p, ssw=ssw, dfw=dfw, msw=msw,
                means=means, n=n, grandMean=grand, blockMeans=None, resid=resid)
`;
LIB.m.anova = `
function r = anova_table(groups, blocked)
% One-way analysis of variance (anova1), or with the replication as a block the two-way table of
% anova2 on the R-by-k matrix of outcomes, one observation per cell. The statistics each returns
% are kept for multcompare.
k = numel(groups);
means = cellfun(@mean, groups); n = cellfun(@numel, groups);
y = cell2mat(cellfun(@(v) v(:), groups(:), 'UniformOutput', false));
grand = mean(y);
tiny = 1e-24 * sum(y.^2);   % below this, a sum of squares is rounding error
if blocked
    M = cell2mat(cellfun(@(v) v(:), groups, 'UniformOutput', false));   % R-by-k: row = block, column = design
    [~, tab, st] = anova2(M, 1, 'off');
    % tab rows: Columns (the designs), Rows (the blocks), Error, Total; columns: SS, df, MS, F, p
    bm = mean(M, 2);
    % The residuals: each outcome less its design's mean and its replication's effect.
    resid = reshape(M - means - (bm - grand), [], 1);
    % anova2 finds the residual sum of squares by subtraction, with error near 1e-16 of the total,
    % and so the sum the rule tests is taken from the residuals themselves.
    ssw = sum(resid.^2); flat = tab{4,3} > 0 && ssw <= tiny;   % nothing left once the designs and the blocks are removed
    if flat, ssw = 0; resid = zeros(size(resid)); end   % computed, they would be rounding error
    msw = ssw / tab{4,3};
    [F, p] = f_entry(tab, 2, flat, tiny, msw, tab{4,3}); [Fb, pb] = f_entry(tab, 3, flat, tiny, msw, tab{4,3});
    r = struct('ssb', tab{2,2}, 'dfb', tab{2,3}, 'msb', tab{2,4}, 'F', F, 'p', p, ...
               'ssblk', tab{3,2}, 'dfblk', tab{3,3}, 'msblk', tab{3,4}, 'Fblock', Fb, 'pBlock', pb, ...
               'ssw', ssw, 'dfw', tab{4,3}, 'msw', msw, 'means', means, 'n', n, 'grandMean', grand, ...
               'blockMeans', bm', 'resid', resid, 'stats', st);
else
    g = repelem((1:k)', n(:));
    [~, tab, st] = anova1(y, g, 'off');
    % tab rows: Groups, Error, Total; columns: SS, df, MS, F, p
    resid = y - reshape(means(g), [], 1);
    % anova1 finds the error sum of squares by subtraction, and so the sum the rule tests is
    % taken from the residuals themselves.
    ssw = sum(resid.^2); flat = tab{3,3} > 0 && ssw <= tiny;   % no design varies within itself
    if flat, ssw = 0; resid = zeros(size(resid)); end   % computed, they would be rounding error
    msw = ssw / tab{3,3};
    [F, p] = f_entry(tab, 2, flat, tiny, msw, tab{3,3});
    r = struct('ssb', tab{2,2}, 'dfb', tab{2,3}, 'msb', tab{2,4}, 'F', F, 'p', p, ...
               'ssw', ssw, 'dfw', tab{3,3}, 'msw', msw, 'means', means, 'n', n, 'grandMean', grand, ...
               'blockMeans', [], 'resid', resid, 'stats', st);
end
end

function [F, p] = f_entry(tab, row, flat, tiny, msw, dfw)
% F and p for one row of a table, on the mean square msw summed directly from the residuals
% (dfw degrees of freedom): the table's own F rests on an error sum of squares found by
% subtraction, which near "no spread" is rounding error or 0 (F empty). With nothing left within
% the designs (flat), F is infinite (p = 0) when the row's sum of squares exceeds tiny, and
% undefined when it does not.
if flat
    if tab{row, 2} > tiny, F = Inf; p = 0; else, F = NaN; p = NaN; end
else
    F = (tab{row, 2} / tab{row, 3}) / msw; p = fcdf(F, tab{row, 3}, dfw, 'upper');
end
end
`;

// ── Welch's analysis of variance ─────────────────────────────────────────

LIB.R.welchAnova = `
welch_anova <- function(groups) {
  # Welch (1951): each design weighted by R_i / s_i^2, nothing pooled.
  outcome <- unlist(groups); design <- factor(rep(seq_along(groups), lengths(groups)))
  ow <- oneway.test(outcome ~ design, var.equal = FALSE)
  list(F = unname(ow$statistic), df1 = unname(ow$parameter[1]), df2 = unname(ow$parameter[2]), p = ow$p.value,
       means = sapply(groups, mean), n = lengths(groups), resid = unlist(lapply(groups, function(x) x - mean(x))), test = ow)
}
`;
LIB.py.welchAnova = `
def welch_anova(groups):
    """Welch (1951): each design weighted by R_i / s_i^2, nothing pooled; R's oneway.test(var.equal=FALSE)."""
    groups = [np.asarray(g, float) for g in groups]; k = len(groups)
    n = np.array([len(g) for g in groups]); m = np.array([g.mean() for g in groups]); v = np.array([g.var(ddof=1) for g in groups])
    w = n / v; W = w.sum(); mu = np.sum(w * m) / W
    lam = np.sum((1 - w / W) ** 2 / (n - 1))
    F = (np.sum(w * (m - mu) ** 2) / (k - 1)) / (1 + 2 * (k - 2) / (k ** 2 - 1) * lam)
    df2 = (k ** 2 - 1) / (3 * lam)
    resid = np.concatenate([g - m[i] for i, g in enumerate(groups)])
    return dict(F=F, df1=k - 1, df2=df2, p=stats.f.sf(F, k - 1, df2), means=m, n=n, resid=resid)
`;
LIB.m.welchAnova = `
function r = welch_anova(groups)
% Welch (1951): each design weighted by R_i / s_i^2, nothing pooled (R's oneway.test(var.equal = FALSE)).
k = numel(groups);
n = cellfun(@numel, groups); m = cellfun(@mean, groups); v = cellfun(@var, groups);
w = n ./ v; W = sum(w); mu = sum(w .* m) / W;
lambda = sum((1 - w / W).^2 ./ (n - 1));
F = (sum(w .* (m - mu).^2) / (k - 1)) / (1 + 2 * (k - 2) / (k^2 - 1) * lambda);
df2 = (k^2 - 1) / (3 * lambda);
resid = cell2mat(cellfun(@(x) x(:) - mean(x), groups(:), 'UniformOutput', false));
r = struct('F', F, 'df1', k - 1, 'df2', df2, 'p', fcdf(F, k - 1, df2, 'upper'), 'means', m, 'n', n, 'resid', resid);
end
`;

// ── Compact letter display by insert-and-absorb ──────────────────────────
// Start with one group of every design; for each pair declared different,
// split every group holding both into one without i and one without j, and
// drop a group inside another (or equal to one kept already). The surviving
// groups, ordered by their members, take the letters a to z, then A to Z,
// then a letter with a count.

LIB.R.letters = `
letter_label <- function(q) {
  if (q <= 26) letters[q] else if (q <= 52) LETTERS[q - 26] else paste0(letters[(q - 1) %% 26 + 1], (q - 1) %/% 26)
}
letter_groups <- function(k, flagged) {
  # flagged: a list of c(i, j), the pairs declared different.
  groups <- list(seq_len(k))
  for (f in flagged) {
    nxt <- list()
    for (g in groups) {
      if (all(f %in% g)) { nxt[[length(nxt) + 1]] <- setdiff(g, f[1]); nxt[[length(nxt) + 1]] <- setdiff(g, f[2]) }
      else nxt[[length(nxt) + 1]] <- g
    }
    keep <- list()
    for (g in nxt) {
      inside <- any(sapply(nxt, function(h) length(h) > length(g) && all(g %in% h)))
      dup <- any(sapply(keep, function(h) setequal(h, g)))
      if (!inside && !dup) keep[[length(keep) + 1]] <- g
    }
    groups <- keep
  }
  groups <- groups[order(sapply(groups, function(g) paste(sprintf("%03d", sort(g)), collapse = "")))]
  out <- rep("", k)
  for (q in seq_along(groups)) for (d in groups[[q]]) out[d] <- paste0(out[d], letter_label(q))
  out
}
`;
LIB.py.letters = `
def letter_label(q):
    """The q-th letter, counted from 0: a to z, A to Z, then a letter with a count."""
    return chr(97 + q) if q < 26 else chr(65 + q - 26) if q < 52 else chr(97 + q % 26) + str(q // 26)

def letter_groups(k, flagged):
    """flagged: the pairs (i, j) declared different, counted from 0."""
    groups = [frozenset(range(k))]
    for i, j in flagged:
        nxt = []
        for g in groups:
            if i in g and j in g: nxt += [g - {i}, g - {j}]
            else: nxt.append(g)
        keep = []
        for g in nxt:
            if not any(g < h for h in nxt) and g not in keep: keep.append(g)
        groups = keep
    groups.sort(key=lambda g: sorted(g))
    out = [""] * k
    for q, g in enumerate(groups):
        for d in g: out[d] += letter_label(q)
    return out
`;
LIB.m.letters = `
function out = letter_groups(k, flagged)
% flagged: a 2-column matrix of the pairs (i, j) declared different.
groups = {1:k};
for f = 1:size(flagged, 1)
    i = flagged(f, 1); j = flagged(f, 2); nxt = {};
    for q = 1:numel(groups)
        g = groups{q};
        if ismember(i, g) && ismember(j, g), nxt{end+1} = setdiff(g, i); nxt{end+1} = setdiff(g, j); %#ok<AGROW>
        else, nxt{end+1} = g; end %#ok<AGROW>
    end
    keep = {};
    for q = 1:numel(nxt)
        g = nxt{q}; inside = false; dup = false;
        for s = 1:numel(nxt), h = nxt{s}; if numel(h) > numel(g) && all(ismember(g, h)), inside = true; end, end
        for s = 1:numel(keep), if isequal(sort(keep{s}), sort(g)), dup = true; end, end
        if ~inside && ~dup, keep{end+1} = g; end %#ok<AGROW>
    end
    groups = keep;
end
keys = cellfun(@(g) sprintf('%03d', sort(g)), groups, 'UniformOutput', false);
[~, order] = sort(keys); groups = groups(order);
out = repmat({''}, 1, k);
for q = 1:numel(groups), for d = groups{q}, out{d} = [out{d} letter_label(q)]; end, end
end

function s = letter_label(q)
% The q-th letter: a to z, A to Z, then a letter with a count.
if q <= 26, s = char('a' + q - 1); elseif q <= 52, s = char('A' + q - 27); else, s = sprintf('%c%d', 'a' + mod(q - 1, 26), floor((q - 1) / 26)); end
end
`;

// ── Post-hoc rules on the pooled mean square ─────────────────────────────
// Every rule works on diff = mean_i - mean_j with se = sqrt(msw (1/R_i +
// 1/R_j)), msw being the pooled mean square within or, with blocks, the
// residual mean square, on its degrees of freedom. The half-width is the
// critical value times se, divided by sqrt(2) for Tukey-Kramer, whose
// critical value is the studentized range q. Fisher's LSD declares nothing
// unless the F test rejects at alpha.

LIB.R.posthoc = `
posthoc_pooled <- function(groups, av, rule, alpha, pairs, control) {
  # pairs: a list of c(i, j); control: the control design, for Dunnett.
  k <- length(groups); C <- length(pairs); scale <- 1
  if (rule == "tukey") {
    # R's qtukey is approximate on few degrees of freedom (about 1% or more off at 2, several
    # percent with many designs), and below 2 it is not defined (it returns NaN with a
    # warning), and so there the critical value and the half-widths are left NaN and no pair is
    # declared different.
    crit <- if (av$dfw >= 2) qtukey(1 - alpha, k, av$dfw) else NaN; scale <- 1 / sqrt(2)
  } else if (rule == "lsd") {
    crit <- qt(1 - alpha / 2, av$dfw)
  } else if (rule == "bonferroni") {
    crit <- qt(1 - alpha / (2 * C), av$dfw)
  } else {
    crit <- qdunnett(1 - alpha, sapply(pairs, function(p) sqrt(av$n[p[1]] / av$n[control])), av$dfw)
  }
  protected <- if (rule == "lsd") isTRUE(av$p < alpha) else NA
  out <- lapply(pairs, function(p) {
    diff <- av$means[p[1]] - av$means[p[2]]; se <- sqrt(av$msw * (1 / av$n[p[1]] + 1 / av$n[p[2]]))
    hw <- crit * scale * se
    list(i = p[1], j = p[2], diff = diff, se = se, hw = hw, lo = diff - hw, hi = diff + hw,
         flagged = isTRUE(!identical(protected, FALSE) && (diff - hw > 0 || diff + hw < 0)))
  })
  list(crit = crit, protected = protected, pairs = out)
}
`;
LIB.py.posthoc = `
def posthoc_pooled(groups, av, rule, alpha, pairs, control):
    """pairs: the pairs (i, j) counted from 0; control: the control design counted from 0, for
    Dunnett. Without blocks, Tukey-Kramer's half-widths come from scipy's tukey_hsd and Dunnett's
    from scipy's dunnett, both on the pooled variance; with blocks, which those functions do not
    take, the quantiles are applied to the residual mean square directly."""
    groups = [np.asarray(g, float) for g in groups]; k = len(groups); C = len(pairs)
    means, n, msw, dfw = av["means"], av["n"], av["msw"], av["dfw"]
    blocked = av["blockMeans"] is not None
    I = np.array([i for i, j in pairs]); J = np.array([j for i, j in pairs])
    diff = means[I] - means[J]; se = np.sqrt(msw * (1 / n[I] + 1 / n[J]))
    protected = bool(av["p"] < alpha) if rule == "lsd" else None
    if rule == "tukey":
        crit = stats.studentized_range.ppf(1 - alpha, k, dfw); hw = crit * se / np.sqrt(2)
        if not blocked and msw > 0:
            ci = stats.tukey_hsd(*groups).confidence_interval(1 - alpha)
            hw = (ci.high[I, J] - ci.low[I, J]) / 2
    elif rule == "dunnett":
        if not blocked and msw > 0:
            # SciPy finds Dunnett's critical value by randomized quadrature; the seed makes it repeatable.
            ci = stats.dunnett(*[groups[i] for i in I], control=groups[control],
                               random_state=np.random.default_rng(1)).confidence_interval(1 - alpha)
            hw = (ci.high - ci.low) / 2; crit = hw[0] / se[0]
        else:
            crit = qdunnett(1 - alpha, np.sqrt(n[I] / n[control]), dfw); hw = crit * se
    else:
        crit = stats.t.ppf(1 - alpha / 2, dfw) if rule == "lsd" else stats.t.ppf(1 - alpha / (2 * C), dfw)
        hw = crit * se
    lo, hi = diff - hw, diff + hw
    flagged = ((lo > 0) | (hi < 0)) & (protected is not False)
    out = [dict(i=int(I[q]), j=int(J[q]), diff=diff[q], se=se[q], hw=hw[q], lo=lo[q], hi=hi[q], flagged=bool(flagged[q])) for q in range(C)]
    return dict(crit=crit, protected=protected, pairs=out)
`;
LIB.m.posthoc = `
function r = posthoc_pooled(~, av, rule, alpha, pairs, control)
% The designs' outcomes (the first argument) enter only through av, the analysis of variance.
% pairs: a 2-column matrix of (i, j); control: the control design, for Dunnett. LSD's and
% Bonferroni's critical values come from multcompare on the statistics of anova1 or, with blocks,
% of anova2 (comparing the column means), read back from the first pair's half-width; with no
% spread left (msw = 0) every half-width is 0, and the critical value is read with the variance
% set to 1. multcompare finds Dunnett's value only to within about 1e-4 (its root search stops
% there), and Tukey-Kramer's studentized range only approximately on few degrees of freedom
% (about 1e-4 off at 2), and so those two are computed here.
C = size(pairs, 1); means = av.means; n = av.n; msw = av.msw;
if strcmp(rule, 'lsd'), protected = av.p < alpha; else, protected = []; end
if strcmp(rule, 'dunnett')
    crit = qdunnett(1 - alpha, sqrt(n(pairs(:, 1)) / n(control)), av.dfw);
elseif strcmp(rule, 'tukey')
    % The studentized range q, with hw = q se / sqrt(2). multcompare(stats, 'CriticalValueType',
    % 'tukey-kramer') gives the same intervals except on very few degrees of freedom.
    crit = studrange_inv(1 - alpha, numel(means), av.dfw);
else
    types = struct('lsd', 'lsd', 'bonferroni', 'bonferroni');
    % The statistics carry anova1's or anova2's own variance, found by subtraction; they are given
    % the directly summed one (or 1 when there is none), so the read-back matches av.msw.
    st = av.stats; s2 = msw;
    if ~(msw > 0), s2 = 1; end
    if isfield(st, 's'), st.s = sqrt(s2); else, st.sigmasq = s2; end
    opts = {'CriticalValueType', types.(rule), 'Alpha', alpha, 'Display', 'off'};
    if isfield(st, 'sigmasq'), opts = [opts, {'Estimate', 'column'}]; end
    c = multcompare(st, opts{:});
    i1 = pairs(1, 1); j1 = pairs(1, 2);
    row = find((c(:, 1) == i1 & c(:, 2) == j1) | (c(:, 1) == j1 & c(:, 2) == i1), 1);
    crit = (c(row, 5) - c(row, 3)) / 2 / sqrt(s2 * (1 / n(i1) + 1 / n(j1)));
end
scale = 1;
if strcmp(rule, 'tukey'), scale = 1 / sqrt(2); end
out = cell(1, C);
for q = 1:C
    i = pairs(q, 1); j = pairs(q, 2);
    d = means(i) - means(j); se = sqrt(msw * (1 / n(i) + 1 / n(j))); hw = crit * scale * se; lo = d - hw; hi = d + hw;
    fl = ~isequal(protected, false) && (lo > 0 || hi < 0);
    out{q} = struct('i', i, 'j', j, 'diff', d, 'se', se, 'hw', hw, 'lo', lo, 'hi', hi, 'flagged', fl);
end
r = struct('crit', crit, 'protected', protected, 'pairs', {out});
end
`;

// ── Post-hoc rules that keep each design's variance (Welch) ──────────────
// Games-Howell is the studentized range on each pair's own Welch degrees of
// freedom; the other rule is Bonferroni on each pair's own Welch t interval
// at 1 - alpha/C.

LIB.R.posthocWelch = `
posthoc_welch <- function(groups, rule, alpha, pairs) {
  k <- length(groups); C <- length(pairs)
  out <- lapply(pairs, function(p) {
    xi <- groups[[p[1]]]; xj <- groups[[p[2]]]
    a1 <- var(xi) / length(xi); a2 <- var(xj) / length(xj)
    se <- sqrt(a1 + a2); df <- (a1 + a2)^2 / (a1^2 / (length(xi) - 1) + a2^2 / (length(xj) - 1))
    diff <- mean(xi) - mean(xj)
    if (rule == "gameshowell") {
      # R's qtukey and ptukey are approximate on few degrees of freedom (about 1% or more off at 2,
      # several percent with many designs), and below 2, as between two designs of 2 replications
      # each, they are not defined (they return NaN with a warning), and so there the critical
      # value, the half-width, and the p-value are left NaN and the pair is not declared different.
      crit <- if (df >= 2) qtukey(1 - alpha, k, df) else NaN; hw <- crit * se / sqrt(2)
      pval <- if (df >= 2) ptukey(abs(diff) / (se / sqrt(2)), k, df, lower.tail = FALSE) else NaN
    } else {
      crit <- qt(1 - alpha / (2 * C), df); hw <- crit * se
      pval <- min(1, C * 2 * pt(-abs(diff / se), df))
    }
    list(i = p[1], j = p[2], diff = diff, se = se, df = df, crit = crit, hw = hw, lo = diff - hw, hi = diff + hw, p = pval,
         flagged = isTRUE(diff - hw > 0 || diff + hw < 0))
  })
  list(pairs = out)
}
`;
LIB.py.posthocWelch = `
def posthoc_welch(groups, rule, alpha, pairs):
    """pairs: the pairs (i, j) counted from 0."""
    groups = [np.asarray(g, float) for g in groups]; k = len(groups); C = len(pairs)
    n = np.array([len(g) for g in groups]); m = np.array([g.mean() for g in groups]); v = np.array([g.var(ddof=1) for g in groups])
    I = np.array([i for i, j in pairs]); J = np.array([j for i, j in pairs])
    a1, a2 = v[I] / n[I], v[J] / n[J]
    se = np.sqrt(a1 + a2); df = (a1 + a2) ** 2 / (a1 ** 2 / (n[I] - 1) + a2 ** 2 / (n[J] - 1))
    diff = m[I] - m[J]
    if rule == "gameshowell":
        crit = stats.studentized_range.ppf(1 - alpha, k, df); hw = crit * se / np.sqrt(2)
        p = np.minimum(1, stats.studentized_range.sf(np.abs(diff) / (se / np.sqrt(2)), k, df))
    else:
        crit = stats.t.ppf(1 - alpha / (2 * C), df); hw = crit * se
        p = np.minimum(1, C * 2 * stats.t.sf(np.abs(diff / se), df))
    lo, hi = diff - hw, diff + hw
    return dict(pairs=[dict(i=int(I[q]), j=int(J[q]), diff=diff[q], se=se[q], df=df[q], crit=crit[q], hw=hw[q], lo=lo[q], hi=hi[q],
                            p=p[q], flagged=bool(lo[q] > 0 or hi[q] < 0)) for q in range(C)])
`;
LIB.m.posthocWelch = `
function r = posthoc_welch(groups, rule, alpha, pairs)
% pairs: a 2-column matrix of (i, j).
k = numel(groups); C = size(pairs, 1); out = cell(1, C);
for q = 1:C
    i = pairs(q, 1); j = pairs(q, 2); xi = groups{i}(:); xj = groups{j}(:);
    a1 = var(xi) / numel(xi); a2 = var(xj) / numel(xj);
    se = sqrt(a1 + a2); df = (a1 + a2)^2 / (a1^2 / (numel(xi) - 1) + a2^2 / (numel(xj) - 1));
    d = mean(xi) - mean(xj);
    if strcmp(rule, 'gameshowell')
        crit = studrange_inv(1 - alpha, k, df); hw = crit * se / sqrt(2);
        p = 1 - studrange_cdf(abs(d) / (se / sqrt(2)), k, df);
    else
        crit = tinv(1 - alpha / (2 * C), df); hw = crit * se;
        p = min(1, C * 2 * tcdf(-abs(d / se), df));
    end
    out{q} = struct('i', i, 'j', j, 'diff', d, 'se', se, 'df', df, 'crit', crit, 'hw', hw, 'lo', d - hw, 'hi', d + hw, 'p', p, ...
                    'flagged', d - hw > 0 || d + hw < 0);
end
r = struct('pairs', {out});
end
`;

// ── The studentized range in MATLAB, which has no public ptukey ──────────
// P(Q <= q) for the range of k standard normal means divided by an
// independent s on nu degrees of freedom: the density of s = S/sigma times
// the range probability k int phi(x) [Phi(x + q s) - Phi(x)]^(k-1) dx,
// integrated over s.

LIB.m.studrange = `
function p = studrange_cdf(q, k, nu)
if q <= 0, p = 0; return; end
dens = @(s) exp(log(2) + (nu / 2) * log(nu / 2) + (nu - 1) .* log(s) - nu .* s.^2 / 2 - gammaln(nu / 2));
inner = @(s) k * integral(@(x) normpdf(x) .* (normcdf(x + q * s) - normcdf(x)).^(k - 1), -8, 8, 'RelTol', 1e-10, 'AbsTol', 1e-13);
p = integral(@(s) dens(s) .* arrayfun(inner, s), 0, Inf, 'RelTol', 1e-10, 'AbsTol', 1e-13);
p = min(1, p);
end

function q = studrange_inv(p, k, nu)
% The bracket's upper end doubles until it holds the quantile, which grows fast on few degrees of freedom.
hi = 50;
while studrange_cdf(hi, k, nu) < p, hi = 2 * hi; end
q = fzero(@(q) studrange_cdf(q, k, nu) - p, [0.05 hi], optimset('TolX', 1e-10));
end
`;

// ── Dunnett's critical value, exact for unequal sizes ────────────────────
// P(max |T_i| <= c) = int f(s) int phi(z) prod_i [Phi(l_i z + c s a_i) -
// Phi(l_i z - c s a_i)] dz ds, with l_i = sqrt(R_i / R_0) for the control's
// R_0, a_i = sqrt(1 + l_i^2), and f the density of s = S/sigma on nu degrees
// of freedom, integrated over the range of s that holds all but 1e-12 of
// its probability.

LIB.R.dunnett = `
pdunnett <- function(cc, lambdas, nu) {
  a <- sqrt(1 + lambdas^2)
  dens <- function(s) 2 * nu * s * dchisq(nu * s^2, nu)
  inner <- function(s) integrate(function(z) {
    pr <- rep(1, length(z))
    for (m in seq_along(lambdas)) pr <- pr * (pnorm(lambdas[m] * z + cc * s * a[m]) - pnorm(lambdas[m] * z - cc * s * a[m]))
    dnorm(z) * pr
  }, -8, 8, rel.tol = 1e-10)$value
  lim <- sqrt(qchisq(c(1e-12, 1 - 1e-12), nu) / nu)
  integrate(function(s) dens(s) * sapply(s, inner), lim[1], lim[2], rel.tol = 1e-9)$value
}
qdunnett <- function(p, lambdas, nu) {
  # The probability rises with cc, and so the search extends the bracket upward as far as it must
  # (on 1 degree of freedom, the critical value is near 12.7).
  uniroot(function(cc) pdunnett(cc, lambdas, nu) - p, c(0.5, 10), extendInt = "upX", tol = 1e-9)$root
}
`;
LIB.py.dunnett = `
def pdunnett(c, lambdas, nu):
    lam = np.asarray(lambdas, float); a = np.sqrt(1 + lam ** 2)
    z = np.linspace(-8, 8, 3201); phi = stats.norm.pdf(z)
    def inner(s):
        lz = np.outer(lam, z); w = (c * s * a)[:, None]
        return integrate.simpson(phi * np.prod(stats.norm.cdf(lz + w) - stats.norm.cdf(lz - w), axis=0), x=z)
    dens = lambda s: stats.chi.pdf(s * np.sqrt(nu), nu) * np.sqrt(nu)
    lo, hi = stats.chi.ppf([1e-12, 1 - 1e-12], nu) / np.sqrt(nu)
    return integrate.quad(lambda s: dens(s) * inner(s), lo, hi, epsabs=1e-13, epsrel=1e-10, limit=200)[0]

def qdunnett(p, lambdas, nu):
    # The bracket's upper end doubles until it holds the root (on 1 degree of freedom, near 12.7).
    hi = 10.0
    while pdunnett(hi, lambdas, nu) < p: hi *= 2
    return optimize.brentq(lambda c: pdunnett(c, lambdas, nu) - p, 0.5, hi, xtol=1e-10)
`;
LIB.m.dunnett = `
function p = pdunnett(c, lambdas, nu)
lambdas = lambdas(:); a = sqrt(1 + lambdas.^2);
dens = @(s) 2 * nu * s .* chi2pdf(nu * s.^2, nu);
lim = sqrt(chi2inv([1e-12, 1 - 1e-12], nu) / nu);
p = integral(@(s) dens(s) .* arrayfun(@(t) dunnett_inner(t, c, lambdas, a), s), lim(1), lim(2), 'RelTol', 1e-10, 'AbsTol', 1e-13);
end

function v = dunnett_inner(s, c, lambdas, a)
% The integral over the control's standardized mean z, at one value s of S/sigma.
v = integral(@(z) normpdf(z) .* prod(normcdf(lambdas * z + c * s * a) - normcdf(lambdas * z - c * s * a), 1), ...
             -8, 8, 'RelTol', 1e-10, 'AbsTol', 1e-13);
end

function c = qdunnett(p, lambdas, nu)
% The bracket's upper end doubles until it holds the root (on 1 degree of freedom, near 12.7).
hi = 10;
while pdunnett(hi, lambdas, nu) < p, hi = 2 * hi; end
c = fzero(@(c) pdunnett(c, lambdas, nu) - p, [0.5 hi], optimset('TolX', 1e-10));
end
`;

// ── Kruskal-Wallis and Dunn's pairwise comparisons ───────────────────────
// Dunn's z for a pair is its difference of mean ranks over
// sqrt(v (1/R_i + 1/R_j)), where v = N (N + 1)/12 - T/(12 (N - 1)) is the
// pooled rank variance and T the sum of t^3 - t over the tied groups. When
// every outcome is equal, no tie correction is possible: the analyzer leaves
// H uncorrected (0, with p = 1), v is 0, and every z and p is missing.

LIB.R.kruskal = `
kruskal_dunn <- function(groups, alpha, adjust, pairs) {
  # Kruskal-Wallis (tie-corrected) and Dunn's z for each pair, adjusted by Bonferroni or Holm.
  k <- length(groups); n <- lengths(groups)
  y <- unlist(groups); g <- factor(rep(seq_len(k), n), levels = seq_len(k))
  r <- rank(y); N <- length(y); tt <- rle(sort(y))$lengths; ties <- sum(tt^3 - tt)
  # H from the exact ranks with the tie correction, left uncorrected when every outcome is equal
  # (no correction is possible there; the analyzer does the same).
  H <- 12 / (N * (N + 1)) * sum(tapply(r, g, sum)^2 / n) - 3 * (N + 1)
  if (ties < N^3 - N) H <- H / (1 - ties / (N^3 - N))
  p <- pchisq(H, k - 1, lower.tail = FALSE)
  # kw <- kruskal.test(y, g)   # the same H, but it counts ties after rounding to 15 digits, and so can differ when outcomes differ only by rounding
  v <- N * (N + 1) / 12 - ties / (12 * (N - 1))   # the pooled rank variance, tie-corrected
  mr <- as.vector(tapply(r, g, mean))
  out <- lapply(pairs, function(pr) {
    i <- pr[1]; j <- pr[2]
    se <- sqrt(v * (1 / n[i] + 1 / n[j])); z <- (mr[i] - mr[j]) / se
    list(i = i, j = j, diff = mr[i] - mr[j], se = se, z = z, p = 2 * pnorm(-abs(z)))
  })
  padj <- adjust_p(sapply(out, function(o) o$p), adjust)
  for (q in seq_along(out)) { out[[q]]$pAdj <- padj[q]; out[[q]]$flagged <- isTRUE(padj[q] < alpha) }
  list(H = H, df = k - 1, p = p, pairs = out)
}
`;
LIB.py.kruskal = `
def kruskal_dunn(groups, alpha, adjust, pairs):
    """scipy's kruskal (tie-corrected) and Dunn's z for each pair, adjusted by Bonferroni or Holm."""
    groups = [np.asarray(g, float) for g in groups]; k = len(groups)
    n = np.array([len(g) for g in groups]); y = np.concatenate(groups); N = len(y)
    r = stats.rankdata(y); _, counts = np.unique(y, return_counts=True); ties = float(np.sum(counts ** 3 - counts))
    rank_sums = np.bincount(np.repeat(np.arange(k), n), weights=r, minlength=k)
    if ties < N ** 3 - N:
        kw = stats.kruskal(*groups); H, p = float(kw.statistic), float(kw.pvalue)
    else:
        # Every outcome equal: scipy's kruskal refuses, and the analyzer reports H uncorrected.
        H = 12 / (N * (N + 1)) * float(np.sum(rank_sums ** 2 / n)) - 3 * (N + 1); p = float(stats.chi2.sf(H, k - 1))
    v = N * (N + 1) / 12 - ties / (12 * (N - 1))   # the pooled rank variance, tie-corrected
    mr = rank_sums / n
    I = np.array([pr[0] for pr in pairs]); J = np.array([pr[1] for pr in pairs])
    diff = mr[I] - mr[J]; se = np.sqrt(v * (1 / n[I] + 1 / n[J]))
    with np.errstate(divide="ignore", invalid="ignore"):   # v is 0 when every outcome is equal
        z = diff / se
    pv = 2 * stats.norm.sf(np.abs(z)); padj = adjust_p(pv, adjust)
    out = [dict(i=int(I[q]), j=int(J[q]), diff=diff[q], se=se[q], z=z[q], p=pv[q], pAdj=padj[q], flagged=bool(padj[q] < alpha))
           for q in range(len(pairs))]
    return dict(H=H, df=k - 1, p=p, pairs=out)
`;
LIB.m.kruskal = `
function r = kruskal_dunn(groups, alpha, adjust, pairs)
% kruskalwallis (tie-corrected) and Dunn's z for each pair, adjusted by Bonferroni or Holm.
k = numel(groups); n = cellfun(@numel, groups); y = []; g = [];
for i = 1:k, y = [y; groups{i}(:)]; g = [g; i * ones(n(i), 1)]; end %#ok<AGROW>
rk = tiedrank(y); N = numel(y);
[~, ~, grp] = unique(y); counts = accumarray(grp, 1); ties = sum(counts.^3 - counts);
rankSums = accumarray(g, rk, [k 1])';
if ties < N^3 - N
    [p, tab] = kruskalwallis(y, g, 'off'); H = tab{2, 5};
else
    % Every outcome equal: kruskalwallis would divide 0 by 0, and the analyzer reports H uncorrected.
    H = 12 / (N * (N + 1)) * sum(rankSums.^2 ./ n) - 3 * (N + 1); p = chi2cdf(H, k - 1, 'upper');
end
v = N * (N + 1) / 12 - ties / (12 * (N - 1));   % the pooled rank variance, tie-corrected
mr = rankSums ./ n; I = pairs(:, 1)'; J = pairs(:, 2)';
d = mr(I) - mr(J); se = sqrt(v * (1 ./ n(I) + 1 ./ n(J))); z = d ./ se;
ps = 2 * normcdf(-abs(z)); padj = adjust_p(ps, adjust);
out = cell(1, numel(I));
for q = 1:numel(I)
    out{q} = struct('i', I(q), 'j', J(q), 'diff', d(q), 'se', se(q), 'z', z(q), 'p', ps(q), 'pAdj', padj(q), 'flagged', padj(q) < alpha);
end
r = struct('H', H, 'df', k - 1, 'p', p, 'pairs', {out});
end
`;

// ── Friedman's test and Siegel and Castellan's pairwise comparisons ──────
// Each block (replication) ranks the k designs among themselves; the
// statistic is 12 sum (S_j - R (k + 1)/2)^2 / (R k (k + 1) - T/(k - 1)) with
// S_j the designs' rank sums and T the sum of t^3 - t over the ties within
// blocks, and a pair's z is its difference of rank sums over
// sqrt(R k (k + 1)/6). When every block is tied throughout, the statistic is
// 0/0 and missing, as in R's friedman.test.

LIB.R.friedman = `
friedman_pairs <- function(groups, alpha, adjust, pairs) {
  # friedman.test (tie-corrected) and each pair's difference of rank sums over sqrt(R k (k + 1) / 6),
  # adjusted by Bonferroni or Holm.
  M <- do.call(cbind, groups)   # row = block (replication), column = design
  fr <- friedman.test(M)
  k <- ncol(M); R <- nrow(M)
  rank_sums <- colSums(t(apply(M, 1, rank)))
  se <- sqrt(R * k * (k + 1) / 6)
  out <- lapply(pairs, function(pr) {
    d <- unname(rank_sums[pr[1]] - rank_sums[pr[2]]); z <- d / se
    list(i = pr[1], j = pr[2], diff = d, se = se, z = z, p = 2 * pnorm(-abs(z)))
  })
  padj <- adjust_p(sapply(out, function(o) o$p), adjust)
  for (q in seq_along(out)) { out[[q]]$pAdj <- padj[q]; out[[q]]$flagged <- isTRUE(padj[q] < alpha) }
  list(chi2 = unname(fr$statistic), df = unname(fr$parameter), p = fr$p.value, pairs = out, test = fr)
}
`;
LIB.py.friedman = `
def friedman_pairs(groups, alpha, adjust, pairs):
    """Friedman's test with the tie correction, written out because scipy's friedmanchisquare needs three
    designs or more, and each pair's difference of rank sums over sqrt(R k (k + 1) / 6), adjusted by
    Bonferroni or Holm."""
    M = np.column_stack([np.asarray(g, float) for g in groups]); R, k = M.shape   # row = block, column = design
    rank_sums = stats.rankdata(M, axis=1).sum(axis=0)
    tie_term = 0.0
    for row in M:
        _, counts = np.unique(row, return_counts=True); tie_term += float(np.sum(counts ** 3 - counts))
    den = R * k * (k + 1) - tie_term / (k - 1)
    chi2 = 12 * float(np.sum((rank_sums - R * (k + 1) / 2) ** 2)) / den if den > 0 else np.nan
    se = np.sqrt(R * k * (k + 1) / 6)
    I = np.array([pr[0] for pr in pairs]); J = np.array([pr[1] for pr in pairs])
    diff = rank_sums[I] - rank_sums[J]; z = diff / se
    pv = 2 * stats.norm.sf(np.abs(z)); padj = adjust_p(pv, adjust)
    out = [dict(i=int(I[q]), j=int(J[q]), diff=diff[q], se=se, z=z[q], p=pv[q], pAdj=padj[q], flagged=bool(padj[q] < alpha))
           for q in range(len(pairs))]
    return dict(chi2=chi2, df=k - 1, p=float(stats.chi2.sf(chi2, k - 1)), pairs=out)
`;
LIB.m.friedman = `
function r = friedman_pairs(groups, alpha, adjust, pairs)
% Friedman's test with the tie correction, written out as in the R and Python forms so that a block
% tied throughout gives a missing statistic, as in R and the analyzer; and each pair's difference of
% rank sums over sqrt(R k (k + 1) / 6), adjusted by Bonferroni or Holm.
M = cell2mat(cellfun(@(v) v(:), groups, 'UniformOutput', false)); [R, k] = size(M);   % row = block, column = design
rk = zeros(R, k); tieTerm = 0;
for b = 1:R
    rk(b, :) = tiedrank(M(b, :));
    [~, ~, grp] = unique(M(b, :)); counts = accumarray(grp(:), 1); tieTerm = tieTerm + sum(counts.^3 - counts);
end
rankSums = sum(rk, 1);
den = R * k * (k + 1) - tieTerm / (k - 1);
chi2 = NaN;
if den > 0, chi2 = 12 * sum((rankSums - R * (k + 1) / 2).^2) / den; end
se = sqrt(R * k * (k + 1) / 6);
I = pairs(:, 1)'; J = pairs(:, 2)';
d = rankSums(I) - rankSums(J); z = d / se;
ps = 2 * normcdf(-abs(z)); padj = adjust_p(ps, adjust);
out = cell(1, numel(I));
for q = 1:numel(I)
    out{q} = struct('i', I(q), 'j', J(q), 'diff', d(q), 'se', se, 'z', z(q), 'p', ps(q), 'pAdj', padj(q), 'flagged', padj(q) < alpha);
end
r = struct('chi2', chi2, 'df', k - 1, 'p', chi2cdf(chi2, k - 1, 'upper'), 'pairs', {out});
end
`;

// ── Subset selection with Rinott's second-stage sizes ────────────────────
// The screen runs at 1 - alpha/2 and Rinott's sizing at 1 - alpha/2, and so
// the whole holds at 1 - alpha. Rinott's h solves
//   P* = int g(v) [ int g(u) Phi(h u v / sqrt(u^2 + v^2)) du ]^(k-1) dv,
// g the density of s = S/sigma on nu = n0 - 1 degrees of freedom and n0 the
// smallest R (the chi-square form with x = nu u^2 and y = nu v^2). Each
// integral runs over the range of s that holds all but 2e-12 of its
// probability, split at 1/h and 10/h: on a first stage of two replications h
// is 25 or more, and the inner probability rises in a narrow stretch near
// s = 1/h that an adaptive rule can otherwise miss. The search for h doubles
// the upper end of its bracket until it holds the root, as the analyzer's does.

LIB.R.subset = `
rinott_h <- function(n0, k, pstar) {
  # s = S / sigma has density 2 nu s dchisq(nu s^2, nu), and lim holds all but 2e-12 of it.
  nu <- n0 - 1
  lim <- sqrt(qchisq(c(1e-12, 1 - 1e-12), nu) / nu)
  over_s <- function(f, h) {
    # The integral of f(s) against that density, in pieces split at 1/h and 10/h.
    pts <- sort(c(lim, c(1, 10) / h)); pts <- pts[pts >= lim[1] & pts <= lim[2]]
    sum(sapply(seq_len(length(pts) - 1), function(i)
      integrate(function(s) 2 * nu * s * dchisq(nu * s^2, nu) * f(s), pts[i], pts[i + 1], rel.tol = 1e-10)$value))
  }
  pcs <- function(h) over_s(function(v) sapply(v, function(vv) over_s(function(u) pnorm(h * u * vv / sqrt(u^2 + vv^2)), h))^(k - 1), h)
  # The probability rises with h, and so the search extends the bracket upward as far as it must.
  uniroot(function(h) pcs(h) - pstar, c(0.5, 12), extendInt = "upX", tol = 1e-8)$root
}
subset_selection <- function(groups, alpha, delta, dir) {
  k <- length(groups); n <- lengths(groups)
  if (k < 2 || !isTRUE(delta > 0) || any(n < 2)) return(list(ok = FALSE))
  m <- sapply(groups, mean); s2 <- sapply(groups, var)
  n0 <- min(n); a0 <- alpha / 2
  tt <- qt((1 - a0)^(1 / (k - 1)), n0 - 1)
  W <- tt * sqrt(outer(s2 / n, s2 / n, "+"))
  slack <- pmax(0, W - delta)
  # Design i survives when its mean is within the slack of every other design's.
  mi <- matrix(m, k, k); mj <- t(mi)   # mi[i, j] is design i's mean, mj[i, j] design j's
  ok <- if (dir == "max") mi >= mj - slack else mi <= mj + slack
  diag(ok) <- TRUE
  surv <- apply(ok, 1, all)
  h <- rinott_h(n0, k, 1 - alpha / 2)
  N <- ifelse(surv, pmax(n, ceiling((h * sqrt(s2) / delta)^2)), NaN)
  list(ok = TRUE, t = tt, h = h, best = if (dir == "max") which.max(m) else which.min(m),
       survivors = surv, N = N, additional = N - n)
}
`;
LIB.py.subset = `
def rinott_h(n0, k, pstar):
    from scipy import special   # the plain normal cdf, which quad calls many times
    nu = n0 - 1
    # The density of s = S / sigma on nu degrees of freedom; lo and hi hold all but 2e-12 of it.
    lc = np.log(2) + (nu / 2) * np.log(nu / 2) - special.gammaln(nu / 2)
    dens = lambda s: np.exp(lc + (nu - 1) * np.log(s) - nu * s * s / 2)
    lo, hi = np.sqrt(stats.chi2.ppf([1e-12, 1 - 1e-12], nu) / nu)
    def over_s(f, h):
        # The integral of f(s) against that density, told where the inner probability rises.
        pts = [p for p in (1 / h, 10 / h) if lo < p < hi]
        return integrate.quad(lambda s: dens(s) * f(s), lo, hi, points=pts, epsabs=1e-12, epsrel=1e-10, limit=200)[0]
    def pcs(h):
        return over_s(lambda v: over_s(lambda u: special.ndtr(h * u * v / np.sqrt(u * u + v * v)), h) ** (k - 1), h)
    # The probability rises with h; the bracket's upper end doubles until it holds the root.
    top = 12.0
    while pcs(top) < pstar: top *= 2
    return optimize.brentq(lambda h: pcs(h) - pstar, 0.5, top, xtol=1e-8)

def subset_selection(groups, alpha, delta, dir):
    groups = [np.asarray(g, float) for g in groups]; k = len(groups)
    n = np.array([len(g) for g in groups])
    if k < 2 or not (delta > 0) or np.any(n < 2): return dict(ok=False)
    m = np.array([g.mean() for g in groups]); s2 = np.array([g.var(ddof=1) for g in groups])
    n0 = int(n.min()); a0 = alpha / 2
    t = stats.t.ppf((1 - a0) ** (1 / (k - 1)), n0 - 1)
    W = t * np.sqrt(s2[:, None] / n[:, None] + s2[None, :] / n[None, :])
    slack = np.maximum(0.0, W - delta)
    # Design i survives when its mean is within the slack of every other design's.
    ok = (m[:, None] >= m[None, :] - slack) if dir == "max" else (m[:, None] <= m[None, :] + slack)
    np.fill_diagonal(ok, True)
    surv = ok.all(axis=1)
    h = rinott_h(n0, k, 1 - alpha / 2)
    N = np.where(surv, np.maximum(n, np.ceil((h * np.sqrt(s2) / delta) ** 2)), np.nan)
    return dict(ok=True, t=t, h=h, best=int(np.argmax(m) if dir == "max" else np.argmin(m)), survivors=surv, N=N, additional=N - n)
`;
LIB.m.subset = `
function h = rinott_h(n0, k, pstar)
nu = n0 - 1;
lim = sqrt(chi2inv([1e-12, 1 - 1e-12], nu) / nu);   % holds all but 2e-12 of the density of s = S / sigma
pcs = @(h) rinott_over_s(@(v) arrayfun(@(vv) rinott_over_s(@(u) normcdf(h * u * vv ./ sqrt(u.^2 + vv^2)), nu, h, lim), v).^(k - 1), nu, h, lim);
% The probability rises with h; the bracket's upper end doubles until it holds the root.
top = 12;
while pcs(top) < pstar, top = 2 * top; end
h = fzero(@(h) pcs(h) - pstar, [0.5 top], optimset('TolX', 1e-10));
end

function v = rinott_over_s(f, nu, h, lim)
% The integral of f(s) against the density of s over lim, told where the inner probability rises.
dens = @(s) exp(log(2) + (nu / 2) * log(nu / 2) + (nu - 1) .* log(s) - nu .* s.^2 / 2 - gammaln(nu / 2));
w = [1 10] / h; w = w(w > lim(1) & w < lim(2));
v = integral(@(s) dens(s) .* f(s), lim(1), lim(2), 'Waypoints', w, 'RelTol', 1e-10, 'AbsTol', 1e-12);
end

function r = subset_selection(groups, alpha, delta, dir)
k = numel(groups); n = cellfun(@numel, groups);
if k < 2 || ~(delta > 0) || any(n < 2), r = struct('ok', false); return; end
m = cellfun(@mean, groups); s2 = cellfun(@var, groups);
n0 = min(n); a0 = alpha / 2;
t = tinv((1 - a0)^(1 / (k - 1)), n0 - 1);
W = t * sqrt(s2' ./ n' + s2 ./ n);
slack = max(0, W - delta);
% Design i survives when its mean is within the slack of every other design's.
if strcmp(dir, 'max'), ok = m' >= m - slack; else, ok = m' <= m + slack; end
ok(logical(eye(k))) = true;
surv = all(ok, 2)';
h = rinott_h(n0, k, 1 - alpha / 2);
% A missing h leaves every N missing ('includenan'), as in the analyzer.
N = nan(1, k); N(surv) = max(n(surv), ceil((h * sqrt(s2(surv)) / delta).^2), 'includenan');
if strcmp(dir, 'max'), [~, best] = max(m); else, [~, best] = min(m); end
r = struct('ok', true, 't', t, 'h', h, 'best', best, 'survivors', surv, 'N', N, 'additional', N - n);
end
`;

// ── Steady State: time-weighted averages of a step function ──────────────
// A time-persistent record's value holds from its time to the next record's,
// and the last record's until the end time, or for no time when there is none.

LIB.R.timeWeighted = `
trajectory_end <- function(t, end_time) if (is.nan(end_time)) t[length(t)] else end_time
tw_mean <- function(t, v, t_end, lo, hi) {
  # The time average of the step function over [lo, hi]: each record's value counts for the part
  # of its holding span (to the next record, the last to t_end) that lies inside [lo, hi].
  # NaN when the trajectory covers none of [lo, hi].
  seg_end <- c(t[-1], t_end)
  ov <- pmax(0, pmin(seg_end, hi) - pmax(t, lo))
  if (!isTRUE(sum(ov) > 0)) return(NaN)
  sum(v * ov) / sum(ov)
}
`;
LIB.py.timeWeighted = `
def trajectory_end(t, end_time):
    """Where the last record stops holding: the end time, or the last record's own time."""
    return t[-1] if np.isnan(end_time) else end_time

def tw_mean(t, v, t_end, lo, hi):
    """The time average of the step function over [lo, hi]: each record's value counts for the part
    of its holding span (to the next record, the last to t_end) that lies inside [lo, hi].
    nan when the trajectory covers none of [lo, hi]."""
    t = np.asarray(t, float); v = np.asarray(v, float)
    seg_end = np.append(t[1:], t_end)
    ov = np.maximum(0.0, np.minimum(seg_end, hi) - np.maximum(t, lo))
    tot = ov.sum()
    return float(np.sum(v * ov) / tot) if tot > 0 else np.nan
`;
LIB.m.timeWeighted = `
function e = trajectory_end(t, end_time)
% Where the last record stops holding: the end time, or the last record's own time.
if isnan(end_time), e = t(end); else, e = end_time; end
end

function m = tw_mean(t, v, t_end, lo, hi)
% The time average of the step function over [lo, hi]: each record's value counts for the part
% of its holding span (to the next record, the last to t_end) that lies inside [lo, hi].
% NaN when the trajectory covers none of [lo, hi].
t = t(:)'; v = v(:)';
seg_end = [t(2:end), t_end];
ov = max(0, min(seg_end, hi) - max(t, lo));
if sum(ov) > 0, m = sum(v .* ov) / sum(ov); else, m = NaN; end
end
`;

// ── Summary and Plots: a replication's outcome, and every replication together ──
// A replication's outcome is the mean of its observations (tally), the time
// average of its state from its first record to where its last stops
// holding (time-persistent), or its one value; a replication with no records
// gives none (NaN). The time-weighted mean of every replication together is
// the total area under the state over the total time covered. These use
// trajectory_end and tw_mean from the timeWeighted snippet.

LIB.R.explore = `
rep_outcome <- function(r, kind, end_time) {
  if (!length(r$v)) return(NaN)
  if (kind == "time") {
    te <- trajectory_end(r$t, end_time)
    return(tw_mean(r$t, r$v, te, r$t[1], te))
  }
  if (kind == "reps") return(r$v[1])
  mean(r$v)
}
tw_total <- function(reps, end_time) {
  area <- 0; dur <- 0
  for (r in reps) if (length(r$v)) {
    te <- trajectory_end(r$t, end_time)
    ov <- pmax(0, pmin(c(r$t[-1], te), te) - r$t)   # how long each record holds, up to te
    area <- area + sum(r$v * ov); dur <- dur + sum(ov)
  }
  list(mean = if (dur > 0) area / dur else NaN, duration = dur)
}
`;
LIB.py.explore = `
def rep_outcome(r, kind, end_time):
    """A replication's outcome as the analyzer forms it; nan when it has no records."""
    v = np.asarray(r["v"], float)
    if len(v) == 0:
        return np.nan
    if kind == "time":
        t = np.asarray(r["t"], float); te = trajectory_end(t, end_time)
        return tw_mean(t, v, te, t[0], te)
    if kind == "reps":
        return float(v[0])
    return float(v.mean())

def tw_total(reps, end_time):
    """The time-weighted mean of every replication together, and the time covered."""
    area = dur = 0.0
    for r in reps:
        if len(r["v"]) == 0:
            continue
        t = np.asarray(r["t"], float); v = np.asarray(r["v"], float)
        te = trajectory_end(t, end_time)
        ov = np.maximum(0.0, np.minimum(np.append(t[1:], te), te) - t)   # how long each record holds, up to te
        area += float(np.sum(v * ov)); dur += float(ov.sum())
    return dict(mean=area / dur if dur > 0 else np.nan, duration=dur)
`;
LIB.m.explore = `
function o = rep_outcome(r, kind, end_time)
% A replication's outcome as the analyzer forms it; NaN when it has no records.
if isempty(r.v), o = NaN; return; end
switch kind
    case 'time'
        te = trajectory_end(r.t, end_time); o = tw_mean(r.t, r.v, te, r.t(1), te);
    case 'reps'
        o = r.v(1);
    otherwise
        o = mean(r.v);
end
end

function s = tw_total(reps, end_time)
% The time-weighted mean of every replication together, and the time covered.
area = 0; dur = 0;
for i = 1:numel(reps)
    t = reps(i).t(:)'; v = reps(i).v(:)';
    if isempty(v), continue; end
    te = trajectory_end(t, end_time);
    ov = max(0, min([t(2:end), te], te) - t);   % how long each record holds, up to te
    area = area + sum(v .* ov); dur = dur + sum(ov);
end
if dur > 0, m = area / dur; else, m = NaN; end
s = struct('mean', m, 'duration', dur);
end
`;

// ── Steady State: the warm-up plot's averages ────────────────────────────

LIB.R.alignment = `
align_by_index <- function(reps) {
  # ybar[i] is the mean of observation i over the replications that have one.
  L <- max(0, vapply(reps, function(r) length(r$v), numeric(1)))
  M <- matrix(NaN, length(reps), L)
  for (q in seq_along(reps)) { n <- length(reps[[q]]$v); if (n) M[q, 1:n] <- reps[[q]]$v }
  colMeans(M, na.rm = TRUE)
}
align_by_time <- function(reps, kind, n_bins, end_time, start) {
  # Equal bins of simulation time from start to T, T the end time or, when there is none, the
  # latest last record. In each bin a replication gives its time average over the part of the bin
  # it covers (time-persistent), or the mean of its observations in the bin, the last bin closed on
  # the right (tally); ybar averages the replications that give a value, and is NaN where none does.
  reps <- Filter(function(r) length(r$t) > 0, reps)
  t_end <- if (!is.nan(end_time)) end_time else if (length(reps)) max(vapply(reps, function(r) r$t[length(r$t)], numeric(1))) else 0
  B <- max(1, floor(n_bins))
  t0 <- if (is.finite(start) && start < t_end) start else 0
  edges <- c(t0 + (t_end - t0) * (0:(B - 1)) / B, t_end)
  ybar <- vapply(seq_len(B), function(b) {
    vals <- vapply(reps, function(r) {
      if (kind == "time") return(tw_mean(r$t, r$v, trajectory_end(r$t, end_time), edges[b], edges[b + 1]))
      inb <- r$t >= edges[b] & (r$t < edges[b + 1] | (b == B & r$t <= edges[b + 1]))
      if (any(inb)) mean(r$v[inb]) else NaN
    }, numeric(1))
    vals <- vals[!is.nan(vals)]
    if (length(vals)) mean(vals) else NaN
  }, numeric(1))
  list(edges = edges, ybar = ybar)
}
moving_average <- function(y, w) {
  # Welch's moving average with half-width w: at point i the mean of the 2h + 1 points centered
  # on it, h = min(i - 1, w), and so a shorter symmetric span near the start; NaN where the full
  # span would run past the end. A point with no value (an empty time bin) is skipped.
  L <- length(y); out <- rep(NaN, L)
  for (i in seq_len(L)) {
    if (i > L - w) next
    h <- min(i - 1, w); s <- y[(i - h):(i + h)]; s <- s[is.finite(s)]
    if (length(s)) out[i] <- mean(s)
  }
  out
}
cumulative_average <- function(y) {
  # The mean of the points so far, skipping any with no value.
  ok <- is.finite(y); s <- cumsum(ifelse(ok, y, 0)); cnt <- cumsum(ok)
  ifelse(cnt > 0, s / cnt, NaN)
}
`;
LIB.py.alignment = `
def align_by_index(reps):
    """ybar[i] is the mean of observation i over the replications that have one."""
    L = max([len(r["v"]) for r in reps] + [0])
    M = np.full((len(reps), L), np.nan)
    for q, r in enumerate(reps):
        M[q, :len(r["v"])] = r["v"]
    return np.nansum(M, axis=0) / np.sum(~np.isnan(M), axis=0)

def align_by_time(reps, kind, n_bins, end_time, start):
    """Equal bins of simulation time from start to T, T the end time or, when there is none, the
    latest last record. In each bin a replication gives its time average over the part of the bin
    it covers (time-persistent), or the mean of its observations in the bin, the last bin closed on
    the right (tally); ybar averages the replications that give a value, and is nan where none does."""
    reps = [r for r in reps if r["t"] is not None and len(r["t"]) > 0]
    if not np.isnan(end_time): t_end = end_time
    else: t_end = max(r["t"][-1] for r in reps) if reps else 0.0
    B = max(1, int(np.floor(n_bins)))
    t0 = start if np.isfinite(start) and start < t_end else 0.0
    edges = np.append(t0 + (t_end - t0) * np.arange(B) / B, t_end)
    ybar = np.full(B, np.nan)
    for b in range(B):
        vals = []
        for r in reps:
            t = np.asarray(r["t"], float); v = np.asarray(r["v"], float)
            if kind == "time":
                x = tw_mean(t, v, trajectory_end(t, end_time), edges[b], edges[b + 1])
            else:
                inb = (t >= edges[b]) & ((t < edges[b + 1]) | ((b == B - 1) & (t <= edges[b + 1])))
                x = v[inb].mean() if inb.any() else np.nan
            if not np.isnan(x): vals.append(x)
        if vals: ybar[b] = np.mean(vals)
    return edges, ybar

def moving_average(y, w):
    """Welch's moving average with half-width w: at point i the mean of the 2h + 1 points centered
    on it, h = min(i, w), and so a shorter symmetric span near the start; nan where the full span
    would run past the end. A point with no value (an empty time bin) is skipped."""
    y = np.asarray(y, float); L = len(y); out = np.full(L, np.nan)
    for i in range(L):
        if i > L - 1 - w: continue
        h = min(i, w); s = y[i - h:i + h + 1]; s = s[np.isfinite(s)]
        if len(s): out[i] = s.mean()
    return out

def cumulative_average(y):
    """The mean of the points so far, skipping any with no value."""
    y = np.asarray(y, float); ok = np.isfinite(y)
    s = np.cumsum(np.where(ok, y, 0.0)); c = np.cumsum(ok)
    return np.where(c > 0, s / np.maximum(c, 1), np.nan)
`;
LIB.m.alignment = `
function ybar = align_by_index(reps)
% ybar(i) is the mean of observation i over the replications that have one.
L = max([0, arrayfun(@(r) numel(r.v), reps)]);
M = nan(numel(reps), L);
for q = 1:numel(reps), M(q, 1:numel(reps(q).v)) = reps(q).v; end
ybar = mean(M, 1, 'omitnan');
end

function [edges, ybar] = align_by_time(reps, kind, n_bins, end_time, start)
% Equal bins of simulation time from start to T, T the end time or, when there is none, the
% latest last record. In each bin a replication gives its time average over the part of the bin
% it covers (time-persistent), or the mean of its observations in the bin, the last bin closed on
% the right (tally); ybar averages the replications that give a value, and is NaN where none does.
reps = reps(arrayfun(@(r) ~isempty(r.t), reps));
if ~isnan(end_time), t_end = end_time;
elseif ~isempty(reps), t_end = max(arrayfun(@(r) r.t(end), reps));
else, t_end = 0; end
B = max(1, floor(n_bins));
if isfinite(start) && start < t_end, t0 = start; else, t0 = 0; end
edges = [t0 + (t_end - t0) * (0:B-1) / B, t_end];
ybar = nan(1, B);
for b = 1:B
    vals = [];
    for q = 1:numel(reps)
        t = reps(q).t(:)'; v = reps(q).v(:)';
        if strcmp(kind, 'time')
            x = tw_mean(t, v, trajectory_end(t, end_time), edges(b), edges(b + 1));
        else
            inb = t >= edges(b) & (t < edges(b + 1) | (b == B & t <= edges(b + 1)));
            x = NaN; if any(inb), x = mean(v(inb)); end
        end
        if ~isnan(x), vals(end + 1) = x; end %#ok<AGROW>
    end
    if ~isempty(vals), ybar(b) = mean(vals); end
end
end

function out = moving_average(y, w)
% Welch's moving average with half-width w: at point i the mean of the 2h + 1 points centered
% on it, h = min(i - 1, w), and so a shorter symmetric span near the start; NaN where the full
% span would run past the end. A point with no value (an empty time bin) is skipped.
L = numel(y); out = nan(1, L);
for i = 1:L
    if i > L - w, continue; end
    h = min(i - 1, w); s = y(i-h:i+h); s = s(isfinite(s));
    if ~isempty(s), out(i) = mean(s); end
end
end

function out = cumulative_average(y)
% The mean of the points so far, skipping any with no value.
ok = isfinite(y); y(~ok) = 0;
c = cumsum(ok); out = cumsum(y) ./ c; out(c == 0) = NaN;
end
`;

// ── Steady State: truncation, joining, batch means, and Fishman's test ───

LIB.R.batchMeans = `
truncate_rep <- function(t, v, kind, by, cut_at) {
  # The records kept after the warm-up is cut, with idx, each kept record's position in the
  # original series. By index, the first cut_at records go. By time, a tally observation recorded
  # before cut_at goes, and a time-persistent trajectory is cut there: the state in force at
  # cut_at (the last record at or before it) becomes its first record, with time cut_at, so that
  # every later average still counts the time from cut_at to the next record. cut_at = 0 cuts
  # nothing.
  idx <- seq_along(v)
  if (!isTRUE(cut_at > 0)) return(list(t = t, v = v, idx = idx))
  if (by == "index") keep <- idx > floor(cut_at)
  else if (kind == "tally") keep <- t >= cut_at
  else {
    k <- which(t <= cut_at); after <- which(t > cut_at)
    if (length(k)) { k <- max(k); return(list(t = c(cut_at, t[after]), v = c(v[k], v[after]), idx = c(k, after))) }
    keep <- t > cut_at
  }
  list(t = t[keep], v = v[keep], idx = idx[keep])
}
lump_reps <- function(reps, kind, by, cut_at, end_time) {
  # Every replication cut as truncate_rep cuts it, and joined end to end: tally observations one
  # run after another; a time-persistent run covers [s, E], s its first kept record and E the end
  # time or its last record, and is shifted to begin where the previous run ended. A replication
  # with nothing left, or covering no time, is skipped.
  t <- numeric(0); v <- numeric(0); t_end <- NaN; n_reps <- 0
  for (r in reps) {
    k <- truncate_rep(r$t, r$v, kind, by, cut_at)
    if (!length(k$v)) next
    if (kind == "tally") { v <- c(v, k$v); n_reps <- n_reps + 1; next }
    E <- trajectory_end(k$t, end_time); s <- k$t[1]
    if (!isTRUE(E > s)) next
    shift <- if (n_reps == 0) 0 else t_end - s
    t <- c(t, k$t + shift); v <- c(v, k$v); t_end <- E + shift; n_reps <- n_reps + 1
  }
  list(t = if (kind == "tally") NULL else t, v = v, t_end = t_end, n_reps = n_reps)
}
fishman <- function(y) {
  # The lag-one autocorrelation r1 of the batch means, and Fishman's test of no positive
  # correlation: C is close to N(0, 1) when the batch means are independent (b >= 4).
  # Batch means that are all equal have no correlation to test (their deviations are rounding
  # error at most).
  b <- length(y); d <- y - mean(y); ss <- sum(d^2); varies <- b >= 2 && isTRUE(min(y) < max(y))
  r1 <- if (varies) sum(d[-b] * d[-1]) / ss else NaN
  if (b < 4 || !varies) return(list(r1 = r1, C = NaN, p = NaN))
  C <- sqrt((b^2 - 1) / (b - 2)) * (r1 + (d[1]^2 + d[b]^2) / (2 * ss))
  # The upper tail is computed directly, which keeps its digits far out; the analyzer forms
  # 1 - Phi(C), and so the two can differ visibly when C is about 6 or more.
  list(r1 = r1, C = C, p = pnorm(C, lower.tail = FALSE))
}
batch_means <- function(t, v, kind, end_time, count, size, level, first = 0) {
  # Batches on the kept series, set by count (with size NaN) or by size (with count NaN).
  # Tally: count batches of floor(n / count) observations, or batches of size observations, one
  # after another; the leftover at the end is excluded, and 'first' (the position of the first
  # kept observation in the untruncated series, counted from 0) is where the batches start.
  # Time-persistent: count equal intervals of [start, T], or intervals of length size, from the
  # first kept record to T (the end time or the last record), each batch mean the time average
  # over its interval; the time past the last full interval is excluded. Then the t interval on
  # the batch means, their lag-one autocorrelation, and Fishman's test.
  by_count <- !is.nan(count); n <- length(v)
  no <- function(why) list(ok = FALSE, reason = why)
  if (by_count == !is.nan(size)) return(no("Give either a batch count or a batch size, not both."))
  if (by_count && !isTRUE(count >= 1)) return(no("The batch count must be at least 1."))
  if (!by_count && !isTRUE(size > 0)) return(no("The batch size must be positive."))
  if (kind == "tally") {
    if (by_count) { b <- floor(count); m <- floor(n / b) } else { m <- floor(size); b <- if (m > 0) floor(n / m) else 0 }
    if (m < 1) b <- 0
    if (b < 2) return(no(paste0("Batch means need at least 2 batches; these settings give ", b, ".")))
    means <- vapply(seq_len(b), function(k) mean(v[((k - 1) * m + 1):(k * m)]), numeric(1))
    start <- first; records <- rep(m, b); leftover <- n - b * m
  } else {
    if (!n) return(no("No records remain after truncation."))
    start <- t[1]; t_end <- trajectory_end(t, end_time); span <- t_end - start
    if (!isTRUE(span > 0)) return(no("The trajectory covers no time after truncation."))
    # By size, a small relative slack keeps a span that is a whole number of batches, up to
    # rounding, from losing its last batch.
    if (by_count) { b <- floor(count); m <- span / b } else { m <- size; b <- floor(span / m + 1e-9) }
    if (b < 2) return(no(paste0("Batch means need at least 2 batches; these settings give ", b, ".")))
    edges <- start + (0:b) * m
    if (by_count) edges[b + 1] <- t_end
    leftover <- if (by_count) 0 else t_end - start - b * m
    if (abs(leftover) <= 1e-9 * max(1, abs(span))) leftover <- 0
    means <- vapply(seq_len(b), function(k) tw_mean(t, v, t_end, edges[k], edges[k + 1]), numeric(1))
    # The records whose times fall in each interval; a record at the very end counts in the last
    # batch when no time is left over.
    pos <- findInterval(t, edges)
    pos[pos == b + 1 & leftover == 0 & t == edges[b + 1]] <- b
    records <- tabulate(pos[pos >= 1 & pos <= b], b)
  }
  ti <- t_interval(means, level); f <- fishman(means)
  list(ok = TRUE, b = b, size = m, start = start, nUsed = n, means = means, records = records,
       leftover = leftover, mean = mean(means), sd = sd(means), se = sd(means) / sqrt(b), df = b - 1,
       t = ti$t, hw = ti$hw, lo = ti$lo, hi = ti$hi, r1 = f$r1, C = f$C, p = f$p, test = ti$test)
}
`;
LIB.py.batchMeans = `
def truncate_rep(t, v, kind, by, cut_at):
    """The records kept after the warm-up is cut, with idx, each kept record's position (from 0) in
    the original series. By index, the first cut_at records go. By time, a tally observation
    recorded before cut_at goes, and a time-persistent trajectory is cut there: the state in force
    at cut_at (the last record at or before it) becomes its first record, with time cut_at, so that
    every later average still counts the time from cut_at to the next record. cut_at = 0 cuts
    nothing."""
    v = np.asarray(v, float); t = None if t is None else np.asarray(t, float)
    idx = np.arange(len(v))
    if not cut_at > 0: return t, v, idx
    if by == "index": keep = idx >= np.floor(cut_at)
    elif kind == "tally": keep = t >= cut_at
    else:
        before = np.flatnonzero(t <= cut_at); after = np.flatnonzero(t > cut_at)
        if len(before):
            k = before[-1]
            return np.append(cut_at, t[after]), np.append(v[k], v[after]), np.append(k, after)
        keep = t > cut_at
    return (None if t is None else t[keep]), v[keep], idx[keep]

def lump_reps(reps, kind, by, cut_at, end_time):
    """Every replication cut as truncate_rep cuts it, and joined end to end: tally observations one
    run after another; a time-persistent run covers [s, E], s its first kept record and E the end
    time or its last record, and is shifted to begin where the previous run ended. A replication
    with nothing left, or covering no time, is skipped."""
    ts, vs, t_end, n_reps = [], [], np.nan, 0
    for r in reps:
        t, v, _ = truncate_rep(r["t"], r["v"], kind, by, cut_at)
        if len(v) == 0: continue
        if kind == "tally":
            vs.append(v); n_reps += 1; continue
        E = trajectory_end(t, end_time); s = t[0]
        if not E > s: continue
        shift = 0.0 if n_reps == 0 else t_end - s
        ts.append(t + shift); vs.append(v); t_end = E + shift; n_reps += 1
    v = np.concatenate(vs) if vs else np.array([])
    t = None if kind == "tally" else (np.concatenate(ts) if ts else np.array([]))
    return dict(t=t, v=v, t_end=t_end, n_reps=n_reps)

def fishman(y):
    """The lag-one autocorrelation r1 of the batch means, and Fishman's test of no positive
    correlation: C is close to N(0, 1) when the batch means are independent (b >= 4)."""
    y = np.asarray(y, float); b = len(y); d = y - y.mean(); ss = float(np.sum(d ** 2))
    # Batch means that are all equal have no correlation to test (their deviations are
    # rounding error at most).
    varies = b >= 2 and y.min() < y.max()
    r1 = float(np.sum(d[:-1] * d[1:]) / ss) if varies else np.nan
    if b < 4 or not varies: return dict(r1=r1, C=np.nan, p=np.nan)
    C = np.sqrt((b ** 2 - 1) / (b - 2)) * (r1 + (d[0] ** 2 + d[-1] ** 2) / (2 * ss))
    # The upper tail is computed directly, which keeps its digits far out; the analyzer forms
    # 1 - Phi(C), and so the two can differ visibly when C is about 6 or more.
    return dict(r1=r1, C=C, p=stats.norm.sf(C))

def batch_means(t, v, kind, end_time, count, size, level, first=0):
    """Batches on the kept series, set by count (with size nan) or by size (with count nan).
    Tally: count batches of floor(n / count) observations, or batches of size observations, one
    after another; the leftover at the end is excluded, and 'first' (the position of the first
    kept observation in the untruncated series, counted from 0) is where the batches start.
    Time-persistent: count equal intervals of [start, T], or intervals of length size, from the
    first kept record to T (the end time or the last record), each batch mean the time average
    over its interval; the time past the last full interval is excluded. Then the t interval on
    the batch means, their lag-one autocorrelation, and Fishman's test."""
    v = np.asarray(v, float); n = len(v); by_count = not np.isnan(count)
    no = lambda why: dict(ok=False, reason=why)
    if by_count == (not np.isnan(size)): return no("Give either a batch count or a batch size, not both.")
    if by_count and not count >= 1: return no("The batch count must be at least 1.")
    if not by_count and not size > 0: return no("The batch size must be positive.")
    if kind == "tally":
        if by_count: b = int(np.floor(count)); m = n // b
        else:
            m = int(np.floor(size)); b = n // m if m > 0 else 0
        if m < 1: b = 0
        if b < 2: return no(f"Batch means need at least 2 batches; these settings give {b}.")
        means = v[:b * m].reshape(b, m).mean(axis=1)
        start = first; records = np.full(b, m); leftover = n - b * m
    else:
        if n == 0: return no("No records remain after truncation.")
        t = np.asarray(t, float); start = t[0]; t_end = trajectory_end(t, end_time); span = t_end - start
        if not span > 0: return no("The trajectory covers no time after truncation.")
        # By size, a small relative slack keeps a span that is a whole number of batches, up to
        # rounding, from losing its last batch.
        if by_count: b = int(np.floor(count)); m = span / b
        else: m = float(size); b = int(np.floor(span / m + 1e-9))
        if b < 2: return no(f"Batch means need at least 2 batches; these settings give {b}.")
        edges = start + np.arange(b + 1) * m
        if by_count: edges[b] = t_end
        leftover = 0.0 if by_count else t_end - start - b * m
        if abs(leftover) <= 1e-9 * max(1.0, abs(span)): leftover = 0.0
        means = np.array([tw_mean(t, v, t_end, edges[k], edges[k + 1]) for k in range(b)])
        # The records whose times fall in each interval; a record at the very end counts in the
        # last batch when no time is left over.
        pos = np.searchsorted(edges, t, side="right") - 1
        pos[(pos == b) & (leftover == 0) & (t == edges[b])] = b - 1
        records = np.bincount(pos[(pos >= 0) & (pos < b)], minlength=b)
    ti = t_interval(means, level); f = fishman(means)
    sd = 0.0 if means.min() == means.max() else means.std(ddof=1)   # all equal: exactly 0
    return dict(ok=True, b=b, size=m, start=start, nUsed=n, means=means, records=records, leftover=leftover,
                mean=means.mean(), sd=sd, se=sd / np.sqrt(b), df=b - 1, t=ti["t"], hw=ti["hw"], lo=ti["lo"],
                hi=ti["hi"], r1=f["r1"], C=f["C"], p=f["p"])
`;
LIB.m.batchMeans = `
function [t, v, idx] = truncate_rep(t, v, kind, by, cut_at)
% The records kept after the warm-up is cut, with idx, each kept record's position in the
% original series. By index, the first cut_at records go. By time, a tally observation recorded
% before cut_at goes, and a time-persistent trajectory is cut there: the state in force at
% cut_at (the last record at or before it) becomes its first record, with time cut_at, so that
% every later average still counts the time from cut_at to the next record. cut_at = 0 cuts
% nothing.
v = v(:)'; if ~isempty(t), t = t(:)'; end
idx = 1:numel(v);
if ~(cut_at > 0), return; end
if strcmp(by, 'index')
    keep = idx > floor(cut_at);
elseif strcmp(kind, 'tally')
    keep = t >= cut_at;
else
    k = find(t <= cut_at, 1, 'last'); after = find(t > cut_at);
    if ~isempty(k)
        t = [cut_at, t(after)]; v = [v(k), v(after)]; idx = [k, after]; return;
    end
    keep = t > cut_at;
end
if ~isempty(t), t = t(keep); end
v = v(keep); idx = idx(keep);
end

function r = lump_reps(reps, kind, by, cut_at, end_time)
% Every replication cut as truncate_rep cuts it, and joined end to end: tally observations one
% run after another; a time-persistent run covers [s, E], s its first kept record and E the end
% time or its last record, and is shifted to begin where the previous run ended. A replication
% with nothing left, or covering no time, is skipped.
t = []; v = []; t_end = NaN; n_reps = 0;
for q = 1:numel(reps)
    [tk, vk] = truncate_rep(reps(q).t, reps(q).v, kind, by, cut_at);
    if isempty(vk), continue; end
    if strcmp(kind, 'tally'), v = [v, vk]; n_reps = n_reps + 1; continue; end %#ok<AGROW>
    E = trajectory_end(tk, end_time); s = tk(1);
    if ~(E > s), continue; end
    if n_reps == 0, shift = 0; else, shift = t_end - s; end
    t = [t, tk + shift]; v = [v, vk]; t_end = E + shift; n_reps = n_reps + 1; %#ok<AGROW>
end
r = struct('t', t, 'v', v, 't_end', t_end, 'n_reps', n_reps);
end

function f = fishman(y)
% The lag-one autocorrelation r1 of the batch means, and Fishman's test of no positive
% correlation: C is close to N(0, 1) when the batch means are independent (b >= 4).
y = y(:)'; b = numel(y); d = y - mean(y); ss = sum(d.^2);
% Batch means that are all equal have no correlation to test (their deviations are rounding
% error at most).
varies = b >= 2 && min(y) < max(y);
r1 = NaN; if varies, r1 = sum(d(1:end-1) .* d(2:end)) / ss; end
if b < 4 || ~varies, f = struct('r1', r1, 'C', NaN, 'p', NaN); return; end
C = sqrt((b^2 - 1) / (b - 2)) * (r1 + (d(1)^2 + d(end)^2) / (2 * ss));
% The upper tail is computed directly, which keeps its digits far out; the analyzer forms
% 1 - Phi(C), and so the two can differ visibly when C is about 6 or more.
f = struct('r1', r1, 'C', C, 'p', normcdf(C, 'upper'));
end

function r = batch_means(t, v, kind, end_time, count, sz, level, first)
% Batches on the kept series, set by count (with sz NaN) or by size sz (with count NaN).
% Tally: count batches of floor(n / count) observations, or batches of sz observations, one
% after another; the leftover at the end is excluded, and first (the position of the first kept
% observation in the untruncated series, counted from 0) is where the batches start.
% Time-persistent: count equal intervals of [start, T], or intervals of length sz, from the
% first kept record to T (the end time or the last record), each batch mean the time average
% over its interval; the time past the last full interval is excluded. Then the t interval on
% the batch means, their lag-one autocorrelation, and Fishman's test.
v = v(:)'; n = numel(v); by_count = ~isnan(count);
r = struct('ok', false, 'reason', '');
if by_count == ~isnan(sz), r.reason = 'Give either a batch count or a batch size, not both.'; return; end
if by_count && ~(count >= 1), r.reason = 'The batch count must be at least 1.'; return; end
if ~by_count && ~(sz > 0), r.reason = 'The batch size must be positive.'; return; end
if strcmp(kind, 'tally')
    if by_count, b = floor(count); m = floor(n / b); else, m = floor(sz); b = 0; if m > 0, b = floor(n / m); end; end
    if m < 1, b = 0; end
    if b < 2, r.reason = sprintf('Batch means need at least 2 batches; these settings give %d.', b); return; end
    means = mean(reshape(v(1:b*m), m, b), 1);
    start = first; records = repmat(m, 1, b); leftover = n - b * m;
else
    if n == 0, r.reason = 'No records remain after truncation.'; return; end
    t = t(:)'; start = t(1); t_end = trajectory_end(t, end_time); span = t_end - start;
    if ~(span > 0), r.reason = 'The trajectory covers no time after truncation.'; return; end
    % By size, a small relative slack keeps a span that is a whole number of batches, up to
    % rounding, from losing its last batch.
    if by_count, b = floor(count); m = span / b; else, m = sz; b = floor(span / m + 1e-9); end
    if b < 2, r.reason = sprintf('Batch means need at least 2 batches; these settings give %d.', b); return; end
    edges = start + (0:b) * m;
    if by_count, edges(b + 1) = t_end; end
    leftover = 0; if ~by_count, leftover = t_end - start - b * m; end
    if abs(leftover) <= 1e-9 * max(1, abs(span)), leftover = 0; end
    means = arrayfun(@(k) tw_mean(t, v, t_end, edges(k), edges(k + 1)), 1:b);
    % The records whose times fall in each interval; a record at the very end counts in the last
    % batch when no time is left over.
    pos = sum(edges(:) <= t, 1);
    pos(pos == b + 1 & leftover == 0 & t == edges(b + 1)) = b;
    records = accumarray(pos(pos >= 1 & pos <= b)', 1, [b, 1])';
end
ti = t_interval(means, level); f = fishman(means);
if min(means) == max(means), s = 0; else, s = std(means); end   % all equal: exactly 0
r = struct('ok', true, 'reason', '', 'b', b, 'size', m, 'start', start, 'nUsed', n, 'means', means, ...
           'records', records, 'leftover', leftover, 'mean', mean(means), 'sd', s, ...
           'se', s / sqrt(b), 'df', b - 1, 't', ti.t, 'hw', ti.hw, 'lo', ti.lo, 'hi', ti.hi, ...
           'r1', f.r1, 'C', f.C, 'p', f.p);
end
`;

// ── Steady State: the autocorrelation of the kept series ─────────────────
// The sample autocorrelation as R's acf computes it: deviations from the
// series mean, each lag's sum of products divided by the lag-0 sum. A
// constant series (its minimum equals its maximum) has none, and every lag is
// NaN, as the analyzer reports; acf would divide rounding error by rounding
// error there (0.1 repeated seven times gives 0.857 at lag 1).

LIB.R.acf = `
acf_lags <- function(y, L) {
  if (min(y) == max(y)) return(rep(NaN, L))   # a constant series has no autocorrelation
  as.numeric(acf(y, lag.max = L, plot = FALSE)$acf)[-1]
}
resample_tw <- function(t, v, a, z, n_steps) {
  # The trajectory averaged over n_steps equal intervals of [a, z]: a series on equal time steps,
  # which an autocorrelation needs because the records arrive at uneven times.
  step <- (z - a) / n_steps
  edges <- c(a + (0:(n_steps - 1)) * step, z)
  vapply(seq_len(n_steps), function(i) tw_mean(t, v, z, edges[i], edges[i + 1]), numeric(1))
}
`;
LIB.py.acf = `
def acf_lags(y, L):
    """r_k = sum (y_i - ybar)(y_(i+k) - ybar) / sum (y_i - ybar)^2 for k = 1..L, as R's acf."""
    y = np.asarray(y, float)
    if y.min() == y.max(): return np.full(L, np.nan)   # a constant series has no autocorrelation
    d = y - y.mean(); ss = float(np.sum(d ** 2))
    return np.array([float(np.sum(d[:-k] * d[k:]) / ss) for k in range(1, L + 1)])

def resample_tw(t, v, a, z, n_steps):
    """The trajectory averaged over n_steps equal intervals of [a, z]: a series on equal time
    steps, which an autocorrelation needs because the records arrive at uneven times."""
    edges = np.append(a + np.arange(n_steps) * ((z - a) / n_steps), z)
    return np.array([tw_mean(t, v, z, edges[i], edges[i + 1]) for i in range(n_steps)])
`;
LIB.m.acf = `
function r = acf_lags(y, L)
% r_k = sum (y_i - ybar)(y_(i+k) - ybar) / sum (y_i - ybar)^2 for k = 1..L, as R's acf.
y = y(:)';
if min(y) == max(y), r = NaN(1, L); return; end   % a constant series has no autocorrelation
d = y - mean(y); ss = sum(d.^2);
r = arrayfun(@(k) sum(d(1:end-k) .* d(k+1:end)) / ss, 1:L);
end

function out = resample_tw(t, v, a, z, n_steps)
% The trajectory averaged over n_steps equal intervals of [a, z]: a series on equal time steps,
% which an autocorrelation needs because the records arrive at uneven times.
edges = [a + (0:n_steps-1) * ((z - a) / n_steps), z];
out = arrayfun(@(i) tw_mean(t, v, z, edges(i), edges(i + 1)), 1:n_steps);
end
`;
