// Literal Tidy R code for the figures the regenerate scripts draw: one ggplot2 helper per kind
// of figure, plus a `common` snippet of colors and small helpers they share. Each helper builds
// a tibble, plots it with ggplot2, prints the plot, and returns it invisibly. Pure text; the
// writers in analysis_scripts.js choose what to include (always `common` first). The snippets
// are template literals, and so none of them may contain a backtick or a dollar sign followed
// by a brace. The contract for every helper is at the top of figure_scripts.js.

export const FIG_TIDY = {};

FIG_TIDY.common = `
# Colors used by every figure.
FIG_EST <- "#2b6cb0"; FIG_TRUTH <- "#1a1a1a"; FIG_MISS <- "#c0392b"
FIG_OK <- "#2e7d32"; FIG_MUTED <- "#9e9e9e"; FIG_ACCENT <- "#8c1d40"

# The look shared by every figure.
fig_theme <- function() {
  theme_bw(base_size = 11) + theme(panel.grid.minor = element_blank())
}

# The range of the finite values, padded by a fraction on each side (+/- 1 if it has no width).
fig_span <- function(v, pad = 0.05) {
  v <- v[is.finite(v)]
  if (length(v) == 0) return(c(-1, 1))
  r <- range(v)
  # a range that is only rounding (0.1 against 0.1000...01) has no width either
  if (diff(r) <= 1e-10 * max(1, abs(r))) r <- mean(r) + c(-1, 1)
  r + c(-1, 1) * pad * diff(r)
}

# A vector of length n as numbers, with NA where an argument was not given.
fig_num <- function(v, n) {
  if (is.null(v)) rep(NA_real_, n) else as.numeric(v)
}

# A vector of length n as TRUE/FALSE, with FALSE where an argument was not given or is NA.
fig_flag <- function(v, n) {
  if (is.null(v)) return(rep(FALSE, n))
  out <- as.logical(v)
  out[is.na(out)] <- FALSE
  out
}

# An empty frame with the title and the words "nothing to draw".
fig_empty <- function(title, xlab = "", ylab = "") {
  p <- ggplot(tibble(x = 0, y = 0, label = "nothing to draw"), aes(x, y, label = label)) +
    geom_text(color = FIG_MUTED) +
    labs(title = title, x = xlab, y = ylab) +
    theme_bw(base_size = 11) +
    theme(panel.grid = element_blank(), axis.text = element_blank(), axis.ticks = element_blank())
  print(p)
  invisible(p)
}

# The column (1, 2, ...) each bracket is drawn in. A bracket is a pair of rows; shorter spans
# are placed first, each in the leftmost column where no placed bracket shares a row with it.
fig_bracket_cols <- function(brackets) {
  m <- nrow(brackets)
  lo <- pmin(brackets[, 1], brackets[, 2])
  hi <- pmax(brackets[, 1], brackets[, 2])
  col <- integer(m)
  for (idx in order(hi - lo)) {
    cc <- 1
    repeat {
      clash <- FALSE
      for (j in which(col == cc)) {
        if (lo[idx] <= hi[j] && lo[j] <= hi[idx]) clash <- TRUE
      }
      if (!clash) break
      cc <- cc + 1
    }
    col[idx] <- cc
  }
  col
}
`;

FIG_TIDY.strips = `
# Rows of dots (one row per element of values, first row on top), with an optional interval
# under each row's dots: a line from lo to hi with end ticks and a dot at mid.
fig_strips <- function(values, labels, xlab, title, mid = NULL, lo = NULL, hi = NULL,
                       ref = NA, mean_line = FALSE) {
  if (is.numeric(values)) values <- list(values)
  n <- length(values)
  dots <- bind_rows(lapply(seq_len(n), function(i) {
    v <- sort(as.numeric(values[[i]]))
    v <- v[is.finite(v)]
    tibble(row = rep(i, length(v)), value = v)
  }))
  mid <- fig_num(mid, n); lo <- fig_num(lo, n); hi <- fig_num(hi, n)
  iv <- tibble(row = seq_len(n), mid = mid, lo = lo, hi = hi) %>%
    filter(is.finite(lo), is.finite(hi))
  if (n == 0 || (nrow(dots) == 0 && nrow(iv) == 0)) return(fig_empty(title, xlab))
  # Neighbors in sorted order go to different heights, so ties do not hide each other.
  dots <- dots %>%
    group_by(row) %>%
    mutate(y = n - row + 1 + 0.12 + ((row_number() - 1) %% 5 - 2) * 0.07) %>%
    ungroup()
  xr <- fig_span(c(dots$value, iv$lo, iv$hi, ref))
  iv <- iv %>% mutate(y = n - row + 1 - 0.25)
  p <- ggplot() + geom_point(data = dots, aes(x = value, y = y), color = FIG_EST,
                             alpha = 0.6, size = 2)
  if (is.finite(ref)) p <- p + geom_vline(xintercept = ref, linetype = "dashed", color = FIG_MUTED)
  if (isTRUE(mean_line) && nrow(dots) > 0) {
    p <- p + geom_vline(xintercept = mean(dots$value), color = FIG_TRUTH)
  }
  if (nrow(iv) > 0) {
    p <- p +
      geom_segment(data = iv, aes(x = lo, xend = hi, y = y, yend = y), color = FIG_TRUTH,
                   linewidth = 0.6) +
      geom_segment(data = iv, aes(x = lo, xend = lo, y = y - 0.1, yend = y + 0.1),
                   color = FIG_TRUTH, linewidth = 0.6) +
      geom_segment(data = iv, aes(x = hi, xend = hi, y = y - 0.1, yend = y + 0.1),
                   color = FIG_TRUTH, linewidth = 0.6) +
      geom_point(data = filter(iv, is.finite(mid)), aes(x = mid, y = y), color = FIG_TRUTH,
                 size = 2.4)
  }
  p <- p +
    scale_y_continuous(breaks = n:1, labels = labels, limits = c(0.45, n + 0.55),
                       expand = expansion(0)) +
    coord_cartesian(xlim = xr) +
    labs(x = xlab, y = NULL, title = title) + fig_theme()
  print(p)
  invisible(p)
}
`;

FIG_TIDY.intervals = `
# A forest plot: one row per element (row 1 on top) with a line from lo to hi and a dot at mid.
# Flagged rows are red and dashed, muted rows gray and dashed (both with a hollow dot), ok rows
# green. Optional texts stand to the right of the rows, with brackets joining pairs of rows.
fig_intervals <- function(mid, lo, hi, labels, xlab, title, ref = NA, flagged = NULL,
                          muted = NULL, right = NULL, brackets = NULL, ok = NULL) {
  n <- length(mid)
  if (n == 0) return(fig_empty(title, xlab))
  lo <- fig_num(lo, n); hi <- fig_num(hi, n); mid <- as.numeric(mid)
  flagged <- fig_flag(flagged, n); muted <- fig_flag(muted, n); ok <- fig_flag(ok, n)
  right <- if (is.null(right)) rep("", n) else as.character(right)
  right[is.na(right)] <- ""
  xr <- fig_span(c(mid, lo, hi, ref))
  span <- diff(xr)
  rows <- tibble(row = seq_len(n), y = n - seq_len(n) + 1, mid = mid, lo = lo, hi = hi,
                 right = right) %>%
    mutate(kind = case_when(muted ~ "muted", flagged ~ "flagged", ok ~ "ok", TRUE ~ "plain"),
           col = case_when(kind == "muted" ~ FIG_MUTED, kind == "flagged" ~ FIG_MISS,
                           kind == "ok" ~ FIG_OK, TRUE ~ FIG_TRUTH),
           lt = if_else(kind %in% c("muted", "flagged"), "dashed", "solid"),
           fillc = if_else(kind %in% c("muted", "flagged"), "white", col),
           # Infinite ends run to the edge; an end that is NaN is left out.
           a = if_else(is.na(lo), mid, pmax(lo, xr[1])),
           b = if_else(is.na(hi), mid, pmin(hi, xr[2])),
           textcol = case_when(kind == "muted" ~ FIG_MUTED, kind == "ok" ~ FIG_OK,
                               TRUE ~ FIG_ACCENT))
  # Room on the right for the texts and for one column per bracket.
  has_text <- any(nzchar(right))
  text_w <- if (has_text) 0.03 + 0.013 * max(nchar(right)) else 0
  if (!is.null(brackets) && length(brackets) > 0) {
    brackets <- matrix(as.numeric(brackets), ncol = 2)
    bcol <- fig_bracket_cols(brackets)
  } else {
    brackets <- NULL; bcol <- integer(0)
  }
  ncol_b <- if (length(bcol) > 0) max(bcol) else 0
  xmax <- xr[2] + span * (text_w + if (ncol_b > 0) 0.03 * ncol_b + 0.02 else 0)
  seg <- filter(rows, !is.na(a), !is.na(b))
  p <- ggplot()
  if (is.finite(ref)) p <- p + geom_vline(xintercept = ref, linetype = "dashed", color = FIG_MUTED)
  p <- p +
    geom_segment(data = seg, aes(x = a, xend = b, y = y, yend = y, color = col, linetype = lt),
                 linewidth = 0.6) +
    geom_segment(data = filter(rows, is.finite(lo)),
                 aes(x = lo, xend = lo, y = y - 0.15, yend = y + 0.15, color = col),
                 linewidth = 0.6) +
    geom_segment(data = filter(rows, is.finite(hi)),
                 aes(x = hi, xend = hi, y = y - 0.15, yend = y + 0.15, color = col),
                 linewidth = 0.6) +
    geom_point(data = filter(rows, is.finite(mid)), aes(x = mid, y = y, color = col, fill = fillc),
               shape = 21, size = 2.6, stroke = 0.8)
  if (has_text) {
    p <- p + geom_text(data = filter(rows, nzchar(right)),
                       aes(x = xr[2] + 0.02 * span, y = y, label = right, color = textcol),
                       hjust = 0, size = 3.5)
  }
  if (!is.null(brackets)) {
    bk <- tibble(top = n - pmin(brackets[, 1], brackets[, 2]) + 1,
                 bottom = n - pmax(brackets[, 1], brackets[, 2]) + 1,
                 x = xr[2] + span * (text_w + 0.03 * bcol), tick = 0.015 * span)
    p <- p +
      geom_segment(data = bk, aes(x = x, xend = x, y = top, yend = bottom), color = FIG_TRUTH,
                   linewidth = 0.4) +
      geom_segment(data = bk, aes(x = x, xend = x - tick, y = top, yend = top),
                   color = FIG_TRUTH, linewidth = 0.4) +
      geom_segment(data = bk, aes(x = x, xend = x - tick, y = bottom, yend = bottom),
                   color = FIG_TRUTH, linewidth = 0.4)
  }
  xb <- pretty(xr)
  p <- p +
    scale_color_identity() + scale_fill_identity() + scale_linetype_identity() +
    scale_x_continuous(breaks = xb[xb >= xr[1] & xb <= xr[2]]) +
    scale_y_continuous(breaks = n:1, labels = labels, limits = c(0.4, n + 0.6),
                       expand = expansion(0)) +
    coord_cartesian(xlim = c(xr[1], xmax), expand = FALSE) +
    labs(x = xlab, y = NULL, title = title) + fig_theme()
  print(p)
  invisible(p)
}
`;

FIG_TIDY.pairsByRep = `
# One column per matched pair: design A as a filled dot, design B as a hollow dot, joined by a
# dashed segment.
fig_pairs_by_rep <- function(a, b, ids, xlab = "Replication id", title = "Pairs by replication") {
  n <- length(a)
  if (n == 0) return(fig_empty(title, xlab, "Replication outcome"))
  d <- tibble(k = seq_len(n), a = as.numeric(a), b = as.numeric(b))
  both <- filter(d, is.finite(a), is.finite(b))
  long <- bind_rows(tibble(k = d$k, y = d$a, design = "A"), tibble(k = d$k, y = d$b, design = "B")) %>%
    filter(is.finite(y))
  keep <- seq(1, n, by = max(1, ceiling(n / 20)))
  p <- ggplot() +
    geom_segment(data = both, aes(x = k, xend = k, y = a, yend = b), linetype = "dashed",
                 color = FIG_MUTED) +
    geom_point(data = long, aes(x = k, y = y, shape = design, fill = design), color = FIG_EST,
               size = 2.6, stroke = 0.8) +
    scale_shape_manual(values = c(A = 21, B = 21)) +
    scale_fill_manual(values = c(A = FIG_EST, B = "white")) +
    scale_x_continuous(breaks = keep, labels = as.character(ids)[keep]) +
    labs(x = xlab, y = "Replication outcome", title = title, shape = NULL, fill = NULL) +
    fig_theme()
  print(p)
  invisible(p)
}
`;

FIG_TIDY.pairsSlopes = `
# One line per pair from design A to design B: solid blue when the pair differs in the same
# direction as the average difference, dashed gray otherwise; a short thick bar marks each mean.
fig_pairs_slopes <- function(a, b, label_a = "A", label_b = "B", title = "Pairs as slopes") {
  d <- tibble(a = as.numeric(a), b = as.numeric(b)) %>% filter(is.finite(a), is.finite(b))
  if (nrow(d) == 0) return(fig_empty(title, "Design", "Replication outcome"))
  m <- mean(d$a - d$b)
  d <- d %>%
    mutate(same = sign(a - b) == sign(m),
           col = if_else(same, FIG_EST, FIG_MUTED),
           lt = if_else(same, "solid", "dashed"))
  bars <- tibble(x0 = c(0.9, 1.9), x1 = c(1.1, 2.1), y = c(mean(d$a), mean(d$b)))
  p <- ggplot() +
    geom_segment(data = d, aes(x = 1, xend = 2, y = a, yend = b, color = col, linetype = lt)) +
    geom_segment(data = bars, aes(x = x0, xend = x1, y = y, yend = y), color = FIG_TRUTH,
                 linewidth = 1.6) +
    scale_color_identity() + scale_linetype_identity() +
    scale_x_continuous(breaks = c(1, 2), labels = c(label_a, label_b), limits = c(0.6, 2.4)) +
    labs(x = "Design", y = "Replication outcome", title = title) + fig_theme()
  print(p)
  invisible(p)
}
`;

FIG_TIDY.hist = `
# A histogram of x over the given bin edges: each bin holds its left edge, and the last both.
fig_hist <- function(x, edges, xlab, title) {
  x <- as.numeric(x)
  edges <- sort(unique(as.numeric(edges)))
  x <- x[is.finite(x) & x >= min(edges) & x <= max(edges)]
  if (length(x) == 0) return(fig_empty(title, xlab, "Frequency"))
  p <- ggplot(tibble(x = x), aes(x)) +
    geom_histogram(breaks = edges, closed = "left", fill = FIG_EST, color = "white") +
    labs(x = xlab, y = "Frequency", title = title) + fig_theme()
  print(p)
  invisible(p)
}
`;

FIG_TIDY.ecdf = `
# The empirical cumulative distribution function as a step function.
fig_ecdf <- function(x, xlab, title) {
  x <- as.numeric(x)
  x <- x[is.finite(x)]
  if (length(x) == 0) return(fig_empty(title, xlab, "Cumulative fraction"))
  F <- ecdf(x)
  r <- fig_span(x)
  steps <- tibble(x = c(r[1], knots(F), r[2]), y = c(0, F(knots(F)), 1))
  p <- ggplot(steps, aes(x, y)) +
    geom_step(color = FIG_EST, linewidth = 0.8) +
    scale_y_continuous(limits = c(0, 1)) +
    labs(x = xlab, y = "Cumulative fraction", title = title) + fig_theme()
  print(p)
  invisible(p)
}
`;

FIG_TIDY.box = `
# One horizontal box plot: Tukey's hinges, the median, whiskers to the most extreme values
# within 1.5 hinge spreads, outliers as hollow circles, and the mean as a hollow diamond.
fig_box <- function(x, xlab, title) {
  x <- as.numeric(x)
  x <- x[is.finite(x)]
  if (length(x) == 0) return(fig_empty(title, xlab))
  f <- fivenum(x)
  spread <- f[4] - f[2]
  inside <- x[x >= f[2] - 1.5 * spread & x <= f[4] + 1.5 * spread]
  wl <- min(inside); wh <- max(inside)
  outl <- tibble(x = x[x < wl | x > wh], y = 1)
  p <- ggplot() +
    geom_segment(aes(x = wl, xend = f[2], y = 1, yend = 1), color = FIG_TRUTH) +
    geom_segment(aes(x = f[4], xend = wh, y = 1, yend = 1), color = FIG_TRUTH) +
    geom_rect(aes(xmin = f[2], xmax = f[4], ymin = 0.7, ymax = 1.3), fill = "white",
              color = FIG_TRUTH) +
    geom_segment(aes(x = f[3], xend = f[3], y = 0.7, yend = 1.3), color = FIG_TRUTH,
                 linewidth = 1.2) +
    geom_point(data = outl, aes(x = x, y = y), shape = 1, color = FIG_TRUTH, size = 2) +
    geom_point(aes(x = mean(x), y = 1), shape = 23, fill = "white", color = FIG_TRUTH, size = 3) +
    scale_y_continuous(limits = c(0.4, 1.6)) +
    coord_cartesian(xlim = fig_span(c(x, f[2], f[4]))) +
    labs(x = xlab, y = NULL, title = title) + fig_theme() +
    theme(axis.text.y = element_blank(), axis.ticks.y = element_blank(),
          panel.grid.major.y = element_blank())
  print(p)
  invisible(p)
}
`;

FIG_TIDY.qq = `
# A normal quantile-quantile plot, at R's ppoints positions, with the line through the quartiles.
fig_qq <- function(x, ylab, title, xlab = "Standard normal quantile") {
  x <- sort(as.numeric(x))
  x <- x[is.finite(x)]
  if (length(x) == 0) return(fig_empty(title, xlab, ylab))
  d <- tibble(q = qnorm(ppoints(length(x))), x = x)
  qs <- quantile(x, c(0.25, 0.75), names = FALSE)
  slope <- diff(qs) / diff(qnorm(c(0.25, 0.75)))
  icpt <- qs[1] - slope * qnorm(0.25)
  p <- ggplot(d, aes(q, x)) +
    geom_abline(slope = slope, intercept = icpt, linetype = "dashed", color = FIG_TRUTH) +
    geom_point(color = FIG_EST, size = 2) +
    labs(x = xlab, y = ylab, title = title) + fig_theme()
  print(p)
  invisible(p)
}
`;

FIG_TIDY.series = `
# A series y against x as points, a line, or a step function. With a fence, everything left of
# it is gray, shaded, and marked by a dashed maroon line.
fig_series <- function(x, y, xlab, ylab, title, type = "points", fence = NA) {
  d <- tibble(x = as.numeric(x), y = as.numeric(y)) %>% filter(is.finite(x), is.finite(y))
  if (nrow(d) == 0) return(fig_empty(title, xlab, ylab))
  xr <- fig_span(c(d$x, fence))
  d <- d %>% mutate(col = if (is.finite(fence)) if_else(x < fence, FIG_MUTED, FIG_EST) else FIG_EST,
                    part = if (is.finite(fence)) x < fence else FALSE)
  p <- ggplot()
  if (is.finite(fence)) {
    p <- p + annotate("rect", xmin = xr[1], xmax = fence, ymin = -Inf, ymax = Inf,
                      fill = FIG_MUTED, alpha = 0.2)
  }
  if (type == "points") {
    p <- p + geom_point(data = d, aes(x, y, color = col), size = if (nrow(d) > 1000) 0.6 else 1.4)
  } else {
    draw <- if (type == "step") geom_step else geom_line
    for (pt in unique(d$part)) {
      piece <- filter(d, part == pt)
      p <- p + draw(data = piece, aes(x, y), color = piece$col[1], linewidth = 0.5)
    }
  }
  if (is.finite(fence)) p <- p + geom_vline(xintercept = fence, linetype = "dashed", color = FIG_ACCENT)
  p <- p + scale_color_identity() + scale_x_continuous(expand = expansion(0)) +
    coord_cartesian(xlim = xr) +
    labs(x = xlab, y = ylab, title = title) + fig_theme()
  print(p)
  invisible(p)
}
`;

FIG_TIDY.running = `
# A line of y against x, with a dashed line at the last finite y.
fig_running <- function(x, y, xlab, ylab, title) {
  d <- tibble(x = as.numeric(x), y = as.numeric(y)) %>% filter(is.finite(x), is.finite(y))
  if (nrow(d) == 0) return(fig_empty(title, xlab, ylab))
  last <- tibble(y = d$y[nrow(d)], what = "final value")
  p <- ggplot(d, aes(x, y)) +
    geom_line(color = FIG_EST, linewidth = 0.8) +
    geom_hline(data = last, aes(yintercept = y, linetype = what), color = FIG_TRUTH) +
    scale_linetype_manual(values = c("final value" = "dashed")) +
    labs(x = xlab, y = ylab, title = title, linetype = NULL) + fig_theme() +
    theme(legend.position = "bottom")
  print(p)
  invisible(p)
}
`;

FIG_TIDY.lag = `
# A scatter of x[i + k] against x[i] on a square plot with the identity line.
fig_lag <- function(x, k, xlab, ylab, title) {
  x <- as.numeric(x)
  n <- length(x)
  if (n <= k) return(fig_empty(title, xlab, ylab))
  d <- tibble(a = x[1:(n - k)], b = x[(k + 1):n]) %>% filter(is.finite(a), is.finite(b))
  if (nrow(d) == 0) return(fig_empty(title, xlab, ylab))
  r <- fig_span(x)
  p <- ggplot(d, aes(a, b)) +
    geom_abline(slope = 1, intercept = 0, linetype = "dashed", color = FIG_MUTED) +
    geom_point(color = FIG_EST, alpha = 0.7, size = if (nrow(d) > 1000) 0.8 else 1.6) +
    coord_fixed(xlim = r, ylim = r) +
    labs(x = xlab, y = ylab, title = title) + fig_theme()
  print(p)
  invisible(p)
}
`;

FIG_TIDY.acf = `
# Autocorrelations at lags step, 2 * step, ... as stems, with optional +/- band lines and a
# marked lag.
fig_acf <- function(r, step = 1, band = NA, xlab = "Lag", title = "Autocorrelation", mark = NA,
                    mark_label = "") {
  d <- tibble(lag = seq_along(r) * step, r = as.numeric(r)) %>% filter(is.finite(r))
  if (nrow(d) == 0) return(fig_empty(title, xlab, "Autocorrelation"))
  xr <- fig_span(c(0, d$lag))
  yr <- fig_span(c(0, d$r, band, -band), 0.05)
  yr[2] <- yr[2] + 0.1 * diff(yr)
  p <- ggplot(d, aes(lag, r)) +
    geom_hline(yintercept = 0, color = FIG_MUTED) +
    geom_segment(aes(xend = lag, yend = 0), color = FIG_EST)
  if (nrow(d) <= 120) p <- p + geom_point(color = FIG_EST, size = 1.6)
  if (is.finite(band)) {
    p <- p + geom_hline(yintercept = c(-band, band), linetype = "dashed", color = FIG_MUTED)
  }
  if (is.finite(mark)) {
    past <- mark > max(d$lag)
    mx <- if (past) xr[2] - 0.004 * diff(xr) else mark
    lab <- if (past) paste(mark_label, "(past the axis)") else mark_label
    left <- past || mx > xr[1] + 0.6 * diff(xr)
    p <- p +
      geom_vline(xintercept = mx, linetype = "dashed", color = FIG_OK) +
      annotate("text", x = mx + if (left) -0.01 * diff(xr) else 0.01 * diff(xr), y = yr[2],
               label = lab, hjust = if (left) 1 else 0, vjust = 1, color = FIG_OK, size = 3.5)
  }
  p <- p + coord_cartesian(xlim = xr, ylim = yr, expand = FALSE) +
    labs(x = xlab, y = "Autocorrelation", title = title) + fig_theme()
  print(p)
  invisible(p)
}
`;

FIG_TIDY.warmup = `
# Welch's warm-up plot: the raw average across replications, its moving average, and its
# cumulative average, with the chosen cut marked and the stretch before it shaded.
fig_warmup <- function(x, ybar, smooth, cumavg, cut, xlab, ylab, title, end_lo = NA) {
  x <- as.numeric(x)
  if (length(x) == 0) return(fig_empty(title, xlab, ylab))
  nm <- c("average across replications", "moving average", "cumulative average")
  cut_on <- is.finite(cut) && cut > min(x, na.rm = TRUE)
  cut_name <- paste("cut at", format(cut, digits = 4))
  d <- bind_rows(tibble(x = x, y = as.numeric(ybar), what = nm[1]),
                 tibble(x = x, y = as.numeric(smooth), what = nm[2]),
                 tibble(x = x, y = as.numeric(cumavg), what = nm[3])) %>%
    mutate(what = factor(what, levels = nm)) %>% filter(is.finite(x))
  cols <- c(FIG_MUTED, FIG_EST, FIG_TRUTH); lts <- c("solid", "solid", "dashed")
  lws <- c(0.4, 1.1, 0.7)
  if (cut_on) {
    cols <- c(cols, FIG_ACCENT); lts <- c(lts, "dashed"); lws <- c(lws, 0.7)
    names(cols) <- names(lts) <- names(lws) <- c(nm, cut_name)
  } else {
    names(cols) <- names(lts) <- names(lws) <- nm
  }
  p <- ggplot()
  if (cut_on) {
    p <- p + annotate("rect", xmin = -Inf, xmax = cut, ymin = -Inf, ymax = Inf,
                      fill = FIG_MUTED, alpha = 0.2)
  }
  p <- p + geom_line(data = d, aes(x, y, color = what, linetype = what, linewidth = what),
                     na.rm = TRUE)
  if (cut_on) {
    p <- p + geom_vline(data = tibble(x = cut, what = cut_name),
                        aes(xintercept = x, color = what, linetype = what, linewidth = what))
  }
  if (is.finite(end_lo)) {
    p <- p + geom_vline(xintercept = end_lo, linetype = "dotted", color = FIG_MUTED) +
      annotate("text", x = end_lo, y = -Inf, label = "shortest run ends", angle = 90,
               hjust = 0, vjust = -0.4, color = FIG_MUTED, size = 3.2)
  }
  p <- p +
    scale_color_manual(values = cols, breaks = names(cols)) +
    scale_linetype_manual(values = lts, breaks = names(cols)) +
    scale_linewidth_manual(values = lws, breaks = names(cols)) +
    labs(x = xlab, y = ylab, title = title, color = NULL, linetype = NULL, linewidth = NULL) +
    fig_theme() + theme(legend.position = "bottom") +
    guides(color = guide_legend(nrow = 2))
  print(p)
  invisible(p)
}
`;

FIG_TIDY.batches = `
# A series with its batches: dotted lines at the batch boundaries, a thick green segment at each
# batch mean, a gray stretch for an excluded start, and maroon lines where replications join.
fig_batches <- function(x, y, starts, ends, means, xlab, ylab, title, step = FALSE,
                        exclude_to = NA, joins = NULL) {
  d <- tibble(x = as.numeric(x), y = as.numeric(y)) %>% filter(is.finite(x), is.finite(y))
  if (nrow(d) == 0) return(fig_empty(title, xlab, ylab))
  starts <- as.numeric(starts); ends <- as.numeric(ends); means <- as.numeric(means)
  bt <- tibble(s = starts, e = ends, m = means) %>% filter(is.finite(s), is.finite(e), is.finite(m))
  bounds <- c(starts, if (length(ends) > 0) ends[length(ends)])
  bounds <- bounds[is.finite(bounds)]
  joins <- if (is.null(joins)) numeric(0) else as.numeric(joins)
  joins <- joins[is.finite(joins)]
  xr <- fig_span(c(d$x, bounds))
  d <- d %>% mutate(part = if (is.finite(exclude_to)) x < exclude_to else FALSE)
  p <- ggplot()
  if (is.finite(exclude_to)) {
    p <- p + annotate("rect", xmin = -Inf, xmax = exclude_to, ymin = -Inf, ymax = Inf,
                      fill = FIG_MUTED, alpha = 0.2)
  }
  if (length(bounds) > 0) {
    p <- p + geom_vline(xintercept = bounds, linetype = "dotted", color = FIG_MUTED)
  }
  if (length(joins) > 0) {
    p <- p + geom_vline(xintercept = joins, linetype = "dotted", color = FIG_ACCENT)
  }
  for (pt in unique(d$part)) {
    piece <- filter(d, part == pt)
    col <- if (pt) FIG_MUTED else FIG_EST
    if (isTRUE(step)) {
      p <- p + geom_step(data = piece, aes(x, y), color = col, linewidth = 0.5)
    } else {
      p <- p + geom_point(data = piece, aes(x, y), color = col,
                          size = if (nrow(d) > 1000) 0.6 else 1.4)
    }
  }
  if (nrow(bt) > 0) {
    p <- p + geom_segment(data = bt, aes(x = s, xend = e, y = m, yend = m), color = FIG_OK,
                          linewidth = 1.6)
  }
  p <- p + coord_cartesian(xlim = xr) + labs(x = xlab, y = ylab, title = title) + fig_theme()
  print(p)
  invisible(p)
}
`;
