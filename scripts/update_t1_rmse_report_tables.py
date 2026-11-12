from __future__ import annotations

import csv
from pathlib import Path


ROOT = Path("/Users/dengzhengbin/Desktop/microbial-inactivation-app _副本")
REPORTS = ROOT / "reports"


def rewrite_csv(path: Path, updater) -> None:
    with path.open("r", newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        fieldnames = list(reader.fieldnames or [])
        rows = list(reader)

    for row in rows:
        updater(row)

    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def update_table2_lookup(row: dict[str, str]) -> None:
    if row.get("Dataset ID") == "T1":
        row["Dataset ID"] = "T1-primary"
        row["Corresponding source condition/model"] = "Representative 60 C, aw=0.33 log-linear primary curve"
        row["Source RMSE"] = ""
        row["Source AICc"] = ""
        row["Delta RMSE (Program-Source)"] = ""
        row["Delta AICc (Program-Source)"] = ""
        row["Source location/note"] = (
            "Source single-curve RMSE/AICc not reported. The source RMSE=0.707 and AICc=-76.71 "
            "refer to the overall isothermal modified-Bigelow analysis and are reported in the T1-secondary comparison."
        )


def update_simple(row: dict[str, str]) -> None:
    if row.get("Dataset ID") == "T1":
        row["Dataset ID"] = "T1-primary"
        row["Literature RMSE"] = ""


def update_combined(row: dict[str, str]) -> None:
    if row.get("Source table") == "Table 2" and row.get("Dataset ID") == "T1":
        row["Dataset ID"] = "T1-primary"
        row["Literature RMSE"] = ""
        row["Literature AICc"] = ""
    if row.get("Source table") == "Table 4" and row.get("Dataset ID") == "T1":
        row["Dataset ID"] = "T1-secondary"
        row["Program RMSE"] = "0.730"
        row["Program AICc"] = ""


def main() -> None:
    rewrite_csv(REPORTS / "table2_literature_model_comparison.csv", update_table2_lookup)
    rewrite_csv(REPORTS / "table2_reference_rmse_aicc_lookup.csv", update_table2_lookup)
    rewrite_csv(REPORTS / "table2_literature_model_comparison_simple.csv", update_simple)
    rewrite_csv(REPORTS / "table2_table4_literature_model_comparison_combined.csv", update_combined)


if __name__ == "__main__":
    main()
