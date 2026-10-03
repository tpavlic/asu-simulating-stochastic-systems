# Reference values for concatenateReps and resampleTimeWeighted in js/stats/steadystate.js, and
# for batch means on a joined series, computed by hand in base R.
# Run from the repository root:
#   Rscript output_analysis/output_analyzer/test/reference/steadystate2.R > output_analysis/output_analyzer/test/reference/steadystate2.json
# The input replications are generated here (seeded) and written into the JSON.

j <- function(x) {
  if (is.list(x) && !is.null(names(x))) paste0("{", paste(sprintf('"%s":%s', names(x), sapply(x, j)), collapse = ","), "}")
  else if (is.list(x) || length(x) > 1) paste0("[", paste(sapply(x, j), collapse = ","), "]")
  else if (is.character(x)) sprintf('"%s"', x)
  else if (is.logical(x)) tolower(as.character(x))
  else sprintf("%.17g", as.numeric(x))
}
arr <- function(x) if (length(x) == 1) list(x) else x

set.seed(20261003)

# ---- Tally: three replications of unequal length, time-stamped -------------------------------
ns <- c(40, 35, 52)
tally <- lapply(ns, function(n) {
  t <- cumsum(rexp(n, 1))
  v <- 5 + cumsum(rnorm(n)) / 4
  list(t = t, v = v)
})

# Index cut: drop the first `k` observations of every replication, then join.
cut_index <- function(reps, k) {
  out <- c(); joins <- c()
  for (r in reps) {
    x <- if (k > 0) r$v[-(1:k)] else r$v
    if (length(x) == 0) next
    if (length(out) > 0) joins <- c(joins, length(out))
    out <- c(out, x)
  }
  list(v = out, joins = joins)
}
# Time cut for tally: keep observations at or after `at`.
cut_tally_time <- function(reps, at) {
  out <- c(); joins <- c()
  for (r in reps) {
    x <- r$v[r$t >= at]
    if (length(x) == 0) next
    if (length(out) > 0) joins <- c(joins, length(out))
    out <- c(out, x)
  }
  list(v = out, joins = joins)
}
# Tally batch means on a series with `b` batches of floor(n / b).
bm <- function(y, b) {
  m <- floor(length(y) / b)
  sapply(1:b, function(k) mean(y[((k - 1) * m + 1):(k * m)]))
}

ti <- cut_index(tally, 6)
tt <- cut_tally_time(tally, 4)
tally_index <- list(v = ti$v, joins = ti$joins, means = bm(ti$v, 9))
tally_time <- list(v = tt$v, joins = tt$joins)

# ---- Time-persistent: three trajectories, end time 30 ---------------------------------------
endT <- 30
traj <- lapply(c(14, 9, 20), function(n) {
  t <- c(0, sort(runif(n - 1, 0, endT - 1)))
  v <- sample(0:6, n, replace = TRUE)
  list(t = t, v = v)
})
# Cut at `at`: the state in force there (the last record at or before it) becomes a record at
# `at`, followed by every later record.
cut_traj <- function(r, at) {
  k <- max(which(r$t <= at))
  later <- r$t > at
  list(t = c(at, r$t[later]), v = c(r$v[k], r$v[later]))
}
# Join: the first keeps its times, each later one is shifted to start where the previous ended.
join_traj <- function(reps, at, endT) {
  tt <- c(); vv <- c(); joins <- c(); cum <- NA
  for (i in seq_along(reps)) {
    r <- cut_traj(reps[[i]], at)
    s <- r$t[1]
    off <- if (i == 1) 0 else cum - s
    if (i > 1) joins <- c(joins, cum)
    tt <- c(tt, r$t + off); vv <- c(vv, r$v)
    cum <- endT + off
  }
  list(t = tt, v = vv, joins = joins, end = cum)
}
# Time average of a step function over [a, z]: each record's value times its overlap.
tw <- function(t, v, end, a, z) {
  hold_end <- c(t[-1], end)
  ov <- pmax(0, pmin(hold_end, z) - pmax(t, a))
  sum(v * ov) / (z - a)
}

jt <- join_traj(traj, 2.5, endT)
b_time <- 8
w <- (jt$end - jt$t[1]) / b_time
edges <- jt$t[1] + (0:b_time) * w
edges[b_time + 1] <- jt$end
time_means <- sapply(1:b_time, function(k) tw(jt$t, jt$v, jt$end, edges[k], edges[k + 1]))

# Resampling the first trajectory, cut at 2.5, onto 40 equal steps of [2.5, 30].
r1 <- cut_traj(traj[[1]], 2.5)
steps <- 40
re <- 2.5 + (0:steps) * (endT - 2.5) / steps
re[steps + 1] <- endT
resampled <- sapply(1:steps, function(k) tw(r1$t, r1$v, endT, re[k], re[k + 1]))

cat(j(list(
  tally = lapply(tally, function(r) list(t = r$t, v = r$v)),
  tally_index = list(v = tally_index$v, joins = arr(tally_index$joins), means = tally_index$means),
  tally_time = list(v = tally_time$v, joins = arr(tally_time$joins)),
  endT = endT,
  traj = lapply(traj, function(r) list(t = r$t, v = r$v)),
  time_join = list(t = jt$t, v = jt$v, joins = arr(jt$joins), end = jt$end, means = time_means),
  resampled = list(steps = steps, values = resampled)
)))
