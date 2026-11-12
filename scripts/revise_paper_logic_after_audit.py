from pathlib import Path
from shutil import copy2

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.shared import Pt


ROOT = Path("/Users/dengzhengbin/Desktop/microbial-inactivation-app _副本")
DOCX = ROOT / "paper.docx"
BACKUP = ROOT / "paper_before_logic_revision.docx"


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


def replace_paragraph_block(document, marker, new_texts):
    for para in document.paragraphs:
        if marker in para.text:
            style = para.style
            para.text = new_texts[0]
            anchor = para
            for text in new_texts[1:]:
                anchor = insert_paragraph_after(anchor, text, style=style)
            return True
    return False


def replace_text(document, old, new):
    for para in document.paragraphs:
        if old in para.text:
            para.text = para.text.replace(old, new)
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


def format_table4_header(document):
    table = document.tables[3]
    header = table.rows[0].cells[7]
    header.text = "Tarlak et al.\nplatform"
    for paragraph in header.paragraphs:
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        for run in paragraph.runs:
            run.font.size = Pt(8)
            run.font.bold = True


def main():
    if not BACKUP.exists():
        copy2(DOCX, BACKUP)

    doc = Document(DOCX)

    tool_comparison = [
        (
            "Table 4 summarizes the functional coverage of MicroFit Pro alongside representative existing tools "
            "and two recent predictive-microbiology platforms. The simplified symbols are used only to indicate "
            "whether a capability is supported, partially supported, or not supported; the practical differences "
            "between tools are therefore interpreted in the text rather than embedded as long table notes."
        ),
        (
            "Among fitting-oriented tools, GInaFiT is closest to MicroFit Pro in the primary inactivation-fitting "
            "stage. It provides focused fitting and comparison of non-log-linear survivor-curve models, together "
            "with parameter estimates and common goodness-of-fit statistics (Geeraerd et al., 2005). IPMP Global "
            "Fit addresses a different strength: one-step global regression for estimating primary and secondary "
            "parameters together, thereby reducing error propagation in tertiary model construction (Huang, 2017). "
            "The Bioinactivation ecosystem and Bioinactivation FE provide dynamic microbial inactivation modelling "
            "and Bayesian uncertainty analysis through R-based and web-based implementations (Garre et al., 2017, "
            "2018). MicroFit Pro overlaps with these tools at selected points, but its emphasis is a browser-based "
            "workflow that connects multi-model primary fitting, secondary-model libraries, compatible dynamic "
            "simulation, report export, Monte Carlo propagation, and sensitivity screening in one interface."
        ),
        (
            "Database- and risk-assessment-oriented tools have a broader decision-analysis scope. ComBase and "
            "MicroHibro provide database-driven prediction or expert-system support for predictive microbiology "
            "and microbial risk assessment (Tenenhaus-Aziza & Ellouze, 2015). Growth Predictor provides an "
            "R/Shiny workflow for Baranyi-based growth fitting, gamma/cardinal secondary modelling, stochastic "
            "simulation, strain variability, and modular QMRA with dose-response outputs (Skandamis, 2025). "
            "Q4MRATools further illustrates how R, MATLAB, @Risk, DMFit, GInaFiT, and MicroHibro can be combined "
            "within a broader QMRA training and analysis ecosystem (Bonilla Luque et al., 2024). By contrast, "
            "MicroFit Pro is narrower than a full farm-to-fork QMRA platform: it does not currently implement "
            "dose-response modelling, exposure-chain templates, or full second-order uncertainty separation."
        ),
        (
            "The recent Python/Flask platform reported by Tarlak et al. (2025) defines another boundary. That "
            "platform compares two-step and one-step classical modelling with machine-learning regressors, "
            "including support vector regression, random forest regression, and Gaussian process regression, for "
            "growth and inhibition datasets. MicroFit Pro does not include machine-learning prediction and is not "
            "intended as a growth/inhibition benchmark platform. Its contribution is instead practical integration "
            "for microbial inactivation analysis across multiple processing modes, while keeping major boundaries "
            "explicit: it does not replace MCMC-based Bayesian estimation, one-step global fitting, ML-based "
            "prediction, or full QMRA workflows."
        ),
    ]

    if not replace_paragraph_block(
        doc,
        "Table 4 summarizes the functional coverage of MicroFit Pro alongside five representative existing tools",
        tool_comparison,
    ):
        raise RuntimeError("Could not find the tool-comparison paragraph.")

    bridge_old = (
        "Accordingly, the result should be interpreted as agreement in model form and response direction, "
        "with strong in-sample condition-level fit for T1, not as full reproduction of every published parameter value."
    )
    bridge_new = (
        "Accordingly, the result should be interpreted as agreement in model form and response direction, "
        "with strong in-sample condition-level fit for T1, not as full reproduction of every published parameter value "
        "or as evidence of predictive robustness under held-out conditions."
    )
    if not replace_text(doc, bridge_old, bridge_new):
        raise RuntimeError("Could not update the T1 in-sample bridge sentence.")

    holdout_old = (
        "The single-condition hold-out result therefore supports only an initial workflow demonstration; broader "
        "independent validation is required before using the fitted secondary model or downstream Monte Carlo "
        "outputs for process recommendations."
    )
    holdout_new = (
        "The single-condition hold-out result therefore supports only an initial workflow demonstration; broader "
        "independent validation is required before using the fitted secondary model or downstream Monte Carlo "
        "outputs for process recommendations. This contrast clarifies the evidence hierarchy of the T1 analysis: "
        "the in-sample fit demonstrates calibration capability, whereas the hold-out result defines the current "
        "boundary of predictive use."
    )
    if not replace_text(doc, holdout_old, holdout_new):
        raise RuntimeError("Could not update the T1 hold-out interpretation.")

    limitation_old = (
        "Model-level generalization also remains limited. The secondary workflow was validated only for thermal "
        "inactivation using the extended Bigelow-type temperature-water activity model, although MicroFit Pro "
        "includes 43 secondary model forms for different processing technologies and factor combinations."
    )
    limitation_new = (
        "Model-level generalization also remains limited. The secondary workflow was demonstrated and evaluated "
        "only for thermal inactivation using the extended Bigelow-type temperature-water activity model, although "
        "MicroFit Pro includes 43 secondary model forms for different processing technologies and factor combinations."
    )
    if not replace_text(doc, limitation_old, limitation_new):
        raise RuntimeError("Could not update the limitations wording.")

    conclusion_old = (
        "The evaluation was intentionally tiered. Primary fitting was demonstrated across six processing technologies, "
        "while the complete secondary-modelling, uncertainty, and sensitivity workflow was demonstrated using the T1 "
        "thermal dataset; dynamic simulation was illustrated separately using the T2 literature-derived non-isothermal "
        "heating profile. Thus, MicroFit Pro should be viewed as a reproducible software workflow and thermal workflow "
        "demonstration, not as a fully validated predictive standard for all processing technologies. Future work should "
        "prioritize broader independent validation, direct benchmarking of dynamic simulations against experimental "
        "observations, sensitivity checks for assumed process variability, and optional one-step or Bayesian estimation modes."
    )
    conclusion_new = (
        "The evaluation was intentionally tiered. Primary fitting was demonstrated across six processing technologies, "
        "whereas the complete secondary-modelling, uncertainty, and sensitivity workflow was demonstrated using the T1 "
        "thermal dataset; dynamic simulation was illustrated separately using the T2 literature-derived non-isothermal "
        "heating profile. In relation to the study objectives, the work therefore establishes the implemented model and "
        "algorithm library, demonstrates cross-technology primary fitting, shows the linked T1 secondary-modelling and "
        "uncertainty workflow, illustrates compatible dynamic simulation using T2, and positions the platform relative "
        "to existing tools. Thus, MicroFit Pro should be viewed as a reproducible software workflow and thermal workflow "
        "demonstration, not as a fully validated predictive standard for all processing technologies. Future work should "
        "prioritize broader independent validation, direct benchmarking of dynamic simulations against experimental "
        "observations, sensitivity checks for assumed process variability, and optional one-step or Bayesian estimation modes."
    )
    if not replace_text(doc, conclusion_old, conclusion_new):
        raise RuntimeError("Could not update the conclusion.")

    caption_old = "Table 4. Functional comparison of MicroFit Pro with representative predictive microbiology tools."
    caption_new = (
        "Table 4. Functional comparison of MicroFit Pro with representative predictive microbiology tools "
        "and recent software platforms."
    )
    replace_text(doc, caption_old, caption_new)

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

    format_table4_header(doc)
    doc.save(DOCX)
    print(f"Updated {DOCX}")
    print(f"Backup {BACKUP}")


if __name__ == "__main__":
    main()
