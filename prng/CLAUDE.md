# CLAUDE.md — `prng/`

Notes for the widget in this directory. Repository-wide conventions (head metadata, footer,
embedding, mobile, commit messages) are in the root `CLAUDE.md`.

- `prng/prng_explorer.html` *(seven tabs: ① the LCG with step-by-step arithmetic and uniformity
  and independence testing, ② combined LCGs, ③ MRGs & MRG32k3a, and a bracketed "Watermarking
  randomness" group ④–⑦ that builds from implicit parameter fingerprints through keyed
  re-seeding to SynthID-style tournament sampling, ending in a tiny embedded Markov model that
  writes marked prose and reads the mark back through a twenty-one-key detector lineup. Conventions
  relied on by code outside the file, which any later edit has to preserve:*
  1. *Everything between the `PRNG-CORE-BEGIN` / `PRNG-CORE-END` sentinels is pure numerics with
     no DOM access, and the sentinel block must not even contain the words "window" or "document"
     -- the Markov training corpus lives inside it, so corpus edits must avoid those words.
     `prng/verify_prng_explorer.mjs` slices that block out of the HTML and runs it in Node.*
  2. *`verify_prng_explorer.mjs` is not shipped with the widget and is not linked from the site.
     Run it (`node prng/verify_prng_explorer.mjs`; `PRNG_QUICK=1` skips the direct 2.1-billion-step
     walk of the minimal standard's full cycle, and `PRNG_CALIB_REPS` shortens the calibration
     sections) after touching anything in the core. It checks LCG and MRG reference vectors
     computed independently with Python big integers, Hull--Dobell verdicts against brute-forced
     periods, special functions against exact identities, chi-square and K-S calibration on
     known-good generators, exact re-seeding prediction, tournament distribution preservation
     with detector calibration, and the Markov section's corpus pins, grammar guards, forced-
     fraction gradient, and detection strength.*
  3. *The Markov chain's grammar guarantees rest on corpus discipline plus three state bits, not
     smoothing: no sentence-opening bigram is ever a sentence-ending bigram, every clause carries
     a verb, every comma-requiring opener gets its comma before its period, and the chain's state
     tracks all three empirically. The corpus token and vocabulary counts are pinned in the verify
     script, and so any corpus edit must update them and re-run the Markov checks.)*
