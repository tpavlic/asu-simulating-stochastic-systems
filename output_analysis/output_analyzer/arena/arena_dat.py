"""
Reader for Arena / SIMAN Output Analyzer ``.dat`` files (file version ARENA_40_OUT1).

Format, as reverse engineered from Arena 16.20 on 2026-10-05 (see arena_dat_format.md):

    <text header, CRLF lines>  0x1A  <little-endian float64 pairs (time, value)...>

Each record is a pair of IEEE-754 doubles. A record whose first element is negative is a
replication terminator: ``(-r, 0.0)`` ends replication ``r``; ``(-r, -1.0)`` ends the last
replication and the file.

Python 3.8+, standard library only.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, field
from typing import List, Tuple

# First header line ("type code"). Observed values:
TYPE_CODES = {
    201: "time-persistent",  # DSTAT / Time Persistent module
    203: "tally",            # TALLY / Tally module (Record: Expression, Time Interval, ...)
    204: "output",           # OUTPUT / Output module (one value per replication)
    205: "analyzer",         # written by the Output Analyzer (.flt batch means, .fst forecasts)
    206: "counter",          # COUNTER / Counter module (cumulative count at each increment)
    207: "frequency",        # FREQUENCY module; payload identical in form to 201
    # 202 not observed.
}


@dataclass
class ArenaDat:
    type_code: int
    type_name: str
    project: str
    analyst: str
    data_for: str
    run_date: str
    header_lines: List[str]
    # One list of (time, value) pairs per replication, terminators removed.
    replications: List[List[Tuple[float, float]]] = field(default_factory=list)

    @property
    def n_reps(self) -> int:
        return len(self.replications)


def parse_header(text: bytes) -> dict:
    lines = text.decode("latin-1").split("\r\n")
    lines = [ln for ln in lines if ln != ""]
    out = {"lines": lines, "type_code": None, "project": "", "analyst": "",
           "data_for": "", "run_date": ""}
    try:
        out["type_code"] = int(lines[0].strip())
    except (IndexError, ValueError):
        pass
    for ln in lines[1:]:
        if ln.startswith("Output file for:"):
            rest = ln[len("Output file for:"):]
            # Fixed-width fields: 25-char project, then "by:", then 25-char analyst.
            out["project"] = rest[:25].strip()
            tail = rest[25:]
            if tail.startswith("by:"):
                out["analyst"] = tail[3:].strip()
        elif ln.startswith("Data for:"):
            out["data_for"] = ln[len("Data for:"):].strip()
        elif ln.startswith("Run date:"):
            # "Run date:MM/DD/YYYY" followed by a padded field whose trailing integer
            # equals the number of replications (observed "YDB          3" for 3 reps).
            out["run_date"] = ln[len("Run date:"):len("Run date:") + 10]
    return out


def read_arena_dat(path: str) -> ArenaDat:
    with open(path, "rb") as fh:
        raw = fh.read()
    sep = raw.find(b"\x1a")
    if sep < 0:
        raise ValueError(f"{path}: no 0x1A header terminator found; not an Arena .dat?")
    hdr = parse_header(raw[:sep])
    body = raw[sep + 1:]
    if len(body) % 16:
        raise ValueError(f"{path}: payload length {len(body)} is not a multiple of 16")
    n = len(body) // 16
    flat = struct.unpack("<" + "d" * (2 * n), body)
    pairs = list(zip(flat[0::2], flat[1::2]))

    reps: List[List[Tuple[float, float]]] = []
    cur: List[Tuple[float, float]] = []
    ended = False
    for t, v in pairs:
        if t < 0:
            # Terminator: t == -rep_number, v == 0.0 (more reps follow) or -1.0 (last rep).
            reps.append(cur)
            cur = []
            if v < 0:
                ended = True
                break
        else:
            cur.append((t, v))
    # The Analyzer's Batch/Truncate with Replications=All writes a malformed file: rep 1's
    # batches, a (-1, 0) terminator, then all-zero records and no final (-r, -1). Treat a
    # trailing run of exact (0, 0) records after a terminator as padding, not data.
    if not ended and cur and any(t != 0.0 or v != 0.0 for t, v in cur):
        reps.append(cur)  # tolerate a file truncated before its final terminator

    code = hdr["type_code"]
    return ArenaDat(
        type_code=code,
        type_name=TYPE_CODES.get(code, f"unknown({code})"),
        project=hdr["project"],
        analyst=hdr["analyst"],
        data_for=hdr["data_for"],
        run_date=hdr["run_date"],
        header_lines=hdr["lines"],
        replications=reps,
    )


def time_average(rep: List[Tuple[float, float]]) -> float:
    """Time-weighted mean for a time-persistent replication.

    Arena writes an initial (t0, v0) record, one record per change, and a closing
    (T_end, v_last) record, so integrating piecewise-constant segments between
    consecutive records covers exactly [t0, T_end].
    """
    if len(rep) < 2:
        return float("nan")
    area = 0.0
    for (t0, v0), (t1, _) in zip(rep, rep[1:]):
        area += v0 * (t1 - t0)
    return area / (rep[-1][0] - rep[0][0])


if __name__ == "__main__":
    import sys
    for p in sys.argv[1:]:
        d = read_arena_dat(p)
        print(f"{p}: type={d.type_code} ({d.type_name}) data_for={d.data_for!r} "
              f"project={d.project!r} analyst={d.analyst!r} run_date={d.run_date} "
              f"reps={d.n_reps}")
        for i, rep in enumerate(d.replications, 1):
            vals = [v for _, v in rep]
            msg = f"  rep {i}: {len(rep)} records"
            if d.type_name == "time-persistent":
                msg += f", time-avg={time_average(rep):.6g}"
            elif vals:
                msg += f", mean={sum(vals)/len(vals):.6g}, first={rep[0]}, last={rep[-1]}"
            print(msg)
