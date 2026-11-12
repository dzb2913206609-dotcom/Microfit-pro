#!/usr/bin/env python3
"""Rewrite the supplementary material for the T1-T5 dataset order."""
from pathlib import Path

import docx
from docx.oxml.ns import qn
from docx.enum.text import WD_COLOR_INDEX
from docx.shared import Inches, Pt

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "dzb-7.8 MicroFit 补充材料_审稿修改版_黄色高亮.docx"
DST = ROOT / "dzb-7.8 MicroFit 补充材料_审稿修改版_黄色高亮_20261111.docx"
FIG = ROOT / "figures" / "paper_20261111"

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


def set_cell(cell, text, size=10.0, bold=False):
    cell.text = ""
    p = cell.paragraphs[0]
    run = p.add_run(str(text))
    run.font.size = Pt(size)
    run.bold = bold
    run.font.highlight_color = WD_COLOR_INDEX.YELLOW
    p.paragraph_format.space_after = Pt(0)
    p.paragraph_format.space_before = Pt(0)


def replace_image(index, path, width_in=6.0):
    from PIL import Image
    shape = doc.inline_shapes[index]
    blip = shape._inline.graphic.graphicData.pic.blipFill.blip
    r_id = blip.embed
    part = doc.part.related_parts[r_id]
    part._blob = Path(path).read_bytes()
    for ext_list in blip.findall(qn("a:extLst")):
        blip.remove(ext_list)
    with Image.open(path) as image:
        w, h = image.size
    shape.width = Inches(width_in)
    shape.height = Inches(width_in * h / w)


set_text(
    60,
    "The grid combines 500 evenly spaced intervals by default with every supplied profile breakpoint; adding "
    "breakpoints may therefore increase the interval count. Environmental variables are interpolated linearly "
    "between strictly increasing finite profile times. Nonfinite or negative predicted rates are rejected. "
    "Constant-condition trajectories were checked against static log-linear predictions; broader non-isothermal "
    "evidence is limited to the illustrative T5 workflow.",
)
set_text(
    82,
    "A repeat-run check used 20 seed strings, review-20261111-01 through review-20261111-20, at each of 10,000 and "
    "50,000 requested iterations for the same fitted T1 WMP model and uncertainty assumptions. Rejected draws were "
    "excluded from the denominator. The 60-min success fraction used draw-specific 5-log reductions. To isolate "
    "sampling error from saved-grid rounding, each target time was computed analytically as 5 ln(10)/kmax for the "
    "accepted log-linear draw; the q-quantile was the ceil(qN)th ordered value for N accepted draws. The seed "
    "labels were reused at both sample sizes. Supplementary Table S4 reports between-seed SD and range, not a "
    "confidence interval or a measure of biological uncertainty.",
)
set_text(
    97,
    "The T1 WMP sensitivity output was log10(N) at exactly 60 min. OAT used ±5% around the nominal condition; SRC "
    "used the 10,000 MC draws with seed 20260430 and independent primary estimation-noise columns rather than the "
    "derived kinetic rate. Morris used 10 trajectories, four grid levels and seed 20260430:morris. Sobol used the "
    "Jansen-style total-effect and first-order estimators with N = 512 and seed 20260430:sobol-512 (Jansen, 1999; Saltelli et al., "
    "2010). Global factor ranges defaulted to the bounding-box intersection from the bound secondary calibration "
    "data: 75–85 °C, aw = 0.10–0.30, and fixed pH = 7. Constant factors were omitted. The rectangular range does not "
    "validate every combination. Unbound primary parameters used ±20%; secondary parameters used max(3SE,20% of "
    "the absolute nominal value), clipped to declared bounds. Sampling was independent over these screening ranges "
    "and differed from the covariance-based Gaussian MC scenario.",
)
set_text(
    101,
    "The 43-model library should be read as implemented model coverage rather than uniform validation coverage. In "
    "the present study, the thermal extended Bigelow workflow was demonstrated with T1 and T2, the D-value-only "
    "secondary workflow with T3 and T4, the dynamic module was illustrated with T5, and the non-thermal entries were "
    "exercised at the primary-fitting level only unless explicitly stated otherwise.",
)
set_text(
    180,
    "Supplementary Fig. S1. Morris screening of log10(N) at 60 min for T1 WMP. Bars show normalized mean absolute "
    "elementary effects with 10 trajectories, four levels and seed 20260430:morris. Factor ranges are 75–85 °C and "
    "aw = 0.10–0.30; pH is fixed at 7. Primary and secondary parameter ranges are defined in Supplementary Methods. "
    "These percentages are screening influence, not variance fractions.",
)
set_text(
    183,
    "Supplementary Fig. S2. Sobol total-effect screening of log10(N) at 60 min for T1 WMP, with N = 512 and seed "
    "20260430:sobol-512. Bars normalize the raw total-effect estimates, whose sum is 1.188. The ranges match "
    "Supplementary Fig. S1. Total effects overlap through interactions and include finite-sample error; normalized "
    "bars are not additive first-order variance fractions. First-order estimates from a separate N = 8192 "
    "stability run are reported in Supplementary Table S7; bootstrap confidence intervals were not estimated.",
)
set_text(
    184,
    "Supplementary Table S4. Repeatability of T1 WMP Monte Carlo outputs across 20 seed strings at two requested "
    "sample sizes.",
)
set_text(
    185,
    "Notes: All runs use the fitted T1 WMP extended Bigelow model, nominal T = 80 °C, aw = 0.20, pH = 7, process SDs "
    "of 1 °C and 0.01 for temperature and aw, and the same primary- and secondary-parameter uncertainty settings as "
    "the main T1 scenario. Each statistic summarizes 20 runs. The accepted counts ranged from 9999 to 10,000 and "
    "from 49999 to 50,000, respectively. Target times use exact log-linear inversion rather than the 200-point "
    "display grid used for the original 89.2-min example. These results measure conditional numerical repeatability "
    "and do not validate the process model, parameter distributions or biological safety.",
)

# Table S4 values
s4_rows = [
    ["Draws", "Output", "Mean", "Between-seed SD", "Min–max"],
    ["10,000", "Success at 60 min (%)", "41.70", "0.51", "40.69–42.90"],
    ["10,000", "99% target time (min)", "89.298", "0.519", "88.453–90.443"],
    ["10,000", "99.9% target time (min)", "100.305", "1.697", "97.802–104.829"],
    ["50,000", "Success at 60 min (%)", "41.76", "0.26", "41.41–42.44"],
    ["50,000", "99% target time (min)", "89.164", "0.209", "88.589–89.409"],
    ["50,000", "99.9% target time (min)", "100.596", "0.765", "99.009–102.068"],
]
table = doc.tables[3]
for row_index, row in enumerate(s4_rows):
    for col_index, value in enumerate(row):
        set_cell(table.rows[row_index].cells[col_index], value, size=10.0, bold=(row_index == 0))

# Update the Extended Bigelow reference basis in Table S2.
for table in doc.tables:
    for row in table.rows:
        for cell in row.cells:
            if "Faliarizao et al., 2025" in cell.text:
                text = cell.text.replace(
                    "Faliarizao et al., 2025",
                    "Wei et al., 2020; Wei et al., 2021",
                )
                cell.text = ""
                paragraph = cell.paragraphs[0]
                run = paragraph.add_run(text)
                run.font.size = Pt(9.5)
                run.font.highlight_color = WD_COLOR_INDEX.YELLOW
                paragraph.paragraph_format.space_after = Pt(0)
                paragraph.paragraph_format.space_before = Pt(0)

# Supplementary figures
replace_image(0, FIG / "FigS1_morris_T1.png")
replace_image(1, FIG / "FigS2_sobol_T1.png")

# References: replace Faliarizao with Wei 2020, then insert Wei 2021.
fali_index = next((i for i, p in enumerate(doc.paragraphs) if p.text.strip().startswith("Faliarizao, N. T.")), None)
if fali_index is not None:
    set_text(fali_index, (
        "Wei, X., Lau, S. K., Chaves, B. D., Danao, M.-G. C., Agarwal, S., & Subbiah, J. (2020). Effect of water "
        "activity on the thermal inactivation kinetics of Salmonella in milk powders. Journal of Dairy Science, "
        "103(8), 6904–6917. https://doi.org/10.3168/jds.2020-18298"
    ))
    fali_p = doc.paragraphs[fali_index]
    new_p = doc.add_paragraph(style="Normal")
    new_run = new_p.add_run(
        "Wei, X., Vasquez, S., Thippareddi, H., & Subbiah, J. (2021). Evaluation of Enterococcus faecium NRRL "
        "B-2354 as a surrogate for Salmonella in ground black pepper at different water activities. International "
        "Journal of Food Microbiology, 344, 109114. https://doi.org/10.1016/j.ijfoodmicro.2021.109114"
    )
    new_run.font.highlight_color = WD_COLOR_INDEX.YELLOW
    fali_p._p.addnext(new_p._p)

doc.save(DST)
print("saved", DST)
