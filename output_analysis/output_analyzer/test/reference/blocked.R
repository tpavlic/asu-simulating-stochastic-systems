# Reference values for the paired (blocked) procedures in js/stats/compare.js
# and js/stats/nonparam.js. Run from the repository root:
#   Rscript output_analysis/output_analyzer/test/reference/blocked.R > output_analysis/output_analyzer/test/reference/blocked.json
# Base R only: aov(y ~ g + block) and TukeyHSD on it, paired t.test per pair
# at the Bonferroni level, friedman.test, the Siegel-Castellan pairwise z
# tests coded by hand with p.adjust, and the blocked F test's power by pf.

j <- function(x) {
  if (is.list(x) && !is.null(names(x))) paste0("{", paste(sprintf('"%s":%s', names(x), sapply(x, j)), collapse = ","), "}")
  else if (is.list(x) || length(x) > 1) paste0("[", paste(sapply(x, j), collapse = ","), "]")
  else if (is.character(x)) sprintf('"%s"', x)
  else if (is.logical(x)) tolower(as.character(x))
  else sprintf("%.17g", x)
}

# Four designs in ten blocks with a block effect (common random numbers).
set.seed(2718)
k <- 4; R <- 10
mus <- c(10, 11, 12.5, 10.3)
blk <- rnorm(R, 0, 2)
Y <- sapply(1:k, function(i) mus[i] + blk + rnorm(R, 0, 1))   # R x k matrix
groups <- lapply(1:k, function(i) Y[, i])
y <- as.vector(Y)
g <- factor(rep(1:k, each = R))
b <- factor(rep(1:R, times = k))
fit <- aov(y ~ g + b)
tab <- summary(fit)[[1]]
anova <- list(ssb = tab$`Sum Sq`[1], ssblk = tab$`Sum Sq`[2], ssw = tab$`Sum Sq`[3],
              dfb = tab$Df[1], dfblk = tab$Df[2], dfw = tab$Df[3],
              F = tab$`F value`[1], p = tab$`Pr(>F)`[1], Fblock = tab$`F value`[2], pBlock = tab$`Pr(>F)`[2])
tk <- TukeyHSD(fit, "g", conf.level = 0.95)$g
tukey <- lapply(seq_len(nrow(tk)), function(q) {
  nm <- strsplit(rownames(tk)[q], "-")[[1]]
  list(i = as.integer(nm[1]) - 1, j = as.integer(nm[2]) - 1, diff = tk[q, "diff"], lo = tk[q, "lwr"], hi = tk[q, "upr"])
})
C <- choose(k, 2)
pairedBonf <- list()
for (i in 1:(k - 1)) for (jj in (i + 1):k) {
  tt <- t.test(groups[[i]], groups[[jj]], paired = TRUE, conf.level = 1 - 0.05 / C)
  pairedBonf[[length(pairedBonf) + 1]] <- list(i = i - 1, j = jj - 1, diff = unname(tt$estimate), se = unname(tt$stderr),
    df = unname(tt$parameter), t = unname(tt$statistic), p = tt$p.value, lo = tt$conf.int[1], hi = tt$conf.int[2])
}
fr <- friedman.test(Y)
rs <- colSums(t(apply(Y, 1, rank)))
sePair <- sqrt(R * k * (k + 1) / 6)
pz <- list()
for (i in 1:(k - 1)) for (jj in (i + 1):k) {
  z <- (rs[i] - rs[jj]) / sePair
  pz[[length(pz) + 1]] <- list(i = i - 1, j = jj - 1, diff = unname(rs[i] - rs[jj]), z = unname(z), p = 2 * pnorm(-abs(unname(z))))
}
praw <- sapply(pz, function(o) o$p)
pb <- p.adjust(praw, "bonferroni"); ph <- p.adjust(praw, "holm")
for (q in seq_along(pz)) { pz[[q]]$bonferroni <- pb[q]; pz[[q]]$holm <- ph[q] }
# A tied Friedman case: rounded values.
Yt <- round(Y)
frt <- friedman.test(Yt)
# Blocked power for one design shifted by delta, sigma the residual sd.
pw <- function(n, kk, sigma, delta, alpha) {
  d1 <- kk - 1; d2 <- (kk - 1) * (n - 1)
  ncp <- n * delta^2 * (kk - 1) / (kk * sigma^2)
  1 - pf(qf(1 - alpha, d1, d2), d1, d2, ncp)
}
power <- lapply(list(c(5, 4, 1, 1), c(10, 4, 1.5, 1), c(20, 3, 2, 1.2)), function(v) list(n = v[1], k = v[2], sigma = v[3], delta = v[4], power = pw(v[1], v[2], v[3], v[4], 0.05)))

cat(j(list(groups = groups, anova = anova, tukey = tukey, pairedBonferroni = pairedBonf,
           friedman = list(chi2 = unname(fr$statistic), df = unname(fr$parameter), p = fr$p.value, rankSums = unname(rs), pairs = pz),
           friedmanTied = list(groups = lapply(1:k, function(i) Yt[, i]), chi2 = unname(frt$statistic), p = frt$p.value),
           power = power)), "\n")
