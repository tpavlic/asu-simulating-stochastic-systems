# Reference values for test/descriptive.test.mjs. The samples are generated here
# and written into the JSON, and so the test runs on exactly these numbers.
# Run:  Rscript descriptive.R > descriptive.json
j <- function(x) {
  if (is.list(x) && !is.null(names(x))) paste0("{", paste(sprintf('"%s":%s', names(x), sapply(x, j)), collapse = ","), "}")
  else if (is.list(x) || length(x) > 1) paste0("[", paste(sapply(x, j), collapse = ","), "]")
  else if (is.character(x)) sprintf('"%s"', x)
  else if (is.logical(x)) tolower(as.character(x))
  else sprintf("%.17g", x)
}
v <- function(x) as.list(as.numeric(x))   # always a JSON array, even of length 0 or 1
set.seed(20261002)

samples <- list(
  normal  = rnorm(20, 10, 2),
  expo    = rexp(37, 0.5),
  spiked  = c(rnorm(30), 8, -6),        # guaranteed outliers on both sides
  ties    = as.numeric(sample(1:6, 15, replace = TRUE))
)

describe <- function(name, x) {
  bs <- boxplot.stats(x)                # Tukey's hinges, 1.5 hinge-spread fences
  b <- max(5, ceiling(sqrt(length(x))))
  br <- seq(min(x), max(x), length.out = b + 1)
  h <- hist(x, breaks = br, right = FALSE, include.lowest = TRUE, plot = FALSE)
  e <- ecdf(x); u <- sort(unique(x))
  rm <- cumsum(x) / seq_along(x)
  list(
    name = name, x = v(x),
    mean = mean(x), var = var(x), sd = sd(x), se = sd(x) / sqrt(length(x)),
    min = min(x), max = max(x),
    q = v(quantile(x, c(0.25, 0.5, 0.75), type = 7)),
    q10 = quantile(x, 0.1, type = 7), q90 = quantile(x, 0.9, type = 7),
    acf = v(acf(x, lag.max = 5, plot = FALSE)$acf),
    box = v(bs$stats), out = v(sort(bs$out)),
    histEdges = v(br), histCounts = v(h$counts),
    ecdfX = v(u), ecdfP = v(e(u)),
    runMean = v(rm),
    lag1cor = cor(x[-length(x)], x[-1])
  )
}
sets <- lapply(names(samples), function(nm) describe(nm, samples[[nm]]))

# Pearson correlation of two of the samples cut to equal length.
pr <- list(x = v(samples$normal), y = v(samples$expo[1:20]),
           r = cor(samples$normal, samples$expo[1:20]))

# An irregular time-persistent trajectory. Two records share the time 10 (an
# instantaneous change, which carries no duration), the first record is at 2,
# and the last at 13.5 holds until endTime = 20.
tt <- sort(c(2, 10, 10, 13.5, runif(12, 2.1, 13.4)))
vv <- round(runif(length(tt), 0, 8))
endT <- 20
edges <- seq(0, 20, length.out = 5)    # [0,5) starts before t[1]; [15,20) holds only the last value's spill

# Hand integration of the piecewise-constant path over [lo, hi): each record's
# value times the overlap of its holding interval with the window.
integ <- function(t, val, end, lo, hi) {
  n <- length(t); area <- 0; cover <- 0
  for (i in seq_len(n)) {
    s <- t[i]; e <- if (i < n) t[i + 1] else end
    ov <- max(0, min(e, hi) - max(s, lo))
    area <- area + val[i] * ov; cover <- cover + ov
  }
  c(area, cover)
}
bins <- function(end) sapply(1:4, function(b) {
  r <- integ(tt, vv, end, edges[b], edges[b + 1]); if (r[2] > 0) r[1] / r[2] else -1
})
whole <- integ(tt, vv, endT, -Inf, Inf)
wholeNull <- integ(tt, vv, tt[length(tt)], -Inf, Inf)
tw <- list(
  t = v(tt), v = v(vv), endTime = endT, edges = v(edges),
  mean = whole[1] / whole[2],
  meanNullEnd = wholeNull[1] / wholeNull[2],
  bins = v(bins(endT)),                # -1 marks a bin with no covered time
  binsNullEnd = v(bins(tt[length(tt)]))
)

# Tally bins: the same times plus one observation exactly at the last edge
# (counted, since the last bin is closed) and edges reaching back before any
# observation, which leaves the first two bins empty.
t2 <- c(tt, 20); v2 <- c(vv, 7)
e2 <- seq(-10, 20, by = 5)
tb <- sapply(seq_len(length(e2) - 1), function(b) {
  last <- b == length(e2) - 1
  sel <- t2 >= e2[b] & (if (last) t2 <= e2[b + 1] else t2 < e2[b + 1])
  if (any(sel)) mean(v2[sel]) else -1
})
tally <- list(t = v(t2), v = v(v2), edges = v(e2), bins = v(tb))

cat(j(list(sets = sets, pearson = pr, tw = tw, tally = tally)))
