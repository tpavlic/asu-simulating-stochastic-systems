# Reference values for js/stats/steadystate.js, computed by hand in base R.
# Run from the repository root:
#   Rscript output_analysis/output_analyzer/test/reference/steadystate.R > output_analysis/output_analyzer/test/reference/steadystate.json
# The input data are generated here (seeded) and written into the JSON, so the JS test reads the
# same series rather than regenerating them.

j <- function(x) {
  if (is.list(x) && !is.null(names(x))) paste0("{", paste(sprintf('"%s":%s', names(x), sapply(x, j)), collapse = ","), "}")
  else if (is.list(x) || length(x) > 1) paste0("[", paste(sapply(x, j), collapse = ","), "]")
  else if (is.character(x)) sprintf('"%s"', x)
  else if (is.logical(x)) tolower(as.character(x))
  else sprintf("%.17g", as.numeric(x))
}

set.seed(20261002)

# Fishman's lag-one statistic, written out term by term.
fishman <- function(y) {
  b <- length(y); m <- mean(y); d <- y - m
  ss <- sum(d^2)
  r1 <- sum(d[-b] * d[-1]) / ss
  C <- sqrt((b^2 - 1) / (b - 2)) * (r1 + (d[1]^2 + d[b]^2) / (2 * ss))
  list(r1 = r1, acf1 = acf(y, lag.max = 1, plot = FALSE)$acf[2], C = C, p = 1 - pnorm(C))
}

tci <- function(means, level) {
  b <- length(means); s <- sd(means); hw <- qt(1 - (1 - level) / 2, b - 1) * s / sqrt(b)
  list(mean = mean(means), sd = s, se = s / sqrt(b), hw = hw, lo = mean(means) - hw, hi = mean(means) + hw)
}

# ---- (a) AR(1) series, phi = 0.7, mean 10, started from the stationary distribution ----------
na <- 2000; phi <- 0.7; mu <- 10
e <- rnorm(na)
a <- numeric(na)
a[1] <- mu + e[1] / sqrt(1 - phi^2)
for (i in 2:na) a[i] <- mu + phi * (a[i - 1] - mu) + e[i]

# Tally batch means: drop the first `drop` observations, cut consecutive batches of m
# observations, and exclude the leftover. start/end are 0-based, start inclusive, end exclusive,
# as indices into the untruncated series.
bm_tally <- function(y, drop, count = NULL, size = NULL, level = 0.95) {
  x <- if (drop > 0) y[-(1:drop)] else y
  n <- length(x)
  if (!is.null(count)) { b <- count; m <- floor(n / count) } else { m <- size; b <- floor(n / size) }
  means <- sapply(1:b, function(k) mean(x[((k - 1) * m + 1):(k * m)]))
  start <- drop + (0:(b - 1)) * m
  c(list(drop = drop, b = b, size = m, leftover = n - b * m, means = means,
         start = start, end = start + m), fishman(means), tci(means, level))
}

a_count20 <- bm_tally(a, 100, count = 20)
a_size150 <- bm_tally(a, 100, size = 150)
a_count7 <- bm_tally(a, 0, count = 7, level = 0.90)

# ---- (b) time-persistent trajectory: 60 state changes, integer states 0-5 ---------------------
nb <- 60
tb <- c(0, cumsum(rexp(nb - 1, rate = 1 / 1.5)))
vb <- sample(0:5, nb, replace = TRUE)
endb <- ceiling(tb[nb]) + 3

# Time average of a trajectory over [lo, hi]: each record's value times the part of its holding
# interval that falls inside [lo, hi], divided by the covered duration.
tw_int <- function(t, v, end, lo, hi) {
  segEnd <- c(t[-1], end)
  ov <- pmax(0, pmin(segEnd, hi) - pmax(t, lo))
  if (sum(ov) == 0) return(NA)
  sum(v * ov) / sum(ov)
}

cut <- 10
k <- max(which(tb <= cut))
tb2 <- c(cut, tb[tb > cut]); vb2 <- c(vb[k], vb[tb > cut])

bm_time <- function(t, v, end, count = NULL, size = NULL, level = 0.95) {
  start <- t[1]
  if (!is.null(count)) { b <- count; w <- (end - start) / count } else { w <- size; b <- floor((end - start) / size) }
  lo <- start + (0:(b - 1)) * w; hi <- start + (1:b) * w
  means <- mapply(function(l, h) tw_int(t, v, end, l, h), lo, hi)
  n <- mapply(function(l, h) sum(t >= l & t < h), lo, hi)
  leftover <- end - start - b * w
  if (leftover == 0) n[b] <- n[b] + sum(t == hi[b])
  c(list(b = b, size = w, leftover = leftover, start = lo, end = hi, n = n, means = means),
    fishman(means), tci(means, level))
}

b_count6 <- bm_time(tb2, vb2, endb, count = 6)
b_size7 <- bm_time(tb2, vb2, endb, size = 7)

# A second, shorter trajectory for time alignment; with no end time each record set ends at its
# own last record, which then carries no weight.
nb3 <- 25
tb3 <- c(0, cumsum(rexp(nb3 - 1, rate = 1)))
vb3 <- sample(0:5, nb3, replace = TRUE)
Tt <- max(tb[nb], tb3[nb3])
edgesT <- seq(0, Tt, length.out = 6)
binT <- function(t, v) sapply(1:5, function(i) tw_int(t, v, t[length(t)], edgesT[i], edgesT[i + 1]))
mT <- rbind(binT(tb, vb), binT(tb3, vb3))
alignTime <- list(edges = edgesT, ybar = apply(mT, 2, function(c) mean(c[!is.na(c)])),
                  counts = apply(mT, 2, function(c) sum(!is.na(c))))
# Whole-trajectory time average up to the end time, for the single-bin check.
twWhole <- tw_int(tb, vb, endb, 0, endb)

# ---- (c) five tally replications of unequal length, with a warm-up trend ----------------------
lens <- sample(120:150, 5, replace = TRUE)
reps <- lapply(lens, function(L) {
  t <- cumsum(rexp(L, rate = 1))
  v <- 5 * (1 - exp(-(1:L) / 25)) + rnorm(L)
  list(t = t, v = v)
})
Lmax <- max(lens)
idxY <- numeric(Lmax); idxC <- numeric(Lmax)
for (i in 1:Lmax) {
  s <- 0; c <- 0
  for (r in reps) if (length(r$v) >= i) { s <- s + r$v[i]; c <- c + 1 }
  idxY[i] <- s / c; idxC[i] <- c
}
Tc <- max(sapply(reps, function(r) r$t[length(r$t)]))
edgesC <- seq(0, Tc, length.out = 9)
mC <- t(sapply(reps, function(r) sapply(1:8, function(i) {
  inb <- if (i < 8) r$t >= edgesC[i] & r$t < edgesC[i + 1] else r$t >= edgesC[i] & r$t <= edgesC[i + 1]
  if (any(inb)) mean(r$v[inb]) else NA
})))
alignTally <- list(edges = edgesC, ybar = apply(mC, 2, function(c) mean(c[!is.na(c)])),
                   counts = apply(mC, 2, function(c) sum(!is.na(c))))

# ---- Welch's moving average on a short vector, by hand (1-based i = 1 .. m - w) ---------------
y <- c(3, 7, 2, 9, 4, 6, 8, 1, 5, 7, 3, 6)
welch <- function(y, w) {
  m <- length(y); out <- numeric(m - w)
  for (i in 1:(m - w)) {
    if (i <= w) out[i] <- mean(y[1:(2 * i - 1)]) else out[i] <- mean(y[(i - w):(i + w)])
  }
  out
}

# ---- Monte Carlo calibration of Fishman's test under independence -----------------------------
mc <- function(b, N) {
  X <- matrix(rnorm(b * N), N, b)
  C <- apply(X, 1, function(r) fishman(r)$C)
  mean(C > qnorm(0.95))
}
mc20 <- mc(20, 20000)
mc10 <- mc(10, 20000)

out <- list(
  ar1 = list(series = a, count20 = a_count20, size150 = a_size150, count7 = a_count7),
  traj = list(t = tb, v = vb, endTime = endb, cut = cut, carried = vb[k],
              truncT = tb2, truncV = vb2, count6 = b_count6, size7 = b_size7,
              twWhole = twWhole),
  traj3 = list(t = tb3, v = vb3),
  alignTime = alignTime,
  tallyReps = lapply(reps, function(r) list(t = r$t, v = r$v)),
  alignIndex = list(L = Lmax, ybar = idxY, counts = idxC),
  alignTally = alignTally,
  welch = list(y = y, w2 = welch(y, 2), w5 = welch(y, 5), cum = cumsum(y) / seq_along(y)),
  mc = list(b20 = mc20, b10 = mc10, N = 20000, crit = qnorm(0.95))
)
cat(j(out))
