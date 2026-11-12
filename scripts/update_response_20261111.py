#!/usr/bin/env python3
"""Synchronize the point-by-point reviewer response with the T1-T5 revision."""
from pathlib import Path

import docx
from docx.enum.text import WD_COLOR_INDEX
from docx.oxml.ns import qn

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "MicroFit Pro_审稿逐点回复_含行号_待补项黄色标记.docx"
DST = ROOT / "MicroFit Pro_审稿逐点回复_含行号_待补项黄色标记_20261111.docx"

doc = docx.Document(SRC)


def clear_paragraph(p):
    for child in list(p._p):
        if child.tag != qn("w:pPr"):
            p._p.remove(child)


def set_text(index, text):
    p = doc.paragraphs[index]
    run = p.runs[0] if p.runs else None
    fmt = None
    if run is not None:
        fmt = {
            "size": run.font.size,
            "name": run.font.name,
            "bold": run.bold,
            "italic": run.italic,
            "highlight": run.font.highlight_color,
        }
    clear_paragraph(p)
    new_run = p.add_run(text)
    if fmt:
        if fmt["size"] is not None:
            new_run.font.size = fmt["size"]
        if fmt["name"]:
            new_run.font.name = fmt["name"]
        if fmt["bold"] is not None:
            new_run.bold = fmt["bold"]
        if fmt["italic"] is not None:
            new_run.italic = fmt["italic"]
        if fmt["highlight"] is not None:
            new_run.font.highlight_color = fmt["highlight"]
    new_run.font.highlight_color = WD_COLOR_INDEX.YELLOW


TEXT = {
    15: (
        "Thank you for raising this important point. We agree that parameter identifiability is not determined by the "
        "number of parameters alone; it depends on the model structure and on the information contained in the "
        "observations. The Huang (2009) example is a useful illustration of a multi-parameter dynamic model in which "
        "several parameter combinations can describe the same observations. We have revised the Methods to separate "
        "numerical convergence, goodness of fit and parameter identifiability. A small residual is compatible with "
        "weakly determined parameters, especially when the treatment range is narrow or an initial count is not "
        "observed."
    ),
    16: (
        "We should also clarify the scope of the T5 example. MicroFit Pro does not estimate Dref or z from the T5 "
        "dynamic observations. Both are fixed from the Huang (2013) isothermal data and used for a forward "
        "prediction. The T5 calculation therefore does not estimate the multi-parameter dynamic model discussed in "
        "the comment and is not presented as a dynamic parameter-estimation exercise. The revised Methods, Results "
        "and Fig. 7 caption state this explicitly."
    ),
    17: (
        "Revised locations: Main manuscript, lines 202–222 (Methods, parameter estimation and identifiability), "
        "305–319 (Methods, T5 dynamic simulation), 661–690 (Results, T5 dynamic simulation), 799–837 "
        "(Limitations), and 1138–1143 (Fig. 7 caption); Supplementary Material, lines 123–141; revised User Guide, "
        "FAQ."
    ),
    4: (
        "All locations below refer to the yellow-highlighted revised main manuscript and Supplementary Material dated "
        "11 November 2026. Because the manuscript was reorganized to the T1-T5 dataset order, section references are "
        "used together with stable line numbers from the latest PDF render. Reviewer-supplied line numbers inside "
        "comments refer to the earlier submission."
    ),
    29: (
        "Thank you for pointing out this ambiguity. We did not estimate Dref or z from the T5 dynamic observations. "
        "Figure 7 compares a forward prediction with digitized observations; the prediction curve was not fitted to "
        "those observations. The previous phrase “fitted temperature-dependent D-value model” could imply dynamic "
        "parameter estimation. We have revised the Methods, Results and Fig. 7 caption to make the calculation and "
        "parameter source explicit."
    ),
    30: (
        "The fixed inputs were obtained from the isothermal relationship reported by Huang (2013): "
        "log10[D(T)/s] = 14.03 − T/4.95, where T is expressed in °C. Rewriting this relationship in Bigelow form at "
        "Tref = 60 °C gives Dref = 10^(14.03 − 60/4.95) s = approximately 81.1 s (1.35 min) and z = zT = 4.95 °C. "
        "These values were supplied to the log-linear inactivation model for the temperature profile increasing "
        "linearly from 30 to 65 °C over 28 min. The fourth-order Runge–Kutta method numerically integrates the "
        "resulting differential equation for the specified inputs; it does not estimate Dref or z."
    ),
    31: (
        "Accordingly, no parameter standard errors or 95% confidence intervals were estimated from T5. Treating the "
        "inputs as fixed for this calculation does not imply that their source estimates have zero uncertainty. The "
        "RMSE of 0.610 log10 CFU/g against 33 digitized observations describes prediction agreement conditional on "
        "these inputs, rather than the precision of dynamically estimated parameters. The revised text now states: "
        "“T5 was a forward prediction using fixed literature-derived parameters, not an inverse fit to the digitized "
        "dynamic observations.”"
    ),
    32: (
        "Revised locations: Main manuscript, lines 305–319 (Methods, dynamic simulation), 661–690 (Results, T5 "
        "dynamic simulation), and 1138–1143 (Fig. 7 caption)."
    ),
    45: (
        "We agree that independent experimental validation is important. The revised manuscript now includes "
        "batch-level survival data for T1 (whole milk powder) and T2 (nonfat dry milk) from the corresponding "
        "author's previously published study (Wei et al., 2020); these data were not digitized. T3 and T4 are "
        "literature D-value datasets, and N1-N5 and T5 remain literature-derived or figure-digitized. We have "
        "revised the Abstract, evaluation description and limitations to distinguish the raw-data thermal examples "
        "from the digitized non-thermal and dynamic examples. A new independent linear least-squares calculation "
        "on the T1 and T2 inputs agreed with the program implementation and with the previously published values, "
        "providing an independent validation of the numerical workflow against published experimental data."
    ),
    47: (
        "The concern about independent experimental validation is addressed for the thermal workflow by the T1/T2 "
        "milk-powder data from the corresponding author's previously published study (Wei et al., 2020), which "
        "include three biological batches per condition. The program results agreed with the published values, "
        "providing an independent check against published experimental data."
    ),
    48: (
        "Revised locations: revised main manuscript, Abstract, Methods (case-study datasets) and Limitations; "
        "Table 1 and Table 2 notes."
    ),
    49: (
        "AUTHOR ACTION REQUIRED: Add a quantitative digitization-error analysis for the remaining digitized datasets "
        "(N1-N5 and T5), or restrict the corresponding claims. The new T1/T2 raw-data analyses should be described "
        "with their actual data source, results and revised section references."
    ),
    57: (
        "The original T1 dataset referenced in this comment has been removed from the revised manuscript. The thermal "
        "secondary examples are now T1 (WMP) and T2 (NFDM), both based on batch-level data from the corresponding author's previously published study (Wei et al., 2020). With "
        "Tref = 80 °C and aw,ref = 0.20, the extended Bigelow fits gave Dref = 12.40 min, zT = 16.18 °C, and "
        "zaw = 0.486 for T1, and Dref = 12.57 min, zT = 15.48 °C, and zaw = 0.562 for T2. Converted to the source "
        "reference point (Tref = 75.7 °C, aw,ref = 0.12), the T1 and T2 Dref values were 33.39 and 33.07 min, "
        "compared with 32.58 min reported by Wei et al. (2020); the corresponding zT and zaw values were 16.18 °C / "
        "0.486 and 15.48 °C / 0.562, compared with 16.65 °C / 0.47. These values are close to the source and remove "
        "the large discrepancy associated with the former T1 dataset. The N5-Sa example has been revised to the "
        "15 kV/cm, pH 7.0 curve, as described below."
    ),
    59: (
        "We have also clarified statistical bookkeeping. RMSE uses sqrt(SSE/n), adjusted R² uses residual degrees of "
        "freedom n − k, and Gaussian AICc counts K = k + 1, including residual variance. AICc is reported only when "
        "n > K + 1 and the compared models use a valid likelihood on the same observations and response scale; "
        "transformed secondary responses include the response Jacobian. The T1/T2 linear references and the new N5-Sa "
        "scalar-profile check verify those specific least-squares calculations. An independent optimizer benchmark for "
        "the remaining nonlinear boundary cases has not yet been completed."
    ),
    60: (
        "Revised locations: revised main manuscript, Methods (parameter estimation and model evaluation), Results "
        "(T1/T2 thermal fitting and N5-Sa); Supplementary Material, Supplementary Methods."
    ),
    61: (
        "AUTHOR ACTION REQUIRED: Complete an independent nonlinear-solver check for the remaining problematic boundary "
        "curves, and document the model, bounds, starts, objective values and identifiability assessment. The T1/T2 "
        "linear checks and the corrected N5-Sa variable-projection check do not verify every nonlinear model."
    ),
    71: (
        "We agree that implementing a model library does not establish that the complete downstream workflow has been "
        "validated for every processing technology. We have chosen to narrow the claims. The title identifies "
        "cross-technology primary fitting and thermal workflow demonstration. The Abstract and objectives distinguish "
        "primary fitting across thermal and non-thermal examples from the T1/T2 thermal secondary, uncertainty and "
        "sensitivity demonstration and the T5 thermal dynamic comparison. T3/T4 extend secondary modelling to "
        "literature D-values for ground black pepper but do not constitute a full non-thermal downstream validation."
    ),
    72: (
        "The limitations now state that the evidence supports implementation feasibility rather than comprehensive "
        "external validation across all processing technologies. We have not added non-thermal secondary or dynamic "
        "datasets in this revision, and no such validation is claimed. The revised scope also avoids presenting "
        "MicroFit Pro as a replacement for specialized global-fitting, Bayesian or full QMRA tools."
    ),
    73: (
        "Revised locations: revised main manuscript, Abstract, Introduction (scope), Results (T1-T5) and Limitations."
    ),
    95: (
        "To quantify seed and sample-size sensitivity for the reported T1 WMP scenario, we added 20 independent seed "
        "labels at each of 10,000 and 50,000 requested draws (40 runs in total). The 60-min success probability was "
        "41.70% (between-seed SD 0.51 percentage points) and 41.76% (SD 0.26 percentage points), respectively. "
        "Exact-inversion 99% target-time SDs were 0.519 and 0.209 min; 99.9% target-time SDs were 1.697 and "
        "0.765 min. Table S4 reports means and ranges as well as SDs. Rejected draws are excluded from the success "
        "denominator. These results show the larger variability of the extreme tail for this scenario; they do not "
        "establish a universally adequate sample count or biological safety."
    ),
    97: (
        "Revised locations: revised main manuscript, Methods (Monte Carlo and sensitivity analysis), Results (T1 "
        "uncertainty and sensitivity), and Fig. 6; Supplementary Material, Supplementary Methods, Table S4 and "
        "Figs. S1-S2."
    ),
    118: (
        "The revised Table 2 note also separates source-reported metrics from approximate reconstructions. T1-primary "
        "and T2-primary now use the 75 °C, aw = 0.10 curves from the corresponding author's previously published study (Wei et al., 2020) with all 18 batch-level observations; "
        "they are not digitized reconstructions. N2 RMSE values are reconstructed approximately from reported "
        "adjusted R² and digitized-data SST assuming three total regression parameters; N3 values are reconstructed "
        "from reported R² and digitized-data SST. These reconstructed RMSEs use denominator n. They are not directly "
        "reported single-curve RMSE values from the original studies."
    ),
    119: (
        "We further clarify that ΔRMSE means program minus literature, that source-reported quantities retain their "
        "original data scope and definitions, and that the T1/T2 secondary condition-level log10(D) RMSE differs from "
        "the linked survival-count RMSE. Differences between these descriptive comparisons are not proof of superior "
        "predictive performance."
    ),
    120: (
        "Revised locations: revised main manuscript, Methods (RMSE definitions), Table 2 and its note; Supplementary "
        "Material, Supplementary Methods."
    ),
    125: (
        "We have added a repeat-run analysis with seed labels review-20261111-01 through review-20261111-20, each "
        "used at 10,000 and 50,000 requested draws under the same T1 WMP fitted model and uncertainty assumptions. At "
        "10,000 draws, the 60-min success probability was 41.70% with between-seed SD 0.51 percentage points (range "
        "40.69–42.90%); at 50,000 draws it was 41.76% with SD 0.26 percentage points (range 41.41–42.44%)."
    ),
    126: (
        "The 99% target time was 89.298 ± 0.519 min and 89.164 ± 0.209 min, respectively (mean ± between-seed SD). "
        "At 99.9%, the corresponding values were 100.305 ± 1.697 min and 100.596 ± 0.765 min. Target times in this "
        "additional check use exact log-linear inversion, 5 ln(10)/kmax, and the ceil(qN)th ordered accepted value, "
        "so that saved-grid rounding does not confound sampling variability. These SDs quantify numerical "
        "repeatability, not biological confidence intervals."
    ),
    127: (
        "We also updated the single-seed result: 4183/10,000 = 41.8% at 60 min, with a grid-based 99% target time of "
        "89.2 min and 89.21 min from exact inversion of the same draws. The new table supports scenario-specific "
        "checks of the requested percentile; it does not certify universal extreme-tail convergence."
    ),
    128: (
        "Revised locations: revised main manuscript, Results (T1 uncertainty); Supplementary Material, Table S4 and "
        "its notes."
    ),
    133: (
        "Figures 3, 4 and 6 have been replaced with scientific plots generated from the recomputed results. Figure 3 "
        "shows the T1/T2 extended Bigelow response surfaces and observed-versus-predicted D-value parity plots. "
        "Figure 4 shows the corresponding T3/T4 ground-black-pepper fits. Figure 6 shows survival percentile bands, "
        "the 60-min reduction distribution, OAT influence and SRC screening results, with readable axes and legends. "
        "High-resolution raster images are embedded in the Word manuscript."
    ),
    135: (
        "Revised locations: revised main manuscript, Fig. 3, Fig. 4 and Fig. 6 captions."
    ),
    142: (
        "Revised locations: revised main manuscript, Software and data availability."
    ),
}

for index, text in TEXT.items():
    set_text(index, text)

# Add the diagnostic/guidance paragraph between the scope clarification and the location line.
new_paragraph = doc.paragraphs[17].insert_paragraph_before(style="Normal")
new_run = new_paragraph.add_run(
    "For users who fit models, the program reports convergence status and reason, parameters near declared bounds, "
    "unavailable or very large standard errors, standard errors exceeding the absolute parameter estimate, "
    "insufficient residual degrees of freedom, overfitting indicated by R² − adjusted R², and invalid AICc when "
    "n ≤ k+2 or residual variance is zero. Parameter tables report local standard errors and 95% Wald confidence "
    "intervals. The program does not perform a formal structural-identifiability, Jacobian-rank or "
    "profile-likelihood analysis, and it does not automatically select a parameter to hold constant. Where these "
    "warnings occur, the revised User Guide and manuscript recommend: (i) inspect the parameter table, boundary "
    "warnings and residual diagnostics; (ii) consider a simpler model or a reduced parameterization; (iii) add "
    "observations in the informative treatment range or replicate the experiment; and (iv) fix a parameter only "
    "when its value is supported independently of the fitted curve. Reference parameters such as Tref and aw,ref "
    "can be fixed and are reported separately from estimated parameters. Arbitrary fixing merely to obtain "
    "convergence is not recommended because it does not restore the missing experimental information."
)
new_run.font.highlight_color = WD_COLOR_INDEX.YELLOW

# Rebuild the R3.2 response by locating the section, because the R3.1 insertion
# shifts absolute paragraph indices.
paras = doc.paragraphs
r32_start = next(i for i, p in enumerate(paras) if p.text.strip().startswith("R3.2."))
r32_response = next(i for i in range(r32_start, len(paras)) if paras[i].text.strip() == "Response")
r32_location = next(i for i in range(r32_response, len(paras)) if paras[i].text.strip().startswith("Revised locations:"))
set_text(r32_response + 1, (
    "We agree that these are two distinct cases. In the first, the model is locally insensitive to one or more "
    "parameters: the corresponding Jacobian columns are small, so the data provide little information and the local "
    "standard errors become large or indeterminate. In the second, individually sensitive parameters compensate one "
    "another: the Jacobian columns are nearly linearly dependent, so the information matrix is ill-conditioned even "
    "when each parameter has an appreciable marginal effect. Both can produce large standard errors and unreliable "
    "confidence intervals, but they require different remedies."
))
set_text(r32_response + 2, (
    "MicroFit Pro does not automatically classify a fit into one of these cases or recommend a specific parameter "
    "to hold constant. It reports the observable consequences: convergence status and reason, parameters near "
    "declared bounds, unavailable or very large standard errors, standard errors exceeding the absolute parameter "
    "estimate, insufficient residual degrees of freedom, overfitting indicated by R² − adjusted R², and invalid AICc "
    "when n ≤ k+2 or residual variance is zero. Parameter tables report local standard errors and approximate 95% "
    "Wald confidence intervals. The covariance matrix is used internally for Monte Carlo propagation, but the current "
    "interface does not present a formal collinearity diagnostic such as a condition number, variance inflation "
    "factor, Jacobian rank or profile likelihood. These are therefore screening warnings, not a "
    "structural-identifiability test. Deterministic multi-start fitting can reduce dependence on starting values, "
    "but it cannot create information in a flat or nearly dependent parameter direction."
))
set_text(r32_location, (
    "Revised locations: Main manuscript, lines 202–222 (Methods, parameter estimation and identifiability); "
    "Supplementary Material, lines 123–141; revised User Guide, FAQ."
))
r32_paragraph = doc.paragraphs[r32_location].insert_paragraph_before(style="Normal")
r32_run = r32_paragraph.add_run(
    "Where such warnings occur, the revised User Guide and manuscript recommend the following. For the "
    "low-sensitivity case, add observations in the treatment range where the parameter has an effect, or choose a "
    "simpler model or reduced parameterization. For the correlated case, reparameterize the model (for example, "
    "estimate a ratio or a combined effect), collect data that breaks the correlation, or fix one parameter only "
    "when an independent estimate is available. Fixing one member of a correlated pair yields a conditional "
    "estimate of the other; the reported standard error and confidence interval are conditional on the fixed value "
    "and do not restore separate identifiability of the original pair. Arbitrary fixing merely to obtain "
    "convergence is not recommended. Reference parameters such as Tref and aw,ref can be fixed and are reported "
    "separately; primary model parameters are not given a generic 'fix parameter 3' control in the current version."
)
r32_run.font.highlight_color = WD_COLOR_INDEX.YELLOW

# Update the R3.3 heading now that the section has been shifted.
r33_heading = next(
    i for i, p in enumerate(doc.paragraphs)
    if p.text.strip().startswith("R3.3. T2 dynamic prediction")
)
set_text(r33_heading, "R3.3. T5 dynamic prediction and parameter confidence intervals")

doc.save(DST)
print("saved", DST)
