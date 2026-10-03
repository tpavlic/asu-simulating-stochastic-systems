# Reference values for test/normality.test.mjs: the Shapiro–Wilk test, the
# normal plotting positions, and the line through the quartiles that R's
# qqline draws, for samples of several sizes and shapes. Run:
#   Rscript output_analysis/output_analyzer/test/reference/normality.R > output_analysis/output_analyzer/test/reference/normality.json
j <- function(x) {
  if (is.list(x) && !is.null(names(x))) paste0("{", paste(sprintf('"%s":%s', names(x), sapply(x, j)), collapse = ","), "}")
  else if (is.list(x) || length(x) > 1) paste0("[", paste(sapply(x, j), collapse = ","), "]")
  else if (is.character(x)) sprintf('"%s"', x)
  else if (is.logical(x)) tolower(as.character(x))
  else sprintf("%.17g", x)
}
set.seed(11)
samples <- list(
  n3 = round(rnorm(3, 5, 1), 4),
  n4 = round(rnorm(4, 5, 1), 4),
  n5 = round(rnorm(5, 5, 1), 4),
  n6 = round(rnorm(6, 5, 1), 4),
  n10 = round(rnorm(10, 5, 1), 4),
  n11 = round(rnorm(11, 5, 1), 4),
  n12 = round(rnorm(12, 5, 1), 4),
  n20 = round(rnorm(20, 2, 0.5), 4),
  exp20 = round(rexp(20, 0.5), 4),
  unif30 = round(runif(30), 4),
  n50 = round(rnorm(50), 4),
  exp200 = round(rexp(200), 4),
  n1000 = round(rnorm(1000, 10, 3), 4),
  ties = c(1, 1, 2, 2, 2, 3, 3, 4, 5, 5, 5, 6)
)
out <- list()
for (nm in names(samples)) {
  x <- samples[[nm]]
  sw <- shapiro.test(x)
  s <- sort(x)
  pp <- ppoints(length(x))
  q <- quantile(x, c(0.25, 0.75), names = FALSE)
  z <- qnorm(c(0.25, 0.75))
  slope <- diff(q) / diff(z)
  out[[nm]] <- list(x = x, W = unname(sw$statistic), p = sw$p.value, ppoints = pp,
                    theoretical = qnorm(pp), sample = s,
                    slope = slope, intercept = q[1] - slope * z[1])
}
cat(j(out))
