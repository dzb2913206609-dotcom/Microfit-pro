from pathlib import Path
from shutil import copy2

from docx import Document
from docx.oxml import OxmlElement


ROOT = Path("/Users/dengzhengbin/Desktop/microbial-inactivation-app _副本")
DOCX = ROOT / "paper.docx"
BACKUP = ROOT / "paper_before_existing_tools_body_expansion.docx"


def insert_paragraph_after(paragraph, text="", style=None):
    new_p = OxmlElement("w:p")
    paragraph._p.addnext(new_p)
    new_para = paragraph._parent.add_paragraph()
    new_para._p = new_p
    if style is not None:
        new_para.style = style
    if text:
        new_para.add_run(text)
    return new_para


def replace_paragraph_with_block(document, marker, new_paragraphs):
    paragraphs = document.paragraphs
    for para in paragraphs:
        if marker in para.text:
            style = para.style
            para.text = new_paragraphs[0]
            anchor = para
            for text in new_paragraphs[1:]:
                anchor = insert_paragraph_after(anchor, text, style=style)
            return True
    return False


def add_reference_after(document, after_prefix, new_reference, skip_terms):
    for para in document.paragraphs:
        if any(term in para.text for term in skip_terms):
            return False
    for para in document.paragraphs:
        if para.text.startswith(after_prefix):
            insert_paragraph_after(para, new_reference, style=para.style)
            return True
    raise RuntimeError(f"Reference anchor not found: {after_prefix}")


def main():
    if not BACKUP.exists():
        copy2(DOCX, BACKUP)

    doc = Document(DOCX)

    comparison_block = [
        (
            "Table 4 summarizes the functional coverage of MicroFit Pro alongside representative predictive microbiology "
            "and risk-assessment tools. The simplified symbols in the table are intended only as a compact map of "
            "whether a capability is supported, partially supported, or not supported; the practical differences between "
            "tools are therefore interpreted in the text rather than embedded as long table notes."
        ),
        (
            "GInaFiT is closest to MicroFit Pro in the primary inactivation-fitting stage. It was designed as a freeware "
            "Microsoft Excel add-in for non-log-linear survivor curves and reports parameter estimates together with "
            "standard errors, SSE, MSE, RMSE, R2, and adjusted R2 for several survival-curve shapes (Geeraerd et al., 2005). "
            "Its main strength is focused primary-model fitting and model comparison for user-supplied inactivation data. "
            "MicroFit Pro overlaps with this role by fitting multiple survival-curve families, but differs by moving the "
            "workflow into a client-side browser interface and by extending the analysis beyond primary fitting to "
            "secondary modelling, compatible dynamic simulation, Monte Carlo propagation, and sensitivity screening."
        ),
        (
            "The IPMP family addresses a different modelling need. IPMP 2013 provides a desktop Python/PyQt environment "
            "for fitting growth, survival, and secondary models and was reported to give results comparable to SAS and R "
            "(Huang, 2014). IPMP Global Fit further emphasizes one-step global regression, in which primary and secondary "
            "models are estimated together to reduce error propagation and directly construct tertiary models for time- "
            "and temperature-dependent growth or survival data (Huang, 2017). MicroFit Pro does not currently implement "
            "this one-step global-fitting strategy. Instead, it uses a transparent two-step workflow with explicit "
            "parameter transfer, AICc-based primary-model ranking, exportable reports, and downstream uncertainty and "
            "sensitivity modules. This makes it complementary to IPMP Global Fit rather than a replacement for one-step "
            "inverse modelling."
        ),
        (
            "Risk-assessment-oriented platforms have a broader decision-analysis scope than MicroFit Pro. MicroHibro is "
            "built around a predictive-model database and can combine growth, inactivation, transfer, partitioning, and "
            "dose-response processes to estimate exposure and risk along a food chain; it also supports model validation "
            "and sensitivity analysis (Cubero Gonzalez et al., 2019). Growth Predictor similarly focuses on Baranyi-based "
            "growth fitting, gamma/cardinal secondary modelling, stochastic growth simulation, strain variability, and "
            "modular QMRA outputs (Skandamis, 2025). Q4MRATools highlights the broader QMRA training ecosystem in which "
            "R, MATLAB, @Risk, DMFit, GInaFiT, and MicroHibro may be combined for risk-assessment work (Bonilla Luque et al., 2024). "
            "By contrast, MicroFit Pro is narrower than a complete farm-to-fork QMRA platform: it does not currently provide "
            "dose-response modelling, exposure-chain templates, or full second-order uncertainty separation, but it provides "
            "a direct browser workflow for inactivation-model fitting and process-focused prediction."
        ),
        (
            "The Bioinactivation ecosystem and recent machine-learning platforms define two additional boundaries. "
            "Bioinactivation and Bioinactivation FE provide dynamic microbial inactivation modelling, including R-based "
            "and web-based implementations and Bayesian uncertainty analysis (Garre et al., 2017, 2018). MicroFit Pro "
            "supports dynamic simulation and covariance-aware Monte Carlo propagation when the fitted covariance matrix "
            "is available, but it does not currently implement MCMC-based Bayesian estimation. The Python/Flask platform "
            "reported by Tarlak et al. (2025) compares two-step and one-step classical modelling with machine-learning "
            "regressors such as support vector regression, random forest regression, and Gaussian process regression for "
            "growth and inhibition datasets. MicroFit Pro does not include machine-learning prediction and is not intended "
            "as a growth/inhibition benchmark platform; its contribution is the integration of multi-technology microbial "
            "inactivation fitting, secondary modelling, simulation, uncertainty propagation, and OAT, SRC, Morris, and Sobol "
            "sensitivity screening in a single open-source browser-based interface."
        ),
        (
            "These differences also clarify how the uncertainty functions should be interpreted. Monte Carlo propagation "
            "has long been used to represent experimental variation in predictive microbiology (Poschet et al., 2003), and "
            "risk-assessment studies have shown that the parameters most influential for public-health outputs may differ "
            "from the parameters emphasized during primary model fitting (Pouillot & Lubran, 2011). The MicroFit Pro "
            "uncertainty and sensitivity modules therefore serve as transparent screening tools for fitted inactivation "
            "scenarios, not as substitutes for a fully specified QMRA. This positioning keeps the platform practical for "
            "process-level inactivation analysis while making its limitations relative to database-driven, Bayesian, "
            "one-step, and QMRA-oriented tools explicit."
        ),
    ]

    if not replace_paragraph_with_block(
        doc,
        "Table 4 summarizes the functional coverage of MicroFit Pro alongside five representative existing tools",
        comparison_block,
    ):
        raise RuntimeError("Comparison paragraph not found")

    add_reference_after(
        doc,
        "Bigelow, W. D.",
        (
            "Bonilla Luque, O. M., Valero, A., Possas, A., Roufou, S., de Oliveira Mallia, J., & Valdramidis, V. (2024). "
            "Q4MRATools: Quantitative tools to microbial risk assessment. EFSA Journal, 22(S1), e221113. "
            "https://doi.org/10.2903/j.efsa.2024.e221113"
        ),
        ["Q4MRATools: Quantitative tools to microbial risk assessment"],
    )
    add_reference_after(
        doc,
        "Couvert, O.",
        (
            "Cubero Gonzalez, S., Possas, A., Carrasco, E., Valero, A., Bolivar, A., Posada-Izquierdo, G. D., "
            "Garcia-Gimeno, R. M., Zurera, G., & Perez-Rodriguez, F. (2019). 'MicroHibro': A software tool for "
            "predictive microbiology and microbial risk assessment in foods. International Journal of Food Microbiology, "
            "290, 226-236. https://doi.org/10.1016/j.ijfoodmicro.2018.10.007"
        ),
        ["'MicroHibro': A software tool for predictive microbiology"],
    )
    add_reference_after(
        doc,
        "Huang, L. (2013).",
        (
            "Huang, L. (2014). IPMP 2013 - A comprehensive data analysis tool for predictive microbiology. "
            "International Journal of Food Microbiology, 171, 100-107. https://doi.org/10.1016/j.ijfoodmicro.2013.11.019"
        ),
        ["IPMP 2013 - A comprehensive data analysis tool"],
    )
    add_reference_after(
        doc,
        "Poschet, F.",
        (
            "Pouillot, R., & Lubran, M. B. (2011). Predictive microbiology models vs. modeling microbial growth within "
            "Listeria monocytogenes risk assessment: What parameters matter and why. Food Microbiology, 28(4), 720-726. "
            "https://doi.org/10.1016/j.fm.2010.06.002"
        ),
        ["Predictive microbiology models vs. modeling microbial growth within Listeria monocytogenes risk assessment"],
    )

    doc.save(DOCX)
    print(f"Updated {DOCX}")
    print(f"Backup {BACKUP}")


if __name__ == "__main__":
    main()
