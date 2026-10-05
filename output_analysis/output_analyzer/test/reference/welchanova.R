# Reference values for js/stats/compare.js's welchAnova and posthocWelch. Run from
# the repository root:
#   Rscript output_analysis/output_analyzer/test/reference/welchanova.R > output_analysis/output_analyzer/test/reference/welchanova.json
# Base R only: oneway.test(var.equal = FALSE) for Welch's F, and the Games-Howell
# and Bonferroni-on-Welch-pairs comparisons by hand from ptukey, qtukey, and
# t.test. The groups are drawn here from a fixed seed and written beside the
# results, so the tests run on exactly the data R analyzed.

j <- function(x) {
  if (is.list(x) && !is.null(names(x))) paste0("{", paste(sprintf('"%s":%s', names(x), sapply(x, j)), collapse = ","), "}")
  else if (is.list(x) || length(x) > 1) paste0("[", paste(sapply(x, j), collapse = ","), "]")
  else if (is.character(x)) sprintf('"%s"', x)
  else if (is.logical(x)) tolower(as.character(x))
  else sprintf("%.17g", x)
}
arr <- function(v) as.list(v)

# Four designs of unequal size and clearly unequal spread.
set.seed(20261004)
sizes <- c(8, 12, 10, 15)
sds <- c(0.8, 2.5, 1.2, 3.0)
mus <- c(10, 11.5, 10.4, 13)
groups <- lapply(1:4, function(i) rnorm(sizes[i], mus[i], sds[i]))
y <- unlist(groups); g <- factor(rep(1:4, sizes))
k <- 4
ow <- oneway.test(y ~ g, var.equal = FALSE)
welch <- list(F = unname(ow$statistic), df1 = unname(ow$parameter[1]), df2 = unname(ow$parameter[2]), p = ow$p.value)

prs <- combn(k, 2, simplify = FALSE)
C <- length(prs)
pairStats <- function(i, jj) {
  xi <- groups[[i]]; xj <- groups[[jj]]
  a1 <- var(xi) / length(xi); a2 <- var(xj) / length(xj)
  se <- sqrt(a1 + a2)
  df <- (a1 + a2)^2 / (a1^2 / (length(xi) - 1) + a2^2 / (length(xj) - 1))
  list(diff = mean(xi) - mean(xj), se = se, df = df)
}
gh <- function(alpha) lapply(prs, function(q) {
  s <- pairStats(q[1], q[2])
  crit <- qtukey(1 - alpha, k, s$df)
  hw <- crit * s$se / sqrt(2)
  list(i = q[1] - 1, j = q[2] - 1, diff = s$diff, se = s$se, df = s$df, crit = crit, hw = hw,
       lo = s$diff - hw, hi = s$diff + hw,
       p = ptukey(abs(s$diff) / (s$se / sqrt(2)), k, s$df, lower.tail = FALSE))
})
bw <- function(alpha) lapply(prs, function(q) {
  tt <- t.test(groups[[q[1]]], groups[[q[2]]], conf.level = 1 - alpha / C)
  list(i = q[1] - 1, j = q[2] - 1, diff = unname(tt$estimate[1] - tt$estimate[2]), df = unname(tt$parameter),
       crit = qt(1 - alpha / (2 * C), unname(tt$parameter)), lo = tt$conf.int[1], hi = tt$conf.int[2],
       p = min(1, C * tt$p.value))
})

cat(j(list(groups = lapply(groups, arr), sizes = sizes, welch = welch,
           gh05 = gh(0.05), gh10 = gh(0.10), bw05 = bw(0.05), bw01 = bw(0.01))))
