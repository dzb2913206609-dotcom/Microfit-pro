from pathlib import Path
import shutil

from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt
from openpyxl import load_workbook


ROOT = Path("/Users/dengzhengbin/Desktop/microbial-inactivation-app _副本")
DOCX_PATH = ROOT / "paper.docx"
XLSX_PATH = ROOT / "reports/table2_table4_literature_model_comparison_combined.xlsx"
BACKUP_PATH = ROOT / "paper_before_combined_table2_table4_replacement.docx"


def remove_element(element):
    parent = element.getparent()
    if parent is not None:
        parent.remove(element)


def remove_extra_columns(table, keep_count):
    tbl_grid = table._tbl.tblGrid
    if tbl_grid is not None:
        for grid_col in list(tbl_grid.gridCol_lst)[keep_count:]:
            tbl_grid.remove(grid_col)

    for row in table.rows:
        tr = row._tr
        for tc in list(tr.tc_lst)[keep_count:]:
            tr.remove(tc)


def set_cell_width(cell, width_twips):
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_w = tc_pr.tcW
    if tc_w is None:
        tc_w = OxmlElement("w:tcW")
        tc_pr.append(tc_w)
    tc_w.set(qn("w:w"), str(width_twips))
    tc_w.set(qn("w:type"), "dxa")


def set_cell_margins(cell, margin_twips=45):
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for edge in ("top", "left", "bottom", "right"):
        node = tc_mar.find(qn(f"w:{edge}"))
        if node is None:
            node = OxmlElement(f"w:{edge}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(margin_twips))
        node.set(qn("w:type"), "dxa")


def set_cell_text(cell, text, *, bold=False, center=False):
    cell.text = ""
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    paragraph = cell.paragraphs[0]
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER if center else WD_ALIGN_PARAGRAPH.LEFT
    paragraph.paragraph_format.space_before = Pt(0)
    paragraph.paragraph_format.space_after = Pt(0)
    paragraph.paragraph_format.line_spacing = 1
    run = paragraph.add_run("" if text is None else str(text))
    run.bold = bold
    run.font.name = "Times New Roman"
    run.font.size = Pt(7.5)


def table_rows_from_xlsx():
    wb = load_workbook(XLSX_PATH, data_only=True)
    ws = wb.active
    # User's edited workbook keeps column A empty; use columns B:H for the manuscript.
    rows = []
    for row in ws.iter_rows(min_row=1, max_row=ws.max_row, min_col=2, max_col=8, values_only=True):
        rows.append(list(row))
    return rows


def replace_table2(doc, rows):
    table = doc.tables[1]
    table.autofit = False

    remove_extra_columns(table, len(rows[0]))
    while len(table.rows) < len(rows):
        table.add_row()
    while len(table.rows) > len(rows):
        remove_element(table.rows[-1]._tr)

    widths = [800, 1280, 1900, 1850, 760, 820, 1950]
    tbl_grid = table._tbl.tblGrid
    if tbl_grid is not None:
        for idx, grid_col in enumerate(list(tbl_grid.gridCol_lst)[: len(widths)]):
            grid_col.set(qn("w:w"), str(widths[idx]))

    for r_idx, row_values in enumerate(rows):
        row = table.rows[r_idx]
        for c_idx, value in enumerate(row_values):
            cell = row.cells[c_idx]
            set_cell_width(cell, widths[c_idx])
            set_cell_margins(cell)
            set_cell_text(
                cell,
                value,
                bold=(r_idx == 0),
                center=(c_idx in {0, 4, 5}),
            )


def update_text(doc):
    replacements = {
        "Table 2. Primary model fitting results for all case-study datasets. For each organism–condition combination, the best-fit model was selected by AICc-based ranking. Parameter estimates are reported as mean ± standard error.": (
            "Table 2. Comparison of literature-reported model parameters, MicroFit Pro parameter estimates, RMSE values, and reported fitting software for the primary and secondary model case-study datasets. Blank cells indicate metrics not reported in the source literature."
        ),
        "Table 5 summarizes": "Table 4 summarizes",
        "Table 5. Functional comparison": "Table 4. Functional comparison",
        "suitable for parameter-factor regression (Table 4).": "suitable for parameter-factor regression (Table 2).",
        "reported in Table 5.": "reported in Table 3.",
    }

    for paragraph in doc.paragraphs:
        text = paragraph.text
        new_text = text
        for old, new in replacements.items():
            new_text = new_text.replace(old, new)
        if new_text != text:
            paragraph.text = new_text


def remove_old_table4(doc):
    for paragraph in list(doc.paragraphs):
        if paragraph.text.startswith("Table 4. Secondary model fitting results"):
            remove_element(paragraph._element)
            break
    # After replacing Table 2, the old Table 4 is still the fourth table in document order.
    if len(doc.tables) >= 4:
        remove_element(doc.tables[3]._element)


def main():
    if not BACKUP_PATH.exists():
        shutil.copyfile(DOCX_PATH, BACKUP_PATH)

    rows = table_rows_from_xlsx()
    doc = Document(DOCX_PATH)
    replace_table2(doc, rows)
    remove_old_table4(doc)
    update_text(doc)
    doc.save(DOCX_PATH)
    print(DOCX_PATH)
    print(BACKUP_PATH)


if __name__ == "__main__":
    main()
