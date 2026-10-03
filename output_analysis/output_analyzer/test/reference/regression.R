# Reference values for test/regression.test.mjs: a least-squares line and its
# confidence band for the mean, from R's lm and predict. Run:
#   Rscript output_analysis/output_analyzer/test/reference/regression.R > output_analysis/output_analyzer/test/reference/regression.json
j <- function(x) {
  if (is.list(x) && !is.null(names(x))) paste0("{", paste(sprintf('"%s":%s', names(x), sapply(x, j)), collapse = ","), "}")
  else if (is.list(x) || length(x) > 1) paste0("[", paste(sapply(x, j), collapse = ","), "]")
  else if (is.character(x)) sprintf('"%s"', x)
  else if (is.logical(x)) tolower(as.character(x))
  else sprintf("%.17g", x)
}
set.seed(7)
x <- round(rnorm(12, 3, 0.8), 4)
y <- round(0.6 * x + rnorm(12, 0, 0.5), 4)
fit <- lm(y ~ x)
at <- c(1.5, 3, 4.4)
out <- list(x = x, y = y, slope = unname(coef(fit)[2]), intercept = unname(coef(fit)[1]),
            s = summary(fit)$sigma, df = fit$df.residual, r2 = summary(fit)$r.squared, at = at)
for (lv in c(0.9, 0.95, 0.99)) {
  p <- predict(fit, newdata = data.frame(x = at), interval = "confidence", level = lv)
  out[[paste0("band", lv * 100)]] <- list(fit = unname(p[, "fit"]), lo = unname(p[, "lwr"]), hi = unname(p[, "upr"]))
}
cat(j(out))
