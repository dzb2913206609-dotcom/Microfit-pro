from __future__ import annotations

import shutil
from pathlib import Path

from docx import Document
from docx.shared import Pt


ROOT = Path("/Users/dengzhengbin/Desktop/microbial-inactivation-app _副本")
DOCX = ROOT / "paper.docx"
BACKUP = ROOT / "paper_before_t1_rmse_sync.docx"


def set_paragraph_by_prefix(doc: Document, prefix: str, text: str) -> None:
    for paragraph in doc.paragraphs:
        if paragraph.text.startswith(prefix):
            paragraph.text = text
            return
    if any(paragraph.text == text for paragraph in doc.paragraphs):
        return
    raise RuntimeError(f"Paragraph not found: {prefix}")


def set_cell_text(cell, text: str) -> None:
    cell.text = text


def normalize_table_font(table, size_pt: float = 9) -> None:
    for row in table.rows:
        for cell in row.cells:
            for paragraph in cell.paragraphs:
                paragraph.paragraph_format.space_before = Pt(0)
                paragraph.paragraph_format.space_after = Pt(0)
                for run in paragraph.runs:
                    run.font.size = Pt(size_pt)


def main() -> None:
    if not BACKUP.exists():
        shutil.copy2(DOCX, BACKUP)

    doc = Document(DOCX)

    set_paragraph_by_prefix(
        doc,
        "MicroFit Pro: A Web-Based Platform for Predictive Microbial Inactivation Modeling",
        "MicroFit Pro: A Web-Based Platform for Predictive Microbial Inactivation Modelling with Cross-Technology Primary Fitting and Thermal Workflow Demonstration",
    )

    set_paragraph_by_prefix(
        doc,
        "Predictive microbiology increasingly requires workflows",
        "Predictive microbiology increasingly requires workflows that connect primary inactivation fitting, secondary modelling, dynamic prediction, uncertainty propagation, and sensitivity analysis. Yet these steps are often performed in separate tools, reducing traceability. This paper presents MicroFit Pro, an open-source, client-side browser platform for microbial inactivation modelling. The platform implements eleven primary models, 43 secondary models, dynamic simulation under compatible time-varying conditions, Monte Carlo uncertainty propagation, and OAT, SRC, Morris, and Sobol sensitivity screening. Evaluation was tiered: primary fitting was assessed using six published sample groups spanning thermal, gamma irradiation, photoinactivation, high-pressure processing, chemical disinfection, and pulsed electric field treatments; secondary modelling, Monte Carlo propagation, and sensitivity analysis were demonstrated with a thermal Salmonella Montevideo dataset in dried chili peppers; and dynamic simulation was illustrated using a literature-derived non-isothermal Listeria monocytogenes heating profile. AICc-based primary-model screening was used as a diagnostic rather than a stand-alone validation criterion. For the thermal workflow, the extended Bigelow model showed condition-level agreement within the calibrated temperature-water activity range (logD RMSE = 0.175, adjusted R² = 0.915), with linked curve-level RMSE of 0.730 across calibration survival points. Temperature control and secondary-model parameter uncertainty were important drivers under the stated assumptions. MicroFit Pro is positioned as a reproducible workflow for cross-technology primary fitting and integrated thermal demonstration, not as a fully validated predictive standard for all processing technologies.",
    )

    set_paragraph_by_prefix(
        doc,
        "Predictive performance is quantified",
        "Predictive performance is quantified using the bias factor (Bf; Ross, 1996), accuracy factor (Af), and RMSE. Following Ross (1996) and Oscar (2005), Bf values are classified into four zones: excellent fit (0.95 ≤ Bf ≤ 1.05), acceptable (0.85 ≤ Bf < 0.95 or 1.05 < Bf ≤ 1.15), conservative/fail-safe (Bf < 0.85), and fail-dangerous (Bf > 1.15). These zone labels describe the direction of the predicted quantity; when the predicted quantity is a D-value or an inactivation endpoint, the process-safety interpretation was therefore checked against lethality direction, because underpredicting D can overpredict microbial reduction.",
    )

    set_paragraph_by_prefix(
        doc,
        "For the T1 thermal sample group",
        "For the T1 thermal sample group, the source literature and MicroFit Pro both supported a log-linear description for the representative primary curve. For Salmonella Montevideo in dried chili peppers at 60 °C and aw = 0.33, the literature-reported D-value was 60.49 min, while the MicroFit Pro log-linear fit gave D = 54.2 min with RMSE = 0.224 (Table 2). The source article reported RMSE = 0.707 for the overall isothermal modified-Bigelow analysis rather than for this single representative primary curve, so the literature RMSE cell for T1-primary is left blank in Table 2. The parameter estimates are of the same order and indicate comparable first-order thermal resistance for this representative condition. The AICc-based ranking of all eleven candidate primary models for the T1 curve is reported separately in Table 3, so that Table 2 can focus on direct same-model comparison against the source literature.",
    )

    set_paragraph_by_prefix(
        doc,
        "For HPP of sterilized carrot juice",
        "For HPP of sterilized carrot juice using the Hwang et al. (2023) dataset, the source study described the pressure-holding survival curves using first-order kinetics, consistent with HPP applications in food systems (Bermúdez-Aguirre & Barbosa-Cánovas, 2011). The same log-linear model in MicroFit Pro produced D-values close to the reported values: 9.49 versus 9.55 min for Salmonella Typhimurium, 10.6 versus 10.49 min for E. coli, and 10.5 versus 11.02 min for Listeria monocytogenes (Table 2). The source article did not report RMSE or AICc for these fits, so only the program RMSE values are shown. The lower program fit quality for N3-Ec and N3-Lm relative to N3-St reflects visible scatter and limited data resolution in the extracted representative curves, rather than a change in the literature-supported first-order model form.",
    )

    set_paragraph_by_prefix(
        doc,
        "Secondary modeling of environmental effects",
        "Secondary modelling of environmental effects on inactivation parameters",
    )

    set_paragraph_by_prefix(
        doc,
        "Although secondary models are implemented",
        "Although secondary models are implemented for all six processing modes, secondary-model evaluation in this study was restricted to the T1 thermal sample group because only T1 contained multiple temperature-water activity conditions suitable for parameter-factor regression (Table 2). The N1-N5 samples were used only for primary-model fitting because the extracted sample files contained treatment-variable and microbial-count data but not the multi-condition environmental metadata needed for secondary regression. For T1, the extended Bigelow model, a multi-factor generalization of the classical Bigelow equation, was identified as the best-fit secondary model and compared with the literature-reported extended Bigelow parameters in the T1-secondary row of Table 2. The model expresses the logarithm of the D-value as a linear function of temperature and water activity deviations from reference conditions, parameterized by a reference D-value (Dref), a thermal z-value (zT), and a water-activity z-value (zaw). The fitted secondary model surface for dataset T1 is shown in Fig. 3.",
    )

    set_paragraph_by_prefix(
        doc,
        "For dataset T1 (Faliarizao et al., 2025)",
        "For dataset T1 (Faliarizao et al., 2025), the source literature reported isothermal extended Bigelow parameters of D70 = 17.61 min, zT = 24.03 °C, zaw = 0.44, and logN0 = 6.35, with an overall isothermal-model RMSE of 0.707. The MicroFit Pro secondary fit produced Dref = 12.8 min, zT = 18.5 °C, and zaw = 0.395; at the condition level, the logD RMSE was 0.175. To match the scope of the source overall RMSE more closely, the updated program workflow also computes linked curve-level RMSE by inserting the secondary-predicted D-value into each corresponding primary log-linear survival curve and comparing predicted and observed log counts across all T1 calibration points. This linked curve-level RMSE was 0.730 (n = 114; Table 2), close to the literature model-level value but not identical because the estimation workflow, digitized input data, and parameter harmonization differ from the original MATLAB nlinfit analysis. Accordingly, the result should be interpreted as agreement in model form and response direction, with strong in-sample condition-level fit for T1, not as full reproduction of every published parameter value or as evidence of predictive robustness under held-out conditions.",
    )

    set_paragraph_by_prefix(
        doc,
        "Table 2. Comparison of literature-reported model parameters",
        "Table 2. Comparison of literature-reported model parameters, MicroFit Pro parameter estimates, RMSE values, and reported fitting software for the primary and secondary model case-study datasets. Blank cells indicate metrics not reported in the source literature or not reported at the same model/curve level. For T1-primary, the source single-curve RMSE was not reported; for T1-secondary, the program RMSE is the linked curve-level log-count RMSE across the T1 calibration survival points, whereas the condition-level logD RMSE is discussed in the text.",
    )

    table = doc.tables[1]
    rows = table.rows
    set_cell_text(rows[1].cells[0], "T1-primary")
    set_cell_text(rows[1].cells[4], "")
    set_cell_text(rows[1].cells[5], "0.224")

    set_cell_text(rows[15].cells[0], "T1-secondary")
    set_cell_text(rows[15].cells[5], "0.730")
    normalize_table_font(table)

    doc.save(DOCX)


if __name__ == "__main__":
    main()
