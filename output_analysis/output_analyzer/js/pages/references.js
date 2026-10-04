// The References page: the sources behind every procedure in the tool,
// grouped by the page that uses them, so that a reader can follow any
// method back to where it is defined and justified.

/** The page's hash id. */
export const id = 'references';
/** The page's title. */
export const title = 'References';

const GROUPS = [
  ['General', [
    'J. Banks, J. S. Carson, B. L. Nelson, and D. M. Nicol, <i>Discrete-Event System Simulation</i>, 5th ed. (Pearson, 2010), chapters 11 and 12: output analysis for a single system, comparison of system designs, Bonferroni families of intervals, and the two-stage screen for the best.',
    'A. M. Law, <i>Simulation Modeling and Analysis</i>, 5th ed. (McGraw-Hill, 2015), chapters 9 to 11: replications, warm-up, batch means, common random numbers, and the comparison of alternatives.'
  ]],
  ['One System and Two Systems', [
    'B. L. Welch, “The generalization of “Student’s” problem when several different population variances are involved,” <i>Biometrika</i> 34 (1947) 28–35: the two-sample t procedure with unequal variances and the Welch–Satterthwaite degrees of freedom.',
    'F. Wilcoxon, “Individual comparisons by ranking methods,” <i>Biometrics Bulletin</i> 1 (1945) 80–83; H. B. Mann and D. R. Whitney, “On a test of whether one of two random variables is stochastically larger than the other,” <i>Annals of Mathematical Statistics</i> 18 (1947) 50–60: the signed-rank and rank-sum tests.',
    'J. L. Hodges and E. L. Lehmann, “Estimates of location based on rank tests,” <i>Annals of Mathematical Statistics</i> 34 (1963) 598–611: the pseudo-median and shift estimates behind the Wilcoxon intervals.'
  ]],
  ['Several Systems', [
    'J. W. Tukey, “Comparing individual means in the analysis of variance,” <i>Biometrics</i> 5 (1949) 99–114; C. Y. Kramer, “Extension of multiple range tests to group means with unequal numbers of replications,” <i>Biometrics</i> 12 (1956) 307–310.',
    'C. W. Dunnett, “A multiple comparison procedure for comparing several treatments with a control,” <i>Journal of the American Statistical Association</i> 50 (1955) 1096–1121.',
    'J. C. Hsu, <i>Multiple Comparisons: Theory and Methods</i> (Chapman and Hall, 1996): the family-wise error rate, why the post-hoc rules need no F test in front, and multiple comparisons with the best.',
    'S. Holm, “A simple sequentially rejective multiple test procedure,” <i>Scandinavian Journal of Statistics</i> 6 (1979) 65–70.',
    'W. H. Kruskal and W. A. Wallis, “Use of ranks in one-criterion variance analysis,” <i>Journal of the American Statistical Association</i> 47 (1952) 583–621; M. Friedman, “The use of ranks to avoid the assumption of normality implicit in the analysis of variance,” <i>Journal of the American Statistical Association</i> 32 (1937) 675–701.',
    'O. J. Dunn, “Multiple comparisons using rank sums,” <i>Technometrics</i> 6 (1964) 241–252; S. Siegel and N. J. Castellan, <i>Nonparametric Statistics for the Behavioral Sciences</i>, 2nd ed. (McGraw-Hill, 1988): the pairwise comparisons after Kruskal–Wallis and after Friedman.',
    'B. L. Nelson, J. Swann, D. Goldsman, and W. Song, “Simple procedures for selecting the best simulated system when the number of alternatives is large,” <i>Operations Research</i> 49 (2001) 950–963; Y. Rinott, “On two-stage selection procedures and related probability-inequalities,” <i>Communications in Statistics, Theory and Methods</i> A7 (1978) 799–811: the screen for the best and its second-stage sizes.'
  ]],
  ['Variance and Correlation, and the checks', [
    'M. B. Brown and A. B. Forsythe, “Robust tests for the equality of variances,” <i>Journal of the American Statistical Association</i> 69 (1974) 364–367; H. Levene, “Robust tests for equality of variances,” in <i>Contributions to Probability and Statistics</i>, ed. I. Olkin (Stanford University Press, 1960) 278–292.',
    'S. S. Shapiro and M. B. Wilk, “An analysis of variance test for normality (complete samples),” <i>Biometrika</i> 52 (1965) 591–611; P. Royston, “A remark on algorithm AS 181: the W-test for normality,” <i>Applied Statistics</i> 44 (1995) 547–551: the test and the algorithm the Normality section computes it by.',
    'R. A. Fisher, “On the “probable error” of a coefficient of correlation deduced from a small sample,” <i>Metron</i> 1 (1921) 3–32: the z transformation behind the interval on a correlation.'
  ]],
  ['Steady State', [
    'P. D. Welch, “The statistical analysis of simulation results,” in <i>The Computer Performance Modeling Handbook</i>, ed. S. S. Lavenberg (Academic Press, 1983) 268–328: the moving-average plot for choosing a warm-up.',
    'G. S. Fishman, “Grouping observations in digital simulation,” <i>Management Science</i> 24 (1978) 510–521: batch means and the lag-one test of their independence.'
  ]]
];

/**
 * Renders the page into its section.
 * @param {HTMLElement} root
 */
export function render(root) {
  root.innerHTML =
    '<h2>' + title + '</h2>' +
    '<p class="lede">The sources behind the procedures on each page. The two books cover nearly every page and are where a reader new to simulation output analysis should start; the papers are where each procedure was defined or justified.</p>' +
    GROUPS.map(([name, items]) =>
      '<div class="sec"><div class="sec-hd">' + name + '</div><ul class="ref-list">' + items.map(t => '<li>' + t + '</li>').join('') + '</ul></div>').join('');
}

/** Called each time the page is shown. */
export function onShow() {}

export default { id, title, render, onShow };
