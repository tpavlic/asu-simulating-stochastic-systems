# Reference values for levene() in js/stats/compare.js. Run from the repository root:
#   Rscript output_analysis/output_analyzer/test/reference/levene.R > output_analysis/output_analyzer/test/reference/levene.json
# Base R only: Levene's test is the one-way ANOVA of the absolute deviations
# from each group's center, the median (Brown and Forsythe's form, R's
# car::leveneTest default) or the mean (Levene's original).

j <- function(x) {
  if (is.list(x) && !is.null(names(x))) paste0("{", paste(sprintf('"%s":%s', names(x), sapply(x, j)), collapse = ","), "}")
  else if (is.list(x) || length(x) > 1) paste0("[", paste(sapply(x, j), collapse = ","), "]")
  else if (is.character(x)) sprintf('"%s"', x)
  else if (is.logical(x)) tolower(as.character(x))
  else sprintf("%.17g", x)
}

levene <- function(groups, center) {
  g <- factor(rep(seq_along(groups), sapply(groups, length)))
  y <- unlist(groups)
  cen <- if (center == "median") tapply(y, g, median) else tapply(y, g, mean)
  z <- abs(y - cen[as.integer(g)])
  tab <- anova(lm(z ~ g))
  list(center = center, F = tab$`F value`[1], df1 = tab$Df[1], df2 = tab$Df[2], p = tab$`Pr(>F)`[1],
       centers = as.numeric(cen))
}

both <- function(groups) list(groups = groups, median = levene(groups, "median"), mean = levene(groups, "mean"))

# The same four normal groups as compare.R (sizes 6, 8, 7, 9).
set.seed(4242)
sizes <- c(6, 8, 7, 9)
mus <- c(10, 11, 13, 10.5)
four <- lapply(1:4, function(i) rnorm(sizes[i], mean = mus[i], sd = 1.5))

# Three skewed groups with unequal spread, where the F ratio would mislead.
set.seed(777)
skew <- list(rexp(12, rate = 1), rexp(9, rate = 1 / 2.5), rexp(15, rate = 1 / 0.6))

# Two groups, for the Variance page.
set.seed(99)
two <- list(rnorm(10, 5, 1), rnorm(12, 5, 2.2))

cat(j(list(four = both(four), skew = both(skew), two = both(two))), "\n")
