# Reference values for test/planning.test.mjs: replication planning by power and by
# half-width. Noncentral t and F points come from R's pt(t, df, ncp) and
# pf(f, d1, d2, ncp); one- and two-sample t power from power.t.test(strict = TRUE),
# which counts both rejection tails; Welch power at unequal standard deviations from
# the same noncentral-t formula written out with pt and qt at the Welch df; the
# half-width plans by brute force over n with qt; and ANOVA power from
# power.anova.test. Nothing here is random, and so no seed is set.
# Run:  Rscript planning.R > planning.json
j <- function(x) {
  if (is.list(x) && !is.null(names(x))) paste0("{", paste(sprintf('"%s":%s', names(x), sapply(x, j)), collapse = ","), "}")
  else if (is.list(x) || length(x) > 1) paste0("[", paste(sapply(x, j), collapse = ","), "]")
  else if (is.character(x)) sprintf('"%s"', x)
  else if (is.logical(x)) tolower(as.character(x))
  else sprintf("%.17g", x)
}

# Noncentral t and F CDF points.
ptPts <- list(c(2.0, 10, 1.5), c(-1.0, 5, 0.8), c(3.5, 30, 2.5),
              c(0.5, 3, -1.2), c(1.96, 100, 3.0), c(-2.5, 20, -1.0))
pt_ref <- lapply(ptPts, function(p) list(t = p[1], df = p[2], ncp = p[3], p = pt(p[1], p[2], p[3])))
pfPts <- list(c(2.5, 3, 20, 4.0), c(1.0, 1, 10, 2.0), c(4.0, 5, 40, 12.0),
              c(0.5, 2, 6, 1.0), c(3.0, 4, 100, 20.0), c(1.5, 9, 30, 0.5))
pf_ref <- lapply(pfPts, function(p) list(f = p[1], d1 = p[2], d2 = p[3], ncp = p[4],
                                         p = pf(p[1], p[2], p[3], p[4])))

# One-sample t power and plans.
os_power <- lapply(list(c(10, 1, 1.5, 0.05), c(25, 0.5, 1, 0.01), c(6, 2, 1, 0.10)), function(s)
  list(n = s[1], delta = s[2], sd = s[3], alpha = s[4],
       power = power.t.test(n = s[1], delta = s[2], sd = s[3], sig.level = s[4],
                            type = "one.sample", strict = TRUE)$power))
os_plan <- lapply(list(c(1, 1, 0.05, 0.8), c(0.3, 1.2, 0.05, 0.9), c(2.5, 1, 0.01, 0.95)), function(s)
  list(delta = s[1], sd = s[2], alpha = s[3], power = s[4],
       nR = power.t.test(delta = s[1], sd = s[2], sig.level = s[3], power = s[4],
                         type = "one.sample", strict = TRUE)$n))

# Two-sample t with equal standard deviations: the Welch df at equal sds and equal n
# is 2(n - 1), and so power.t.test(type = "two.sample") is the reference exactly.
ts_power <- lapply(list(c(10, 1, 1, 0.05), c(30, 0.5, 1.2, 0.05), c(5, 2, 1, 0.10)), function(s)
  list(n = s[1], delta = s[2], sd = s[3], alpha = s[4],
       power = power.t.test(n = s[1], delta = s[2], sd = s[3], sig.level = s[4],
                            type = "two.sample", strict = TRUE)$power))
ts_plan <- lapply(list(c(1, 1, 0.05, 0.8), c(0.4, 1, 0.05, 0.9), c(1.5, 2, 0.01, 0.85)), function(s)
  list(delta = s[1], sd = s[2], alpha = s[3], power = s[4],
       nR = power.t.test(delta = s[1], sd = s[2], sig.level = s[3], power = s[4],
                         type = "two.sample", strict = TRUE)$n))

# Welch with unequal standard deviations, by hand at the Welch df for equal n.
welchDf <- function(s1, s2, n) (s1^2 + s2^2)^2 / (s1^4 + s2^4) * (n - 1)
welchPower <- function(n, s1, s2, delta, alpha) {
  df <- welchDf(s1, s2, n); ncp <- delta / sqrt((s1^2 + s2^2) / n); q <- qt(1 - alpha / 2, df)
  pt(q, df, ncp, lower.tail = FALSE) + pt(-q, df, ncp)
}
uw_power <- lapply(list(c(8, 2, 0.05), c(20, 1.5, 0.05), c(50, 0.8, 0.01)), function(s)
  list(n = s[1], sd1 = 1.0, sd2 = 2.5, delta = s[2], alpha = s[3],
       df = welchDf(1.0, 2.5, s[1]), power = welchPower(s[1], 1.0, 2.5, s[2], s[3])))
uw_plan <- lapply(list(c(1.5, 0.05, 0.8), c(1.0, 0.05, 0.9)), function(s) {
  n <- 2; while (welchPower(n, 1.0, 2.5, s[1], s[2]) < s[3]) n <- n + 1
  list(sd1 = 1.0, sd2 = 2.5, delta = s[1], alpha = s[2], power = s[3], n = n,
       powerAtN = welchPower(n, 1.0, 2.5, s[1], s[2]))
})

# Welch half-width plans by brute force over n.
welchHw <- function(n, s1, s2, p) qt(p, welchDf(s1, s2, n)) * sqrt((s1^2 + s2^2) / n)
hw_plan <- lapply(list(c(1.0, 2.5, 0.95, 0.5), c(1.0, 1.0, 0.90, 0.3), c(0.4, 3.0, 0.99, 2.0)), function(s) {
  p <- 1 - (1 - s[3]) / 2; n <- 2
  while (welchHw(n, s[1], s[2], p) > s[4]) n <- n + 1
  list(sd1 = s[1], sd2 = s[2], level = s[3], target = s[4], n = n,
       hwAtN = welchHw(n, s[1], s[2], p), df = welchDf(s[1], s[2], n))
})

# Bonferroni half-width plans by brute force over n: the smallest n at which every
# comparison's Welch half-width at level 1 - alpha/C is within the target.
bonfPlan <- function(sds, level, mode, control, target) {
  k <- length(sds)
  prs <- if (mode == "control") lapply(setdiff(seq_len(k), control), function(i) c(i, control))
         else combn(k, 2, simplify = FALSE)
  C <- length(prs); p <- 1 - (1 - level) / (2 * C)
  widest <- function(n) {
    h <- sapply(prs, function(q) welchHw(n, sds[q[1]], sds[q[2]], p))
    list(hw = max(h), pair = prs[[which.max(h)]] - 1)
  }
  n <- 2; while (widest(n)$hw > target) n <- n + 1
  w <- widest(n)
  # The n a plan would give if it watched only the pair with the largest s_i^2 + s_j^2.
  big <- prs[[which.max(sapply(prs, function(q) sds[q[1]]^2 + sds[q[2]]^2))]]
  m <- 2; while (welchHw(m, sds[big[1]], sds[big[2]], p) > target) m <- m + 1
  list(sds = sds, level = level, mode = mode, control = control - 1, target = target,
       n = n, hwAtN = w$hw, pair = w$pair, C = C, nMaxSumPair = m)
}
sds4 <- c(0.8, 1.1, 0.6, 1.4)
bonf <- list(bonfPlan(sds4, 0.95, "pairs", 1, 0.6),
             bonfPlan(sds4, 0.95, "control", 1, 0.6),
             bonfPlan(sds4, 0.90, "pairs", 1, 0.25),
             # At small n with very unequal standard deviations, the pair (0.21, 1.18)
             # has fewer Welch df than (0.59, 1.18), the pair with the largest variance
             # sum, and is wider: watching only the largest-sum pair would stop at
             # n = 2 (nMaxSumPair), one short of what every comparison needs.
             bonfPlan(c(0.21, 0.59, 1.18), 0.95, "pairs", 1, 13.91))

# One-way ANOVA power with one of k designs shifted by delta. power.anova.test takes
# between.var as the variance of the k group means with denominator k - 1. Those
# means are delta (once) and 0 (k - 1 times), with average delta/k, and so the sum
# of squared deviations is (delta (k - 1)/k)^2 + (k - 1)(delta/k)^2
# = delta^2 (k - 1)/k, and dividing by k - 1 gives between.var = delta^2/k. R's
# noncentrality is then (k - 1) n between.var/within.var = n delta^2 (k - 1)/(k sigma^2).
av_power <- lapply(list(c(3, 10, 1, 1, 0.05), c(5, 20, 0.8, 1.2, 0.05), c(4, 6, 2, 1, 0.01)), function(s)
  list(k = s[1], n = s[2], delta = s[3], sigma = s[4], alpha = s[5],
       power = power.anova.test(groups = s[1], n = s[2], between.var = s[3]^2 / s[1],
                                within.var = s[4]^2, sig.level = s[5])$power))
av_plan <- lapply(list(c(3, 1, 1, 0.05, 0.8), c(6, 1.5, 2, 0.05, 0.9)), function(s)
  list(k = s[1], delta = s[2], sigma = s[3], alpha = s[4], power = s[5],
       nR = power.anova.test(groups = s[1], between.var = s[2]^2 / s[1], within.var = s[3]^2,
                             sig.level = s[4], power = s[5])$n))

cat(j(list(pt = pt_ref, pf = pf_ref, osPower = os_power, osPlan = os_plan,
           tsPower = ts_power, tsPlan = ts_plan, uwPower = uw_power, uwPlan = uw_plan,
           hwPlan = hw_plan, bonf = bonf, avPower = av_power, avPlan = av_plan)))
