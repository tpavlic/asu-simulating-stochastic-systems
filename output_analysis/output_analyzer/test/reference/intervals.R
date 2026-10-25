# Reference values for test/intervals.test.mjs, from R's t.test, var.test,
# cor.test, qchisq, qt, predict.lm (the prediction interval), pbinom (the
# distribution-free quantile interval), and sort (the order statistics). The samples are generated here and written into the
# JSON, and so the test runs on exactly these numbers.
# Run:  Rscript intervals.R > intervals.json
j <- function(x) {
  if (is.list(x) && !is.null(names(x))) paste0("{", paste(sprintf('"%s":%s', names(x), sapply(x, j)), collapse = ","), "}")
  else if (is.list(x) || length(x) > 1) paste0("[", paste(sapply(x, j), collapse = ","), "]")
  else if (is.character(x)) sprintf('"%s"', x)
  else if (is.logical(x) && !is.na(x)) tolower(as.character(x))
  else if (length(x) == 1 && is.na(x)) "null"
  else sprintf("%.17g", x)
}
v <- function(x) as.list(as.numeric(x))
set.seed(31415)

x <- rnorm(15, 50, 6)
y <- rnorm(12, 48, 11)
u <- rnorm(20)
w <- 0.6 * u + 0.8 * rnorm(20)          # correlated with u
small <- rexp(3)
levels <- c(0.90, 0.95, 0.99)

per_level <- lapply(levels, function(L) {
  a <- 1 - L
  tt <- t.test(x, conf.level = L)
  n <- length(x); s2 <- var(x)
  chiLo <- qchisq(a / 2, n - 1); chiHi <- qchisq(1 - a / 2, n - 1)
  vt <- var.test(x, y, conf.level = L)
  ct <- cor.test(u, w, conf.level = L)
  list(
    level = L,
    t = list(ci = v(tt$conf.int), mean = unname(tt$estimate), df = unname(tt$parameter),
             q = qt(1 - a / 2, n - 1), se = unname(tt$stderr)),
    var = list(chiLo = chiLo, chiHi = chiHi, lo2 = (n - 1) * s2 / chiHi, hi2 = (n - 1) * s2 / chiLo),
    f = list(F = unname(vt$statistic), p = vt$p.value, ci = v(vt$conf.int)),
    cor = list(r = unname(ct$estimate), t = unname(ct$statistic), p = ct$p.value, ci = v(ct$conf.int))
  )
})
# var.test with the samples swapped puts F below 1 and so exercises the lower tail of the p-value.
vtSwap <- var.test(y, x)
ctSmall <- cor.test(small, c(1, 3, 2))  # n = 3: t and p exist, the interval does not

# Replications needed, found by brute force: the smallest n >= 2 with
# qt(1 - a/2, n - 1) * sd / sqrt(n) <= h. The search starts 50 below the normal
# approximation (or at 2), after checking that the inequality fails there.
need <- function(sd, h, L) {
  n <- max(2, floor((qnorm(1 - (1 - L) / 2) * sd / h)^2) - 50)
  stopifnot(n == 2 || qt(1 - (1 - L) / 2, n - 1) * sd / sqrt(n) > h)
  while (qt(1 - (1 - L) / 2, n - 1) * sd / sqrt(n) > h) n <- n + 1
  list(sd = sd, target = h, level = L, n = n, hwAtN = qt(1 - (1 - L) / 2, n - 1) * sd / sqrt(n))
}
plan <- list(need(2, 0.5, 0.95), need(10, 1, 0.90), need(1.3, 0.9, 0.99), need(5, 40, 0.95),
             need(100, 0.01, 0.95))   # n near 3.8e8, past the df where the planner switches to the expansion

# The one-sample t test against a stated mean, from t.test(mu = mu0), at a
# value below the sample mean, one above it, and one far enough off to reject.
mu0s <- c(48, 51.5, 56)
one_t <- lapply(mu0s, function(m) {
  tt <- t.test(x, mu = m)
  list(mu0 = m, t = unname(tt$statistic), p = tt$p.value, df = unname(tt$parameter))
})

# The prediction interval for one further outcome, mean +/- t * s * sqrt(1 + 1/n),
# as predict.lm gives it for an intercept-only fit.
pi_levels <- lapply(levels, function(L) {
  pr <- predict(lm(x ~ 1), newdata = data.frame(a = 1), interval = "prediction", level = L)
  list(level = L, lo = unname(pr[1, "lwr"]), hi = unname(pr[1, "upr"]))
})

# The distribution-free interval for the p quantile from two order statistics:
# among every pair r < s with P(X(r) <= theta_p < X(s)) = pbinom(s - 1, n, p) -
# pbinom(r - 1, n, p) at least the level, the narrowest (smallest s - r), and
# of those the one whose middle is nearest n p + 1/2, and of those the lowest.
# The point estimates are the book's order statistic X(ceiling(n p)) and R's
# default (type 7) interpolated quantile. minN is the smallest n at which the
# widest pair, (1, n), reaches the level.
z <- rnorm(60, 20, 3)
better <- function(a, b) {   # a before b in lexicographic order
  for (i in seq_along(a)) { if (a[i] < b[i]) return(TRUE); if (a[i] > b[i]) return(FALSE) }
  FALSE
}
q_int <- function(v, p, L) {
  n <- length(v); srt <- sort(v)
  best <- NULL
  for (r in 1:(n - 1)) for (s in (r + 1):n) {
    cov <- pbinom(s - 1, n, p) - pbinom(r - 1, n, p)
    if (cov >= L) {
      cand <- c(s - r, abs((r + s) / 2 - (n * p + 0.5)), r)
      if (is.null(best) || better(cand, best$key)) best <- list(key = cand, r = r, s = s, cov = cov)
    }
  }
  m <- 2
  while (1 - p^m - (1 - p)^m < L) m <- m + 1
  list(p = p, level = L, n = n, order = srt[ceiling(n * p)], interp = unname(quantile(v, p, type = 7)),
       r = if (is.null(best)) NA else best$r, s = if (is.null(best)) NA else best$s,
       lo = if (is.null(best)) NA else srt[best$r], hi = if (is.null(best)) NA else srt[best$s],
       achieved = if (is.null(best)) NA else best$cov, minN = m)
}
quant <- list(q_int(z, 0.5, 0.95), q_int(z, 0.9, 0.95), q_int(z, 0.25, 0.90), q_int(z, 0.95, 0.99),
              q_int(x, 0.5, 0.95), q_int(x, 0.9, 0.95), q_int(x, 0.9, 0.99))   # the last two: n = 15 cannot reach it at p = 0.9

cat(j(list(
  x = v(x), y = v(y), u = v(u), w = v(w), small = v(small),
  levels = per_level,
  fSwap = list(F = unname(vtSwap$statistic), p = vtSwap$p.value, ci = v(vtSwap$conf.int)),
  corSmall = list(t = unname(ctSmall$statistic), p = ctSmall$p.value),
  plan = plan,
  z = v(z), oneT = one_t, pi = pi_levels, quant = quant
)))
