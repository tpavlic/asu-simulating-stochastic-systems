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
