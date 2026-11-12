from pathlib import Path
import shutil

from docx import Document


ROOT = Path("/Users/dengzhengbin/Desktop/microbial-inactivation-app _副本")
DOCX_PATH = ROOT / "paper.docx"
BACKUP_PATH = ROOT / "paper_before_body_update_for_combined_table.docx"


REPLACEMENTS = {
    "The selected datasets include different food matrices and model systems": (
        "The selected datasets include different food matrices and model systems, ranging from liquid or buffer systems to complex low-moisture foods and solid surfaces. Target microorganisms included foodborne pathogens, surrogate organisms, and resistant microbial forms relevant to microbial inactivation studies. Detailed information on target organisms, food matrices, processing technologies, treatment conditions, and the number of data points is summarized in Table 1. For studies containing multiple environmental conditions, Table 1 reports the full experimental range, whereas Table 2 compares representative organism-condition curves and the T1 secondary-model case against the model forms selected in the source literature. Raw data were obtained from published tables or supplementary materials when available; otherwise, data were digitized from published figures using WebPlotDigitizer, a plot-extraction tool whose reliability has been evaluated for extracting graphed data (Drevon et al., 2017)."
    ),
    "The demonstration strategy consisted of four evidence levels. First, primary model fitting was evaluated": (
        "The demonstration strategy consisted of four evidence levels. First, primary model fitting was evaluated by fitting all eleven candidate primary models to each representative survival curve from T1 and N1-N5. Candidate models were compared using AICc, AICc differences, Akaike weights, RMSE, adjusted R², and residual diagnostics. Residual diagnostics included the Shapiro-Wilk normality test, residual trend slope, maximum absolute residual, and a runs test for residual sign randomness. To separate direct literature comparison from automated model selection, Table 2 reports MicroFit Pro results obtained using the model form selected in each source study, whereas AICc ranking was used as a complementary diagnostic of whether the full model library favored the same or a more parsimonious alternative. The objective of this stage was to assess whether the implemented model equations could reproduce literature-supported model forms and to identify cases where additional nonlinear parameters were not well supported by the available data."
    ),
    "To evaluate the primary fitting module, six sample groups spanning six inactivation technologies were analyzed": (
        "To evaluate the primary fitting module, six sample groups spanning six inactivation technologies were analyzed (Table 1: T1 and N1-N5). The datasets encompassed thermal processing, gamma irradiation, photoinactivation, HPP, chemical disinfection, and PEF treatment. For direct comparison with the source papers, the literature-selected model for each row was fitted in MicroFit Pro and summarized in Table 2 together with literature parameter estimates, program-generated parameters, RMSE values, and the software reported in the original studies. In parallel, automatic ranking across the full eleven-model library was used as a diagnostic of whether the platform would select the same model form or a statistically simpler alternative. This distinction is important because microbial survival curves can show log-linear, shoulder, tailing, Weibull-type, or biphasic behavior rather than a single universal log-linear pattern (Geeraerd et al., 2005; Peleg & Cole, 1998; van Boekel, 2002)."
    ),
    "For the T1 thermal sample group, the log-linear model was selected": (
        "For the T1 thermal sample group, the source literature and MicroFit Pro both supported a log-linear description for the representative primary curve. For Salmonella Montevideo in dried chili peppers at 60 °C and aw = 0.33, the literature-reported D-value was 60.49 min, while the MicroFit Pro log-linear fit gave D = 54.2 min with RMSE = 0.224 (Table 2). The estimates are of the same order and indicate comparable first-order thermal resistance for this representative condition. The AICc-based ranking of all eleven candidate primary models for the T1 curve is reported separately in Table 3, so that Table 2 can focus on direct same-model comparison against the source literature."
    ),
    "The non-thermal datasets revealed more diverse curve shapes": (
        "The irradiation dataset illustrates how same-model comparison can be separated from automatic model ranking. For gamma irradiation of milk (Lima et al., 2023), the source study selected a Linear + Shoulder model for Listeria innocua and biphasic models for Salmonella Enteritidis and E. coli. Under the same model forms, MicroFit Pro reproduced the L. innocua shoulder parameter closely (literature SL = 0.40, kmax = 5.09; program SL = 0.397, kmax = 5.09) with identical rounded RMSE values (0.136; Table 2). For the biphasic rows, the E. coli fit was also close in RMSE (0.219 in the literature versus 0.221 in MicroFit Pro), whereas the S. Enteritidis program RMSE was higher (0.175 versus 0.125). In both biphasic program fits, the sensitive-fraction parameter approached the upper bound (f = 0.999), suggesting that the digitized points did not strongly support two well-separated subpopulations even though the source study selected a biphasic form."
    ),
    "For photoinactivation treatment of fresh-cut broccoli": (
        "For photoinactivation treatment of fresh-cut broccoli (Martínez-Hernández et al., 2015), the source study used the Weibull model for E. coli, S. Enteritidis, and L. monocytogenes. Therefore, Table 2 compares MicroFit Pro Weibull fits for all three organisms rather than the model forms selected by an independent AICc screen. The source article reported Weibull d and p parameters and adjusted R², but did not report RMSE or AICc; those literature metric cells are therefore left blank. MicroFit Pro generated Weibull RMSE values of 0.079, 0.243, and 0.057 for N2-Ec, N2-Se, and N2-Lm, respectively. The L. monocytogenes fit gave a stable Weibull shape (δ = 0.551, p = 0.234), whereas the E. coli and S. Enteritidis fits reached the lower scale bound (δ = 0.001), indicating that parameter-level agreement should be interpreted cautiously for those two digitized curves."
    ),
    "For HPP of sterilized carrot juice using the Hwang et al.": (
        "For HPP of sterilized carrot juice using the Hwang et al. (2023) dataset, the source study described the pressure-holding survival curves using first-order kinetics. The same log-linear model in MicroFit Pro produced D-values close to the reported values: 9.49 versus 9.55 min for Salmonella Typhimurium, 10.6 versus 10.49 min for E. coli, and 10.5 versus 11.02 min for Listeria monocytogenes (Table 2). The source article did not report RMSE or AICc for these fits, so only the program RMSE values are shown. The lower program fit quality for N3-Ec and N3-Lm relative to N3-St reflects visible scatter and limited data resolution in the extracted representative curves, rather than a change in the literature-supported first-order model form."
    ),
    "For chemical disinfection using chlorine dioxide gas": (
        "For chemical disinfection using chlorine dioxide gas (Wang et al., 2016), the source study compared first-order and Weibull descriptions and reported the Weibull model as the better fit based on higher R² and lower MSE. The comparison in Table 2 therefore uses Weibull fits for both Bacillus subtilis subsp. niger spores (N4-Bs) and Staphylococcus albus (N4-Sa). Because the source article reported MSE rather than RMSE, the literature RMSE values were obtained as the square root of MSE. MicroFit Pro produced higher RMSE values than the source study for both rows (0.638 versus 0.529 for N4-Bs; 0.685 versus 0.173 for N4-Sa). These differences likely reflect a combination of digitized data points, parameterization differences between the source Weibull form (b, n, td) and the implemented δ-p form, and the limited number of time points available for fitting."
    ),
    "For pulsed electric field treatment, two representative survival curves": (
        "For pulsed electric field treatment, two representative survival curves from Saldaña et al. (2010) were analyzed for Listeria monocytogenes STCC 5672 and Staphylococcus aureus STCC 4459 in McIlvaine buffer. The source study fitted Weibull models using Excel Solver and GraphPad Prism, and MicroFit Pro was therefore run with the Weibull model for direct comparison. For L. monocytogenes (N5-Lm), the parameter estimates and RMSE were close to the source values (literature d = 21.39, p = 0.36, RMSE = 0.16; program δ = 19.7, p = 0.375, RMSE = 0.064). For S. aureus (N5-Sa), the shape parameter was similar in magnitude, but the program scale parameter reached the lower bound (δ = 0.001) and RMSE was higher than the literature value (0.389 versus 0.18). This row should therefore be interpreted as agreement in selected model family but not as close quantitative reproduction of all fitted parameters."
    ),
    "Taken together, the primary-fitting results show that AICc-based selection": (
        "Taken together, the same-model comparisons show that MicroFit Pro can reproduce or approximate the literature-selected model family and key parameters for several representative datasets, especially the N1-Li shoulder model, the HPP first-order D-values, and the N5-Lm Weibull fit. Larger discrepancies occurred where the source software used a different Weibull parameterization, where data had to be digitized from figures, or where fitted parameters approached bounds. The AICc-based model-selection workflow remains useful as a complementary screening step, but Table 2 intentionally emphasizes direct comparison under the literature-selected model rather than replacing the source-study model choices with the platform's automatic ranking."
    ),
    "Although secondary models are implemented for all six processing modes": (
        "Although secondary models are implemented for all six processing modes, secondary-model evaluation in this study was restricted to the T1 thermal sample group because only T1 contained multiple temperature-water activity conditions suitable for parameter-factor regression (Table 2). The N1-N5 samples were used only for primary-model fitting because the extracted sample files contained treatment-variable and microbial-count data but not the multi-condition environmental metadata needed for secondary regression. For T1, the extended Bigelow model, a multi-factor generalization of the classical Bigelow equation, was identified as the best-fit secondary model and compared with the literature-reported extended Bigelow parameters in the final row of Table 2. The model expresses the logarithm of the D-value as a linear function of temperature and water activity deviations from reference conditions, parameterized by a reference D-value (Dref), a thermal z-value (zT), and a water-activity z-value (zaw). The fitted secondary model surface for dataset T1 is shown in Fig. 3."
    ),
    "For dataset T1 (Faliarizao et al., 2025), the fitted parameters were": (
        "For dataset T1 (Faliarizao et al., 2025), the source literature reported isothermal extended Bigelow parameters of D70 = 17.61 min, zT = 24.03 °C, zaw = 0.44, and logN0 = 6.35, with RMSE = 0.707. The MicroFit Pro secondary fit produced Dref = 12.8 min, zT = 18.5 °C, and zaw = 0.395, with RMSE = 0.175 (Table 2). The fitted surface reproduced the expected directional pattern of decreasing D-values with increasing temperature and water activity, matching the qualitative response trend of the source-study model. The parameter differences likely reflect differences in data extraction, harmonization, reference settings, and the available temperature-water activity combinations rather than exact replication of the original MATLAB nlinfit estimation setup. Accordingly, the result should be interpreted as agreement in model form and response direction, with strong in-sample condition-level fit for T1, not as full reproduction of every published parameter value."
    ),
}


def main():
    if not BACKUP_PATH.exists():
        shutil.copyfile(DOCX_PATH, BACKUP_PATH)
    doc = Document(DOCX_PATH)
    replaced = set()
    for paragraph in doc.paragraphs:
        text = paragraph.text
        for prefix, new_text in REPLACEMENTS.items():
            if text.startswith(prefix):
                paragraph.text = new_text
                replaced.add(prefix)
                break
    missing = [prefix for prefix in REPLACEMENTS if prefix not in replaced]
    if missing:
        raise RuntimeError(f"Did not replace {len(missing)} paragraphs: {missing}")
    doc.save(DOCX_PATH)
    print(DOCX_PATH)
    print(BACKUP_PATH)


if __name__ == "__main__":
    main()
