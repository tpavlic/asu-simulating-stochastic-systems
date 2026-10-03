# Reference values for test/special.test.mjs, computed with R's own
# distribution functions. Run:  Rscript special.R > special.json
j <- function(x) {
  if (is.list(x) && !is.null(names(x))) paste0("{", paste(sprintf('"%s":%s', names(x), sapply(x, j)), collapse = ","), "}")
  else if (is.list(x) || length(x) > 1) paste0("[", paste(sapply(x, j), collapse = ","), "]")
  else if (is.character(x)) sprintf('"%s"', x)
  else if (is.logical(x)) tolower(as.character(x))
  else sprintf("%.17g", x)
}
set.seed(20261002)
# Dunnett two-sided and one-sided critical values by Monte Carlo of the
# max-|T| statistic: k treatments against one control, pooled variance on nu
# degrees of freedom, in 5 batches of 200000 so the batch spread gives a
# standard error.
dunnett_mc <- function(ns, nu, p = 0.95, batches = 5, M = 200000) {
  two <- numeric(batches); one <- numeric(batches)
  for (b in seq_len(batches)) {
    y0 <- rnorm(M, sd = 1 / sqrt(ns[1]))
    s2 <- rchisq(M, nu) / nu
    mx2 <- rep(0, M); mx1 <- rep(-Inf, M)
    for (i in 2:length(ns)) {
      yi <- rnorm(M, sd = 1 / sqrt(ns[i]))
      Ti <- (yi - y0) / sqrt(s2 * (1 / ns[i] + 1 / ns[1]))
      mx2 <- pmax(mx2, abs(Ti)); mx1 <- pmax(mx1, Ti)
    }
    two[b] <- quantile(mx2, p); one[b] <- quantile(mx1, p)
  }
  list(ns = ns, nu = nu, two = mean(two), twoSe = sd(two) / sqrt(batches),
       one = mean(one), oneSe = sd(one) / sqrt(batches))
}
out <- list(
  ptukey = list(list(q = 3.5, k = 3, nu = 12, p = ptukey(3.5, 3, 12)),
                list(q = 2.0, k = 5, nu = 30, p = ptukey(2.0, 5, 30)),
                list(q = 4.2, k = 8, nu = 9,  p = ptukey(4.2, 8, 9))),
  qtukey = list(list(p = 0.95, k = 4, nu = 20, q = qtukey(0.95, 4, 20)),
                list(p = 0.90, k = 2, nu = 10, q = qtukey(0.90, 2, 10)),
                list(p = 0.99, k = 6, nu = 36, q = qtukey(0.99, 6, 36))),
  qt = list(list(p = 0.975, nu = 9, q = qt(0.975, 9)), list(p = 0.995, nu = 4, q = qt(0.995, 4)),
            list(p = 0.95, nu = 19, q = qt(0.95, 19))),
  pt = list(list(t = 2.1, nu = 7, p = pt(2.1, 7)), list(t = -0.4, nu = 30, p = pt(-0.4, 30))),
  qchisq = list(list(p = 0.025, k = 9, q = qchisq(0.025, 9)), list(p = 0.975, k = 9, q = qchisq(0.975, 9)),
                list(p = 0.005, k = 24, q = qchisq(0.005, 24))),
  qf = list(list(p = 0.975, d1 = 9, d2 = 14, q = qf(0.975, 9, 14)), list(p = 0.025, d1 = 9, d2 = 14, q = qf(0.025, 9, 14))),
  pf = list(list(f = 2.5, d1 = 3, d2 = 16, p = pf(2.5, 3, 16))),
  pnorm = list(list(z = 1.3, p = pnorm(1.3)), list(z = -2.7, p = pnorm(-2.7)), list(z = 0.1, p = pnorm(0.1))),
  qnorm = list(list(p = 0.975, z = qnorm(0.975)), list(p = 0.01, z = qnorm(0.01))),
  lgamma = list(list(x = 0.5, v = lgamma(0.5)), list(x = 7.25, v = lgamma(7.25)), list(x = 0.1, v = lgamma(0.1))),
  dunnett = list(dunnett_mc(c(5, 5, 5, 5), 16), dunnett_mc(c(6, 4, 8), 15))
)
cat(j(out))
