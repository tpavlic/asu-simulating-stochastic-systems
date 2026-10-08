// Figure helpers for the Base R regenerate scripts. Each value is literal R code: `common`
// holds the colors and small helpers that several figures share, and every other key defines
// the one function that draws that kind of figure with base graphics on the current device.
// Pure text; the script writer in analysis_scripts.js chooses which helpers a script carries
// (always with `common`). The snippets are template literals, and so none of them may
// contain a backtick or a dollar sign followed by a brace.

export const FIG_R = {};

FIG_R.common = `
# Colors used by every figure.
FIG_EST <- "#2b6cb0"      # data points and series
FIG_TRUTH <- "#1a1a1a"    # intervals, means, estimates
FIG_MISS <- "#c0392b"     # a flagged interval
FIG_OK <- "#2e7d32"       # survivors, batch means, highlights
FIG_MUTED <- "#9e9e9e"    # reference lines, eliminated rows, excluded stretches
FIG_ACCENT <- "#8c1d40"   # the cut or fence line, letters

# The finite entries of a vector (a missing argument gives an empty vector).
fig_finite <- function(v) {
  v <- as.numeric(v)
  v[is.finite(v)]
}

# The range of the finite entries, widened by pad on each side; (0, 1) when there are none,
# and a zero-width range is widened by 1 on each side.
fig_span <- function(v, pad = 0.05) {
  v <- fig_finite(v)
  if (length(v) == 0) return(c(0, 1))
  r <- range(v)
  # a range that is only rounding (0.1 against 0.1000...01) has no width either
  if (diff(r) <= 1e-10 * max(1, abs(r))) r <- mean(r) + c(-1, 1)
  r + c(-1, 1) * pad * diff(r)
}

# A y range for the finite entries of v, with extra room (a fraction of the range) on top
# for a legend.
fig_ylim <- function(v, head = 0) {
  r <- fig_span(v, 0.05)
  r[2] <- r[2] + head * diff(r)
  r
}

# A TRUE/FALSE flag for each of n rows; NULL or a missing entry means FALSE.
fig_flag <- function(f, n) {
  if (is.null(f)) return(rep(FALSE, n))
  f <- rep_len(as.logical(f), n)
  f[is.na(f)] <- FALSE
  f
}

# An empty frame with the title and a note, for a figure with nothing to draw.
fig_empty <- function(title, xlab = "", ylab = "") {
  plot(c(0, 1), c(0, 1), type = "n", axes = FALSE, xlab = xlab, ylab = ylab, main = title)
  box()
  text(0.5, 0.5, "nothing to draw", col = FIG_MUTED)
}

# A light gray band over the x stretch from xl to xr, the full height of the plot region.
fig_band <- function(xl, xr) {
  u <- par("usr")
  rect(max(xl, u[1]), u[3], min(xr, u[2]), u[4], col = adjustcolor(FIG_MUTED, 0.2),
       border = NA)
}
`;

FIG_R.strips = `
# Rows of dots, one row per element of values (a list), with an optional interval under each
# row (mid, lo, hi), a dashed reference line at ref, and a solid line at the mean of all the
# values when mean_line is TRUE.
fig_strips <- function(values, labels, xlab, title, mid = NULL, lo = NULL, hi = NULL,
                       ref = NA, mean_line = FALSE) {
  if (!is.list(values)) values <- list(values)
  n <- length(values)
  values <- lapply(values, as.numeric)
  allv <- c(unlist(values), mid, lo, hi, ref)
  if (n == 0 || length(fig_finite(allv)) == 0) {
    fig_empty(title, xlab)
    return(invisible(NULL))
  }
  labels <- rep_len(as.character(labels), n)
  xlim <- fig_span(allv, 0.05)
  op <- par(mai = c(0.8, max(strwidth(labels, units = "inches")) + 0.35, 0.5, 0.2))
  on.exit(par(op))
  plot(xlim, c(1, 1), ylim = c(n + 0.55, 0.45), type = "n", axes = FALSE, xlab = "", ylab = "")
  if (is.finite(ref)) abline(v = ref, lty = 2, col = FIG_MUTED)
  if (mean_line) abline(v = mean(fig_finite(unlist(values))), col = FIG_TRUTH, lwd = 1.5)
  for (i in seq_len(n)) {
    v <- fig_finite(values[[i]])
    if (length(v) > 0) {
      # Neighboring values in sorted order sit at different heights so ties stay visible.
      off <- ((seq_along(v) - 1) %% 4) * 0.06 - 0.09
      points(sort(v), i - 0.1 + off, pch = 19, cex = 1, col = adjustcolor(FIG_EST, 0.6))
    }
    if (!is.null(lo) && !is.null(hi) && is.finite(lo[i]) && is.finite(hi[i])) {
      y <- i + 0.28
      segments(lo[i], y, hi[i], y, col = FIG_TRUTH, lwd = 1.8)
      segments(c(lo[i], hi[i]), y - 0.08, c(lo[i], hi[i]), y + 0.08, col = FIG_TRUTH, lwd = 1.8)
      if (!is.null(mid) && is.finite(mid[i])) points(mid[i], y, pch = 19, col = FIG_TRUTH)
    }
  }
  axis(1)
  axis(2, at = seq_len(n), labels = labels, las = 1, tick = FALSE)
  box()
  title(main = title, xlab = xlab)
  invisible(NULL)
}
`;

FIG_R.intervals = `
# A forest plot: one row per interval (row 1 at the top) with the estimate as a dot. A
# flagged row is red and dashed with a hollow dot, a muted row gray and dashed, an ok row
# green. right gives a text for each row to the right of the plot, and brackets (a
# two-column matrix of row numbers) are drawn to the right of those texts.
fig_intervals <- function(mid, lo, hi, labels, xlab, title, ref = NA, flagged = NULL,
                          muted = NULL, right = NULL, brackets = NULL, ok = NULL) {
  mid <- as.numeric(mid)
  lo <- as.numeric(lo)
  hi <- as.numeric(hi)
  n <- length(mid)
  rng <- fig_span(c(mid, lo, hi, ref), 0.05)
  if (n == 0 || length(fig_finite(c(mid, lo, hi, ref))) == 0) {
    fig_empty(title, xlab)
    return(invisible(NULL))
  }
  labels <- rep_len(as.character(labels), n)
  flagged <- fig_flag(flagged, n)
  muted <- fig_flag(muted, n)
  ok <- fig_flag(ok, n)
  if (is.null(right)) right <- rep("", n)
  right <- rep_len(as.character(right), n)
  right[is.na(right)] <- ""

  # Give each bracket the leftmost column where no bracket already there shares a row;
  # shorter spans are placed first.
  nb <- if (is.null(brackets)) 0 else nrow(as.matrix(brackets))
  col_of <- integer(nb)
  if (nb > 0) {
    b <- as.matrix(brackets)
    top <- pmin(b[, 1], b[, 2])
    bottom <- pmax(b[, 1], b[, 2])
    for (k in order(bottom - top)) {
      column <- 1
      repeat {
        clash <- FALSE
        for (m in which(col_of == column)) {
          if (top[k] <= bottom[m] && top[m] <= bottom[k]) clash <- TRUE
        }
        if (!clash) break
        column <- column + 1
      }
      col_of[k] <- column
    }
  }
  ncol_b <- if (nb > 0) max(col_of) else 0

  op <- par(mai = c(0.8, max(strwidth(labels, units = "inches")) + 0.35, 0.5, 0.2))
  on.exit(par(op))
  # Widen the x range on the right just enough for the texts and the bracket columns.
  text_in <- if (any(nzchar(right))) max(strwidth(right, units = "inches")) + 0.1 else 0
  frac <- min(text_in / par("pin")[1] + ncol_b * 0.03 + (if (nb > 0) 0.02 else 0), 0.7)
  total <- diff(rng) / (1 - frac)
  plot(c(rng[1], rng[1] + total), c(1, 1), ylim = c(n + 0.5, 0.5), type = "n", axes = FALSE,
       xlab = "", ylab = "")

  if (is.finite(ref)) abline(v = ref, lty = 2, col = FIG_MUTED)
  for (i in seq_len(n)) {
    kind <- if (muted[i]) "muted" else if (flagged[i]) "flagged" else if (ok[i]) "ok" else "plain"
    color <- c(plain = FIG_TRUTH, flagged = FIG_MISS, muted = FIG_MUTED, ok = FIG_OK)[[kind]]
    dashed <- kind %in% c("muted", "flagged")
    # An infinite end runs to the edge of the data range and gets no end tick.
    a <- if (is.nan(lo[i]) || is.na(lo[i])) NA else if (lo[i] == -Inf) rng[1] else lo[i]
    z <- if (is.nan(hi[i]) || is.na(hi[i])) NA else if (hi[i] == Inf) rng[2] else hi[i]
    a_seg <- if (is.na(a)) mid[i] else a
    z_seg <- if (is.na(z)) mid[i] else z
    if (is.finite(a_seg) && is.finite(z_seg)) {
      segments(a_seg, i, z_seg, i, col = color, lwd = 1.8, lty = if (dashed) 2 else 1)
    }
    if (is.finite(lo[i])) segments(lo[i], i - 0.15, lo[i], i + 0.15, col = color, lwd = 1.8)
    if (is.finite(hi[i])) segments(hi[i], i - 0.15, hi[i], i + 0.15, col = color, lwd = 1.8)
    if (is.finite(mid[i])) {
      points(mid[i], i, pch = if (dashed) 21 else 19, col = color, bg = "white", cex = 1.2)
    }
    if (nzchar(right[i])) {
      text_col <- if (kind == "ok") FIG_OK else if (kind == "muted") FIG_MUTED else FIG_ACCENT
      text(rng[2] + 0.01 * total, i, right[i], adj = c(0, 0.5), col = text_col)
    }
  }
  if (nb > 0) {
    x0 <- rng[2] + 0.01 * total + text_in / par("pin")[1] * total
    for (k in seq_len(nb)) {
      x <- x0 + (col_of[k] - 0.5) * 0.03 * total
      segments(x, top[k], x, bottom[k], col = FIG_TRUTH, lwd = 1)
      segments(x - 0.012 * total, c(top[k], bottom[k]), x, c(top[k], bottom[k]),
               col = FIG_TRUTH, lwd = 1)
    }
  }
  ticks <- pretty(rng)
  axis(1, at = ticks[ticks >= rng[1] & ticks <= rng[2]])
  axis(2, at = seq_len(n), labels = labels, las = 1, tick = FALSE)
  box()
  title(main = title, xlab = xlab)
  invisible(NULL)
}
`;

FIG_R.pairsByRep = `
# Matched pairs by replication: design A as a filled dot, design B as a hollow dot, and a
# dashed segment joining the two.
fig_pairs_by_rep <- function(a, b, ids, xlab = "Replication id", title = "Pairs by replication") {
  a <- as.numeric(a)
  b <- as.numeric(b)
  n <- length(a)
  if (n == 0 || length(fig_finite(c(a, b))) == 0) {
    fig_empty(title, xlab, "Replication outcome")
    return(invisible(NULL))
  }
  ids <- rep_len(as.character(ids), n)
  plot(c(0.5, n + 0.5), fig_ylim(c(a, b), 0.12), type = "n", axes = FALSE, xlab = xlab,
       ylab = "Replication outcome", main = title)
  x <- seq_len(n)
  both <- is.finite(a) & is.finite(b)
  segments(x[both], a[both], x[both], b[both], lty = 2, col = FIG_MUTED)
  points(x, a, pch = 19, col = FIG_EST)
  points(x, b, pch = 21, col = FIG_EST, bg = "white")
  shown <- unique(round(seq(1, n, length.out = min(n, 20))))
  axis(1, at = shown, labels = ids[shown])
  axis(2, las = 1)
  box()
  legend("top", legend = c("A", "B"), pch = c(19, 21), col = FIG_EST, pt.bg = "white",
         horiz = TRUE, bty = "n")
  invisible(NULL)
}
`;

FIG_R.pairsSlopes = `
# Matched pairs as slopes between two columns: a solid blue line when the pair differs in the
# same direction as the average difference, a dashed gray line otherwise, and a short bar at
# each column's mean.
fig_pairs_slopes <- function(a, b, label_a = "A", label_b = "B", title = "Pairs as slopes") {
  a <- as.numeric(a)
  b <- as.numeric(b)
  n <- length(a)
  if (n == 0 || length(fig_finite(c(a, b))) == 0) {
    fig_empty(title, "Design", "Replication outcome")
    return(invisible(NULL))
  }
  plot(c(0.6, 2.4), fig_ylim(c(a, b)), type = "n", axes = FALSE, xlab = "Design",
       ylab = "Replication outcome", main = title)
  same <- sign(a - b) == sign(mean(a - b, na.rm = TRUE))
  same[is.na(same)] <- FALSE
  for (k in seq_len(n)) {
    segments(1, a[k], 2, b[k], col = if (same[k]) FIG_EST else FIG_MUTED,
             lty = if (same[k]) 1 else 2)
  }
  segments(c(0.9, 1.9), c(mean(a, na.rm = TRUE), mean(b, na.rm = TRUE)), c(1.1, 2.1),
           c(mean(a, na.rm = TRUE), mean(b, na.rm = TRUE)), col = FIG_TRUTH, lwd = 4)
  axis(1, at = c(1, 2), labels = c(label_a, label_b))
  axis(2, las = 1)
  box()
  invisible(NULL)
}
`;

FIG_R.hist = `
# A histogram of x over the given bin edges: [e_k, e_k+1) except the last bin, which is closed.
fig_hist <- function(x, edges, xlab, title) {
  x <- fig_finite(x)
  edges <- sort(as.numeric(edges))
  x <- x[x >= edges[1] & x <= edges[length(edges)]]
  if (length(x) == 0 || length(edges) < 2) {
    fig_empty(title, xlab, "Frequency")
    return(invisible(NULL))
  }
  h <- hist(x, breaks = edges, right = FALSE, include.lowest = TRUE, plot = FALSE)
  plot(range(edges), c(0, max(h$counts, 1) * 1.05), type = "n", xlab = xlab,
       ylab = "Frequency", main = title, yaxs = "i")
  k <- length(edges)
  rect(edges[-k], 0, edges[-1], h$counts, col = FIG_EST, border = "white")
  box()
  invisible(NULL)
}
`;

FIG_R.ecdf = `
# The empirical CDF of x as a step function.
fig_ecdf <- function(x, xlab, title) {
  x <- sort(fig_finite(x))
  n <- length(x)
  if (n == 0) {
    fig_empty(title, xlab, "Cumulative fraction")
    return(invisible(NULL))
  }
  r <- fig_span(x, 0.05)
  xx <- c(r[1], x, r[2])
  yy <- c(0, seq_len(n) / n, 1)
  plot(xx, yy, type = "s", col = FIG_EST, lwd = 1.8, xlim = r, ylim = c(0, 1), xlab = xlab,
       ylab = "Cumulative fraction", main = title, las = 1)
  invisible(NULL)
}
`;

FIG_R.box = `
# One horizontal box plot of x (Tukey's hinges, whiskers to 1.5 hinge spreads) with the mean
# marked by a hollow diamond.
fig_box <- function(x, xlab, title) {
  x <- fig_finite(x)
  if (length(x) == 0) {
    fig_empty(title, xlab)
    return(invisible(NULL))
  }
  r <- fig_span(x, 0.05)
  boxplot(x, horizontal = TRUE, ylim = r, col = adjustcolor(FIG_EST, 0.25), border = FIG_EST,
          medcol = FIG_TRUTH, outpch = 1, outcol = FIG_EST, xlab = xlab, main = title,
          axes = FALSE)
  axis(1)
  box()
  points(mean(x), 1, pch = 5, cex = 1.4, lwd = 2, col = FIG_TRUTH)
  invisible(NULL)
}
`;

FIG_R.qq = `
# A normal quantile-quantile plot of x with a dashed line through the quartiles.
fig_qq <- function(x, ylab, title, xlab = "Standard normal quantile") {
  x <- sort(fig_finite(x))
  n <- length(x)
  if (n == 0) {
    fig_empty(title, xlab, ylab)
    return(invisible(NULL))
  }
  a <- if (n <= 10) 3 / 8 else 1 / 2
  q <- qnorm((seq_len(n) - a) / (n + 1 - 2 * a))
  plot(q, x, pch = 19, col = adjustcolor(FIG_EST, 0.8), xlab = xlab, ylab = ylab, main = title,
       ylim = fig_span(x, 0.05), las = 1)
  y <- quantile(x, c(0.25, 0.75), names = FALSE, type = 7)
  z <- qnorm(c(0.25, 0.75))
  slope <- diff(y) / diff(z)
  abline(y[1] - slope * z[1], slope, lty = 2, col = FIG_TRUTH)
  invisible(NULL)
}
`;

FIG_R.series = `
# y against x as points, a line, or a step function. Everything left of fence (when it is
# finite) is gray, shaded, and marked by a dashed maroon line.
fig_series <- function(x, y, xlab, ylab, title, type = "points", fence = NA) {
  x <- as.numeric(x)
  y <- as.numeric(y)
  keep <- is.finite(x) & is.finite(y)
  if (!any(keep)) {
    fig_empty(title, xlab, ylab)
    return(invisible(NULL))
  }
  n <- length(x)
  cex <- if (n > 2000) 0.3 else if (n > 300) 0.5 else 0.8
  plot(fig_span(c(x, fence), 0.03), fig_span(y, 0.05), type = "n", xlab = xlab, ylab = ylab,
       main = title, las = 1, xaxs = "i")
  drawn <- function(idx, color) {
    if (length(idx) == 0) return(invisible(NULL))
    if (type == "points") {
      points(x[idx], y[idx], pch = 19, cex = cex, col = color)
    } else {
      lines(x[idx], y[idx], type = if (type == "step") "s" else "l", col = color,
            lwd = if (type == "line") 1 else 1.5)
    }
  }
  if (is.finite(fence)) {
    fig_band(-Inf, fence)
    before <- which(x < fence)
    after <- which(x >= fence)
    if (type != "points" && length(before) > 0 && length(after) > 0) {
      after <- c(max(before), after)   # join the two stretches
    }
    drawn(before, FIG_MUTED)
    drawn(after, FIG_EST)
    abline(v = fence, lty = 2, col = FIG_ACCENT, lwd = 1.5)
  } else {
    drawn(seq_len(n), FIG_EST)
  }
  box()
  invisible(NULL)
}
`;

FIG_R.running = `
# A running value against x, with a dashed line at its last finite value.
fig_running <- function(x, y, xlab, ylab, title) {
  x <- as.numeric(x)
  y <- as.numeric(y)
  if (!any(is.finite(x) & is.finite(y))) {
    fig_empty(title, xlab, ylab)
    return(invisible(NULL))
  }
  final <- tail(fig_finite(y), 1)
  plot(fig_span(x, 0.03), fig_ylim(c(y, final), 0.15), type = "n", xlab = xlab, ylab = ylab,
       main = title, las = 1, xaxs = "i")
  abline(h = final, lty = 2, col = FIG_TRUTH)
  lines(x, y, col = FIG_EST, lwd = 1.5)
  legend("top", legend = paste0("final value (", signif(final, 4), ")"), lty = 2,
         col = FIG_TRUTH, bty = "n")
  box()
  invisible(NULL)
}
`;

FIG_R.lag = `
# A lag plot: x[i + k] against x[i], on a square plot with a dashed identity line.
fig_lag <- function(x, k, xlab, ylab, title) {
  x <- as.numeric(x)
  n <- length(x)
  if (k < 1 || n <= k || length(fig_finite(x)) == 0) {
    fig_empty(title, xlab, ylab)
    return(invisible(NULL))
  }
  op <- par(pty = "s")
  on.exit(par(op))
  r <- fig_span(x, 0.05)
  plot(x[1:(n - k)], x[(1 + k):n], pch = 19, cex = if (n > 1000) 0.5 else 0.8,
       col = adjustcolor(FIG_EST, 0.6), xlim = r, ylim = r, xlab = xlab, ylab = ylab,
       main = title, las = 1)
  abline(0, 1, lty = 2, col = FIG_MUTED)
  invisible(NULL)
}
`;

FIG_R.acf = `
# Autocorrelation stems at lags step, 2 * step, ... with optional dashed bands at +/- band
# and an optional marked lag (a dashed green line with a label).
fig_acf <- function(r, step = 1, band = NA, xlab = "Lag", title = "Autocorrelation",
                    mark = NA, mark_label = "") {
  r <- as.numeric(r)
  n <- length(r)
  if (n == 0) {
    fig_empty(title, xlab, "Autocorrelation")
    return(invisible(NULL))
  }
  lags <- seq_len(n) * step
  last <- n * step
  bands <- if (is.finite(band)) c(band, -band) else numeric(0)
  mark_x <- if (is.finite(mark)) min(mark, last) else NA
  past <- is.finite(mark) && mark > last
  plot(c(0, last + step / 2), fig_ylim(c(r, 0, bands, 1.0 * (is.finite(mark))), 0.1),
       type = "n", xlab = xlab, ylab = "Autocorrelation", main = title, las = 1, xaxs = "i")
  abline(h = 0, col = FIG_MUTED)
  if (is.finite(band)) abline(h = bands, lty = 2, col = FIG_MUTED)
  segments(lags, 0, lags, r, col = FIG_EST)
  if (n <= 120) points(lags, r, pch = 19, cex = 0.7, col = FIG_EST)
  if (is.finite(mark)) {
    abline(v = mark_x, lty = 2, col = FIG_OK, lwd = 1.5)
    label <- if (past) paste(mark_label, "(past the axis)") else mark_label
    left_half <- mark_x < (last + step / 2) / 2
    text(mark_x, par("usr")[4], label, col = FIG_OK, adj = c(if (left_half) -0.05 else 1.05, 1.3))
  }
  box()
  invisible(NULL)
}
`;

FIG_R.warmup = `
# Welch's warm-up plot: the raw average, its moving average, and the cumulative average
# against x, with the excluded stretch left of cut shaded and a dashed line at the cut.
fig_warmup <- function(x, ybar, smooth, cumavg, cut, xlab, ylab, title, end_lo = NA) {
  x <- as.numeric(x)
  allv <- c(ybar, smooth, cumavg)
  if (length(fig_finite(x)) == 0 || length(fig_finite(allv)) == 0) {
    fig_empty(title, xlab, ylab)
    return(invisible(NULL))
  }
  show_cut <- is.finite(cut) && cut > min(fig_finite(x))
  plot(fig_span(c(x, if (show_cut) cut, end_lo), 0.03), fig_ylim(allv, 0.3), type = "n",
       xlab = xlab, ylab = ylab, main = title, las = 1, xaxs = "i")
  if (show_cut) fig_band(-Inf, cut)
  lines(x, ybar, col = FIG_MUTED, lwd = 1)
  lines(x, smooth, col = FIG_EST, lwd = 2)
  lines(x, cumavg, col = FIG_TRUTH, lty = 2)
  if (show_cut) abline(v = cut, lty = 2, col = FIG_ACCENT, lwd = 1.5)
  if (is.finite(end_lo)) {
    abline(v = end_lo, lty = 3, col = FIG_MUTED)
    text(end_lo, par("usr")[3], "shortest run ends", srt = 90, adj = c(0, 1.4),
         col = FIG_MUTED, cex = 0.85)
  }
  names <- c("average across replications", "moving average", "cumulative average")
  cols <- c(FIG_MUTED, FIG_EST, FIG_TRUTH)
  ltys <- c(1, 1, 2)
  lwds <- c(1, 2, 1)
  if (show_cut) {
    names <- c(names, "warm-up cut")
    cols <- c(cols, FIG_ACCENT)
    ltys <- c(ltys, 2)
    lwds <- c(lwds, 1.5)
  }
  legend("top", legend = names, col = cols, lty = ltys, lwd = lwds, ncol = 2, bty = "n",
         cex = 0.85)
  box()
  invisible(NULL)
}
`;

FIG_R.batches = `
# The series with its batches: a dotted line at each batch boundary and a thick green segment
# at each batch mean. Optionally the stretch left of exclude_to is gray and shaded, and each
# value in joins (where replications were joined end to end) gets a dotted maroon line.
fig_batches <- function(x, y, starts, ends, means, xlab, ylab, title, step = FALSE,
                        exclude_to = NA, joins = NULL) {
  x <- as.numeric(x)
  y <- as.numeric(y)
  starts <- as.numeric(starts)
  ends <- as.numeric(ends)
  means <- as.numeric(means)
  if (!any(is.finite(x) & is.finite(y))) {
    fig_empty(title, xlab, ylab)
    return(invisible(NULL))
  }
  has_joins <- length(fig_finite(joins)) > 0
  plot(fig_span(c(x, starts, ends), 0.02), fig_ylim(c(y, means), 0.18), type = "n", xlab = xlab,
       ylab = ylab, main = title, las = 1, xaxs = "i")
  drawn <- function(idx, color) {
    if (length(idx) == 0) return(invisible(NULL))
    if (step) {
      lines(x[idx], y[idx], type = "s", col = color)
    } else {
      points(x[idx], y[idx], pch = 19, cex = if (length(x) > 2000) 0.3 else 0.5, col = color)
    }
  }
  if (is.finite(exclude_to)) {
    fig_band(-Inf, exclude_to)
    drawn(which(x < exclude_to), FIG_MUTED)
    drawn(which(x >= exclude_to), FIG_EST)
  } else {
    drawn(seq_along(x), FIG_EST)
  }
  if (length(starts) > 0) abline(v = c(starts, tail(ends, 1)), lty = 3, col = FIG_MUTED)
  if (has_joins) abline(v = fig_finite(joins), lty = 3, col = FIG_ACCENT)
  segments(starts, means, ends, means, col = FIG_OK, lwd = 4, lend = 1)
  names <- c("series", "batch mean", "batch boundary")
  cols <- c(FIG_EST, FIG_OK, FIG_MUTED)
  ltys <- c(if (step) 1 else NA, 1, 3)
  pchs <- c(if (step) NA else 19, NA, NA)
  lwds <- c(1, 4, 1)
  if (has_joins) {
    names <- c(names, "join of replications")
    cols <- c(cols, FIG_ACCENT)
    ltys <- c(ltys, 3)
    pchs <- c(pchs, NA)
    lwds <- c(lwds, 1)
  }
  legend("top", legend = names, col = cols, lty = ltys, pch = pchs, lwd = lwds, ncol = 2, bty = "n",
         cex = 0.85)
  box()
  invisible(NULL)
}
`;
