# Reference values for js/stats/compare.js. Run from the repository root:
#   Rscript output_analysis/output_analyzer/test/reference/compare.R > output_analysis/output_analyzer/test/reference/compare.json
# Base R only. The samples are drawn here from fixed seeds and written into the
# JSON beside the results, so the tests run on exactly the data R analyzed.

j <- function(x) {
  if (is.list(x) && !is.null(names(x))) paste0("{", paste(sprintf('"%s":%s', names(x), sapply(x, j)), collapse = ","), "}")
  else if (is.list(x) || length(x) > 1) paste0("[", paste(sapply(x, j), collapse = ","), "]")
  else if (is.character(x)) sprintf('"%s"', x)
  else if (is.logical(x)) tolower(as.character(x))
  else sprintf("%.17g", x)
}
# A length-one vector that must still be written as a JSON array.
arr <- function(v) as.list(v)

tt <- function(r) list(statistic = unname(r$statistic), df = unname(r$parameter),
                       p = r$p.value, lo = r$conf.int[1], hi = r$conf.int[2],
                       estimate = unname(r$estimate))

# Two independent samples of unequal size and unequal spread.
set.seed(20261002)
x <- rnorm(8, mean = 10, sd = 1.2)
y <- rnorm(11, mean = 8.9, sd = 2.1)
welch95 <- tt(t.test(x, y, conf.level = 0.95))
welch90 <- tt(t.test(x, y, conf.level = 0.90))
welch99 <- tt(t.test(x, y, conf.level = 0.99))
pooled95 <- tt(t.test(x, y, var.equal = TRUE, conf.level = 0.95))
pooled90 <- tt(t.test(x, y, var.equal = TRUE, conf.level = 0.90))
pooled99 <- tt(t.test(x, y, var.equal = TRUE, conf.level = 0.99))

# Two paired samples sharing a common component, the way common random numbers
# correlate two designs' replications.
set.seed(777)
z <- rnorm(10, sd = 2)
px <- 10 + z + rnorm(10, sd = 0.6)
py <- 9.4 + z + rnorm(10, sd = 0.6)
paired95 <- tt(t.test(px, py, paired = TRUE, conf.level = 0.95))
paired90 <- tt(t.test(px, py, paired = TRUE, conf.level = 0.90))
pr <- cor(px, py)
psd <- sd(px - py)

# Four groups of sizes 6, 8, 7, and 9 whose means differ.
set.seed(4242)
sizes <- c(6, 8, 7, 9)
mus <- c(10, 11, 13, 10.5)
groups <- lapply(1:4, function(i) rnorm(sizes[i], mean = mus[i], sd = 1.5))
yv <- unlist(groups)
g <- factor(rep(1:4, sizes))
fit <- aov(yv ~ g)
tab <- summary(fit)[[1]]
k <- 4
N <- sum(sizes)
dfw <- tab$Df[2]
msw <- tab$`Mean Sq`[2]
means <- sapply(groups, mean)
pairs <- t(combn(4, 2))   # rows (i, j) with i < j, 1-based

tk <- function(level) {
  h <- TukeyHSD(fit, conf.level = level)$g
  # R's row "j-i" carries mean_j - mean_i and its bounds; kept raw, in the
  # order of the (i, j) pairs above.
  rows <- apply(pairs, 1, function(p) paste0(p[2], "-", p[1]))
  list(rows = rows, diff = unname(h[rows, "diff"]), lwr = unname(h[rows, "lwr"]),
       upr = unname(h[rows, "upr"]))
}

byhand <- function(crit) {
  d <- apply(pairs, 1, function(p) means[p[1]] - means[p[2]])
  hw <- apply(pairs, 1, function(p) crit * sqrt(msw * (1 / sizes[p[1]] + 1 / sizes[p[2]])))
  list(crit = crit, diff = d, hw = hw, lo = d - hw, hi = d + hw)
}
C <- k * (k - 1) / 2
lsd05 <- byhand(qt(1 - 0.05 / 2, dfw))
bonf05 <- byhand(qt(1 - 0.05 / (2 * C), dfw))
bonf10 <- byhand(qt(1 - 0.10 / (2 * C), dfw))

# Bonferroni families of Welch intervals, all pairs and versus group 1.
famPairs <- lapply(1:nrow(pairs), function(r) {
  i <- pairs[r, 1]; jj <- pairs[r, 2]
  tt(t.test(groups[[i]], groups[[jj]], conf.level = 1 - 0.05 / C))
})
famControl <- lapply(2:4, function(i) tt(t.test(groups[[i]], groups[[1]], conf.level = 1 - 0.05 / 3)))

# Each group's own t interval at 1 - alpha/k.
simul <- lapply(1:4, function(i) tt(t.test(groups[[i]], conf.level = 1 - 0.05 / 4)))

# Dunnett's two-sided critical value with group 1 as the control, by Monte
# Carlo of max |T_i|. Under the null the group means are independent normals
# with variances 1/n_i and the pooled variance is an independent chi-square
# over its degrees of freedom, which is what is drawn here.
set.seed(99)
dunnettBatch <- function(m) {
  mbar <- sapply(sizes, function(n) rnorm(m, sd = 1 / sqrt(n)))
  s <- sqrt(rchisq(m, dfw) / dfw)
  tmax <- rep(0, m)
  for (i in 2:4) {
    ti <- abs(mbar[, i] - mbar[, 1]) / (s * sqrt(1 / sizes[i] + 1 / sizes[1]))
    tmax <- pmax(tmax, ti)
  }
  tmax
}
batches <- lapply(1:5, function(b) dunnettBatch(100000))
bq <- sapply(batches, function(v) unname(quantile(v, 0.95)))
dq <- unname(quantile(unlist(batches), 0.95))
dse <- sd(bq) / sqrt(5)

# The same critical value by nested integrate() and uniroot(), conditioning on
# the control's standardized mean z and on s = S / sigma:
#   P(max |T_i| <= c) = int f(s) int phi(z) prod_i [Phi(l_i z + c s a_i) - Phi(l_i z - c s a_i)] dz ds,
# with l_i = sqrt(n_i / n_1), a_i = sqrt(1 + l_i^2), and f the density of
# sqrt(V / dfw) for V chi-square on dfw degrees of freedom.
lam <- sqrt(sizes[2:4] / sizes[1])
aa <- sqrt(1 + lam^2)
pdun <- function(cc) integrate(function(s) sapply(s, function(ss) {
  dens <- 2 * ss * dfw * dchisq(dfw * ss^2, dfw)
  dens * integrate(function(z) dnorm(z) * Reduce(`*`, lapply(1:3, function(m)
    pnorm(lam[m] * z + cc * ss * aa[m]) - pnorm(lam[m] * z - cc * ss * aa[m]))),
    -Inf, Inf, rel.tol = 1e-11)$value
}), 0, Inf, rel.tol = 1e-11)$value
dexact <- uniroot(function(cc) pdun(cc) - 0.95, c(2, 3), tol = 1e-10)$root

# A second four-group sample with equal true means, for which the F test does
# not reject at 0.05 (checked below), to exercise LSD's protection.
set.seed(31337)
nullGroups <- lapply(sizes, function(n) rnorm(n, mean = 10, sd = 1.5))
nfit <- aov(unlist(nullGroups) ~ g)
ntab <- summary(nfit)[[1]]

out <- list(
  two = list(x = x, y = y, welch95 = welch95, welch90 = welch90, welch99 = welch99,
             pooled95 = pooled95, pooled90 = pooled90, pooled99 = pooled99),
  paired = list(x = px, y = py, t95 = paired95, t90 = paired90, r = pr, sdD = psd),
  four = list(
    groups = lapply(groups, arr), sizes = sizes, means = means,
    anova = list(dfb = tab$Df[1], dfw = dfw, ssb = tab$`Sum Sq`[1], ssw = tab$`Sum Sq`[2],
                 msb = tab$`Mean Sq`[1], msw = msw, F = tab$`F value`[1], p = tab$`Pr(>F)`[1]),
    pairs = lapply(1:nrow(pairs), function(r) pairs[r, ] - 1),
    tukey95 = tk(0.95), tukey90 = tk(0.90),
    lsd05 = lsd05, bonf05 = bonf05, bonf10 = bonf10,
    famPairs = famPairs, famControl = famControl, simul = simul,
    dunnett = list(level = 0.95, control = 0, reps = 500000, batches = 5,
                   batchQuantiles = bq, quantile = dq, se = dse,
                   integrated = dexact)
  ),
  nullFour = list(groups = lapply(nullGroups, arr), F = ntab$`F value`[1], p = ntab$`Pr(>F)`[1])
)
cat(j(out))
cat("\n")
