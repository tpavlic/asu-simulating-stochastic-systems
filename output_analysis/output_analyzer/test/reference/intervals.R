# Reference values for test/intervals.test.mjs, from R's t.test, var.test,
# cor.test, qchisq, and qt. The samples are generated here and written into the
# JSON, and so the test runs on exactly these numbers.
# Run:  Rscript intervals.R > intervals.json
j <- function(x) {
  if (is.list(x) && !is.null(names(x))) paste0("{", paste(sprintf('"%s":%s', names(x), sapply(x, j)), collapse = ","), "}")
  else if (is.list(x) || length(x) > 1) paste0("[", paste(sapply(x, j), collapse = ","), "]")
  else if (is.character(x)) sprintf('"%s"', x)
  else if (is.logical(x)) tolower(as.character(x))
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

cat(j(list(
  x = v(x), y = v(y), u = v(u), w = v(w), small = v(small),
  levels = per_level,
  fSwap = list(F = unname(vtSwap$statistic), p = vtSwap$p.value, ci = v(vtSwap$conf.int)),
  corSmall = list(t = unname(ctSmall$statistic), p = ctSmall$p.value),
  plan = plan
)))
