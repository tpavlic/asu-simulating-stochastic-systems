# Reference values for bandCrossing in js/stats/steadystate.js: the first lag from which R's own
# acf stays inside the band of 2/sqrt(n) for 5 lags in a row (or through the last lag, if sooner),
# over lags 1 to min(400, n/4) as the page's correlogram runs.
# Run from the repository root:
#   Rscript output_analysis/output_analyzer/test/reference/crossing.R > output_analysis/output_analyzer/test/reference/crossing.json
# The series are generated here (seeded) and written into the JSON, apart from the bundled long
# run, which is read from the example's own data file.

j <- function(x) {
  if (is.list(x) && !is.null(names(x))) paste0("{", paste(sprintf('"%s":%s', names(x), sapply(x, j)), collapse = ","), "}")
  else if (is.list(x) || length(x) > 1) paste0("[", paste(sapply(x, j), collapse = ","), "]")
  else if (is.character(x)) sprintf('"%s"', x)
  else if (is.na(x)) "null"
  else if (is.logical(x)) tolower(as.character(x))
  else sprintf("%.17g", as.numeric(x))
}

crossing <- function(y) {
  n <- length(y); L <- min(400, floor(n / 4)); band <- 2 / sqrt(n)
  r <- as.numeric(acf(y, lag.max = L, plot = FALSE)$acf)[-1]
  crossing <- NA
  for (k in seq_len(L)) {
    if (all(abs(r[k:min(L, k + 4)]) <= band)) { crossing <- k; break }
  }
  list(maxLag = L, band = band, crossing = crossing)
}

set.seed(20261110)
ar1 <- function(n, phi) as.numeric(filter(rnorm(n), phi, method = "recursive"))
cases <- list(
  list(name = "AR(1), phi = 0.95, n = 4000", y = ar1(4000, 0.95)),
  list(name = "independent normals, n = 600", y = rnorm(600)),
  list(name = "oscillating AR(3), r1 < 0 < r3, n = 3000",
       y = as.numeric(filter(rnorm(3000), c(-0.3, 0, 0.35), method = "recursive"))),
  list(name = "linear trend with noise, n = 1200: never inside", y = seq_len(1200) / 100 + rnorm(1200))
)
long <- read.csv("output_analysis/output_analyzer/data/steady_state_long.csv")$wait
out <- lapply(cases, function(cs) c(list(name = cs$name, y = cs$y), crossing(cs$y)))
out[[length(out) + 1]] <- c(list(name = "bundled long run (steady_state_long.csv)", file = "steady_state_long.csv"), crossing(long))
cat(j(list(cases = out)), "\n")
