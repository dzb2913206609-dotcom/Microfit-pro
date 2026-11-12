"""Save revised copies of the supplied manuscript and supplement.

Numeric values come from saved current-production calculations. Source DOCX
files remain intact. Run after generating the figure exports.
"""
from copy import deepcopy
import json
from pathlib import Path
import re

from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, Inches
from sync_supp_formulas_20261009 import patch_supp, replace_text, seq, sub, sup, frac, group, root, log

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'reports/paper_sync_20261009'
FIG = DATA / 'figures'
MAIN_SOURCE = ROOT / 'dzb-7.8 MicroFit Pro正文.docx'
SUPP_SOURCE = ROOT / 'dzb-7.8 MicroFit 补充材料.docx'
MAIN_OUT = ROOT / 'dzb-7.8 MicroFit Pro正文_修订版.docx'
SUPP_OUT = ROOT / 'dzb-7.8 MicroFit 补充材料_修订版.docx'


def load(name):
    return json.loads((DATA / (name + '.json')).read_text())


def change_text(p, old, new):
    """Replace a fragment across runs while retaining surrounding formatting."""
    alltext = ''.join(r.text for r in p.runs)
    if old not in alltext:
        raise ValueError(f'Expected text not found: {old!r}')
    start = alltext.index(old); stop = start + len(old); at = 0; inserted = False
    for run in p.runs:
        text = run.text; end = at + len(text)
        if end > start and at < stop:
            left = text[:max(0, start - at)]
            right = text[max(0, stop - at):] if stop < end else ''
            run.text = left + (new if not inserted else '') + right
            inserted = True
        at = end


def cell_text(cell, text):
    replace_text(cell.paragraphs[0], text)
    for p in list(cell.paragraphs)[1:]:
        p._p.getparent().remove(p._p)


def replace_image(doc, shape_index, path):
    sh = doc.inline_shapes[shape_index]
    rid = sh._inline.graphic.graphicData.pic.blipFill.blip.embed
    doc.part.related_parts[rid]._blob = path.read_bytes()
    # Word and LibreOffice prefer the embedded SVG over its PNG fallback.
    for svg in sh._inline.xpath('.//*[local-name()="svgBlip"]'):
        svg_rid = svg.get(qn('r:embed'))
        doc.part.related_parts[svg_rid]._blob = path.with_suffix('.svg').read_bytes()
    # Preserve layout width, update aspect ratio to avoid stretched plots.
    from PIL import Image
    w, h = Image.open(path).size
    sh.height = int(sh.width * h / w)


def comment(doc, paragraph, text):
    if hasattr(doc, 'add_comment') and paragraph.runs:
        doc.add_comment(paragraph.runs[0], text=text, author='Numerical review', initials='NR')


def append_math(p, content):
    element = OxmlElement('m:oMath')
    element.extend(seq(content))
    p._p.append(element)


def math_font_size(doc, table_index, size):
    for r in doc.tables[table_index]._tbl.xpath('.//m:r'):
        rp = r.find(qn('w:rPr'))
        if rp is None:
            rp = OxmlElement('w:rPr'); r.insert(0, rp)
        fonts = rp.find(qn('w:rFonts'))
        if fonts is None:
            fonts = OxmlElement('w:rFonts'); rp.append(fonts)
        fonts.set(qn('w:ascii'), 'Cambria Math'); fonts.set(qn('w:hAnsi'), 'Cambria Math')
        sz = rp.find(qn('w:sz'))
        if sz is None:
            sz = OxmlElement('w:sz'); rp.append(sz)
        sz.set(qn('w:val'), str(int(size * 2)))


def table_layout(table, widths, size, indent=0, after=3):
    table.autofit = False
    pr = table._tbl.tblPr
    for tag, value in [('tblW', round(sum(widths) * 1440)), ('tblInd', round(indent * 1440))]:
        el = pr.find(qn('w:' + tag))
        if el is None:
            el = OxmlElement('w:' + tag); pr.append(el)
        el.set(qn('w:type'), 'dxa'); el.set(qn('w:w'), str(value))
    for col, width in zip(table.columns, widths): col.width = Inches(width)
    for i, row in enumerate(table.rows):
        trpr = row._tr.get_or_add_trPr()
        if trpr.find(qn('w:cantSplit')) is None: trpr.append(OxmlElement('w:cantSplit'))
        if i == 0 and trpr.find(qn('w:tblHeader')) is None: trpr.append(OxmlElement('w:tblHeader'))
        for cell, width in zip(row.cells, widths):
            cell.width = Inches(width)
            for p in cell.paragraphs:
                pf = p.paragraph_format
                pf.space_before = Pt(0); pf.space_after = Pt(after); pf.line_spacing = 1
                pf.keep_with_next = False; pf.keep_together = True
                pf.left_indent = Pt(0); pf.right_indent = Pt(0); pf.first_line_indent = Pt(0)
                for r in p.runs: r.font.size = Pt(size)


def clean_header_line_numbers(doc):
    # Empty header/footer paragraphs were included in inherited line numbering.
    for section in doc.sections:
        for part in [section.header, section.first_page_header, section.even_page_header,
                     section.footer, section.first_page_footer, section.even_page_footer]:
            for p in part.paragraphs:
                pr = p._p.get_or_add_pPr()
                if pr.find(qn('w:suppressLineNumbers')) is None:
                    pr.append(OxmlElement('w:suppressLineNumbers'))


def finish_copy(doc):
    while doc.paragraphs and not doc.paragraphs[-1].text.strip() and not doc.paragraphs[-1]._p.xpath('.//w:drawing|.//m:oMath'):
        p = doc.paragraphs[-1]._p
        p.getparent().remove(p)
    for p in doc.paragraphs:
        if p.style.name.startswith('Heading') or (len(p.text) < 150 and re.match(r'^\d+(?:\.\d+)*[.\s]', p.text.strip())):
            p.paragraph_format.keep_with_next = True
    # Keep brief metric formulas editable in Word, including table notes.
    for p in doc.paragraphs:
        if '√(SSE/n)' not in p.text and '√[SSE/(n − k)]' not in p.text: continue
        text = p.text
        pieces = re.split(r'(√\(SSE/n\)|√\[SSE/\(n − k\)\])', text)
        replace_text(p, '')
        for piece in pieces:
            if piece == '√(SSE/n)': append_math(p, root(frac('SSE', 'n')))
            elif piece == '√[SSE/(n − k)]': append_math(p, root(frac('SSE', seq('n−k'))))
            else: p.add_run(piece)


def main():
    rows = load('table2_same_model_comparison')
    by_id = {r['tableId']: r for r in rows}
    ranks = load('table3_all_primary_fits')
    sec = load('t1_all_secondary_fits')['EXTENDED_BIGELOW_D']
    mc = load('figure6_mc_summary'); ss = load('sensitivity_results')
    ms = mc['summary']; params = sec['params']
    doc = Document(MAIN_SOURCE); p = list(doc.paragraphs)
    if len(p) != 195 or len(doc.tables) != 4 or len(doc.inline_shapes) != 6:
        raise ValueError('Unexpected main-document source structure')

    change_text(p[3], 'analysis,standardized', 'analysis, standardized')
    # Accept the source's single inserted spacing change for the revised copy.
    for ins in list(doc._element.xpath('.//w:ins')):
        parent = ins.getparent(); index = parent.index(ins)
        for child in list(ins): parent.insert(index, child); index += 1
        parent.remove(ins)
    for para in p:
        if '[insert GitHub or repository URL]' in para.text:
            change_text(para, 'Source code is available at [insert GitHub or repository URL] under the MIT license ', '')
    change_text(p[3], 'RMSE = 0.175, adjusted R² = 0.915',
                f"RMSE = {sec['rmse']:.3f}, adjusted R² = {sec['r2adj']:.3f}")
    replace_text(p[23], 'Model parameters were estimated by bounded nonlinear least-squares regression using a Levenberg–Marquardt procedure with finite-difference Jacobians and adaptive damping (Levenberg, 1944; Marquardt, 1963). Convergence required a scaled projected-gradient criterion; reaching 2000 iterations or damping above 10⁹ was treated as nonconvergence. For models with three or more fitted parameters, data-driven starts and deterministic multi-start fitting were used, with up to 30 generic candidate starts. A normalized-axis Weibull fit could additionally use a profiled shape-boundary start. Numerical working-axis scaling and log coordinates for positive dimensional parameters were used for short PEF curves or fits reaching a legacy scale bound, and parameters and local uncertainty were converted back to the treatment-axis unit. Detailed criteria and constraints are provided in Supplementary Methods.')
    change_text(p[24], 'Detailed estimation equations are provided in Supplementary Methods.',
                'RMSE was calculated as √(SSE/n), whereas residual SE was √[SSE/(n − k)]. Adjusted R² used residual degrees of freedom n − k, where k includes all freely estimated regression parameters, including a fitted initial count or intercept. Gaussian AICc counted K = k + 1 parameters, including residual variance, and required n > K + 1. Secondary-model likelihood comparisons included response-transformation Jacobians on a common observed target scale. Detailed equations are provided in Supplementary Methods.')
    change_text(p[34], 'integrated using a fourth-order Runge-Kutta method with piecewise linear interpolation of environmental variables (Butcher, 2016).',
                'integrated using Simpson quadrature on a grid containing both the requested base steps and all environmental-profile breakpoints. Environmental variables were interpolated linearly within each profile segment. For the supported state-independent rate equations, this quadrature is equivalent to a fourth-order Runge–Kutta update (Butcher, 2016).')
    change_text(p[41], 'Output distributions were summarized using percentiles of final log10(N), log10 reduction, time to target, or success probability.',
                'Output distributions were summarized using percentiles of final log10(N), log10 reduction, time to target, or success probability. Reduction targets were evaluated against each iteration’s actual model value at zero treatment time, rather than against a single nominal initial count.')
    change_text(p[43], 'OAT evaluates local perturbations around the nominal operating point, whereas SRC uses standardized Monte Carlo input-output samples for regression-based screening and reports the regression R² as a diagnostic of linear approximation quality',
                'OAT evaluates local perturbations around the nominal operating point. SRC uses standardized process factors, independent primary estimation-noise inputs and sampled secondary parameters, without reusing the resulting derived primary rate as an additional predictor. Normalized squared coefficients provide relative regression-based screening contributions, not an additive explained-variance decomposition under correlated inputs. The regression R² is reported as a diagnostic of linear approximation quality')
    change_text(p[44], 'Detailed equations are provided in Supplementary Methods.',
                'For Morris and Sobol screening, environmental ranges defaulted to the calibration bounds of the bound secondary model; fixed factors were omitted. These rectangular bounds do not establish validation at every factor combination. Detailed equations and the case-study ranges are provided in Supplementary Methods.')

    change_text(p[58], 'RMSE = 0.224', f"RMSE = {by_id['T1-primary']['programRMSE']:.3f}")
    change_text(p[58], 'recalculated from the extracted data points using the log-linear model.',
                f"conditionally reconstructed from the digitized points by fixing the reported D = 60.49 min and estimating the intercept, giving RMSE = {by_id['T1-primary']['sourceRMSE']:.3f}. This reconstructed metric is not a directly reported source RMSE.")
    replace_text(p[60], f"The irradiation dataset illustrates how same-model comparison can be separated from automatic model ranking. For gamma irradiation of milk (Lima et al., 2023), the source study selected a Linear + Shoulder model for Listeria innocua and biphasic models for Salmonella Enteritidis and E. coli. MicroFit Pro reproduced the L. innocua shoulder and rate estimates closely (literature SL = 0.40, kmax = 5.09; program SL = 0.397, kmax = 5.09). Program RMSE values using √(SSE/n) were {by_id['N1-Li']['programRMSE']:.3f}, {by_id['N1-Se']['programRMSE']:.3f}, and {by_id['N1-Ec']['programRMSE']:.3f}, compared with source-reported values of 0.136, 0.125, and 0.219, respectively (Table 2). The source values were retained with their original definitions; these numerical comparisons do not establish superior fit on identical raw data. Both program biphasic fits reached f = 0.999, indicating that the digitized points provided limited support for two well-separated subpopulations.")
    replace_text(p[61], f"For photoinactivation of fresh-cut broccoli (Martínez-Hernández et al., 2015), the source study used Weibull models for E. coli, S. Enteritidis, and L. monocytogenes. Table 2 therefore compares the same model family. The source reported d, p and adjusted R², but no RMSE or AICc. Source-side RMSE values were reconstructed from reported adjusted R² and the digitized-data total sum of squares, with three total regression parameters assumed, and expressed as √(SSE/n). These are approximate reconstructions, not direct refits to the original observations. Program RMSE values were {by_id['N2-Ec']['programRMSE']:.3f}, {by_id['N2-Se']['programRMSE']:.3f}, and {by_id['N2-Lm']['programRMSE']:.3f} for N2-Ec, N2-Se, and N2-Lm. The N2-Se estimate (δ = 9.58 × 10⁻⁵ in the fluence unit, p = 0.123) was no longer clipped at the former scale bound. This small extrapolated scale remains sensitive to the sparse digitized data and should not be interpreted as an independently validated kinetic parameter.")
    change_text(p[63], 'recalculated from the extracted data points using the log-linear model reported in the source study,',
                'approximately reconstructed from reported R² and the digitized-data total sum of squares using √(SSE/n),')
    replace_text(p[65], f"For chlorine dioxide gas disinfection (Wang et al., 2016), the source study selected Weibull models using R² and MSE; Table 2 uses the same family for Bacillus subtilis subsp. niger spores (N4-Bs) and Staphylococcus albus (N4-Sa). Source RMSE values were obtained as √MSE. Program prediction RMSE values were {by_id['N4-Bs']['programRMSE']:.3f} and {by_id['N4-Sa']['programRMSE']:.3f}, compared with 0.529 and 0.173 from the source. The source metrics retain their original definitions and data scope, so the differences should be interpreted descriptively. Digitization, the limited number of observations and parameterization differences between the reported b–n form and the implemented δ–p form may affect the comparison.")
    replace_text(p[67], 'For pulsed electric field treatment, two representative survival curves from Saldaña et al. (2010) were analyzed with the source-selected Weibull family. For Listeria monocytogenes STCC 5672 (N5-Lm), the program estimates were δ = 20.2 μs, p = 0.377 and RMSE = 0.048, compared with literature d = 21.39 μs, p = 0.36 and RMSE = 0.16. For Staphylococcus aureus STCC 4459 (N5-Sa, pH 3.5), the source worksheet contains seven observations, including time = 0 μs and log10(N) = 8. The built-in sample was corrected to match these source observations. The refitted estimates were log10(N0) = 8.009, δ = 1.738 × 10⁻⁴ μs and p = 0.123, with RMSE = 0.187. The estimates no longer reached the shape boundary. An independent variable-projection reference, using linear least squares at each candidate shape and a one-dimensional shape search, agreed with this fit. Nevertheless, the local scale SE was 3.717 × 10⁻⁴ μs, exceeding the scale estimate. Because the first positive-time observation occurs at 15.3 μs, δ remains an extrapolated one-log reduction time with substantial relative uncertainty; numerical convergence does not establish its biological precision.')
    change_text(p[72], 'D70, aw=0.33 = 12.8 min', f"D70, aw=0.33 = {10**params['logDref']:.1f} min")
    change_text(p[72], 'RMSE = 0.175 and adjusted R² = 0.915', f"RMSE = {sec['rmse']:.3f} and adjusted R² = {sec['r2adj']:.3f}")
    change_text(p[80], 'solved with the fourth-order Runge-Kutta method using 500 integration steps.',
                'integrated using Simpson quadrature with 500 base intervals and explicit inclusion of profile breakpoints. For this state-independent log-linear equation, the update is equivalent to RK4.')
    replace_text(p[83], 'The T1 uncertainty scenario used 10,000 Monte Carlo iterations, seed 20260430, nominal initial log10(N0) = 7.9, a target 5-log10 reduction, and a 99% attainment criterion. Each reduction was measured from that iteration’s actual zero-time model prediction; 2.9 was therefore only the nominal endpoint. Process variability was σT = 1 °C, σaw = 0.01 and σpH = 0. The first representative T1 log-linear fit supplied primary-parameter uncertainty, and the extended Bigelow fit supplied secondary-parameter uncertainty. Full covariance sampling was available for these fitted parameter blocks; positivity transforms and process-factor bounds were applied as numerical constraints. These assumptions define an illustrative scenario rather than validated equipment variability.')
    replace_text(p[84], f"At exactly 6.0 min, {ms['successPercent']:.1f}% of the accepted iterations achieved a 5-log10 reduction ({ms['successCount']}/10,000 iterations). The 99% time-to-target was {ms['safeTimeUI']:.1f} min using the 200-point saved grid over 0–149.76 min; exact inversion of the same log-linear draws gave {ms['safeTimeExact']:.2f} min as a grid-resolution check. Changes between 5000 and 10,000 iterations in the 6-min 95th and 99th percentiles were 0.020 and 0.015 log10 units, and the grid-based 99% time-to-target was unchanged. These endpoint and time diagnostics met their stability thresholds. The final-survival tail over the full 149.76-min horizon remained exploratory, so a blanket stable designation for the entire run was not warranted. Fig. 6A displays the survival bands over the first 25 min and the draw-specific reduction distribution at 6 min. The outputs remain scenario-specific diagnostics rather than process recommendations.")
    replace_text(p[85], f"In local OAT analysis at 6 min with ±5% perturbations (Fig. 6B), process factors accounted for {ss['oat']['factorContribution']:.1f}% of normalized absolute output-change influence, secondary parameters {ss['oat']['secondaryContribution']:.1f}%, and primary parameters {ss['oat']['modelContribution']:.1f}%. Temperature and water activity were the leading local inputs. These percentages summarize local perturbation effects and are not variance fractions.")
    replace_text(p[86], f"SRC regression for final log10(N) at exactly 6 min gave R² = {ss['src']['rSquared']:.3f}, supporting a useful but incomplete linear screening approximation (Fig. 6C). Normalized squared coefficients attributed {ss['src']['secondaryContribution']:.1f}% of relative regression influence to secondary parameters, {ss['src']['factorContribution']:.1f}% to process factors and {ss['src']['modelContribution']:.1f}% to independent primary estimation-noise inputs. log10(Dref) and zaw were the leading regression inputs. These normalized contributions are not a rigorous additive explained-variance partition because fitted secondary inputs can remain correlated.")
    replace_text(p[87], f"Morris and Sobol screening used the T1 calibration bounding box of 55–70 °C and aw = 0.33–0.97, with pH fixed at 7; this box does not validate all combinations within it. Morris used 10 trajectories and four levels with seed 20260430:morris. Its normalized mean absolute effects were {ss['morris']['secondaryContribution']:.1f}% for secondary parameters, {ss['morris']['factorContribution']:.1f}% for process factors and {ss['morris']['modelContribution']:.1f}% for primary parameters, with log10(Dref) and aw leading the ranking. Sobol used 512 base samples and seed 20260430:sobol-512. Normalized total-effect estimates were {ss['sobol']['factorContribution']:.1f}% for process factors, {ss['sobol']['secondaryContribution']:.1f}% for secondary parameters and {ss['sobol']['modelContribution']:.1f}% for primary parameters. Temperature and aw had total-effect estimates of 0.701 and 0.539. The sum of estimates was {ss['sobol']['sumST']:.3f}; total effects overlap through interactions and are subject to finite-sample error, so neither their sum nor normalized percentages provide an additive first-order decomposition. No first-order indices or confidence intervals were estimated. Supplementary Figs. S1 and S2 show these screening results.")
    change_text(p[88], 'whereas SRC estimates regression-based contributions over the sampled uncertainty space',
                'whereas SRC estimates relative regression-based influence over the sampled uncertainty space')
    change_text(p[88], 'the consistent appearance of temperature and secondary-model parameters across methods',
                'the recurring importance of temperature, water activity and secondary-model parameters')
    change_text(p[95], 'scenarios.The', 'scenarios. The')
    replace_text(p[180], 'Fig. 3 Secondary-model results for T1 using the extended Bigelow model. (A) Predicted log10(D/min) surface versus temperature and water activity; red markers show observed D-values obtained from the individual primary fits, expressed on the same log scale. (B) Observed-versus-predicted D-value parity plot. The fit summary distinguishes condition-level log10(D) RMSE from linked survival-curve RMSE; AICc includes the response Jacobian on the observed D scale.')
    replace_text(p[189], 'Fig. 6 Uncertainty and sensitivity results for T1 at T = 70 °C and aw = 0.70. (A) Survival percentile bands over the first 25 min and the draw-specific 6-min reduction distribution from 10,000 iterations with seed 20260430. The dashed vertical histogram line marks the 5-log10 reduction target. (B) Local OAT normalized absolute output-change influence at ±5%. (C) Normalized squared SRC coefficients for log10(N) at 6 min, using independent primary estimation-noise inputs and fitted secondary parameters. Percentages are relative screening influence, not additive variance fractions. Morris and Sobol results appear in Supplementary Figs. S1 and S2.')

    table = doc.tables[1]
    cell_text(table.rows[0].cells[6], 'ΔRMSE\n(Prog. − Lit.)')
    for row in table.rows[1:]:
        identifier = row.cells[0].text.strip()
        result = by_id[identifier]
        pp = result['programParameters']
        if identifier == 'T1-primary': text = f"D(T = 60 °C, aw = 0.33) = {result['programD']:.1f} min"
        elif identifier == 'T1-secondary': text = f"D(T = 70 °C, aw = 0.33) = {pp['Dref']:.1f} min; zT = {pp['zT']:.1f} °C; zaw = {pp['zaw']:.3f}"
        elif identifier == 'N1-Li': text = f"SL = {pp['Sl']:.3f}; kmax = {pp['kmax']:.2f}"
        elif identifier.startswith('N1-'): text = f"f = {pp['f']:.3f}; kmax1 = {pp['kmax1']:.2f}; kmax2 = {pp['kmax2']:.2f}"
        elif identifier.startswith('N3-'): text = f"D = {result['programD']:.2f} min"
        elif identifier == 'N5-Sa': text = f"δ = {pp['delta']:.3g} μs; p = {pp['p']:.3f}; logN0 = {pp['logN0']:.3f}"
        elif identifier == 'N2-Se': text = 'δ = 9.58 × 10⁻⁵; p = 0.123'
        else: text = f"δ = {pp['delta']:.3g}; p = {pp['p']:.3f}" + ('; δ in μs' if identifier == 'N5-Lm' else '')
        cell_text(row.cells[3], text)
        for index, field in [(4, 'sourceRMSE'), (5, 'programRMSE'), (6, 'deltaRMSE')]:
            cell_text(row.cells[index], f"{result[field]:.3f}")
    replace_text(p[164], 'Note: Program RMSE uses √(SSE/n); ΔRMSE = program minus literature. Source-reported values retain their original metric definitions and data scope. T1-primary is a conditional reconstruction with reported D = 60.49 min fixed and an intercept estimated from the 13 digitized points. N2 values are approximate reconstructions from reported adjusted R² and digitized-data SST, assuming three total regression parameters; N3 values are reconstructed from reported R² and digitized-data SST. These reconstructed metrics use √(SSE/n) and are not source-reported single-curve RMSE values. For N5-Sa, the corrected seven-point fit includes the zero-time observation; the local scale SE exceeds its estimate.')
    replace_text(p[165], 'For source Weibull forms ')
    append_math(p[165], seq(log('N'), '=', log(sub('N','0')), '−b', sup('t','n')))
    p[165].add_run(', the implemented parameters satisfy ')
    append_math(p[165], seq('p=n,  δ=', sup(group(frac('1','b')), frac('1','n'))))
    p[165].add_run(', so t = δ produces a one-log10 reduction. Parameters retain the source treatment-axis unit; PEF δ is expressed in μs.')
    table = doc.tables[2]
    for i, (row, fit) in enumerate(zip(table.rows[1:], ranks)):
        values = [str(i+1), {'SHOULDER_NOTAIL':'Linear + Shoulder', 'SHOULDER_TAIL':'Shoulder + Tail',
                           'BARANYI':'Baranyi Inactivation', 'GOMPERTZ':'Modified Gompertz'}.get(fit['modelId'],
                          {'LOG_LINEAR':'Log-linear','WEIBULL':'Weibull','LOG_LINEAR_TAIL':'Log-linear + Tail',
                           'BIPHASIC':'Biphasic','WEIBULL_TAIL':'Weibull + Tail','BIPHASIC_SHOULDER':'Biphasic + Shoulder',
                           'MIXED_WEIBULL':'Mixed Weibull'}[fit['modelId']] if fit['modelId'] not in ['SHOULDER_NOTAIL','SHOULDER_TAIL','BARANYI','GOMPERTZ'] else fit['modelId']),
                  f"{fit['r2']:.4f}", f"{fit['r2adj']:.4f}", f"{fit['rmse']:.4f}", f"{fit['aicc']:.2f}"]
        for c, value in zip(row.cells, values): cell_text(c, value)
    change_text(p[166], 'shown in Fig. 2.', 'shown in Fig. 2 (n = 13). RMSE = √(SSE/n); adjusted R² uses n − k; Gaussian AICc includes the residual-variance parameter K = k + 1. All listed fits converged, but boundary estimates and local identifiability limitations remain relevant to model interpretation.')
    replace_image(doc, 2, FIG / 'figure3_secondary.png')
    replace_image(doc, 0, FIG / 'figure1_workflow.png')
    replace_image(doc, 3, FIG / 'figure4_holdout.png')
    replace_image(doc, 5, FIG / 'figure6_uncertainty.png')
    comment(doc, p[67], 'PEF fit was recalculated with physical-unit-invariant numerical scaling. The N5-Sa built-in sample now matches all seven source points, including zero time; its small extrapolated scale retains substantial local uncertainty.')
    comment(doc, p[84], 'Recomputed with seed 20260430 and draw-specific initial states. Stability is reported for the 6-min endpoint and time-to-target, with the full-horizon limitation retained.')
    comment(doc, table.rows[0].cells[1].paragraphs[0], 'All eleven candidate fits were recalculated using the current numerical definitions. Original source Word file remains intact.')
    for i, t in enumerate(doc.tables):
        total = 6.5 if i == 2 else 7.5
        old = [col.width / 914400 for col in t.columns]
        widths = ([.9,.6,1.05,1.1,.83,1.2,.95,.87] if i == 0 else
                  [.85,.65,.77,1.01,.80,.88,.85,.90,.79] if i == 3 else
                  [w * total / sum(old) for w in old])
        table_layout(t, widths, 8.5 if i == 0 else 10, (6.5 - total) / 2)
    clean_header_line_numbers(doc)
    finish_copy(doc)
    comment(doc, p[24], 'Synchronized RMSE, residual degrees of freedom and Gaussian AICc parameter counts with the corrected program. Detailed equations are in the revised Supplementary Methods.')
    doc.save(MAIN_OUT)

    supp = Document(SUPP_SOURCE)
    supplement_text = {
        '37': 'For primary models with three or more freely fitted parameters, deterministic multi-start fitting perturbed data-driven starts, with alternative fractions, shapes, rates and scales. The generic list was capped at 30; normalized-axis Weibull fitting could add one profiled shape-boundary seed alongside default or user-provided starts. The converged solution with the lowest SSE was retained, with a default-start fallback if no candidate converged. Nonconverged fits, invalid AICc (n ≤ K + 1, K = k + 1), and near-boundary estimates were flagged.',
        '95': 'The T1 sensitivity output was log10(N) at exactly 6 min. OAT used ±5% around the nominal condition; SRC used the 10,000 MC draws with seed 20260430 and independent primary estimation-noise columns rather than the derived kinetic rate. Morris used 10 trajectories, four grid levels and seed 20260430:morris. Sobol used the Jansen-style total-effect estimator with N = 512 and seed 20260430:sobol-512 (Jansen, 1999; Saltelli et al., 2010). Global factor ranges defaulted to the bounding-box intersection from the bound secondary calibration data: 55–70 °C, aw = 0.33–0.97, and fixed pH = 7. Constant factors were omitted. The rectangular range does not validate every combination. Unbound primary parameters used ±20%; secondary parameters used max(3SE,20% of the absolute nominal value), clipped to declared bounds. Sampling was independent over these screening ranges and differed from the covariance-based Gaussian MC scenario.',
        '178': 'Supplementary Fig. S1. Morris screening of log10(N) at 6 min for T1. Bars show normalized mean absolute elementary effects with 10 trajectories, four levels and seed 20260430:morris. Factor ranges are 55–70 °C and aw = 0.33–0.97; pH is fixed at 7. Primary and secondary parameter ranges are defined in Supplementary Methods. These percentages are screening influence, not variance fractions.',
        '181': f"Supplementary Fig. S2. Sobol total-effect screening of log10(N) at 6 min for T1, with N = 512 and seed 20260430:sobol-512. Bars normalize the raw total-effect estimates, whose sum is {ss['sobol']['sumST']:.3f}. The ranges match Supplementary Fig. S1. Total effects overlap through interactions and include finite-sample error; normalized bars are not additive first-order variance fractions. No first-order indices or confidence intervals were estimated."
    }
    audit = patch_supp(supp, {'supplement_text': supplement_text})
    math_font_size(supp, 0, 9)
    table_layout(supp.tables[0], [1.65, 4.35, 1.5], 9, -.75)
    table_layout(supp.tables[1], [.40, 1.10, 1.10, .62, .80, .78, 1.20, 1.50], 9.5, -.75, after=0)
    cell_text(supp.tables[1].rows[0].cells[3], 'Factors')
    cell_text(supp.tables[1].rows[0].cells[4], 'Response')
    cell_text(supp.tables[1].rows[0].cells[5], 'Transform')
    for c in supp.tables[1].rows[0].cells:
        for r in c.paragraphs[0].runs: r.font.size = Pt(9.5)
    table_layout(supp.tables[2], [1.6, 1.15, 1.8, 1.45], 10)
    replace_image(supp, 0, FIG / 'figureS1_morris.png')
    replace_image(supp, 1, FIG / 'figureS2_sobol.png')
    comment(supp, supp.paragraphs[41], 'Parameter counting and response Jacobians now match the implemented Gaussian AICc; adjusted R² uses residual df n − k.')
    comment(supp, supp.tables[0].rows[1].cells[0].paragraphs[0], 'All eleven primary formulas were checked against the implemented equations, including outer logarithms and population-mixture grouping.')
    finish_copy(supp)
    supp.save(SUPP_OUT)
    (DATA / 'document_sync_audit.json').write_text(json.dumps({'main': str(MAIN_OUT), 'supplement': str(SUPP_OUT),
        'supplement_audit': audit, 'main_tables': len(doc.tables), 'main_images': len(doc.inline_shapes),
        'supplement_tables': len(supp.tables), 'supplement_images': len(supp.inline_shapes)}, ensure_ascii=False, indent=2))
    print(MAIN_OUT); print(SUPP_OUT)


if __name__ == '__main__':
    main()
