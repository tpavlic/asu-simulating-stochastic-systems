# Reference values for js/stats/nonparam.js. Run from the repository root:
#   Rscript output_analysis/output_analyzer/test/reference/nonparam.R > output_analysis/output_analyzer/test/reference/nonparam.json
# Base R only: wilcox.test (exact and approximate paths, with conf.int),
# kruskal.test, and Dunn's pairwise z tests coded by hand with p.adjust.

j <- function(x) {
  if (is.list(x) && !is.null(names(x))) paste0("{", paste(sprintf('"%s":%s', names(x), sapply(x, j)), collapse = ","), "}")
  else if (is.list(x) || length(x) > 1) paste0("[", paste(sapply(x, j), collapse = ","), "]")
  else if (is.character(x)) sprintf('"%s"', x)
  else if (is.logical(x)) tolower(as.character(x))
  else sprintf("%.17g", x)
}

# R 4.4 and later compute an exact permutation distribution even under ties;
# the widget uses the classical normal approximation there, which is what
# exact = FALSE asks R for, so the tied cases are pinned to that path.
one <- function(x, mu, level, exact = NULL) {
  w <- suppressWarnings(wilcox.test(x, mu = mu, conf.int = TRUE, conf.level = level, exact = exact))
  list(x = x, mu = mu, level = level, V = unname(w$statistic), p = w$p.value, estimate = unname(w$estimate),
       lo = w$conf.int[1], hi = w$conf.int[2], achieved = attr(w$conf.int, "conf.level"),
       exact = is.null(w$method) || !grepl("correction", w$method))
}
two <- function(x, y, level, exact = NULL) {
  w <- suppressWarnings(wilcox.test(x, y, conf.int = TRUE, conf.level = level, exact = exact))
  list(x = x, y = y, level = level, W = unname(w$statistic), p = w$p.value, estimate = unname(w$estimate),
       lo = w$conf.int[1], hi = w$conf.int[2], achieved = attr(w$conf.int, "conf.level"),
       exact = !grepl("correction", w$method))
}
dunnBy <- function(groups, adjust) {
  g <- factor(rep(seq_along(groups), sapply(groups, length)))
  y <- unlist(groups)
  r <- rank(y)
  N <- length(y)
  tt <- table(y); ties <- sum(tt^3 - tt)
  v <- N * (N + 1) / 12 - ties / (12 * (N - 1))
  mr <- tapply(r, g, mean); n <- tapply(r, g, length)
  k <- length(groups)
  out <- list()
  for (i in 1:(k - 1)) for (jj in (i + 1):k) {
    z <- (mr[i] - mr[jj]) / sqrt(v * (1 / n[i] + 1 / n[jj]))
    out[[length(out) + 1]] <- list(i = i - 1, j = jj - 1, z = unname(z), p = 2 * pnorm(-abs(unname(z))))
  }
  p <- sapply(out, function(o) o$p)
  padj <- p.adjust(p, method = adjust)
  for (q in seq_along(out)) out[[q]]$pAdj <- padj[q]
  out
}
kw <- function(groups) {
  k <- kruskal.test(groups)
  list(groups = groups, H = unname(k$statistic), df = unname(k$parameter), p = k$p.value,
       bonferroni = dunnBy(groups, "bonferroni"), holm = dunnBy(groups, "holm"))
}

set.seed(31)
a <- rnorm(10, 5, 1); b <- rnorm(12, 5.8, 1.3); d <- rnorm(15, 0.4, 1)
set.seed(32)
big <- rnorm(60, 2, 1); big2 <- rnorm(55, 2.3, 1.2)
tiedA <- round(rnorm(14, 5, 1) * 2) / 2; tiedB <- round(rnorm(11, 5.5, 1) * 2) / 2
paired <- round(rnorm(12, 0.3, 1) * 2) / 2   # ties, and zeros are possible
stopifnot(anyDuplicated(c(tiedA, tiedB)) > 0, anyDuplicated(abs(paired)) > 0)
set.seed(33)
g3 <- list(rexp(9), rexp(11, 1 / 1.8), rexp(10, 1 / 0.7))
g4 <- list(round(rnorm(8, 10, 2)), round(rnorm(9, 11, 2)), round(rnorm(7, 13, 2)), round(rnorm(10, 10.5, 2)))

cat(j(list(
  signed = list(exact = one(d, 0, 0.95), exact90 = one(d, 0.2, 0.90), ties = one(paired, 0, 0.95, exact = FALSE), big = one(big, 2, 0.95)),
  ranksum = list(exact = two(a, b, 0.95), exact99 = two(a, b, 0.99), ties = two(tiedA, tiedB, 0.95, exact = FALSE), big = two(big, big2, 0.95)),
  kw = list(three = kw(g3), four = kw(g4))
)), "\n")
