# Simulating Stochastic Systems – Course Visualizations

Supplemental web visualizations for **Simulating Stochastic Systems** at
[Arizona State University](https://www.asu.edu/), taught by
[Theodore P. Pavlic](https://search.asu.edu/profile/1995237)
(Associate Professor, [SCAI](https://scai.engineering.asu.edu/) &
[SOLS](https://sols.asu.edu/)).

**Live site:** <https://tpavlic.github.io/asu-simulating-stochastic-systems/>

The course covers the modeling and analysis of systems driven by randomness – pseudorandom number
generation, random variate generation, input modeling and distribution fitting, discrete-event
simulation and queueing models, output analysis and confidence intervals, and variance-reduction
techniques. These visualizations are designed to build intuition for the concepts behind those
methods and to be usable both standalone and embedded in Canvas LMS pages as iframes.

---

## Contents

Topic sections are added alongside the first demo that belongs in them, so this list grows section
by section as the course progresses; see [Adding a new visualization](#adding-a-new-visualization)
below.

### Monte Carlo Methods

| Directory | Description |
| --- | --- |
| [`monte_carlo/`](monte_carlo/) | Interactive explorer for Monte Carlo estimation: dartboard estimation of π, Buffon's needle, area from a walking robot's crossing trails, and Monte Carlo integration, with accumulating 95% confidence intervals |

### Input Modeling

| Directory | Description |
| --- | --- |
| [`input_modeling/`](input_modeling/) | Fit a distribution to sample data and read off the expression for a simulation model: maximum-likelihood fits of fourteen candidates ranked by AIC and BIC beside Arena's square-error criterion, chi-square, Kolmogorov–Smirnov, and Anderson–Darling tests with bootstrap p-values, Q–Q and P–P diagnostics, a nonhomogeneous-Poisson arrival mode, and export to Arena, Simio, AnyLogic, R, MATLAB, and SciPy |

---

## Adding a new visualization

Each visualization lives in its own subdirectory and generally follows this pattern:

```bash
my_demo/
  my_demo.html          # self-contained page
  my_demo-preview.png   # preview image for OG/Twitter cards
```

For a new `my_demo.html`, the checklist is:

1. **`<head>` metadata:**

   * Include `<title>`, `<meta name="description">`, and the full Open Graph + Twitter
     card block (see [`CLAUDE.md`](CLAUDE.md) for the template)
   * Use the preview image as `og:image` and `twitter:image`; set width/height
     accurately
   * For Twitter/X, the image should be close to **2:1 aspect ratio**
     and under **5 MB**

2. **Back-link footer** – add at the bottom of `<body>`:

   ```html
    <footer id="course-nav-footer" style="margin-top:0;font-size:0.8rem;color:#8C1D40;">
      <div style="max-width:MAX_WIDTH;margin:0 auto;padding:0.75rem 0 0 1rem;">
        <a href="../" style="color:inherit;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'"><span style="font-family:sans-serif">&larr;</span> All course visualizations</a>
      </div>
    </footer>
    <script>
    if (window.self !== window.top) { var f = document.getElementById('course-nav-footer'); if (f) { f.style.display = 'none'; } }
    </script>
   ```

   The script hides the footer when the page is embedded in a Canvas iframe.

3. **Index entry** – add a `<li>` to the appropriate `<section>` in [`index.html`](index.html),
   following the pattern in [`CLAUDE.md`](CLAUDE.md) (thumbnail + title + one-sentence
   description). If the demo starts a new topic area, add the section itself first: create the
   `<section>` in `index.html`, add a matching link to **both** nav lists there, and add a
   `### <Section>` table to the [Contents](#contents) above.

---

## See also

Other projects by the same author that visitors here may find complementary:

* [Bio-Inspired AI & Optimization — Course Visualizations](https://tpavlic.github.io/asu-bioinspired-ai-and-optimization/) — supplemental visualizations for a separate ASU graduate course on optimization and multi-agent control inspired by biological and physical systems.
* [Topic Visualizers — Interactive Explainers](https://tpavlic.github.io/topic_visualizers/) — interactive web demonstrations across science, mathematics, statistics, and engineering.
* [Notes, Documents, & Guides](https://github.com/tpavlic/docs-and-guides) — Markdown-formatted notes and instructional guides on a variety of fundamental and applied science and engineering topics.
* [Lectures and short video tutorials](https://www.youtube.com/@TedPavlic) on YouTube, including the [Office Hours](https://www.youtube.com/playlist?list=PLXBbGVSkQJqEFKCGlTbzBnvf96DRJ6_gi) playlist.

---

## License

Released under the [MIT License](LICENSE).
Copyright &copy; 2026 Theodore P. Pavlic.
