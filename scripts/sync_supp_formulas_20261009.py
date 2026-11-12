"""Synchronize supplementary methods with the implemented numerical model.

Call patch_supp(Document(source), results, figures) before saving.  This module
does not write a document on import; the caller owns authoring/render QA gates.
All replacement equations are native, structured Office Math (OMML).
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
from pathlib import Path
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn


def atom(text):
    r = OxmlElement('m:r')
    t = OxmlElement('m:t')
    t.set(qn('xml:space'), 'preserve')
    t.text = str(text)
    r.append(t)
    return r


def seq(*items):
    out = []
    for item in items:
        if isinstance(item, str):
            out.append(atom(item))
        elif isinstance(item, (list, tuple)):
            out.extend(seq(*item))
        else:
            out.append(deepcopy(item))
    return out


def structure(tag, **parts):
    e = OxmlElement('m:' + tag)
    for name, value in parts.items():
        box = OxmlElement('m:' + name)
        box.extend(seq(value))
        e.append(box)
    return e


def sub(base, index):
    return structure('sSub', e=base, sub=index)


def sup(base, power):
    return structure('sSup', e=base, sup=power)


def frac(numerator, denominator):
    return structure('f', num=numerator, den=denominator)


def group(content, left='(', right=')'):
    e = OxmlElement('m:d')
    pr = OxmlElement('m:dPr')
    for key, val in [('begChr', left), ('endChr', right)]:
        child = OxmlElement('m:' + key)
        child.set(qn('m:val'), val)
        pr.append(child)
    e.append(pr)
    box = OxmlElement('m:e')
    box.extend(seq(content))
    e.append(box)
    return e


def root(content):
    e = OxmlElement('m:rad')
    pr = OxmlElement('m:radPr')
    hide = OxmlElement('m:degHide')
    hide.set(qn('m:val'), '1')
    pr.append(hide)
    e.append(pr)
    e.append(OxmlElement('m:deg'))
    box = OxmlElement('m:e')
    box.extend(seq(content))
    e.append(box)
    return e


def summation(content, low='i=1', high='n'):
    e = OxmlElement('m:nary')
    pr = OxmlElement('m:naryPr')
    chr_ = OxmlElement('m:chr')
    chr_.set(qn('m:val'), '∑')
    pr.append(chr_)
    e.append(pr)
    for tag, value in [('sub', low), ('sup', high), ('e', content)]:
        child = OxmlElement('m:' + tag)
        child.extend(seq(value))
        e.append(child)
    return e


def exp(power):
    return sup('e', power)


def log(content):
    return seq(sub('log', '10'), group(content))


N0 = sub('N', '0')
NR = sub('N', 'res')
NM = sub('N', 'min')
K = sub('k', 'max')
SL = sub('S', 'L')
CC = sub('C', 'c')


def shoulder(rate=K):
    # Equivalent to the stabilized logShoulderSurvival in the implementation.
    return frac(seq(exp(seq('−', rate, 't')), group(seq('1+', CC))),
                seq('1+', CC, exp(seq('−', rate, 't'))))


def primary_equations():
    lhs = seq(log('N'), ' = ')
    k1, k2 = sub('k', '1'), sub('k', '2')
    d1, d2, p1, p2 = sub('δ', '1'), sub('δ', '2'), sub('p', '1'), sub('p', '2')
    wp = sup(group(frac('t', 'δ')), 'p')
    note = seq(CC, ' = ', exp(seq(K, SL)), '−1')
    n1 = seq(CC, ' = ', exp(seq(k1, SL)), '−1')
    return [
        [seq(lhs, log(N0), '−', frac(seq(K, 't'), 'ln 10'))],
        [seq(lhs, log(seq(group(seq(N0, '−', NR)), exp(seq('−', K, 't')), '+', NR)))],
        [seq(lhs, log(N0), '+', log(shoulder())), note],
        [seq(lhs, log(seq(group(seq(N0, '−', NR)), shoulder(), '+', NR))), note],
        [seq(lhs, log(N0), '−', wp)],
        [seq(lhs, log(seq(group(seq(N0, '−', NR)), sup('10', seq('−', wp)), '+', NR)))],
        [seq(lhs, log(N0), '+', log(seq('f', exp(seq('−', k1, 't')), '+', group('1−f'), exp(seq('−', k2, 't')))))],
        [seq(lhs, log(N0), '+', log(seq('f', shoulder(k1), '+', group('1−f'), exp(seq('−', k2, 't'))))), n1],
        [seq(lhs, log(N0), '+', log(seq('f', sup('10', seq('−', sup(group(frac('t', d1)), p1))), '+',
                group('1−f'), sup('10', seq('−', sup(group(frac('t', d2)), p2))))))],
        [seq(lhs, log(N0), '−A exp', group(seq('−exp', group(seq(frac('μe', 'A'), group('λ−t'), '+1')))))],
        [seq(lhs, log(seq(NM, '+', group(seq(N0, '−', NM)), exp(seq('−', K, 'A(t)'))))),
         seq('A(t)=t+', frac('1', K), 'ln', group(seq(exp(seq('−', K, 't')), '+', exp(seq('−', sub('h', '0'))),
                 '−', exp(seq('−', K, 't−', sub('h', '0'))))))],
    ]


def replace_text(paragraph, text):
    """Keep paragraph properties and first run formatting, replace its content."""
    props = deepcopy(paragraph.runs[0]._r.rPr) if paragraph.runs and paragraph.runs[0]._r.rPr is not None else None
    for child in list(paragraph._p):
        if child.tag != qn('w:pPr'):
            paragraph._p.remove(child)
    r = paragraph.add_run(text)
    if props is not None:
        r._r.insert(0, props)


def replace_math(paragraph, content):
    for child in list(paragraph._p):
        if child.tag != qn('w:pPr'):
            paragraph._p.remove(child)
    math = OxmlElement('m:oMath')
    math.extend(seq(content))
    paragraph._p.append(math)


def patch_supp(doc, results=None, figures=None):
    """Modify Document in memory and return an audit dict (no save operation).

    results/figures are accepted for the root's shared interface; figure bytes,
    captions and stochastic result summaries are deliberately caller-owned.
    Optional results['supplement_text'] maps 1-based source paragraph numbers
    to verified result-dependent replacement text.
    """
    p = list(doc.paragraphs)
    if len(p) < 181 or len(doc.tables) != 3 or len(doc.tables[0].rows) != 12:
        raise ValueError('Unexpected supplementary source structure; refusing index-based patch')
    text = {
        7: 'n: Number of observations.\nk: Number of freely estimated regression parameters, including the fitted intercept or initial count when applicable.\nK = k + 1: Likelihood parameter count including the estimated Gaussian residual variance.\np: Number of sensitivity-analysis inputs.',
        9: 'SSE: Sum of squared errors.\nSST: Total sum of squares.\nMSE: Residual mean square, SSE/(n − k), used for parameter covariance.\nRMSE: Root mean squared prediction error, √(SSE/n).\nResidual SE: √MSE.',
        15: 'u(t): log10 N(t), the log10-transformed microbial population at time t.\ng(t): log10-scale instantaneous derivative in dynamic simulation.',
        21: 'kmax: Natural-log first-order inactivation rate; units are the inverse of the treatment-time or exposure unit.',
        22: 'k1, k2: Natural-log first-order inactivation rates for the two biphasic subpopulations (implemented parameter names kmax1 and kmax2); the labels sensitive and resistant identify the fitted components and require inspection of their fitted rates.',
        24: 'δ, δ1, δ2: Weibull scale parameters in the treatment-time or exposure unit. The implemented base-10 convention gives a one-log10 reduction at t = δ for a single Weibull population; subscripts identify mixed-population components.',
        26: 'f: Fraction of the first subpopulation in biphasic or mixed Weibull models; 0 ≤ f ≤ 1 in the mathematical formulation.',
        27: 'A: Gompertz asymptotic reduction amplitude (log10 units); μ: maximum Gompertz decline rate (log10 units per treatment-time or exposure unit); λ: Gompertz shoulder parameter in that unit. The fitted parameter logN0 is the upper asymptote, and the implemented Gompertz value at t = 0 is evaluated from the full equation rather than set identically to logN0.',
        28: 'A(t): Baranyi adjusted time; h0: dimensionless physiological-state parameter; Nmin: Baranyi lower asymptote. Baranyi uses fitted logN0, logNmin, kmax and h0, with h0/kmax corresponding to an effective shoulder time. Cc = exp(kmax SL) − 1 is an auxiliary shoulder quantity, not a fitted Gompertz parameter.',
        32: 'Here yi is the observed response and ŷi(θ) is the model prediction. Nonlinear optimization used a bounded Levenberg–Marquardt procedure with central finite differences (one-sided fallback for a nonfinite perturbed prediction), adaptive damping and constrained steps. Convergence required a scaled projected-gradient criterion; a small SSE change or parameter step alone was not accepted as convergence. With g = ΠT(Jᵀr), where ΠT projects onto the feasible tangent cone of active constraints, the criterion was:',
        35: 'The search stopped without a convergence claim at 2,000 iterations, an invalid prediction or Jacobian, an unsuccessful constrained solve, or damping above 10⁹. Accepted steps decreased SSE; damping was divided by 10 after an accepted step and multiplied by 10 after a rejected step.',
        36: 'Initial values used model-specific data-driven heuristics; user values could override these starts. Declared bounds and residual/minimum population ≤ initial population were enforced in the constrained steps. Ordinary time curves were fitted in minutes. Curves shorter than 0.1 min used time normalized by the observed maximum, with log coordinates for strictly positive dimensional rates and scales; this path was also used when the minute-axis fit encountered a scale lower bound. Parameters and local covariance were transformed back to the selected display unit. The working axis depended on physical time rather than the displayed unit, and positivity did not impose a new physical kinetic floor.',
        37: 'For primary models with three or more freely fitted parameters, deterministic multi-start fitting perturbed data-driven starts, with alternative fractions, shapes, rates and scales. The generic candidate list was capped at 30; a normalized-axis Weibull fit without a user start could add one shape-boundary seed obtained by linear regression at the declared minimum shape. The converged candidate with the lowest SSE was retained, with a default-start fallback if none converged. Nonconverged fits, invalid AICc (n ≤ K + 1, K = k + 1), and near-boundary estimates were flagged.',
        42: 'Here k counts freely estimated regression parameters and K = k + 1 also includes residual variance. AICc requires n > K + 1 and positive finite SSE. For response transformation h and comparisons on the same underlying response scale, ℓJ = ∑i ln|h′(yi)| is the response Jacobian contribution; ℓJ = 0 for an untransformed response. Models must share observations and comparison scale. Performance also included RMSE, R², adjusted R², residual SE, parameter SE, approximate 95% confidence intervals and residual diagnostics:',
        46: 'Parameter uncertainty was approximated from the local variance-covariance matrix; the numerical fit object stores C = (JᵀJ)⁻¹ separately from MSE, so Cov(θ) = MSE C and sampling must apply the MSE factor exactly once:',
        47: 'Standard errors and 95% intervals are local Wald approximations: θj ± t0.975,n−k SE(θj), using tabulated t critical values for n − k ≤ 30 and 1.96 thereafter. Log-coordinate fits transformed covariance locally to physical parameters before unit conversion. Covariance output was suppressed when the information matrix was not reliably invertible or when physical-scale covariance underflowed or overflowed. Sparse curves without a zero-time observation can have a shallow initial-count/scale/shape trade-off; extreme extrapolated scales and boundary shapes are weak-identifiability diagnostics, not validated point estimates. Wald intervals are not a complete uncertainty characterization.',
        58: 'At each time, the linearly interpolated environmental state was passed through the secondary model to obtain D(t) or k(t). The state-independent derivative g(t) = −k(t)/ln 10 was integrated by Simpson quadrature on each interval. This update is algebraically equivalent to classical RK4 for a derivative depending only on time:',
        59: 'The grid combines 500 evenly spaced intervals by default with every supplied profile breakpoint; adding breakpoints may therefore increase the interval count. Environmental variables are interpolated linearly between strictly increasing finite profile times. Nonfinite or negative predicted rates are rejected. Constant-condition trajectories were checked against static log-linear predictions; broader non-isothermal evidence is limited to the illustrative T2 workflow.',
        68: 'Monte Carlo propagation used fitted parameters, local covariance and optional process-factor variability. Joint Gaussian sampling used a Cholesky factor of the MSE-scaled covariance, with fitted correlations numerically limited to ±0.999 before decomposition (Helton & Davis, 2003):',
        70: 'Here μ is the nominal parameter vector and L is the Cholesky factor. If Cholesky decomposition was unavailable, diagonal sampling retained available marginal variances. Parameters with no supplied uncertainty remained deterministic; no artificial variance was added.',
        71: 'Sampling modes were reported as full covariance, diagonal fallback, diagonal sampling or deterministic. Secondary fits were sampled jointly within each fitted covariance block when possible; different fit blocks and process-factor draws were sampled independently. This local covariance approximation does not capture cross-fit dependence from shared data or constitute Bayesian posterior sampling.',
        72: 'Strictly positive primary rates, scales, shapes and Gompertz amplitude were transformed to log-normal draws. For nominal mean μj and standard error sj, the moment-matched log-space scale was σlog,j = √ln[1 + (sj/μj)²]:',
        73: 'The −σ²log,j/2 correction preserves the nominal mean for an untruncated log-normal draw. Standardized draws were clipped to ±3 when sj/μj > 1; shape parameters were floored at 0.01, shoulder/state modifiers at zero, and fractions at [0.001, 0.999]. Truncation, bounds and nonlinear transformation can change moments and correlation, so the propagated distribution remains an approximation.',
        77: 'Here x0 is the nominal condition and σx is the specified process standard deviation. Process factors were sampled independently without implicit physical clipping. The sampled factors and secondary coefficients generated iteration-specific primary predictions, followed by primary estimation-noise perturbations. Invalid secondary predictions or any nonfinite point on a sampled trajectory caused the entire draw to be rejected; all output arrays retained the same accepted draw identities.',
        78: 'Outputs included final log10 N, draw-specific reduction R(s)(t) = u(s)(0) − u(s)(t), time to target and success probability. Reduction targets were measured from each sampled curve’s initial value, including the actual Gompertz value at zero. The equation below uses the number S of accepted complete trajectories:',
        80: 'Endpoint stability was assessed at accepted-sample checkpoints of 1,000, 3,000, 5,000 and 10,000 using changes between the last two available checkpoints. The 99th-percentile thresholds were 0.10 and 0.25 log10 units; the 95th-percentile thresholds were 0.05 and 0.15. Exceeding the larger threshold was exploratory, and the more conservative classification was retained. Safe-treatment-time changes were converted to minutes and compared with thresholds of 0.2 and 0.5 min. Target times used the first saved point reaching each draw-specific target, so they depend on time-grid resolution; a draw not reaching the target within the horizon had infinite first-passage time. These are numerical diagnostics rather than validated safety acceptance criteria. Fewer than two checkpoints did not establish stability.',
        82: 'Four sensitivity methods were implemented. OAT perturbed each input symmetrically around its nominal value (±5% by default), while holding other independent inputs fixed and re-predicting bound primary parameters. It ranked absolute half-spans of the output response rather than finite-difference derivatives:',
        84: 'SRC standardized the accepted Monte Carlo inputs and output and fitted ordinary least squares. In factor-driven simulations, primary-input columns were sampled estimation-noise coordinates; factor/secondary-derived primary rates were not added again as independent regressors. Zero-variance columns were excluded and singular regressions were suppressed. Normalized squared coefficients provide relative regression screening weights:',
        87: 'Regression R² diagnoses the linear approximation. Normalized β² weights sum to one by construction, but correlated fitted inputs, nonlinear transformations and interactions prevent interpreting them as an additive variance decomposition or causal allocation.',
        88: 'Morris elementary effects were computed along sampled trajectories in normalized input space; the denominator was the actual normalized step after any range clipping:',
        91: 'Mean absolute elementary effects ranked influence; their spread can reflect nonlinearities or interactions. Whole trajectories with nonfinite predictions were excluded. Normalized μ* percentages are screening ranks, not variance fractions.',
        92: 'Sobol total effects were estimated with a Jansen-style pick-and-freeze estimator (Jansen, 1999; Saltelli et al., 2010). Its variance interpretation requires independent inputs, a finite nonzero output variance and a valid model throughout the declared rectangular domain:',
        94: 'Inputs were grouped as process-control factors, unbound primary parameters and secondary coefficients. Bound primary rates were deterministically re-predicted. Finite-sample total-effect estimates can exceed one and need not sum to one. The implementation clips displayed ST values to [0, 2] and uses finite evaluation pairs (at least 50% valid base outputs and 30% valid pairs per input); invalid regions or clipped estimates weaken the formal Sobol interpretation. Normalized bar percentages are relative influence summaries. ΣST > 1 alone does not demonstrate interactions.',
        95: 'Default settings were OAT ±5%, Morris 10 trajectories with 4 grid levels, and Sobol 128 base samples. SRC used accepted samples from the uncertainty run. Morris and Sobol sampled independently within configured process-factor bounds, otherwise ±20% of the nominal factor value. Unbound primary ranges used ±20% with declared parameter and population bounds; secondary-coefficient ranges used the larger of 3SE, 20% of |nominal| and 10⁻⁶, intersected with declared bounds. These global ranges differ from covariance-based Monte Carlo uncertainty and require domain review before scientific interpretation. Demonstration-specific sample sizes and settings accompany the corresponding results and figures.',
    }
    for source_index, value in text.items():
        replace_text(p[source_index - 1], value)
    yi, yh = sub('y', 'i'), sub('ŷ', 'i')
    math = {
        31: seq('SSE(θ)=', summation(sup(group(seq(yi, '−', yh, '(θ)')), '2'))),
        33: seq(sub('h', 'j'), '=', sup('10', '−5'), 'max', group(seq('1,|', sub('θ', 'j'), '|'))),
        34: seq(sub('max', 'j'), frac(seq('|', sub('g', 'j'), '|'), seq('max', group(seq(root(sub('JᵀJ', 'jj')), ',', sup('10', '−12'))))),
                '<', sup('10', '−8'), 'max', group(seq('1,', root('SSE')))),
        39: seq('AICc=n ln', group(frac('SSE', 'n')), '−2', sub('ℓ', 'J'), '+2K+', frac('2K(K+1)', 'n−K−1'), ',   K=k+1'),
        43: seq('RMSE=', root(frac('SSE', 'n')), ',   residual SE=', root(frac('SSE', 'n−k'))),
        45: seq(sub(sup('R', '2'), 'adj'), '=1−', group(seq('1−', sup('R', '2'))), frac('n−1', 'n−k')),
        48: seq('MSE=', frac('SSE', 'n−k'), ',   n>k'),
        49: seq('Cov(θ)=MSE ', sup(group('JᵀJ'), '−1')),
        50: seq('SE', group(sub('θ', 'j')), '=', root(sub('Cov(θ)', 'jj'))),
        60: seq(sub('u', 'm+1'), '=', sub('u', 'm'), '+', frac(sub('Δt', 'm'), '6'),
                group(seq('g', group(sub('t', 'm')), '+4g', group(seq(sub('t', 'm'), '+', frac(sub('Δt', 'm'), '2'))), '+g', group(sub('t', 'm+1'))))),
        61: seq('g(t)=−', frac('k(t)', 'ln 10'), '=−', frac('1', 'D(t)')),
        62: seq(sub('Δt', 'm'), '=', sub('t', 'm+1'), '−', sub('t', 'm')),
        69: seq(sup('θ', '(s)'), '=μ+L', sup('z', '(s)'), ',   ', sup('z', '(s)'), '∼N(0,I),   LLᵀ=Cov(θ)'),
        74: seq(sup(sub('θ', 'j'), '(s)'), '=', sub('μ', 'j'), 'exp', group(seq(sub('σ', 'log,j'), sup(sub('z', 'j'), '(s)'), '−', frac(sup(sub('σ', 'log,j'), '2'), '2')))),
        79: seq(sub('P', 'success'), '=', frac('1', 'S'), summation(seq('I', group(seq(sup('R', '(s)'), '(t)≥', sub('R', 'target')))), 's=1', 'S')),
        83: seq(sub('a', 'i'), '=', frac(seq('|Y', group(seq(sub('x', 'i'), '+', sub('Δ', 'i'))), '−Y', group(seq(sub('x', 'i'), '−', sub('Δ', 'i'))), '|'), '2'),
                ',   ', sub('C', 'i'), '=', frac(sub('a', 'i'), summation(sub('a', 'j'), 'j=1', 'p'))),
        85: seq(sub('Z', 'Y'), '=', summation(seq(sub('β', 'i'), sub('Z', 'Xi')), 'i=1', 'p'), '+ε'),
        86: seq(sub('C', 'i'), '=', frac(sup(sub('β', 'i'), '2'), summation(sup(sub('β', 'j'), '2'), 'j=1', 'p')), ',   ',
                sub(sup('R', '2'), 'SRC'), '=1−', frac(sub('SSE', 'reg'), sub('SST', 'reg'))),
        89: seq(sup(sub('EE', 'i'), '(l)'), '=', frac(seq('Y', group(sup('x', '(l+1)')), '−Y', group(sup('x', '(l)'))),
                frac(seq(sup(sub('x', 'i'), '(l+1)'), '−', sup(sub('x', 'i'), '(l)')), seq(sub('x', 'i,max'), '−', sub('x', 'i,min'))))),
        90: seq(sup(sub('μ', 'i'), '*'), '=', frac('1', sub('r', 'i')), summation(seq('|', sup(sub('EE', 'i'), '(l)'), '|'), 'l=1', sub('r', 'i'))),
        93: seq(sub('Ŝ', 'Ti'), '=', frac(summation(sup(group(seq('f', group(sub('A', 's')), '−f', group(sub(sup(sub('A', 'B'), '(i)'), 's')))), '2'), 's=1', 'Mᵢ'), '2Mᵢ Var(Y)')),
    }
    for source_index, value in math.items():
        replace_math(p[source_index - 1], value)
    equations = primary_equations()
    for row, lines in zip(doc.tables[0].rows[1:], equations):
        cell = row.cells[1]
        original = list(cell.paragraphs)
        for extra in original[1:]:
            extra._p.getparent().remove(extra._p)
        replace_math(original[0], lines[0])
        for line in lines[1:]:
            added = cell.add_paragraph()
            if original[0]._p.pPr is not None:
                added._p.insert(0, deepcopy(original[0]._p.pPr))
            replace_math(added, line)
    # Clear transcription errors only; retain the complete 43-model library.
    replace_math(doc.tables[2].rows[1].cells[1].paragraphs[0], log('D'))
    replace_math(doc.tables[2].rows[4].cells[1].paragraphs[0], log('δ'))
    if results and results.get('supplement_text'):
        for idx, value in results['supplement_text'].items():
            replace_text(p[int(idx)-1], value)
    count = len(doc.element.xpath('.//m:oMath'))
    if not all(row.cells[1]._tc.xpath('.//m:oMath') for row in doc.tables[0].rows[1:]):
        raise AssertionError('Primary table lost native OMML equations')
    return {'native_math_count': count, 'primary_formulas': 11,
            'secondary_library_rows': len(doc.tables[1].rows)-1,
            'replaced_text_source_paragraphs': sorted(text),
            'replaced_math_source_paragraphs': sorted(math)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', default='dzb-7.8 MicroFit 补充材料.docx')
    parser.add_argument('--output', required=True)
    parser.add_argument('--results')
    args = parser.parse_args()
    results = json.loads(Path(args.results).read_text()) if args.results else None
    doc = Document(args.source)
    audit = patch_supp(doc, results)
    doc.save(args.output)
    print(json.dumps(audit, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
