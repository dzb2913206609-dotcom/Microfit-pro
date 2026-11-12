#!/usr/bin/env python3
"""Rewrite the main manuscript for the T1-T5 dataset order."""
from pathlib import Path

import docx
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_COLOR_INDEX
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "dzb-7.8 MicroFit Pro正文_审稿修改版_黄色高亮.docx"
DST = ROOT / "dzb-7.8 MicroFit Pro正文_审稿修改版_黄色高亮_20261111.docx"
FIG = ROOT / "figures" / "paper_20261111"

doc = docx.Document(SRC)


def clear_paragraph(p):
    for child in list(p._p):
        if child.tag != qn("w:pPr"):
            p._p.remove(child)


def set_text(index, text, size=None, bold=None):
    p = doc.paragraphs[index]
    run = p.runs[0] if p.runs else None
    fmt = None
    if run is not None:
        fmt = {
            "size": run.font.size,
            "name": run.font.name,
            "bold": run.bold,
            "italic": run.italic,
            "color": run.font.color.rgb if run.font.color and run.font.color.rgb else None,
            "highlight": run.font.highlight_color,
        }
    clear_paragraph(p)
    new_run = p.add_run(text)
    if fmt:
        if size is None and fmt["size"] is not None:
            new_run.font.size = fmt["size"]
        if fmt["name"]:
            new_run.font.name = fmt["name"]
        if bold is None and fmt["bold"] is not None:
            new_run.bold = fmt["bold"]
        if fmt["italic"] is not None:
            new_run.italic = fmt["italic"]
        if fmt["color"] is not None:
            new_run.font.color.rgb = fmt["color"]
        if fmt["highlight"] is not None:
            new_run.font.highlight_color = fmt["highlight"]
    if size is not None:
        new_run.font.size = Pt(size)
    if bold is not None:
        new_run.bold = bold
    new_run.font.highlight_color = WD_COLOR_INDEX.YELLOW
    return p


def set_cell(cell, text, bold=False, size=8.5):
    cell.text = ""
    p = cell.paragraphs[0]
    run = p.add_run(str(text))
    run.font.size = Pt(size)
    run.bold = bold
    run.font.highlight_color = WD_COLOR_INDEX.YELLOW
    p.paragraph_format.space_after = Pt(0)
    p.paragraph_format.space_before = Pt(0)


def rebuild_table(table, rows, size=8.5, widths=None):
    for tr in list(table._tbl.tr_lst):
        table._tbl.remove(tr)
    if widths:
        table.autofit = False
        layout = OxmlElement("w:tblLayout")
        layout.set(qn("w:type"), "fixed")
        table._tbl.tblPr.append(layout)
        # Reduce horizontal cell padding so narrow numeric columns do not wrap.
        existing_margins = table._tbl.tblPr.find(qn("w:tblCellMar"))
        if existing_margins is not None:
            table._tbl.tblPr.remove(existing_margins)
        cell_margins = OxmlElement("w:tblCellMar")
        for side in ("left", "right"):
            element = OxmlElement(f"w:{side}")
            element.set(qn("w:w"), "58")
            element.set(qn("w:type"), "dxa")
            cell_margins.append(element)
        table._tbl.tblPr.append(cell_margins)
        for index, width in enumerate(widths):
            table.columns[index].width = Inches(width)
    for row_index, row in enumerate(rows):
        cells = table.add_row().cells
        for col_index, value in enumerate(row):
            set_cell(cells[col_index], value, bold=(row_index == 0), size=size)
            if widths and col_index < len(widths):
                cells[col_index].width = Inches(widths[col_index])


def replace_image(index, path, width_in=6.0):
    from PIL import Image
    shape = doc.inline_shapes[index]
    blip = shape._inline.graphic.graphicData.pic.blipFill.blip
    r_id = blip.embed
    part = doc.part.related_parts[r_id]
    part._blob = Path(path).read_bytes()
    # Some figures carry an SVG alternate (a:extLst/asvg:svgBlip). Remove it so
    # Word and LibreOffice render the replacement PNG rather than the old SVG.
    for ext_list in blip.findall(qn("a:extLst")):
        blip.remove(ext_list)
    with Image.open(path) as image:
        w, h = image.size
    shape.width = Inches(width_in)
    shape.height = Inches(width_in * h / w)


# ── Text replacements ───────────────────────────────────────────────────────
TEXT = {
    3: (
        "Predictive microbiology increasingly requires workflows that connect primary inactivation fitting, "
        "secondary modelling, dynamic prediction, uncertainty propagation, and sensitivity analysis. Yet these "
        "steps are often performed using separate tools, which can hinder workflow traceability and lead to "
        "inconsistencies in parameter transfer and reporting. This paper presents MicroFit Pro, an open-source, "
        "client-side browser platform for microbial inactivation modelling. The platform implements 11 primary "
        "models, 43 secondary models, dynamic simulation under compatible time-varying conditions, Monte Carlo "
        "uncertainty propagation, and one-at-a-time (OAT), standardized regression coefficient (SRC), Morris, and "
        "Sobol sensitivity analyses. Evaluation was tiered. Primary fitting was assessed using seven sample groups: "
        "two thermal datasets for Salmonella in whole milk powder (WMP) and nonfat dry milk (NFDM) from the corresponding author's previously published study (Wei et al., 2020), "
        "plus five published non-thermal datasets spanning gamma irradiation, photoinactivation, high-pressure "
        "processing, chemical disinfection, and pulsed electric fields. Secondary modelling, Monte Carlo "
        "propagation, and sensitivity analysis were demonstrated with the WMP dataset; independent-condition "
        "hold-out diagnostics were performed for WMP and NFDM; two literature D-value datasets for Enterococcus "
        "faecium and Salmonella in ground black pepper were used to test secondary modelling from D-values alone; "
        "and dynamic simulation was compared with 33 digitized observations from a published non-isothermal "
        "Listeria monocytogenes heating profile. AICc-based primary-model screening was used as a diagnostic rather "
        "than a stand-alone validation criterion. For the WMP workflow, the extended Bigelow model gave "
        "condition-level log10(D) RMSE = 0.023 and adjusted R² = 0.992, with linked curve-level RMSE = 0.260; the "
        "corresponding NFDM values were 0.039, 0.978, and 0.328. The black pepper fits reproduced the published "
        "D-values with RMSE = 2.57 and 2.82 min for E. faecium and Salmonella, respectively, close to the published values of "
        "2.25 and 2.30 min. Under the stated WMP "
        "scenario at 80 °C and aw = 0.20, 41.8% of Monte Carlo iterations achieved a 5-log10 reduction at 60 min and "
        "the 99% time-to-target was 89.2 min. Temperature control and secondary-model parameter uncertainty were "
        "important drivers. The dynamic comparison gave an RMSE of 0.610 log10 CFU/g against the digitized "
        "observations. MicroFit Pro is positioned as a reproducible workflow for cross-technology primary fitting "
        "and integrated thermal demonstration, not as a fully validated predictive standard for all processing "
        "technologies."
    ),
    16: (
        "For the present evaluation, T1 and T2 denote the WMP and NFDM thermal datasets used to demonstrate primary "
        "fitting and the downstream secondary-modelling, uncertainty, and sensitivity workflows; T3 and T4 denote "
        "the ground black pepper D-value datasets for E. faecium and Salmonella used for secondary modelling; T5 "
        "denotes the non-isothermal thermal dataset used for dynamic simulation; and N1-N5 denote five non-thermal "
        "datasets used for primary-model fitting. Primary-model fitting was evaluated using T1, T2 and N1-N5; "
        "secondary modelling, Monte Carlo uncertainty propagation, and sensitivity analysis were demonstrated using "
        "T1, with T2, T3 and T4 providing additional secondary-model and hold-out checks; and dynamic simulation was "
        "evaluated separately using the T5 heating profile reported by Huang (2013). Table 1 summarizes the dataset "
        "sources and their roles at each evaluation tier, whereas Fig. 1 presents the platform architecture and "
        "modular analytical workflow."
    ),
    34: (
        "Numerical convergence, model fit and parameter identifiability were interpreted separately. Low parameter "
        "sensitivity means that changing a parameter has little effect on the predicted observations; parameter "
        "confounding means that simultaneous changes in multiple parameters can compensate. The interface reports "
        "convergence status and reason, parameters near declared bounds, unavailable or very large parameter standard "
        "errors, standard errors exceeding the absolute parameter estimate, insufficient residual degrees of freedom, "
        "overfitting indicated by a large difference between R² and adjusted R², and invalid AICc when n ≤ k + 2 or "
        "residual variance is zero. Parameter tables report local standard errors and approximate 95% Wald confidence "
        "intervals. These are warning signs rather than a formal structural-identifiability, Jacobian-rank or "
        "profile-likelihood analysis. A small residual or agreement across starts does not resolve a flat or "
        "correlated parameter direction. Where information is insufficient, users should inspect the parameter table, "
        "boundary warnings and residual diagnostics; consider a simpler model or a reduced parameterization; add "
        "observations in the informative treatment range or replicate the experiment; and fix a parameter only when "
        "its value is supported independently of the fitted curve. Reference parameters such as Tref and aw,ref can be "
        "fixed and are reported separately from estimated parameters. An arbitrary fixed value does not supply missing "
        "experimental information. Fixing one member of a correlated parameter pair yields a conditional estimate of "
        "the other; its standard error is conditional on the fixed value and does not restore separate identifiability. "
        "Reparameterization or additional data that break the correlation are therefore preferable to arbitrary fixing."
    ),
    39: "For the two-factor extended Bigelow models applied to T1 and T2, the fitted relationship was:",
    41: (
        "For T1 and T2, the reference conditions were fixed at Tref = 80 °C and aw,ref = 0.20. For T3 and T4, the "
        "reference conditions were fixed at Tref = 75 °C and aw,ref = 0.45. The three free regression parameters "
        "were log10(Dref), zT and zaw; the reference conditions did not consume fitted degrees of freedom."
    ),
    49: (
        "In the present study, dynamic simulation was evaluated using the T5 sample, a published non-isothermal "
        "linear-heating scenario for Listeria monocytogenes in chicken breast meat reported by Huang (2013). The "
        "reported isothermal kinetic parameters were converted to the Bigelow form and coupled with the literature "
        "temperature program in MicroFit Pro. The numerical implementation was also verified under constant-condition "
        "scenarios by agreement with the corresponding analytical log-linear solution. Thirty-three observations "
        "digitized from Huang (2013) Fig. 3A-C were converted from seconds (s) to minutes (min) and overlaid with the "
        "simulated survival trajectory; RMSE was calculated at the corresponding observation times. Because the "
        "observations were digitized from a published figure rather than obtained from the original raw dataset, the "
        "dynamic result was interpreted as a figure-digitized external comparison for one published heating profile "
        "rather than comprehensive dynamic validation. T5 was a forward prediction using fixed literature-derived "
        "parameters, not an inverse fit to the digitized dynamic observations. Dref and zT were therefore not "
        "estimated from T5 in this study, and no new parameter SE or confidence intervals were inferred from that "
        "comparison."
    ),
    54: (
        "Output distributions were summarized using percentiles of final log10(N), log10 reduction, time to target, "
        "or success probability. Reduction targets were evaluated against each iteration’s actual model value at zero "
        "treatment time, rather than against a single nominal initial count. In MicroFit Pro, MC stability was "
        "assessed from checkpoint-based changes in upper-tail percentiles and time-to-target estimates, and the final "
        "status was reported as stable for final reporting, acceptable for screening, or exploratory tail estimate. "
        "These operational stability thresholds were used as implementation diagnostics rather than universal "
        "acceptance criteria. These outputs are scenario-specific and depend on the fitted model, assumed "
        "process-factor variability, and selected target threshold. Detailed sampling equations and stability "
        "thresholds are provided in Supplementary Methods. Checkpoint agreement within a single seeded run does not "
        "quantify between-seed variability or establish convergence of the 99.9th percentile. Repeat-run diagnostics "
        "for the T1 WMP scenario are reported in Supplementary Table S4."
    ),
    59: (
        "To evaluate the platform, seven sample groups were selected or generated, yielding seven primary-fitting "
        "groups (T1, T2 and N1-N5) and one additional dynamic-simulation sample (T5) summarized in Table 1. T1 and T2 "
        "are batch-level thermal datasets for Salmonella in whole milk powder and nonfat dry milk from the corresponding author's previously published study (Wei et al., 2020); they cover "
        "75, 80, and 85 °C across aw 0.10, 0.20, and 0.30 with three biological batches per condition. T3 and T4 are "
        "literature D-value datasets for E. faecium and Salmonella in ground black pepper and are used for secondary "
        "modelling rather than primary-curve fitting. The five published non-thermal datasets cover gamma "
        "irradiation, photoinactivation, high-pressure processing, chemical disinfection, and pulsed electric "
        "fields. The datasets span near log-linear inactivation, shoulder effects, tailing behaviour, Weibull-type "
        "curvature, and biphasic responses. This selection was intended to test whether the platform could accommodate "
        "diverse microbial inactivation patterns rather than to provide an exhaustive validation across all "
        "organisms, food matrices, or processing conditions."
    ),
    60: (
        "The selected datasets include different food matrices and model systems, ranging from liquid or buffer "
        "systems to low-moisture powders and solid spices. Target microorganisms included foodborne pathogens, "
        "surrogate organisms, and resistant microbial forms relevant to microbial inactivation studies. Detailed "
        "information on target organisms, food matrices, processing technologies, treatment conditions, and the "
        "number of data points is summarized in Table 1. For studies containing multiple environmental conditions, "
        "Table 1 reports the full experimental range, whereas Table 2 compares representative organism-condition "
        "curves and the T1/T2 secondary-model cases against the model forms selected in the source literature, and "
        "also reports the T3/T4 black pepper D-value fits. Raw data for T1 and T2 were supplied as batch-level "
        "replicate measurements; the N1-N5 and T5 data were obtained from published tables or digitized from "
        "published figures using WebPlotDigitizer, a plot-extraction tool whose reliability has been evaluated for "
        "extracting graphed data (Drevon et al., 2017)."
    ),
    61: (
        "The demonstration strategy consisted of four evidence levels. First, primary model fitting was evaluated by "
        "fitting all 11 candidate primary models to each representative survival curve from T1, T2 and N1-N5. "
        "Candidate models were compared using AICc, AICc differences, Akaike weights, RMSE, adjusted R², and residual "
        "diagnostics. Residual diagnostics included the Shapiro-Wilk normality test, residual trend slope, maximum "
        "absolute residual, and a runs test for residual sign randomness. To separate direct literature comparison "
        "from automated model selection, Table 2 reports MicroFit Pro results obtained using the model form selected "
        "in each source study, whereas AICc ranking was used as a complementary diagnostic of whether the full model "
        "library favoured the same or a more parsimonious alternative. The objective of this stage was to assess "
        "whether the implemented model equations could reproduce literature-supported model forms and to identify "
        "cases where additional nonlinear parameters were not well supported by the available data."
    ),
    62: (
        "Second, secondary model fitting was evaluated for datasets containing multiple environmental conditions "
        "suitable for parameter-factor regression. T1 and T2 provided nine temperature-aw survival conditions each, "
        "and T3 and T4 provided 27 replicate D-values each across three temperatures and three aw levels. The fitted "
        "secondary models were assessed using goodness-of-fit statistics, factor-response visualization, and "
        "observed-versus-predicted parity plots. A single-condition hold-out prediction diagnostic was performed for "
        "T1 and T2 by withholding the 80 °C, aw = 0.20 condition from calibration, re-fitting the secondary model "
        "using the remaining eight conditions, and predicting the held-out condition. Parameter-level diagnostics "
        "compared the independently fitted held-out D-value with the secondary-model-predicted D-value, whereas "
        "conditional curve-level diagnostics retained the fitted initial count from the held-out curve and "
        "propagated the predicted D-value through the primary model. These diagnostics were treated as bias-direction "
        "and workflow checks rather than pass-fail external validation."
    ),
    63: (
        "Third, dynamic simulation was evaluated using the T5 literature-derived non-isothermal thermal process "
        "profile from Huang (2013). The numerical solver was verified under constant-condition scenarios by comparing "
        "the integrated dynamic prediction with the corresponding analytical log-linear solution. The dynamic case "
        "study therefore demonstrates implementation under a published time-varying heating profile and provides a "
        "direct comparison with 33 digitized observations from Huang (2013) Fig. 3A-C, while still remaining a single "
        "figure-digitized external comparison rather than full raw-data validation."
    ),
    64: (
        "Fourth, Monte Carlo uncertainty propagation and sensitivity analysis were demonstrated using the same "
        "representative T1 WMP thermal dataset. The revised MC workflow used covariance-aware parameter sampling when "
        "the covariance matrix was positive definite, process-factor perturbation, explicit reporting of "
        "covariance-sampling mode, and stability diagnostics for upper-tail percentiles and time-to-target estimates. "
        "Sensitivity analysis was evaluated using four complementary methods: local one-at-a-time analysis, "
        "standardized regression coefficients, Morris elementary-effects screening, and Sobol total-effect indices. "
        "These analyses were used to identify whether prediction uncertainty was primarily associated with "
        "process-control variability, primary-model parameter uncertainty, or secondary-model fitting uncertainty "
        "under the specified T1 assumptions."
    ),
    67: (
        "The results are organized by evidence level. Primary-model fitting was evaluated across the seven "
        "primary-fitting sample groups T1, T2 and N1-N5. Secondary modelling, Monte Carlo propagation, and "
        "sensitivity analysis were demonstrated for the T1 WMP dataset, with T2 NFDM providing an independent "
        "secondary-model and hold-out check and T3/T4 extending secondary modelling to literature D-values, whereas "
        "dynamic simulation was compared with digitized observations from the T5 literature-derived non-isothermal "
        "heating profile reported by Huang (2013). Accordingly, cross-technology conclusions are restricted to "
        "primary fitting; the T1/T2 downstream outputs are interpreted as scenario-specific workflow demonstrations, "
        "and the T5 result is interpreted as a single figure-digitized dynamic comparison rather than a broadly "
        "validated process recommendation."
    ),
    69: (
        "To evaluate the primary fitting module, seven sample groups spanning thermal processing and five non-thermal "
        "technologies were analyzed (Table 1: T1, T2 and N1-N5). The datasets encompassed thermal processing of two "
        "milk powders plus gamma irradiation, photoinactivation, HPP, chemical disinfection, and PEF treatment. For "
        "direct comparison with the source papers, the literature-selected model for each row was fitted in MicroFit "
        "Pro and summarized in Table 2 together with literature parameter estimates, program-generated parameters, "
        "RMSE values, and the software reported in the original studies. In parallel, AICc ranking across the 11 "
        "implemented primary models was retained as a screening diagnostic to illustrate how the platform identifies "
        "the preferred or simpler adequate curve form for a representative dataset. This distinction is important "
        "because microbial survival curves can show log-linear, shoulder, tailing, Weibull-type, or biphasic "
        "behaviour rather than a single universal log-linear pattern (Geeraerd et al., 2005; Peleg & Cole, 1998; van "
        "Boekel, 2002)."
    ),
    71: (
        "For the T1 WMP sample group, the representative WMP 75 °C, aw = 0.10 curve was described by the log-linear "
        "model (D = 41.01 min, RMSE = 0.174, R² = 0.989; literature D = 41.10 min, RMSE = 0.17). The AICc ranking "
        "favoured the log-linear form (AICc = −55.28) over Weibull (AICc = −52.28) and Linear + Shoulder (AICc = "
        "−52.30) alternatives, supporting the first-order description for this curve (Table 3). Across all nine WMP "
        "conditions, log-linear fits gave D-values of 3.56–41.01 min, consistent with the published range of "
        "3.56–41.10 min. For T2 NFDM, the representative 75 °C, aw = 0.10 curve gave D = 40.49 min (RMSE = 0.288, "
        "R² = 0.982; literature 40.58 min), while the AICc ranking slightly favoured Weibull (AICc = −45.58) over "
        "Linear + Shoulder (AICc = −43.17) and log-linear (AICc = −37.12); the log-linear fit nevertheless remained "
        "adequate (R² = 0.982). Across all nine NFDM conditions, log-linear D-values ranged from 3.95 to 40.49 min, "
        "compared with 3.64–40.58 min in the source table. The two milk powders therefore showed comparable thermal "
        "resistance, consistent with the source study’s conclusion that fat content did not significantly affect "
        "inactivation."
    ),
    81: (
        "Taken together, the same-model comparisons show that MicroFit Pro can reproduce or approximate the "
        "literature-selected model family and key parameters for several representative datasets, especially the T1 "
        "and T2 milk-powder thermal fits, the N1-Li shoulder model, the HPP first-order D-values, and the N5-Lm "
        "Weibull fit. Larger discrepancies occurred where the source software used a different Weibull "
        "parameterization, where data had to be digitized from figures, or where fitted parameters approached bounds. "
        "The AICc-based model-selection workflow remains useful as a complementary screening step, but Table 2 "
        "intentionally emphasizes direct comparison under the literature-selected model rather than replacing the "
        "source-study model choices with the platform’s automatic ranking."
    ),
    84: (
        "Although secondary models are implemented for all six processing modes, secondary-model evaluation in this "
        "study focused on T1-T4 because these datasets contained multiple temperature-water activity conditions "
        "suitable for parameter-factor regression. T1 and T2 each contained nine temperature-aw survival conditions, "
        "enabling the extended Bigelow model to be fitted to D-values obtained from the individual primary fits. T3 "
        "and T4 contained 27 replicate D-values each for E. faecium and Salmonella in ground black pepper across three "
        "temperatures and three aw levels; these datasets entered the secondary workflow directly as literature "
        "D-values. The N1-N5 samples were used only for primary-model fitting because the extracted sample files "
        "contained treatment-variable and microbial-count data but not the multi-condition environmental metadata "
        "needed for secondary regression. For T1 and T2, the extended Bigelow model, a multi-factor generalization of "
        "the classical Bigelow equation, was used to describe the logarithm of the D-value as a linear function of "
        "temperature and water activity deviations from reference conditions, parameterized by a reference D-value "
        "(Dref), a thermal z-value (zT), and a water-activity z-value (zaw). The fitted surfaces for T1 and T2 are "
        "shown in Fig. 3, and the corresponding fits for T3 and T4 are shown in Fig. 4."
    ),
    85: (
        "For T1 WMP, the extended Bigelow fit with Tref = 80 °C and aw,ref = 0.20 gave D(80 °C, aw = 0.20) = "
        "12.40 min, zT = 16.18 °C, and zaw = 0.486; the condition-level log10(D) RMSE was 0.023 and adjusted R² was "
        "0.992. For T2 NFDM, the corresponding fit gave D(80 °C, aw = 0.20) = 12.57 min, zT = 15.48 °C, and "
        "zaw = 0.562, with log10(D) RMSE = 0.039 and adjusted R² = 0.978. Converted to the source reference point "
        "(Tref = 75.7 °C, aw,ref = 0.12), the fitted Dref values were 33.39 min for T1 and 33.07 min for T2, compared "
        "with 32.58 min reported by Wei et al. (2020); zT and zaw were 16.18 °C and 0.486 for T1 and 15.48 °C and "
        "0.562 for T2, compared with 16.65 °C and 0.47 in the source. The linked curve-level RMSE, obtained by "
        "propagating the predicted D-value through each primary log-linear curve, was 0.260 for T1 (n = 162) and "
        "0.328 for T2 (n = 162). The fitted surfaces reproduced the expected decrease in D with increasing "
        "temperature and aw (Fig. 3). For T3 E. faecium in ground black pepper, the fit gave Dref = 15.34 min, "
        "zT = 12.71 °C, and zaw = 0.315, with a D-value RMSE of 2.57 min and adjusted R² = 0.975. For T4 Salmonella, "
        "the corresponding values were Dref = 8.49 min, zT = 12.79 °C, zaw = 0.299, D-value RMSE = 2.82 min, and "
        "adjusted R² = 0.979. These values are close to the published modified Bigelow parameters (T3: Dref = "
        "14.9 min, zT = 13.5 °C, zaw = 0.31, RMSE = 2.25 min; T4: Dref = 8.94 min, zT = 13.9 °C, zaw = 0.30, "
        "RMSE = 2.30 min)."
    ),
    86: (
        "An independent linear least-squares reference was used to check the T1 and T2 calculations on identical "
        "inputs. The primary log-linear curve has the closed-form representation u = a + bt, with kmax = −b ln(10) "
        "and D = −1/b. The extended Bigelow regression is linear in log10(Dref), −1/zT and −1/zaw. For T1, these "
        "references gave primary D = 41.009 min and RMSE = 0.174, and secondary Dref = 12.40 min, zT = 16.18 °C, "
        "zaw = 0.486, and log10(D) RMSE = 0.0229; for T2, primary D = 40.494 min and RMSE = 0.288, and secondary "
        "Dref = 12.57 min, zT = 15.48 °C, zaw = 0.562, and log10(D) RMSE = 0.0386. They agreed with the iterative "
        "implementation to the reported precision. This verifies the least-squares computations but does not "
        "establish equivalence to the original source data or identify nonlinear models globally."
    ),
    87: (
        "These results demonstrate that, when multiple environmental conditions are available, the platform can "
        "transfer primary-model parameters into a secondary-model workflow. The secondary parameters provide the "
        "mathematical bridge required for cross-condition interpolation within the calibrated temperature-water "
        "activity range. Although the T1 and T2 secondary fits were strong within the available condition-level data, "
        "the Monte Carlo and sensitivity examples based on the T1 model are still interpreted as demonstrations of "
        "software coupling and uncertainty propagation rather than externally validated process-design predictions. "
        "Dynamic simulation was evaluated separately using the T5 non-isothermal heating profile described below."
    ),
    88: (
        "The high adjusted R² of the T1 and T2 secondary models indicates that temperature and water activity "
        "captured most of the condition-level D-value variation in both milk powders. This is consistent with "
        "low-moisture thermal inactivation studies showing strong dependence of Salmonella thermal resistance on "
        "temperature and water activity (Couvert et al., 2005; den Besten et al., 2006; Smith et al., 2016; Wei et "
        "al., 2020). Nevertheless, residual variation may still reflect strain history, matrix composition, "
        "physiological state, and experimental handling. Thus, the secondary model is most defensible as an "
        "interpolation tool within the calibrated factor range rather than as a universal thermal-resistance "
        "equation or validated process-schedule model."
    ),
    90: (
        "The fitted extended Bigelow models were visualized as contour maps, three-dimensional response surfaces, and "
        "observed-versus-predicted parity plots. For T1 and T2, the contour surfaces showed a monotonic decrease in "
        "D-values with increasing temperature and water activity, consistent with the expected thermal resistance "
        "pattern for Salmonella in low-moisture dairy powders (Smith et al., 2016; Wei et al., 2020). For T3 and T4, "
        "the surfaces showed the same direction of effect in ground black pepper (Fig. 4)."
    ),
    92: (
        "To provide an initial assessment of out-of-sample predictive performance, a single-condition hold-out "
        "prediction diagnostic was conducted for T1 and T2, with the 80 °C, aw = 0.20 condition excluded from "
        "secondary-model calibration in each case. The extended Bigelow model was re-fitted using the remaining eight "
        "conditions and used to predict the held-out condition. At the parameter level, the T1 held-out D-value was "
        "12.11 min (observed) versus 12.43 min (predicted), giving Bf = Af = 1.027 and log10(D) RMSE = 0.011 "
        "(Fig. 5A). For T2, the observed and predicted D-values were 10.46 and 12.86 min, giving Bf = Af = 1.230 and "
        "log10(D) RMSE = 0.090 (Fig. 5C). At the curve level, retaining the fitted initial count from each held-out "
        "curve gave Bf = 1.131, Af = 1.410, and RMSE = 0.177 log10 units for T1 (n = 6; Fig. 5B), and Bf = Af = 2.799 "
        "and RMSE = 0.567 log10 units for T2 (n = 6; Fig. 5D). The T1 result indicates good parameter-level and "
        "moderate curve-level agreement; the T2 result indicates a larger overprediction of thermal resistance when "
        "the central condition is withheld. These diagnostics are bias-direction and workflow checks rather than "
        "pass-fail external validation."
    ),
    94: (
        "To evaluate the dynamic simulation capability of the platform under an external non-isothermal condition, "
        "the T5 linear-heating experiment of Huang (2013) for Listeria monocytogenes in chicken breast meat was "
        "reproduced as a dynamic simulation scenario. The reported isothermal thermal-resistance parameters, "
        "log10(D0) = 14.03 and zT = 4.95 °C, were converted to the Bigelow form using Tref = 60 °C, giving Dref = "
        "81.1 s (1.35 min). The process profile was defined as a linear temperature increase from 30 to 65 °C over "
        "28 min, corresponding to a heating rate of 1.25 °C/min, with aw = 1 and pH = 7 entered as constant profile "
        "variables. A log-linear primary model was coupled to the literature-parameterized temperature-dependent "
        "D-value model, and the resulting inactivation ODE was integrated using Simpson quadrature with 500 base "
        "intervals and explicit inclusion of profile breakpoints. For this state-independent log-linear equation, "
        "the update is equivalent to RK4. Thirty-three observed survival points were digitized from Huang (2013) "
        "Fig. 3A-C, converted from seconds to minutes, and compared with MicroFit Pro predictions at the same time "
        "points."
    ),
    95: (
        "For the unit conversion, log10[D(T)/s] = 14.03 − T/4.95 gives Dref = 10^(14.03 − 60/4.95) s, which is "
        "divided by 60 for a solver using minutes. Dref and zT were fixed inputs, and aw and pH were constant profile "
        "descriptors rather than separately estimated resistance effects in this T5 calculation. Consequently, "
        "Fig. 7 assesses a conditional survival trajectory and does not report dynamically fitted parameter "
        "confidence intervals."
    ),
    96: (
        "Fig. 7 presents the updated dynamic simulation output for the T5 non-isothermal heating scenario with the "
        "digitized Huang (2013) observations overlaid. Predicted survival remained almost unchanged during the early "
        "low-temperature portion of the profile, then declined rapidly as the temperature approached the upper end of "
        "the 30–65 °C linear ramp. The cumulative F-value rose slowly at first and then increased sharply near the end "
        "of heating, reaching approximately 17.60 min at Tref = 60 °C. Against the 33 digitized observations from "
        "Fig. 3A-C of Huang (2013), the MicroFit Pro prediction gave an RMSE of 0.610 log10 CFU/g. This agreement "
        "supports the implemented dynamic-simulation workflow for this published profile, while the comparison "
        "remains limited by figure-digitization uncertainty and by the fact that only one external dynamic heating "
        "profile was evaluated."
    ),
    98: (
        "The T1 WMP uncertainty scenario used 10,000 Monte Carlo iterations, seed 20260430, nominal initial "
        "log10(N0) = 7.5, a target 5-log10 reduction, and a 99% attainment criterion, evaluated at 60 min under "
        "nominal conditions of 80 °C, aw = 0.20, and pH = 7. Each reduction was measured from that iteration’s "
        "actual zero-time model prediction. Process variability was σT = 1 °C, σaw = 0.01 and σpH = 0. The "
        "representative T1 log-linear fit supplied primary-parameter uncertainty, and the extended Bigelow fit "
        "supplied secondary-parameter uncertainty. Full covariance sampling was available for these fitted "
        "parameter blocks; positive kinetic parameters were constrained through the sampling transformations. "
        "Process factors were sampled from the stated normal distributions, and draws producing invalid model "
        "predictions were rejected. These assumptions define an illustrative scenario rather than validated "
        "equipment variability."
    ),
    99: (
        "At exactly 60.0 min, 41.8% of the accepted iterations achieved a 5-log10 reduction (4183/10,000 iterations). "
        "The 99% time-to-target was 89.2 min using the 200-point saved grid over 0–120 min; exact inversion of the "
        "same log-linear draws gave 89.21 min as a grid-resolution check. The 99% time-to-target changed from 88.6 to "
        "89.2 min between the 3000- and 10,000-iteration checkpoints and was unchanged between 5000 and 10,000 "
        "iterations. These endpoint and time diagnostics met their operational stability thresholds. The "
        "final-survival tail over the full 120-min horizon remained exploratory, so a blanket stable designation for "
        "the entire run was not warranted. Fig. 6A displays the survival bands, and Fig. 6B shows the draw-specific "
        "reduction distribution at 60 min. The outputs remain scenario-specific diagnostics rather than process "
        "recommendations."
    ),
    100: (
        "To assess repeatability, the same fitted T1 scenario was run with 20 seed strings (review-20261111-01 "
        "through review-20261111-20) at each of 10,000 and 50,000 requested iterations. Across seeds, the 60-min "
        "success probability was 41.70 ± 0.51% and 41.76 ± 0.26% (mean ± between-seed SD; ranges 40.69–42.90% and "
        "41.41–42.44%). Exact log-linear inversion gave 99% target-time values of 89.298 ± 0.519 min and "
        "89.164 ± 0.209 min, compared with 100.305 ± 1.697 min and 100.596 ± 0.765 min at 99.9% (Supplementary "
        "Table S4). Target times used 5 ln(10)/kmax and the ceil(qN)th ordered accepted value, so saved-grid "
        "rounding does not confound sampling variability. These SDs quantify numerical repeatability, not "
        "biological confidence intervals. The greater variability of the extreme tail supports checking sample "
        "size and seed sensitivity for the requested percentile rather than assigning a universal adequacy "
        "threshold of 10,000 iterations."
    ),
    101: (
        "In local OAT analysis at 60 min with ±5% perturbations (Fig. 6C), process factors accounted for 76.1% of "
        "normalized absolute output-change influence (temperature 70.5%, aw 5.6%), secondary parameters 14.8%, and "
        "primary parameters 9.1%. Temperature and water activity were the leading local inputs. These percentages "
        "summarize local perturbation effects and are not variance fractions."
    ),
    102: (
        "SRC regression for final log10(N) at exactly 60 min gave R² = 0.987, supporting a strong linear screening "
        "approximation (Fig. 6D). Normalized squared coefficients attributed 94.1% of relative regression influence "
        "to process factors (temperature 84.9%, aw 9.2%), 2.0% to secondary parameters, and 3.9% to independent "
        "primary estimation-noise inputs. Temperature and aw were the leading regression inputs. These normalized "
        "contributions are not a rigorous additive explained-variance partition because fitted secondary inputs can "
        "remain correlated."
    ),
    103: (
        "Morris and Sobol screening used the T1 calibration bounding box of 75–85 °C and aw = 0.10–0.30, with pH "
        "fixed at 7; this box does not validate all combinations within it. Morris used 10 trajectories and four "
        "levels with seed 20260430:morris. Its normalized mean absolute effects were 49.6% for process factors, 39.2% "
        "for secondary parameters and 11.3% for primary parameters, with temperature and log10(Dref) leading the "
        "ranking. Sobol used 512 base samples and seed 20260430:sobol-512. Normalized total-effect estimates were "
        "71.3% for process factors, 23.3% for secondary parameters and 5.4% for primary parameters. Temperature and "
        "aw had total-effect estimates of 0.592 and 0.254. The sum of estimates was 1.188; total effects overlap "
        "through interactions and are subject to finite-sample error, so neither their sum nor normalized percentages "
        "provide an additive first-order decomposition. First-order estimates were more sample-sensitive, so a "
        "separate N=8192 stability run was used: S1 was 0.423 for temperature, 0.196 for aw, 0.209 for log10(Dref) "
        "and 0.060 for log10(N0); the corresponding ST values were 0.513, 0.245, 0.263 and 0.059, with ΣS1 = 0.888 "
        "and ΣST = 1.095. The N=512 values above are therefore treated as screening estimates. Bootstrap confidence "
        "intervals are not implemented, and S1 is reported as an exploratory main-effect share. Supplementary "
        "Figs. S1 and S2 and Supplementary Table S7 show these results."
    ),
    104: (
        "The divergence among OAT, SRC, Morris, and Sobol rankings is methodologically informative rather than "
        "contradictory. OAT evaluates local perturbations around the nominal operating condition, whereas SRC "
        "estimates relative regression-based influence over the sampled uncertainty space and is reliable only when "
        "the input-output relationship is sufficiently linear. Morris screening is designed to detect influential "
        "factors under nonlinear or interaction-prone settings, while Sobol total-effect indices quantify both main "
        "and interaction effects at higher computational cost (Hamby, 1994; Saltelli, 2008; Saltelli et al., 2004; "
        "Sobol′, 2001). In this context, temperature was the consistently dominant input, whereas the relative "
        "importance of water activity and secondary-model parameters varied with method: OAT and Morris assigned "
        "more weight to secondary parameters, whereas SRC and Sobol emphasized process factors. These differences "
        "reflect method-specific assumptions and interaction effects. For applied decisions, these rankings should "
        "be interpreted together with the model-fit diagnostics and user-specified process-variability assumptions "
        "rather than as universal importance rankings."
    ),
    111: (
        "Several limitations should be considered when interpreting the present evaluation. Although MicroFit Pro "
        "integrates multiple modelling workflows, the complete secondary-modelling, uncertainty propagation, "
        "sensitivity analysis, and dynamic simulation framework was demonstrated using a limited number of "
        "representative case studies (T1-T5). Consequently, the results should be interpreted as evidence of "
        "implementation feasibility rather than comprehensive external validation across all processing "
        "technologies. In addition, uncertainty associated with the black pepper D-values and the N1-N5 digitized "
        "datasets was not independently quantified; the T1 and T2 milk-powder data were supplied as batch-level "
        "replicate measurements, but the primary and secondary fits remain conditional on the experimental design. "
        "The current implementation relies on an unweighted nonlinear least-squares framework assuming approximately "
        "homoscedastic Gaussian errors; therefore, heteroscedasticity, left-censoring of log-count observations below "
        "detection limits, correlated repeated measurements, and structural uncertainty arising from alternative "
        "model formulations are not explicitly addressed. Furthermore, the dynamic evaluation was based on a single "
        "literature-derived heating profile reconstructed from figure-digitized observations, since the original raw "
        "data were unavailable. Future studies should expand validation using independently generated datasets "
        "encompassing additional microorganisms, food matrices, processing technologies, and dynamic processing "
        "scenarios. The uncertainty and sensitivity results should also be treated as scenario-specific. The T1 MC "
        "workflow propagated fitted-parameter uncertainty and user-specified process variability, but not structural "
        "uncertainty from alternative secondary-model forms or residual model misspecification; the assumed values "
        "σT = 1 °C, σaw = 0.01, and σpH = 0 define a demonstration scenario rather than a validated processing "
        "standard. OAT, SRC, Morris, and Sobol analyses provide complementary views of input importance, but rankings "
        "depend on the selected output metric, perturbation range, uncertainty assumptions, and model nonlinearity. "
        "In addition, MicroFit Pro currently uses a transparent two-step estimation strategy and client-side "
        "computation; future versions could add optional one-step or Bayesian estimation modes and further optimize "
        "browser performance for large datasets, high Monte Carlo iteration counts, and computationally intensive "
        "Sobol analyses. In particular, a small point-wise RMSE does not remove uncertainty in fitted parameters or "
        "input measurements. Residual normality tests do not establish equal variance or independence. The reported "
        "Monte Carlo distributions are conditional on the stated local parameter approximation and process-factor "
        "distributions, and may understate total predictive uncertainty when these assumptions fail. First-order "
        "Sobol indices and resampling-based confidence intervals are not implemented in this version, so total-effect "
        "indices cannot separate main effects from interactions. Client-side execution is an implementation choice, "
        "not a mathematical restriction preventing bootstrap, global estimation or Bayesian computation; such "
        "extensions require explicit algorithms and performance evaluation."
    ),
    114: (
        "The evaluation was intentionally tiered. Primary fitting was demonstrated using two thermal datasets from the corresponding author's previously published study (Wei et al., 2020) "
        "and five published non-thermal datasets, whereas the complete secondary-modelling, uncertainty, and "
        "sensitivity workflow was demonstrated using the T1 WMP thermal dataset, with T2 NFDM providing an "
        "independent thermal check and T3/T4 extending secondary modelling to literature D-values; dynamic "
        "simulation was compared with digitized observations from the T5 literature-derived non-isothermal heating "
        "profile. In relation to the study objectives, the work therefore establishes the implemented model and "
        "algorithm library, demonstrates cross-technology primary fitting, shows the linked T1/T2 secondary-modelling "
        "and uncertainty workflow, compares compatible dynamic simulation with digitized T5 observations, and "
        "positions the platform relative to existing tools. Thus, MicroFit Pro provides an integrated and reproducible "
        "framework for microbial inactivation modelling, combining primary and secondary modelling, dynamic "
        "simulation, uncertainty propagation and sensitivity analysis within a single browser-based platform. Future "
        "work should focus on expanding independent validation datasets, incorporating optional Bayesian and one-step "
        "estimation strategies, and extending support for additional predictive microbiology applications."
    ),
    116: (
        "The current web interface of MicroFit Pro is available at https://microfit.online. Routine analyses run in "
        "the user’s browser without requiring server-side upload of user data. The manuscript case-study inputs "
        "T1-T5 and N1-N5 are included as built-in examples; Table 1 identifies their literature sources. The T1 and "
        "T2 milk-powder data are supplied as batch-level replicate measurements; the black pepper D-values and the "
        "N1-N5/T5 inputs are literature-derived or figure-digitized reconstructions rather than original experimental "
        "records. The source code is licensed under the MIT license. Numerical settings and random seeds for the T1 "
        "analyses are specified in the Methods and Supplementary Table S4."
    ),
}

for index, text in TEXT.items():
    set_text(index, text)

# Table and figure captions
set_text(
    176,
    "Table 1. Summary of case-study datasets used for platform evaluation. Seven primary-fitting sample groups "
    "(T1, T2 and N1-N5), two black-pepper D-value datasets (T3 and T4), and one additional dynamic-simulation "
    "sample (T5) were used to evaluate the analytical capabilities of MicroFit Pro.",
)
set_text(
    179,
    "Table 2. Comparison of literature-reported model parameters, MicroFit Pro parameter estimates, RMSE values, "
    "and reported fitting software for the primary and secondary model case-study datasets. Blank cells indicate "
    "metrics not reported in the source literature or not reported at the same model/curve level. Primary rows "
    "report RMSE in log10 units; secondary rows report D-value RMSE in minutes. Literature Dref values for T1 and "
    "T2 are converted to Tref = 80 °C and aw = 0.20 for comparison with the program fits.",
)
set_text(
    180,
    "Note: Program RMSE uses √(SSE/n); ΔRMSE = program minus literature. Source-reported values retain their "
    "original metric definitions and data scope. T1-primary and T2-primary use the representative 75 °C, aw = 0.10 "
    "curves and all 18 batch-level observations. T1/T2-secondary condition-level log10(D) RMSE values are 0.023 and "
    "0.039, respectively; the table reports the corresponding D-value RMSE in minutes to match the source metric. "
    "N2 values are approximate reconstructions from reported adjusted R² and digitized-data SST, assuming three "
    "total regression parameters; N3 values are reconstructed from reported R² and digitized-data SST. These "
    "reconstructed metrics use √(SSE/n) and are not source-reported single-curve RMSE values. For N5-Sa, the "
    "15 kV/cm, pH 7.0 curve was used; the source reports d = 259.8 μs, p = 0.57 and RMSE = 0.08. Applying the "
    "source parameters to the six digitized observations gives RMSE = 0.087. The 35 kV/cm, pH 3.5 row was not "
    "used because its reported parameters predict substantially less inactivation than the plotted observations.",
)
set_text(
    182,
    "Table 3. AICc-based candidate primary-model ranking for the representative T1 WMP survival curve shown in "
    "Fig. 2A (75 °C, aw = 0.10; n = 18). RMSE = √(SSE/n); adjusted R² uses n − k; Gaussian AICc includes the "
    "residual-variance parameter K = k + 1. All listed fits converged, but boundary estimates and local "
    "identifiability limitations remain relevant to model interpretation.",
)
set_text(
    189,
    "Fig. 1 System architecture and modular workflow of MicroFit Pro. The platform comprises three core sequential "
    "modules—primary model fitting, secondary model fitting, and dynamic simulation—connected by automated parameter "
    "transfer, augmented by two cross-cutting modules for uncertainty propagation and sensitivity analysis.",
)
set_text(
    193,
    "Fig. 2 Primary-model fitting for the representative T1 whole milk powder (WMP) and T2 nonfat dry milk (NFDM) "
    "survival curves at 75 °C and water activity (aw) = 0.10. Symbols show individual batch observations, error bars show the mean ± "
    "standard deviation (SD), and lines show the log-linear fit. (A) T1 WMP; (B) T2 NFDM. The corresponding "
    "corrected Akaike information criterion (AICc)-based ranking of the 11 candidate primary models for T1 is "
    "reported in Table 3.",
)
set_text(
    196,
    "Fig. 3 Secondary-model results for T1 WMP and T2 NFDM using the extended Bigelow model. (A, B) Predicted "
    "log10(D/min) surfaces versus temperature and water activity; markers show observed D-values from the individual "
    "primary fits. (C, D) Observed-versus-predicted D-value parity plots. The fit summary distinguishes "
    "condition-level log10(D) root mean square error (RMSE) from linked survival-curve RMSE.",
)
set_text(
    199,
    "Fig. 4 Secondary-model results for T3 Enterococcus faecium (E. faecium) and T4 Salmonella in ground black "
    "pepper using the extended Bigelow model. (A, B) Predicted log10(D/min) surfaces versus temperature and water "
    "activity; markers show the 27 replicate D-values. (C, D) Observed-versus-predicted D-value parity plots.",
)
set_text(
    202,
    "Fig. 5 Independent-condition hold-out prediction diagnostics for T1 WMP and T2 NFDM. The held-out condition was "
    "80 °C and aw = 0.20. (A, C) Parameter-level comparison between the independently fitted observed D-value and "
    "the secondary-model-predicted D-value. (B, D) Conditional curve-level comparisons in which the fitted initial "
    "count from each held-out curve was retained and the predicted D-value was propagated through the primary "
    "log-linear model."
)
set_text(
    205,
    "Fig. 6 Uncertainty and sensitivity results for T1 WMP at 80 °C and aw = 0.20. (A) Survival percentile bands "
    "from 10,000 iterations with seed 20260430. (B) Draw-specific 60-min reduction distribution; the dashed vertical "
    "line marks the 5-log10 reduction target. (C) Local one-at-a-time (OAT) normalized absolute output-change "
    "influence at ±5%. (D) Normalized squared standardized regression coefficients (SRC) for log10(N) at 60 min, "
    "using independent primary estimation-noise inputs and fitted secondary parameters. Percentages are relative "
    "screening influence, not additive variance fractions. Morris and Sobol results appear in Supplementary "
    "Figs. S1 and S2."
)

# ── Tables ──────────────────────────────────────────────────────────────────
table1_rows = [
    ["Evaluation level", "ID", "Reference", "Microorganism", "Matrix / system", "Tech.", "Curve / condition", "Purpose"],
    ["Primary, secondary, MC, and sensitivity workflow demonstration", "T1", "Wei et al., 2020", "Salmonella (5-strain cocktail)", "Whole milk powder (WMP)", "Thermal", "Isothermal; 75/80/85 °C; aw 0.10/0.20/0.30; three batches", "Primary fitting and T1 demonstration of secondary modelling, Monte Carlo uncertainty propagation, sensitivity analysis, and hold-out prediction"],
    ["Primary, secondary, and hold-out demonstration", "T2", "Wei et al., 2020", "Salmonella (5-strain cocktail)", "Nonfat dry milk (NFDM)", "Thermal", "Isothermal; 75/80/85 °C; aw 0.10/0.20/0.30; three batches", "Independent thermal check of primary fitting, secondary modelling, and hold-out prediction"],
    ["Secondary D-value modelling", "T3", "Wei et al., 2021", "Enterococcus faecium NRRL B-2354", "Ground black pepper", "Thermal", "Isothermal; 65–85 °C; aw 0.25/0.45/0.65; 27 replicate D-values", "Secondary-model fitting from literature D-values"],
    ["Secondary D-value modelling", "T4", "Wei et al., 2021", "Salmonella (5-serotype cocktail)", "Ground black pepper", "Thermal", "Isothermal; 65–85 °C; aw 0.25/0.45/0.65; 27 replicate D-values", "Secondary-model fitting from literature D-values"],
    ["Dynamic simulation comparison", "T5", "Huang, 2013", "Listeria monocytogenes", "Chicken breast meat", "Thermal", "Non-isothermal linear heating; 30–65 °C over 28 min; aw = 1; pH = 7", "Dynamic comparison using literature Bigelow parameters and 33 digitized observations (RMSE = 0.610 log10 CFU/g)"],
    ["Primary model evaluation", "N1", "Lima et al., 2023", "Listeria innocua / Salmonella Enteritidis / Escherichia coli", "Milk", "Irradiation (gamma)", "Dose-response (N1-Li, N1-Se, N1-Ec)", "Demonstration of irradiation module at the primary-model fitting level"],
    ["Primary model evaluation", "N2", "Martínez-Hernández et al., 2015", "Escherichia coli / Salmonella Enteritidis / Listeria monocytogenes", "Fresh-cut broccoli", "Photoinactivation", "Non-linear fluence-response (N2-Ec, N2-Se, N2-Lm)", "Demonstration of light-disinfection module at the primary-model fitting level"],
    ["Primary model evaluation", "N3", "Hwang et al., 2023", "Salmonella Typhimurium / Escherichia coli / Listeria monocytogenes", "Sterilized carrot juice", "HPP", "Pressure-holding curves (N3-St, N3-Ec, N3-Lm)", "Demonstration of HPP module at the primary-model fitting level"],
    ["Primary model evaluation", "N4", "Wang et al., 2016", "Bacillus subtilis subsp. niger spores / Staphylococcus albus", "Paper coupon / enclosed chamber", "Chemical disinfection", "Concentration/exposure-response (N4-Bs, N4-Sa)", "Demonstration of chemical-disinfection module at the primary-model fitting level"],
    ["Primary model evaluation", "N5", "Saldaña et al., 2010", "Listeria monocytogenes STCC 5672 / Staphylococcus aureus STCC 4459", "McIlvaine buffer, pH 3.5–7.0, 0.10 ± 0.01 S/m", "Pulsed electric fields", "Weibull-type PEF curves (N5-Lm, N5-Sa)", "Demonstration of PEF module at the primary-model fitting level"],
]
rebuild_table(doc.tables[0], table1_rows, size=7.5, widths=[0.85, 0.5, 0.75, 1.0, 0.9, 0.65, 0.95, 0.9])

table2_rows = [
    ["Dataset", "Literature model", "Literature parameters", "Program parameters", "Lit. RMSE", "Prog. RMSE", "ΔRMSE (Prog. − Lit.)", "Reported software"],
    ["T1-primary", "Log-linear", "D(75 °C, aw = 0.10) = 41.10 min", "D = 41.01 min", "0.17", "0.174", "+0.004", "MATLAB nlinfit; SAS 9.4 for statistical analysis"],
    ["T2-primary", "Log-linear", "D(75 °C, aw = 0.10) = 40.58 min", "D = 40.49 min", "0.28", "0.288", "+0.008", "MATLAB nlinfit; SAS 9.4 for statistical analysis"],
    ["T1-secondary", "Extended Bigelow", "Dref(80 °C, aw = 0.20) = 12.14 min; zT = 16.65 °C; zaw = 0.47", "Dref = 12.40 min; zT = 16.18 °C; zaw = 0.486", "1.47 min", "0.99 min", "−0.48 min", "MATLAB nlinfit (Wei et al., 2020)"],
    ["T2-secondary", "Extended Bigelow", "Dref(80 °C, aw = 0.20) = 12.14 min; zT = 16.65 °C; zaw = 0.47", "Dref = 12.57 min; zT = 15.48 °C; zaw = 0.562", "1.47 min", "0.97 min", "−0.50 min", "MATLAB nlinfit (Wei et al., 2020)"],
    ["T3-secondary", "Extended Bigelow", "Dref(75 °C, aw = 0.45) = 14.9 min; zT = 13.5 °C; zaw = 0.31", "Dref = 15.34 min; zT = 12.71 °C; zaw = 0.315", "2.25 min", "2.57 min", "+0.32 min", "MATLAB nlinfit (Wei et al., 2021)"],
    ["T4-secondary", "Extended Bigelow", "Dref(75 °C, aw = 0.45) = 8.94 min; zT = 13.9 °C; zaw = 0.30", "Dref = 8.49 min; zT = 12.79 °C; zaw = 0.299", "2.30 min", "2.82 min", "+0.52 min", "MATLAB nlinfit (Wei et al., 2021)"],
    ["N1-Li", "Linear + Shoulder", "SL = 0.40; kmax = 5.09", "SL = 0.397; kmax = 5.09", "0.136", "0.103", "−0.033", "GInaFiT"],
    ["N1-Se", "Biphasic", "f = 0.99; kmax1 = 4.51; kmax2 = 0.03", "f = 0.999; kmax1 = 4.63; kmax2 = 1.44", "0.125", "0.115", "−0.010", "GInaFiT"],
    ["N1-Ec", "Biphasic", "f = 0.99; kmax1 = 6.29; kmax2 = 1.24", "f = 0.999; kmax1 = 6.30; kmax2 = 1.35", "0.219", "0.145", "−0.074", "GInaFiT"],
    ["N2-Ec", "Weibull", "d = 1.07; p = 0.07", "δ = 0.0409; p = 0.102", "0.089", "0.014", "−0.075", "GInaFiT v1.6 for Microsoft Excel"],
    ["N2-Se", "Weibull", "d = 0.02; p = 0.18", "δ = 9.58 × 10⁻⁵; p = 0.123", "0.099", "0.035", "−0.064", "GInaFiT v1.6 for Microsoft Excel"],
    ["N2-Lm", "Weibull", "d = 9.26; p = 0.28", "δ = 0.945; p = 0.268", "0.050", "0.040", "−0.010", "GInaFiT v1.6 for Microsoft Excel"],
    ["N3-St", "Log-linear", "D = 9.55 min", "D = 9.49 min", "0.107", "0.094", "−0.014", "SPSS v12.0 for statistical analysis; fitting software not specified"],
    ["N3-Ec", "Log-linear", "D = 10.49 min", "D = 10.57 min", "0.230", "0.238", "+0.009", "SPSS v12.0 for statistical analysis; fitting software not specified"],
    ["N3-Lm", "Log-linear", "D = 11.02 min", "D = 10.51 min", "0.281", "0.291", "+0.010", "SPSS v12.0 for statistical analysis; fitting software not specified"],
    ["N4-Bs", "Weibull", "b = 0.0068; n = 1.54; td = 25.50 min", "δ = 23.4; p = 1.468", "0.529", "0.451", "−0.078", "OriginPro v8.5.0 for curve fitting; SAS 9.1.3 for statistical analysis"],
    ["N4-Sa", "Weibull", "b = 0.67; n = 0.52; td = 2.16 min", "δ = 2.17; p = 0.520", "0.173", "0.164", "−0.009", "OriginPro v8.5.0 for curve fitting; SAS 9.1.3 for statistical analysis"],
    ["N5-Lm", "Weibull", "d = 21.39; p = 0.36", "δ = 20.2; p = 0.377; δ in μs", "0.160", "0.048", "−0.112", "Excel 2007 Solver and GraphPad Prism for Weibull fitting; Statgraphics Plus 5.1 for secondary regression"],
    ["N5-Sa", "Weibull", "d = 259.8; p = 0.57", "δ = 290.1 μs; p = 0.665; logN0 = 7.912", "0.080", "0.074", "−0.006", "Excel 2007 Solver and GraphPad Prism for Weibull fitting; Statgraphics Plus 5.1 for secondary regression"],
]
rebuild_table(doc.tables[1], table2_rows, size=7.2, widths=[0.85, 0.8, 1.0, 1.0, 0.6, 0.6, 0.6, 1.05])

table3_rows = [["Rank", "Model", "R²", "Adj. R²", "RMSE", "AICc"]]
import pandas as pd
ranking = pd.read_csv(ROOT / "reports" / "paper_sync_20261111" / "t1_table3_primary_ranking.csv")
for _, row in ranking.iterrows():
    table3_rows.append([
        str(int(row["rank"])),
        row["model"],
        f"{row['r2']:.4f}",
        f"{row['r2adj']:.4f}",
        f"{row['rmse']:.4f}",
        f"{row['aicc']:.2f}",
    ])
rebuild_table(doc.tables[2], table3_rows, size=8.8, widths=[0.55, 1.15, 0.85, 0.85, 0.85, 0.85])

# ── Figures ─────────────────────────────────────────────────────────────────
replace_image(1, FIG / "Fig2_primary_T1_T2.png")
replace_image(2, FIG / "Fig3_secondary_T1_T2.png")
replace_image(3, FIG / "Fig4_secondary_T3_T4.png")
replace_image(4, FIG / "Fig5_holdout_T1_T2.png")
replace_image(5, FIG / "Fig6_mc_sensitivity_T1.png")

# Append Fig. 7 (dynamic simulation) after Fig. 6 caption
fig7_para = doc.add_paragraph()
fig7_run = fig7_para.add_run()
fig7_run.add_picture(str(FIG / "Fig7_dynamic_T5.png"), width=Inches(6.0))
fig7_caption = doc.add_paragraph(style="Body Text")
fig7_run = fig7_caption.add_run(
    "Fig. 7 Dynamic simulation of Listeria monocytogenes in chicken breast meat under the T5 literature-derived "
    "non-isothermal linear-heating profile from Huang (2013). The process temperature increased from 30 to 65 °C "
    "over 28 min (1.25 °C/min), with aw = 1 and pH = 7. (A) Linear heating profile. (B) MicroFit Pro survival "
    "prediction, cumulative F-value, and 33 digitized observations from Huang (2013) Fig. 3. The prediction gave "
    "RMSE = 0.610 log10 colony-forming units (CFU) g−1 against the digitized observations."
)
fig7_run.font.highlight_color = WD_COLOR_INDEX.YELLOW

# ── References ──────────────────────────────────────────────────────────────
# Remove the Faliarizao (2025) reference, which is no longer cited.
for p in list(doc.paragraphs):
    if p.text.strip().startswith("Faliarizao, N. T."):
        p._element.getparent().remove(p._element)
        break

whiting = next(p for p in doc.paragraphs if p.text.strip().startswith("Whiting, R. C."))
wei2020 = whiting.insert_paragraph_before(style="Bibliography")
wei2020_run = wei2020.add_run(
    "Wei, X., Lau, S. K., Chaves, B. D., Danao, M.-G. C., Agarwal, S., & Subbiah, J. (2020). Effect of water "
    "activity on the thermal inactivation kinetics of Salmonella in milk powders. Journal of Dairy Science, 103(8), "
    "6904–6917. https://doi.org/10.3168/jds.2020-18298"
)
wei2020_run.font.highlight_color = WD_COLOR_INDEX.YELLOW
wei2021 = whiting.insert_paragraph_before(style="Bibliography")
wei2021_run = wei2021.add_run(
    "Wei, X., Vasquez, S., Thippareddi, H., & Subbiah, J. (2021). Evaluation of Enterococcus faecium NRRL B-2354 as "
    "a surrogate for Salmonella in ground black pepper at different water activities. International Journal of Food "
    "Microbiology, 344, 109114. https://doi.org/10.1016/j.ijfoodmicro.2021.109114"
)

doc.save(DST)
print("saved", DST)
