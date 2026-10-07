# Reference values for the studentized range, Dunnett's critical value, and
# Rinott's h on few degrees of freedom, where each quantile lies far out and the
# integrand over s = S / sigma rises in a narrow stretch near s = 1 / q. Run from
# the repository root:
#   Rscript output_analysis/output_analyzer/test/reference/lowdf.R > output_analysis/output_analyzer/test/reference/lowdf.json
# Base R only. R's own qtukey is not used: it returns NaN below 2 degrees of
# freedom and misses q(0.99, 4, 2) by about 1%. Every value here is a nested
# integrate() over s, split at 1 / q and 10 / q so that integrate() sees the
# stretch where the inner probability rises, and a uniroot() on the result.

j <- function(x) {
  if (is.list(x) && !is.null(names(x))) paste0("{", paste(sprintf('"%s":%s', names(x), sapply(x, j)), collapse = ","), "}")
  else if (is.list(x) || length(x) > 1) paste0("[", paste(sapply(x, j), collapse = ","), "]")
  else if (is.character(x)) sprintf('"%s"', x)
  else if (is.logical(x)) tolower(as.character(x))
  else sprintf("%.17g", x)
}

# The density of s = sqrt(V / nu) for V chi-square on nu degrees of freedom, and
# the integral of f(s) against it over (0, Inf) in pieces split at brk.
dens_s <- function(s, nu) 2 * nu * s * dchisq(nu * s^2, nu)
over_s <- function(f, nu, brk) {
  pts <- c(0, sort(brk), Inf)
  sum(sapply(seq_len(length(pts) - 1), function(i)
    integrate(function(s) dens_s(s, nu) * f(s), pts[i], pts[i + 1],
              rel.tol = 1e-12, abs.tol = 1e-15, subdivisions = 1000L)$value))
}
root_up <- function(f) uniroot(f, c(1, 20), extendInt = "upX", tol = 1e-12)$root

# Studentized range: P(Q <= q) = int f(s) k int phi(x) [Phi(x + q s) - Phi(x)]^(k-1) dx ds.
range_cdf <- function(r, k) k * integrate(function(x) dnorm(x) * (pnorm(x + r) - pnorm(x))^(k - 1),
                                          -Inf, Inf, rel.tol = 1e-12, abs.tol = 1e-15)$value
ptk <- function(q, k, nu) over_s(function(s) sapply(s, function(ss) range_cdf(q * ss, k)), nu, c(1, 10) / q)
qtk <- function(p, k, nu) root_up(function(q) ptk(q, k, nu) - p)

# Dunnett: P(max |T_i| <= c) = int f(s) int phi(z) prod_i [Phi(l_i z + c s a_i) - Phi(l_i z - c s a_i)] dz ds,
# with l_i = sqrt(n_i / n_0) and a_i = sqrt(1 + l_i^2) (two-sided).
pdun <- function(cc, lam, nu) {
  a <- sqrt(1 + lam^2)
  inner <- function(s) integrate(function(z) {
    pr <- rep(1, length(z))
    for (m in seq_along(lam)) pr <- pr * (pnorm(lam[m] * z + cc * s * a[m]) - pnorm(lam[m] * z - cc * s * a[m]))
    dnorm(z) * pr
  }, -Inf, Inf, rel.tol = 1e-12, abs.tol = 1e-15)$value
  over_s(function(s) sapply(s, inner), nu, c(1, 10) / cc)
}
qdun <- function(p, ns, nu) root_up(function(cc) pdun(cc, sqrt(ns[-1] / ns[1]), nu) - p)

# Rinott's h: P* = int g(v) [ int g(u) Phi(h u v / sqrt(u^2 + v^2)) du ]^(k-1) dv,
# g the density of s on nu = n0 - 1 degrees of freedom: the chi-square form of
# select.R with x = nu u^2 and y = nu v^2.
rinott <- function(n0, k, pstar) {
  nu <- n0 - 1
  inner <- function(h, v) over_s(function(u) pnorm(h * u * v / sqrt(u^2 + v^2)), nu, c(1, 10) / h)
  pcs <- function(h) over_s(function(v) sapply(v, function(vv) inner(h, vv))^(k - 1), nu, c(1, 10) / h)
  root_up(function(h) pcs(h) - pstar)
}

tukey <- lapply(list(c(0.99, 4, 2), c(0.99, 6, 1.5), c(0.99, 3, 2), c(0.95, 5, 1), c(0.99, 4, 3)),
                function(a) list(p = a[1], k = a[2], nu = a[3], q = qtk(a[1], a[2], a[3])))
dunnett <- lapply(list(list(p = 0.99, ns = c(4, 4, 4, 4), nu = 1), list(p = 0.95, ns = c(2, 3, 2, 4), nu = 1),
                       list(p = 0.99, ns = c(2, 3, 2), nu = 1.5)),
                  function(a) c(a, list(c = qdun(a$p, a$ns, a$nu))))
rinottRows <- lapply(2:5, function(k) list(n0 = 2, k = k, pstar = 0.975, h = rinott(2, k, 0.975)))
rinottRows <- c(rinottRows, list(list(n0 = 3, k = 4, pstar = 0.975, h = rinott(3, 4, 0.975))))

cat(j(list(tukey = tukey, dunnett = dunnett, rinott = rinottRows)))
cat("\n")
