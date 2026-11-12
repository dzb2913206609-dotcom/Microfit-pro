#!/usr/bin/env python3
"""Digitize the representative survival curves in Huang (2013), Fig. 1.

The source figure is a raster image embedded in the PDF.  The script uses
marker templates taken from the figure legend and normalized cross-correlation
to locate the plotted markers.  It is intended as a transparent first-pass
digitization, not as a replacement for careful manual verification.

Requirements: PyMuPDF, Pillow, NumPy, SciPy, scikit-image.
Run from the repository root:
    python3 scripts/digitize_huang2013_fig1.py
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

import fitz
import numpy as np
from PIL import Image
from scipy import ndimage
from skimage.feature import match_template, peak_local_max

ROOT = Path(__file__).resolve().parents[1]
PDF_PATH = ROOT / "huang2013 (1).pdf"
OUT_DIR = ROOT / "reports" / "huang2013_digitization_20261111"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Pixel coordinates in the 1009 x 677 Fig. 1 raster.  The four legend entries
# are 57, 60, 63 and 66 degC; Fig. 1 does not contain a 54 degC curve.
CROPS = {
    "57": (757, 102, 775, 120),  # open triangle
    "60": (756, 144, 774, 163),  # filled square
    "63": (756, 187, 775, 206),  # filled triangle
    "66": (756, 231, 776, 250),  # cross
}
THRESHOLDS = {"57": 0.74, "60": 0.97, "63": 0.74, "66": 0.73}
CONFIDENCE = {"57": "high", "60": "high", "63": "moderate", "66": "low"}
MARKER = {"57": "open_triangle", "60": "filled_square", "63": "filled_triangle", "66": "cross"}

# Axis calibration from the major tick marks (0-2500 s; 0-10 log10 CFU/g).
X_TICK_PX = np.array([116.5, 202.5, 290.0, 376.0, 463.0, 549.0, 635.5, 723.0, 809.0, 896.5, 983.5])
X_TICK_VALUES = np.arange(0, 2501, 250)
Y_TICK_PX = np.array([595.5, 537.0, 480.0, 421.0, 362.0, 303.5, 245.5, 186.5, 128.0, 12.5])
Y_TICK_VALUES = np.array([0, 1, 2, 3, 4, 5, 6, 7, 8, 10])

PAPER_D_S = {"57": 327.0, "60": 81.1, "63": 20.1, "66": 4.97}

# Manual WebPlotDigitizer extraction supplied by the user.  The automatic
# template matching does not resolve the early 63 degC points near the y-axis,
# so the manual series is used in preference to the automated 63 degC points.
MANUAL_POINTS = {
    "63": [
        (0.141713, 9.3684224),
        (38.967272, 7.9827299),
        (59.948316, 6.9828771),
        (80.960466, 5.8777614),
        (99.354522, 3.6322765),
        (120.24743, 2.9306687),
    ],
    "66": [
        (0.1987408, 9.1754403),
        (6.362927, 8.3158344),
        (12.527113, 7.4562286),
        (21.895224, 5.7545399),
        (28.080148, 4.8247588),
        (28.318628, 4.0177429),
        (37.925219, 1.5090384),
    ],
}
USE_MANUAL = {"63": True, "66": True}


def extract_figure() -> Image.Image:
    doc = fitz.open(PDF_PATH)
    page = doc[2]
    target = None
    for image in page.get_images(full=True):
        bbox = page.get_image_bbox(image)
        if bbox.x0 < 300 and bbox.y0 > 500:  # Fig. 1, lower-left of page 3
            target = image
            break
    if target is None:
        raise RuntimeError("Fig. 1 image not found on page 3")
    pix = fitz.Pixmap(doc, target[0])
    if pix.n - pix.alpha >= 4:
        pix = fitz.Pixmap(fitz.csRGB, pix)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def extract_points() -> tuple[dict[str, list[dict]], dict]:
    image = extract_figure()
    gray = np.array(image.convert("L")).astype(float)
    if gray.shape != (677, 1009):
        raise RuntimeError(f"Unexpected Fig. 1 raster shape: {gray.shape}")

    x_slope, x_intercept = np.polyfit(X_TICK_VALUES, X_TICK_PX, 1)
    y_slope, y_intercept = np.polyfit(Y_TICK_VALUES, Y_TICK_PX, 1)

    series: dict[str, list[dict]] = {}
    for name, (x0, y0, x1, y1) in CROPS.items():
        template = gray[y0:y1, x0:x1]
        response = match_template(gray, template)
        peaks = peak_local_max(
            response,
            min_distance=4,
            threshold_abs=THRESHOLDS[name],
            exclude_border=False,
        )
        points = []
        for py, px in peaks:
            cx = px + template.shape[1] / 2.0
            cy = py + template.shape[0] / 2.0
            if not (120 < cx < 980 and 20 < cy < 590):
                continue
            if cx > 700 and cy < 260:  # legend box
                continue
            time_s = (cx - x_intercept) / x_slope
            log_n = (cy - y_intercept) / y_slope
            if time_s < 0 or log_n < -0.2:
                continue
            points.append({
                "temperature_C": int(name),
                "time_s": round(float(time_s), 1),
                "log10_N": round(float(log_n), 2),
                "marker": MARKER[name],
                "confidence": CONFIDENCE[name],
                "match_score": round(float(response[py, px]), 3),
                "pixel_x": round(float(cx), 1),
                "pixel_y": round(float(cy), 1),
                "source": "Huang (2013), Food Control 33, 484-488, Fig. 1",
            })
        points.sort(key=lambda point: point["time_s"])
        if not points:
            raise RuntimeError(f"No markers found for {name} degC")
        for point in points:
            point["time_min"] = round(point["time_s"] / 60.0, 3)
        series[name] = points

    for name, manual_data in MANUAL_POINTS.items():
        if not USE_MANUAL.get(name, False):
            continue
        manual_points = []
        for time_s, log_n in manual_data:
            cx = x_slope * time_s + x_intercept
            cy = y_slope * log_n + y_intercept
            manual_points.append({
                "temperature_C": int(name),
                "time_s": round(float(time_s), 1),
                "log10_N": round(float(log_n), 2),
                "marker": MARKER[name],
                "confidence": "manual",
                "match_score": None,
                "pixel_x": round(float(cx), 1),
                "pixel_y": round(float(cy), 1),
                "source": "Manual WebPlotDigitizer extraction from Huang (2013), Fig. 1",
            })
        manual_points.sort(key=lambda point: point["time_s"])
        for point in manual_points:
            point["time_min"] = round(point["time_s"] / 60.0, 3)
        series[name] = manual_points

    calibration = {
        "x_pixel_per_s": float(x_slope),
        "x_intercept_px": float(x_intercept),
        "y_pixel_per_log10": float(y_slope),
        "y_intercept_px": float(y_intercept),
        "x_range_s": [0, 2500],
        "y_range_log10": [0, 10],
    }
    return series, calibration


def fit_series(points: list[dict]) -> dict:
    t = np.array([point["time_s"] for point in points], dtype=float)
    y = np.array([point["log10_N"] for point in points], dtype=float)
    slope, intercept = np.polyfit(t, y, 1)
    fitted = slope * t + intercept
    ss_res = float(np.sum((y - fitted) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    return {
        "n": len(points),
        "D_s": float(-1.0 / slope),
        "log10_N0_extrapolated": float(intercept),
        "R2": float(1.0 - ss_res / ss_tot),
        "RMSE_log10": float(np.sqrt(ss_res / len(points))),
        "time_range_s": [float(t.min()), float(t.max())],
        "log10_N_range": [float(y.min()), float(y.max())],
    }


def main() -> None:
    series, calibration = extract_points()

    long_rows = []
    for points in series.values():
        long_rows.extend(points)
    long_rows.sort(key=lambda point: (point["temperature_C"], point["time_s"]))

    long_csv = OUT_DIR / "huang2013_fig1_digitized.csv"
    columns = list(long_rows[0].keys())
    with long_csv.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        writer.writerows(long_rows)

    for name, points in series.items():
        # The thermal workflow in MicroFit Pro uses minutes; provide both units.
        path_min = OUT_DIR / f"huang2013_fig1_T{name}.csv"
        with path_min.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(["time_min", "log10_N"])
            for point in points:
                writer.writerow([point["time_min"], point["log10_N"]])
        path_s = OUT_DIR / f"huang2013_fig1_T{name}_seconds.csv"
        with path_s.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(["time_s", "log10_N"])
            for point in points:
                writer.writerow([point["time_s"], point["log10_N"]])

    fits = {name: fit_series(points) for name, points in series.items()}
    display_confidence = {**CONFIDENCE, "63": "manual", "66": "manual"}
    for name, fit in fits.items():
        fit["paper_D_s"] = PAPER_D_S[name]
        fit["relative_difference_percent"] = 100.0 * (fit["D_s"] - PAPER_D_S[name]) / PAPER_D_S[name]

    # Secondary Bigelow check, log10(D/s) = log10(D0/s) - T/z, with D in seconds.
    secondary_T = np.array([float(name) for name in ("57", "60", "63", "66")])
    secondary_logD = np.array([np.log10(fits[name]["D_s"]) for name in ("57", "60", "63", "66")])
    secondary_slope, secondary_intercept = np.polyfit(secondary_T, secondary_logD, 1)
    secondary = {
        "form": "log10(D/s) = log10(D0/s) - T/z",
        "n": len(secondary_T),
        "z_C": float(-1.0 / secondary_slope),
        "log10_D0_s": float(secondary_intercept),
        "D_at_60C_s": float(10.0 ** (secondary_intercept + secondary_slope * 60.0)),
        "paper_z_C": 4.95,
        "paper_log10_D0_s": 14.03,
        "paper_D_at_60C_s": 81.1,
        "note": "Unweighted OLS on the four extracted representative-curve D values; 54 degC is not present in Fig. 1.",
    }

    summary = {
        "source": "Huang, L. (2013). Food Control 33, 484-488, Fig. 1.",
        "secondary_bigelow_check": secondary,
        "figure_note": (
            "Fig. 1 shows representative isothermal survival curves for 57, 60, 63 and 66 degC only; "
            "no 54 degC curve or legend entry is present. The curves are representative, not replicate means."
        ),
        "calibration": calibration,
        "series": {name: {"points": series[name], "fit": fits[name]} for name in series},
    }
    (OUT_DIR / "huang2013_fig1_summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    lines = [
        "# Huang (2013) Fig. 1 digitization",
        "",
        "Source: Huang, L. (2013). *Food Control* 33, 484-488, Fig. 1.",
        "",
        "## Important limitation",
        "",
        "Fig. 1 contains four representative isothermal curves (57, 60, 63 and 66 °C). "
        "There is no 54 °C curve in the figure and no 54 °C legend entry. The curves are representative, "
        "not replicate means, so the extracted D values need not reproduce the paper's regression exactly.",
        "",
        "## Extracted series and log-linear D check",
        "",
        "| T (°C) | n | D from extracted points (s) | Paper D (s) | Difference | R² | Confidence |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for name in ("57", "60", "63", "66"):
        fit = fits[name]
        lines.append(
            f"| {name} | {fit['n']} | {fit['D_s']:.2f} | {fit['paper_D_s']:.2f} | "
            f"{fit['relative_difference_percent']:+.1f}% | {fit['R2']:.3f} | {display_confidence[name]} |"
        )
    lines += [
        "",
        "The 57 °C and 60 °C curves are well separated and give the most reliable automated digitization. "
        "The 63 °C and 66 °C series now use the user's manual WebPlotDigitizer extractions, which include the "
        "t = 0 points and replace the automated points. The 66 °C markers are clipped by the y-axis, so the "
        "manual series is strongly preferred over the automated one.",
        "",
        "## Secondary Bigelow check",
        "",
        "Fitting the four extracted D values with the paper's no-Tref form "
        "`log10(D/s) = log10(D0/s) - T/z` gives:",
        "",
        f"- z = {secondary['z_C']:.2f} °C (paper: 4.95 °C)",
        f"- log10(D0/s) = {secondary['log10_D0_s']:.2f} (paper: 14.03)",
        f"- D(60 °C) = {secondary['D_at_60C_s']:.1f} s (paper: 81.1 s)",
        "",
        "This is a consistency check, not an independent replication: it uses the same representative curves and "
        "four temperatures, and the 54 °C condition is missing from Fig. 1.",
        "",
        "## Files",
        "",
        "- `huang2013_fig1_digitized.csv` — long format in seconds, including confidence and match score.",
        "- `huang2013_fig1_T57.csv`, `..._T60.csv`, `..._T63.csv`, `..._T66.csv` — two-column files in minutes for direct thermal import.",
        "- `huang2013_fig1_T57_seconds.csv`, `..._T60_seconds.csv`, ... — the same points in seconds, matching the figure axis.",
        "- `huang2013_fig1_summary.json` — calibration, points and fit statistics.",
        "- `huang2013_fig1_overlay.png` — verification image with detected marker centres.",
        "- `huang2013_fig1_primary_secondary.png` — combined primary and secondary fit figure (from the plotting script).",
        "- `huang2013_fig1_secondary_fit.png` — stand-alone secondary Bigelow figure (from the plotting script).",
        "",
        "## Method",
        "",
        "Marker shapes were taken from the figure legend and located by normalized cross-correlation. "
        "Axis calibration used the major x ticks (0-2500 s) and y ticks (0-10 log₁₀ CFU/g). "
        "The 63 °C and 66 °C series are the user's manual WebPlotDigitizer extractions; 57 °C and 60 °C remain automated. "
        "D was estimated from the slope of log₁₀N versus time for each series.",
        "",
    ]
    (OUT_DIR / "README.md").write_text("\n".join(lines), encoding="utf-8")

    # Verification overlay: original figure with detected marker centres.
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    overlay_image = extract_figure()
    fig, ax = plt.subplots(figsize=(10.09, 6.77))
    ax.imshow(overlay_image)
    colours = {"57": "tab:blue", "60": "tab:orange", "63": "tab:green", "66": "tab:red"}
    for name, points in series.items():
        xs = [point["pixel_x"] for point in points]
        ys = [point["pixel_y"] for point in points]
        label = f"{name} °C (manual)" if name in USE_MANUAL else f"{name} °C"
        ax.scatter(xs, ys, s=90, facecolors="none", edgecolors=colours[name], linewidths=1.5, label=label)
        for point in points:
            ax.text(
                point["pixel_x"] + 5,
                point["pixel_y"] - 5,
                f"{point['log10_N']:.1f}",
                fontsize=7,
                color=colours[name],
            )
    ax.set_xlim(0, overlay_image.width)
    ax.set_ylim(overlay_image.height, 0)
    ax.axis("off")
    ax.legend(loc="upper right", framealpha=0.9)
    fig.tight_layout()
    overlay_path = OUT_DIR / "huang2013_fig1_overlay.png"
    fig.savefig(overlay_path, dpi=200)
    plt.close(fig)

    print(f"Wrote {long_csv}")
    print(f"Wrote {overlay_path}")
    for name, fit in fits.items():
        print(
            f"{name} degC: n={fit['n']}, D={fit['D_s']:.2f} s, "
            f"paper={fit['paper_D_s']:.2f} s, R2={fit['R2']:.3f}"
        )


if __name__ == "__main__":
    main()
