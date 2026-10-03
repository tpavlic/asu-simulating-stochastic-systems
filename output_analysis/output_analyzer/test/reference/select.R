# Reference values for js/stats/select.js. Run from the repository root:
#   Rscript output_analysis/output_analyzer/test/reference/select.R > output_analysis/output_analyzer/test/reference/select.json
# Base R only. The subset-selection screen is coded here by hand, and Rinott's
# h is found by nested integrate() and uniroot(), independently of the
# Gauss-Legendre rule the JavaScript uses.

j <- function(x) {
  if (is.list(x) && !is.null(names(x))) paste0("{", paste(sprintf('"%s":%s', names(x), sapply(x, j)), collapse = ","), "}")
  else if (is.list(x) || length(x) > 1) paste0("[", paste(sapply(x, j), collapse = ","), "]")
  else if (is.character(x)) sprintf('"%s"', x)
  else if (is.logical(x)) tolower(as.character(x))
  else sprintf("%.17g", x)
}

# The same four groups as compare.R (sizes 6, 8, 7, 9).
set.seed(4242)
sizes <- c(6, 8, 7, 9)
mus <- c(10, 11, 13, 10.5)
groups <- lapply(1:4, function(i) rnorm(sizes[i], mean = mus[i], sd = 1.5))

screen <- function(groups, alpha, delta, dir) {
  k <- length(groups)
  n <- sapply(groups, length)
  m <- sapply(groups, mean)
  s2 <- sapply(groups, var)
  n0 <- min(n)
  a0 <- alpha / 2
  tt <- qt((1 - a0)^(1 / (k - 1)), n0 - 1)
  W <- matrix(0, k, k)
  for (i in 1:k) for (jj in 1:k) if (i != jj) W[i, jj] <- tt * sqrt(s2[i] / n[i] + s2[jj] / n[jj])
  surv <- sapply(1:k, function(i) all(sapply(setdiff(1:k, i), function(jj) {
    slack <- max(0, W[i, jj] - delta)
    if (dir == "max") m[i] >= m[jj] - slack else m[i] <= m[jj] + slack
  })))
  best <- if (dir == "max") which.max(m) else which.min(m)
  list(dir = dir, t = tt, W = lapply(1:k, function(i) W[i, ]), survivors = surv,
       best = best - 1, means = m, s2 = s2, n = n)
}

# Rinott's h: P* = int g(y) [ int g(x) Phi(h / sqrt(nu (1/x + 1/y))) dx ]^(k-1) dy,
# g the chi-square density on nu = n0 - 1 degrees of freedom.
rinott <- function(n0, k, pstar) {
  nu <- n0 - 1
  inner <- function(h, y) integrate(function(x) dchisq(x, nu) * pnorm(h / sqrt(nu * (1 / x + 1 / y))),
                                    0, Inf, rel.tol = 1e-10)$value
  pcs <- function(h) integrate(function(y) sapply(y, function(yy) inner(h, yy))^(k - 1) * dchisq(y, nu),
                               0, Inf, rel.tol = 1e-10)$value
  uniroot(function(h) pcs(h) - pstar, c(0.5, 12), tol = 1e-10)$root
}

alpha <- 0.05
delta <- 1.0
sMax <- screen(groups, alpha, delta, "max")
sMin <- screen(groups, alpha, delta, "min")
h <- rinott(min(sizes), 4, 1 - alpha / 2)
sizing <- function(s) {
  Ni <- pmax(s$n, ceiling((h * sqrt(s$s2) / delta)^2))
  # Exact (h s_i / delta)^2 too, to show how far each lies from an integer.
  list(N = ifelse(s$survivors, Ni, -1), raw = (h * sqrt(s$s2) / delta)^2)
}

out <- list(groups = lapply(groups, as.list), alpha = alpha, delta = delta,
            max = c(sMax, sizing(sMax)), min = c(sMin, sizing(sMin)),
            h = list(n0 = min(sizes), k = 4, pstar = 1 - alpha / 2, value = h))
cat(j(out))
cat("\n")
