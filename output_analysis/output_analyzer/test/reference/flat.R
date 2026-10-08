# Reference values for data with no spread: repeated values, and groups with no
# spread within them. Run from the repository root:
#   Rscript output_analysis/output_analyzer/test/reference/flat.R > output_analysis/output_analyzer/test/reference/flat.json
# Base R only. Infinite and undefined values are written as the strings
# "Infinity", "-Infinity", and "NaN", which JSON has no numbers for.
#
# Three rules are the analyzer's, and R applies them here by hand:
# - A sample whose minimum equals its maximum has variance exactly 0. R's var()
#   already gives 0 on these (its mean is accumulated in long double), but
#   t.test() stops on them ("data are essentially constant"), and so a t
#   procedure on two constant samples is written out: the difference is known
#   exactly, t is infinite (p = 0) when the constants differ, and the interval
#   has no width.
# - An analysis of variance whose within (or residual) sum of squares, summed
#   directly from each residual, is at most 1e-24 of the outcomes' uncentered
#   sum of squares sum(y^2) has no spread within the groups: F is infinite
#   (p = 0) when the between sum of squares exceeds that bound and undefined
#   when it does not. Levene's test applies the rule to the distances from the
#   medians on the outcomes' own sum(y^2). aov() reports rounding noise there,
#   which is kept beside each result as aovF.
# - Paired differences d = a - b are constant when max(d) - min(d) is at most
#   8 eps times the largest |a| or |b|, the rounding bound of the subtraction.

j <- function(x) {
  if (is.list(x) && !is.null(names(x))) paste0("{", paste(sprintf('"%s":%s', names(x), sapply(x, j)), collapse = ","), "}")
  else if (is.list(x) || length(x) > 1) paste0("[", paste(sapply(x, j), collapse = ","), "]")
  else if (is.character(x)) sprintf('"%s"', x)
  else if (is.logical(x)) tolower(as.character(x))
  else if (is.nan(x) || is.na(x)) '"NaN"'
  else if (is.infinite(x)) if (x > 0) '"Infinity"' else '"-Infinity"'
  else sprintf("%.17g", x)
}

NO_SPREAD <- 1e-24

# The one-way analysis of variance under the rule above.
oneway <- function(groups, scale = NULL) {
  y <- unlist(groups); g <- factor(rep(seq_along(groups), lengths(groups)))
  n <- lengths(groups); means <- sapply(groups, mean); grand <- mean(y)
  ssb <- sum(n * (means - grand)^2)
  ssw <- sum(sapply(groups, function(x) sum((x - mean(x))^2)))
  dfb <- length(groups) - 1; dfw <- length(y) - length(groups)
  tiny <- NO_SPREAD * (if (is.null(scale)) sum(y^2) else scale)
  aovF <- suppressWarnings(summary(aov(y ~ g))[[1]][1, "F value"])
  if (ssw <= tiny) {
    ssw <- 0
    if (!(ssb > tiny)) ssb <- 0
    F <- if (ssb > 0) Inf else NaN; p <- if (ssb > 0) 0 else NaN
  } else {
    F <- (ssb / dfb) / (ssw / dfw); p <- pf(F, dfb, dfw, lower.tail = FALSE)
  }
  list(groups = groups, ssb = ssb, ssw = ssw, dfb = dfb, dfw = dfw, F = F, p = p, aovF = aovF)
}

# Brown and Forsythe's Levene test: the analysis above on |y - median|.
levene <- function(groups) {
  z <- lapply(groups, function(x) abs(x - median(x)))
  r <- oneway(z, scale = sum(unlist(groups)^2))
  r$groups <- groups
  r
}

# The randomized-block analysis (designs by blocks, one outcome per cell) under
# the rule above: aov's sums of squares for the designs and the blocks, and the
# residual sum of squares summed directly from y - mean_i - mean_r + mean.
blocked <- function(groups) {
  k <- length(groups); R <- length(groups[[1]])
  y <- unlist(groups); design <- factor(rep(seq_len(k), each = R)); block <- factor(rep(seq_len(R), k))
  tab <- suppressWarnings(summary(aov(y ~ design + block))[[1]])
  ssb <- tab[1, "Sum Sq"]; ssblk <- tab[2, "Sum Sq"]
  M <- do.call(cbind, groups)   # R-by-k
  ssw <- sum((M - rep(colMeans(M), each = R) - rowMeans(M) + mean(M))^2)
  dfb <- k - 1; dfblk <- R - 1; dfw <- (k - 1) * (R - 1)
  tiny <- NO_SPREAD * sum(y^2)
  aovF <- tab[1, "F value"]
  if (ssw <= tiny) {
    ssw <- 0
    if (!(ssb > tiny)) ssb <- 0
    if (!(ssblk > tiny)) ssblk <- 0
    F <- if (ssb > 0) Inf else NaN; p <- if (ssb > 0) 0 else NaN
    Fb <- if (ssblk > 0) Inf else NaN; pb <- if (ssblk > 0) 0 else NaN
  } else {
    F <- (ssb / dfb) / (ssw / dfw); p <- pf(F, dfb, dfw, lower.tail = FALSE)
    Fb <- (ssblk / dfblk) / (ssw / dfw); pb <- pf(Fb, dfblk, dfw, lower.tail = FALSE)
  }
  list(groups = groups, ssb = ssb, ssblk = ssblk, ssw = ssw, F = F, p = p, Fblock = Fb, pBlock = pb, aovF = aovF)
}

# Two constant samples: the t procedures written out (t.test stops on them).
constant_t <- function(a, b, pooled) {
  d <- mean(a) - mean(b)
  t <- if (d != 0) sign(d) * Inf else if (pooled) NaN else 0
  list(a = a, b = b, diff = d, se = 0, df = length(a) + length(b) - 2, t = t,
       p = if (is.nan(t)) NaN else if (t == 0) 1 else 0, lo = d, hi = d, hw = 0)
}

reps <- function(v, n) rep(v, n)
varied <- c(3.1, 2.9, 4.2, 3.6, 3.3)

out <- list(
  # R's var() on repeated values that do not sum exactly.
  variance = lapply(list(c(0.1, 3), c(0.3, 3), c(0.7, 3), c(0.1, 7), c(0.2, 3), c(2.3, 7)),
                    function(p) list(value = p[1], n = p[2], var = var(reps(p[1], p[2])))),
  welch = constant_t(reps(0.1, 3), reps(0.3, 3), FALSE),
  pooled = constant_t(reps(0.1, 3), reps(0.3, 3), TRUE),
  # Differences equal only up to the subtraction's rounding: 0.1 - 0.3, 0.2 - 0.4, 0.5 - 0.7.
  pairedRounding = { a <- c(0.1, 0.2, 0.5); b <- c(0.3, 0.4, 0.7); d <- a - b
    list(a = a, b = b, d = d, spread = max(d) - min(d), bound = 8 * .Machine$double.eps * max(abs(c(a, b))),
         constant = (max(d) - min(d)) <= 8 * .Machine$double.eps * max(abs(c(a, b))), meanD = mean(d), t = -Inf, p = 0) },
  # The paired differences of 0.1 and 0.3 repeated, all equal.
  paired = { d <- reps(0.1, 3) - reps(0.3, 3); list(a = reps(0.1, 3), b = reps(0.3, 3), meanD = mean(d), sdD = sd(d), t = -Inf, p = 0) },
  # var.test on two constant samples (F = 0/0) and on a constant against a varied one (F = 0).
  fratioBoth = { vt <- var.test(reps(0.3, 3), reps(0.1, 3)); list(a = reps(0.3, 3), b = reps(0.1, 3), F = unname(vt$statistic), p = vt$p.value) },
  fratioOne = { vt <- var.test(reps(0.7, 3), varied); list(a = reps(0.7, 3), b = varied, F = unname(vt$statistic), p = vt$p.value,
                                                        lo = vt$conf.int[1], hi = vt$conf.int[2]) },
  anovaConstants = oneway(list(reps(0.1, 3), reps(0.3, 3), reps(0.7, 3))),
  anovaEqual = oneway(list(reps(0.3, 3), reps(0.3, 4), reps(0.3, 2))),
  # Two outcomes per design: each design's two distances from its median are equal up to rounding.
  leveneTwo = levene(list(c(2.1, 3.4), c(3.9, 4.4), c(2.5, 2.2))),
  # The same at offsets of a million and a billion, where the distances carry the outcomes' rounding.
  leveneTwo1e6 = levene(lapply(list(c(2.1, 3.4), c(3.9, 4.4), c(2.5, 2.2)), function(x) x + 1e6)),
  leveneTwo1e9 = levene(lapply(list(c(2.1, 3.4), c(3.9, 4.4), c(2.5, 2.2)), function(x) x + 1e9)),
  # Constant designs near a million: their means differ by 0.2 and 0.4, which is real.
  anovaConstants1e6 = oneway(list(reps(1e6 + 0.1, 3), reps(1e6 + 0.3, 3), reps(1e6 + 0.7, 3))),
  # Real spread near a million (half a unit) is not "no spread".
  anovaReal1e6 = oneway(list(1e6 + c(0.1, 0.6), 1e6 + c(0.3, 0.9))),
  # Spread barely above the bound: {m, m + 1e-8, m - 1e-8}, F near 3e16 (aov agrees).
  anovaNearFlat = oneway(lapply(1:3, function(m) m + c(0, 1e-8, -1e-8))),
  # The same distances in both designs: nothing within or between.
  leveneEqual = levene(list(c(0.1, 0.3), c(1.1, 1.3))),
  leveneConstants = levene(list(reps(0.1, 3), reps(0.3, 3), reps(0.7, 3))),
  # Additive in the designs and the blocks: the residual is rounding error.
  blockedAdditive = blocked(list(c(0.1, 0.2), c(0.3, 0.4), c(0.7, 0.8))),
  blockedAdditive1e6 = blocked(lapply(list(c(2.1, 3.1), c(2.3, 3.3), c(4.3, 5.3)), function(x) x + 1e6)),
  # Each design constant across the blocks: no block effect either.
  blockedConstants = blocked(list(reps(0.1, 2), reps(0.3, 2), reps(0.7, 2))),
  # The lag-one autocorrelation of a constant series is undefined (0/0); R's acf() divides
  # rounding error by rounding error there, which is kept as acfR.
  acfConstant = { x <- reps(0.1, 7); list(x = x, r1 = if (min(x) == max(x)) NaN else acf(x, lag.max = 1, plot = FALSE)$acf[2],
                                          acfR = acf(x, lag.max = 1, plot = FALSE)$acf[2]) }
)
cat(j(out), "\n")
