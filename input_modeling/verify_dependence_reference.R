# Reference values for the dependence numerics in input_analyzer.html.
# NOT shipped with the widget.
#
#   Rscript input_modeling/verify_dependence_reference.R > input_modeling/verify_dependence_reference.json
#
# Every dataset is generated here with a fixed seed and written into the JSON
# beside the values R computes from it, so that verify_input_analyzer.mjs
# feeds the page's core the same numbers R saw. Regenerate the JSON only by
# re-running this script.

suppressPackageStartupMessages(library(lmtest))
set.seed(20261015)

num <- function(v) {
  # Full double precision, and JSON null for NA/NaN/Inf.
  out <- ifelse(is.finite(v), formatC(v, digits = 17, format = "g"), "null")
  out <- gsub(" ", "", out)
  if (length(v) == 1) out else paste0("[", paste(out, collapse = ","), "]")
}
arr <- function(v) paste0("[", paste(gsub(" ", "", ifelse(is.finite(v), formatC(v, digits = 17, format = "g"), "null")), collapse = ","), "]")
obj <- function(...) {
  a <- list(...)
  paste0("{", paste(sprintf('"%s":%s', names(a), unlist(a)), collapse = ","), "}")
}

ct <- function(x, y) {
  p <- cor.test(x, y, method = "pearson")
  s <- suppressWarnings(cor.test(x, y, method = "spearman", exact = FALSE))
  k <- suppressWarnings(cor.test(x, y, method = "kendall"))
  kexact <- !any(duplicated(x)) && !any(duplicated(y)) && length(x) < 50
  obj(x = arr(x), y = arr(y),
      r = num(unname(p$estimate)), t = num(unname(p$statistic)), p = num(p$p.value),
      lo = num(p$conf.int[1]), hi = num(p$conf.int[2]),
      rho = num(unname(s$estimate)), rhoP = num(s$p.value),
      tau = num(unname(k$estimate)), tauP = num(k$p.value),
      tauExact = if (kexact) "true" else "false")
}

# Pairs: continuous with no ties (exact Kendall), a small sample, and counts
# with many ties (normal Kendall with the tie correction).
x1 <- rnorm(30); y1 <- 0.5 * x1 + rnorm(30)
x2 <- runif(9); y2 <- x2 + rnorm(9, sd = 0.3)
x3 <- rpois(60, 4); y3 <- x3 + rpois(60, 2)
x4 <- rnorm(80); y4 <- -0.3 * x4 + rnorm(80)   # n >= 50, untied: normal Kendall

reg <- function(x, y) {
  f <- lm(y ~ x); s <- summary(f); ci <- confint(f)
  bp <- bptest(f)
  obj(x = arr(x), y = arr(y),
      a = num(coef(f)[[1]]), b = num(coef(f)[[2]]),
      seA = num(s$coefficients[1, 2]), seB = num(s$coefficients[2, 2]),
      ciA = arr(ci[1, ]), ciB = arr(ci[2, ]),
      r2 = num(s$r.squared), s = num(s$sigma), pB = num(s$coefficients[2, 4]),
      bp = num(unname(bp$statistic)), bpP = num(bp$p.value))
}
xr <- 1:50; yr <- 2 + 0.5 * xr + rnorm(50, sd = 0.2 * xr)   # spread grows with x
xh <- runif(40, 0, 10); yh <- 1 + 2 * xh + rnorm(40)          # constant spread

# Time order.
ar_series <- as.numeric(arima.sim(list(ar = 0.6), n = 200)) + 5
a <- acf(ar_series, lag.max = 20, plot = FALSE)$acf[, 1, 1]
lb0 <- Box.test(ar_series, lag = 10, type = "Ljung-Box", fitdf = 0)
lb1 <- Box.test(ar_series, lag = 10, type = "Ljung-Box", fitdf = 1)
yw <- ar.yw(ar_series, aic = FALSE, order.max = 1)

th <- 0:143
yhar <- 10 + 3 * cos(2 * pi * th / 24) - 1.5 * sin(2 * pi * th / 24) +
  0.8 * cos(4 * pi * th / 24) + 0.01 * th + rnorm(144, sd = 0.7)
harm <- function(t, y, P, H, trend) {
  X <- do.call(cbind, lapply(1:H, function(k) cbind(cos(2 * pi * k * t / P), sin(2 * pi * k * t / P))))
  f <- if (trend) lm(y ~ X + t) else lm(y ~ X)
  s <- summary(f); fs <- s$fstatistic
  b <- coef(f)
  obj(P = num(P), H = num(H), trend = if (trend) "true" else "false",
      coef = arr(unname(b)), r2 = num(s$r.squared), s = num(s$sigma),
      F = num(unname(fs[1])), df1 = num(unname(fs[2])), df2 = num(unname(fs[3])),
      p = num(pf(fs[1], fs[2], fs[3], lower.tail = FALSE)),
      resid = arr(unname(resid(f))))
}

pg <- function(y, span) {
  sp <- if (span == 1) spec.pgram(y, taper = 0, detrend = FALSE, fast = FALSE, plot = FALSE)
        else spec.pgram(y, spans = span, taper = 0, detrend = FALSE, fast = FALSE, plot = FALSE)
  obj(span = num(span), freq = arr(sp$freq), spec = arr(sp$spec))
}

cat(obj(
  pairs = paste0("[", paste(ct(x1, y1), ct(x2, y2), ct(x3, y3), ct(x4, y4), sep = ","), "]"),
  regs = paste0("[", paste(reg(xr, yr), reg(xh, yh), sep = ","), "]"),
  ts = obj(y = arr(ar_series), acf = arr(a),
           lb0 = obj(Q = num(unname(lb0$statistic)), df = num(unname(lb0$parameter)), p = num(lb0$p.value)),
           lb1 = obj(Q = num(unname(lb1$statistic)), df = num(unname(lb1$parameter)), p = num(lb1$p.value)),
           phi = num(yw$ar[1]), varPred = num(yw$var.pred), mean = num(yw$x.mean)),
  harm = obj(t = arr(th), y = arr(yhar),
             fits = paste0("[", paste(harm(th, yhar, 24, 1, FALSE), harm(th, yhar, 24, 2, TRUE), sep = ","), "]")),
  pgram = paste0("[", paste(pg(yhar, 1), pg(yhar, 3), pg(yhar, 5), sep = ","), "]")
), "\n")
