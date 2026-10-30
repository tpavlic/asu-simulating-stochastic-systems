# Reference values for Holm's step-down in js/stats/compare.js and
# js/stats/nonparam.js: adjustP, benchmarkFamily, benchmarkFamilyRank, the
# adjust option of bonferroniFamily and bonferroniFamilyRank, and the 'holm'
# and 'holmWelch' post-hoc rules. Run from the repository root:
#   Rscript output_analysis/output_analyzer/test/reference/holm.R > output_analysis/output_analyzer/test/reference/holm.json
# Base R only. The samples are drawn here from fixed seeds and written into the
# JSON beside the results, and the seeds are chosen so that Holm declares
# strictly more than Bonferroni in every family, which is the case the page's
# three-state display exists for.

j <- function(x) {
  if (is.list(x) && !is.null(names(x))) paste0("{", paste(sprintf('"%s":%s', names(x), sapply(x, j)), collapse = ","), "}")
  else if (is.list(x) || length(x) > 1) paste0("[", paste(sapply(x, j), collapse = ","), "]")
  else if (is.character(x)) sprintf('"%s"', x)
  else if (is.logical(x)) tolower(as.character(x))
  else if (is.na(x)) "null"
  else sprintf("%.17g", x)
}
arr <- function(v) as.list(v)
alpha <- 0.05

# Holm with a missing p-value: every comparison counts in C (n = length(p)).
pv <- c(0.01, NA, 0.03, 0.004, 0.2)
adjust <- list(p = arr(pv), holm = arr(p.adjust(pv, "holm", n = length(pv))),
               bonferroni = arr(p.adjust(pv, "bonferroni", n = length(pv))))

# Four designs, independent, with unequal sizes and spreads.
set.seed(71)
g <- list(rnorm(10, 10.0, 1.0), rnorm(12, 10.9, 1.2), rnorm(9, 11.4, 1.1), rnorm(11, 11.8, 1.6))
k <- length(g)

# Each design against a benchmark.
bench <- 10.8
bt <- lapply(g, function(x) t.test(x, mu = bench))
benchT <- list(value = bench,
  t = arr(sapply(bt, function(r) unname(r$statistic))),
  p = arr(sapply(bt, function(r) r$p.value)))
benchT$holm <- arr(p.adjust(unlist(benchT$p), "holm"))
benchT$bonferroni <- arr(p.adjust(unlist(benchT$p), "bonferroni"))
# The rank procedures on a second set of four designs, drawn the same way.
set.seed(560)
g2 <- list(rnorm(10, 10.0, 1.0), rnorm(12, 10.9, 1.2), rnorm(9, 11.4, 1.1), rnorm(11, 11.8, 1.6))
bw <- lapply(g2, function(x) wilcox.test(x, mu = bench, exact = TRUE, correct = TRUE))
benchW <- list(value = bench,
  V = arr(sapply(bw, function(r) unname(r$statistic))),
  p = arr(sapply(bw, function(r) r$p.value)))
benchW$holm <- arr(p.adjust(unlist(benchW$p), "holm"))
benchW$bonferroni <- arr(p.adjust(unlist(benchW$p), "bonferroni"))

# Every pair by Welch's t and every design against design 1 on the first set, and
# every pair by the rank-sum test on the second.
pairs <- combn(k, 2, simplify = FALSE)
ctrl <- lapply(2:k, function(i) c(i, 1))
welchP <- function(ps) sapply(ps, function(q) t.test(g[[q[1]]], g[[q[2]]])$p.value)
rankP <- function(ps) sapply(ps, function(q) wilcox.test(g2[[q[1]]], g2[[q[2]]], exact = TRUE, correct = TRUE)$p.value)
pw <- welchP(pairs); cw <- welchP(ctrl); pr <- rankP(pairs)
fam <- list(
  pairs = lapply(pairs, function(q) q - 1),
  welch = list(p = arr(pw), holm = arr(p.adjust(pw, "holm")), bonferroni = arr(p.adjust(pw, "bonferroni"))),
  welchControl = list(p = arr(cw), holm = arr(p.adjust(cw, "holm")), bonferroni = arr(p.adjust(cw, "bonferroni"))),
  rank = list(p = arr(pr), holm = arr(p.adjust(pr, "holm")), bonferroni = arr(p.adjust(pr, "bonferroni"))))

# The post-hoc rules on the same four designs: pooled and Welch t, Holm-adjusted.
y <- unlist(g); f <- factor(rep(seq_len(k), sapply(g, length)))
pooledM <- pairwise.t.test(y, f, p.adjust.method = "holm", pool.sd = TRUE)$p.value
welchM <- pairwise.t.test(y, f, p.adjust.method = "holm", pool.sd = FALSE)$p.value
rawPooled <- pairwise.t.test(y, f, p.adjust.method = "none", pool.sd = TRUE)$p.value
lower <- function(m) sapply(pairs, function(q) m[q[2] - 1, q[1]])
posthoc <- list(pooled = list(p = arr(lower(rawPooled)), holm = arr(lower(pooledM))),
                welch = list(p = arr(pw), holm = arr(lower(welchM))))

# Paired: three designs sharing a block effect, the blocked post hoc on the
# residual mean square of aov(y ~ g + block), and the paired t family.
set.seed(99)
R <- 8
blk <- rnorm(R, sd = 2)
h <- list(10 + blk + rnorm(R, sd = 0.5), 10.45 + blk + rnorm(R, sd = 0.5), 10.8 + blk + rnorm(R, sd = 0.5))
yb <- unlist(h); gb <- factor(rep(1:3, each = R)); bb <- factor(rep(1:R, 3))
fit <- aov(yb ~ gb + bb)
mse <- sum(residuals(fit)^2) / fit$df.residual
pb <- combn(3, 2, simplify = FALSE)
tb <- sapply(pb, function(q) (mean(h[[q[1]]]) - mean(h[[q[2]]])) / sqrt(mse * 2 / R))
pbRaw <- 2 * pt(-abs(tb), fit$df.residual)
ppRaw <- sapply(pb, function(q) t.test(h[[q[1]]], h[[q[2]]], paired = TRUE)$p.value)
blocked <- list(pairs = lapply(pb, function(q) q - 1), t = arr(tb), df = fit$df.residual,
                p = arr(pbRaw), holm = arr(p.adjust(pbRaw, "holm")),
                pairedP = arr(ppRaw), pairedHolm = arr(p.adjust(ppRaw, "holm")),
                pairedBonferroni = arr(p.adjust(ppRaw, "bonferroni")))

cat(j(list(alpha = alpha, adjust = adjust,
           groups = lapply(g, arr), rankGroups = lapply(g2, arr), benchT = benchT, benchW = benchW, family = fam, posthoc = posthoc,
           pairedGroups = lapply(h, arr), blocked = blocked)), "\n")
