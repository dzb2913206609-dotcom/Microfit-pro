#!/usr/bin/env python3
"""Plot the digitized Huang (2013) Fig. 1 primary fits and the secondary Bigelow fit."""
from __future__ import annotations

import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.gridspec import GridSpec

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "reports" / "huang2013_digitization_20261111"
SUMMARY_PATH = OUT_DIR / "huang2013_fig1_summary.json"

COLOURS = {"57": "#1f77b4", "60": "#d97706", "63": "#2e7d32", "66": "#c62828"}
MARKERS = {"57": "^", "60": "s", "63": "^", "66": "x"}
FILLED = {"57": False, "60": True, "63": True, "66": False}
TITLES = {"57": "57 °C", "60": "60 °C", "63": "63 °C (manual)", "66": "66 °C"}
X_LIMITS = {"57": (0, 2300), "60": (0, 600), "63": (0, 135), "66": (0, 50)}


def load_summary() -> dict:
    return json.loads(SUMMARY_PATH.read_text(encoding="utf-8"))


def draw_primary(ax, name: str, data: dict) -> None:
    points = data["series"][name]["points"]
    fit = data["series"][name]["fit"]
    t = np.array([point["time_s"] for point in points], dtype=float)
    y = np.array([point["log10_N"] for point in points], dtype=float)
    t_line = np.linspace(0, X_LIMITS[name][1], 200)
    y_line = fit["log10_N0_extrapolated"] - t_line / fit["D_s"]

    marker = MARKERS[name]
    if marker == "x":
        ax.scatter(t, y, s=38, marker=marker, c=COLOURS[name], linewidths=1.4, zorder=3)
    else:
        face = COLOURS[name] if FILLED[name] else "none"
        ax.scatter(t, y, s=38, marker=marker, facecolors=face, edgecolors=COLOURS[name],
                   linewidths=1.4, zorder=3)
    ax.plot(t_line, y_line, color=COLOURS[name], lw=1.6, zorder=2)

    ax.set_xlim(*X_LIMITS[name])
    ax.set_ylim(0, 10)
    ax.set_xlabel("Time (s)", fontsize=9)
    ax.set_ylabel("log$_{10}$ N (CFU/g)", fontsize=9)
    ax.set_title(TITLES[name], fontsize=10, fontweight="bold", loc="left")
    ax.tick_params(labelsize=8)
    ax.grid(True, color="0.9", lw=0.6, zorder=0)
    ax.text(
        0.04, 0.06,
        f"D = {fit['D_s']:.1f} s\nR² = {fit['R2']:.3f}",
        transform=ax.transAxes, fontsize=8, va="bottom", ha="left",
        bbox=dict(boxstyle="round,pad=0.25", fc="white", ec="0.8", lw=0.6),
    )


def draw_secondary(ax, data: dict) -> None:
    secondary = data["secondary_bigelow_check"]
    temperatures = np.array([57, 60, 63, 66], dtype=float)
    log_d = np.array([np.log10(data["series"][str(int(temp))]["fit"]["D_s"]) for temp in temperatures])
    for temp, value in zip(temperatures, log_d):
        name = str(int(temp))
        marker = MARKERS[name]
        if marker == "x":
            ax.scatter(temp, value, s=48, marker=marker, c=COLOURS[name],
                       linewidths=1.4, zorder=3, label=TITLES[name])
        else:
            face = COLOURS[name] if FILLED[name] else "none"
            ax.scatter(temp, value, s=48, marker=marker, facecolors=face,
                       edgecolors=COLOURS[name], linewidths=1.4, zorder=3, label=TITLES[name])

    t_line = np.linspace(55, 68, 200)
    ax.plot(
        t_line,
        secondary["log10_D0_s"] - t_line / secondary["z_C"],
        color="0.15", lw=1.8, label="Four-point fit",
    )
    ax.plot(
        t_line,
        secondary["paper_log10_D0_s"] - t_line / secondary["paper_z_C"],
        color="0.55", lw=1.4, ls="--", label="Paper regression",
    )
    ax.set_xlim(54, 68)
    ax.set_ylim(0.4, 2.8)
    ax.set_xlabel("Temperature (°C)", fontsize=9)
    ax.set_ylabel("log$_{10}$(D/s)", fontsize=9)
    ax.set_title("Secondary Bigelow fit", fontsize=10, fontweight="bold", loc="left")
    ax.tick_params(labelsize=8)
    ax.grid(True, color="0.9", lw=0.6, zorder=0)
    ax.legend(fontsize=7.5, loc="upper right", frameon=True, framealpha=0.95)
    annotation = (
        f"z = {secondary['z_C']:.2f} °C  (paper 4.95)\n"
        f"log$_{{10}}$(D$_0$/s) = {secondary['log10_D0_s']:.2f}  (paper 14.03)\n"
        f"D(60 °C) = {secondary['D_at_60C_s']:.1f} s  (paper 81.1 s)"
    )
    ax.text(
        0.04, 0.96, annotation, transform=ax.transAxes, fontsize=8,
        va="top", ha="left",
        bbox=dict(boxstyle="round,pad=0.3", fc="white", ec="0.8", lw=0.6),
    )


def main() -> None:
    data = load_summary()

    # Combined figure: four primary panels + secondary panel.
    fig = plt.figure(figsize=(10.4, 6.4))
    gs = GridSpec(2, 3, figure=fig, left=0.07, right=0.98, top=0.93, bottom=0.11,
                  wspace=0.35, hspace=0.38)
    axes = {
        "57": fig.add_subplot(gs[0, 0]),
        "60": fig.add_subplot(gs[0, 1]),
        "63": fig.add_subplot(gs[0, 2]),
        "66": fig.add_subplot(gs[1, 0]),
    }
    for name, ax in axes.items():
        draw_primary(ax, name, data)
    secondary_ax = fig.add_subplot(gs[1, 1:])
    draw_secondary(secondary_ax, data)

    for letter, ax in zip("ABCDE", list(axes.values()) + [secondary_ax]):
        ax.text(-0.14, 1.06, letter, transform=ax.transAxes, fontsize=12,
                fontweight="bold", va="top", ha="left")

    fig.text(
        0.07, 0.015,
        "Huang (2013) Fig. 1: representative isothermal curves; 63 °C from manual WebPlotDigitizer; "
        "54 °C is not shown in Fig. 1.",
        fontsize=7.5, color="0.35", ha="left",
    )
    combined_path = OUT_DIR / "huang2013_fig1_primary_secondary.png"
    fig.savefig(combined_path, dpi=300)
    plt.close(fig)

    # Stand-alone secondary figure.
    fig2, ax2 = plt.subplots(figsize=(5.2, 4.0))
    draw_secondary(ax2, data)
    fig2.tight_layout()
    secondary_path = OUT_DIR / "huang2013_fig1_secondary_fit.png"
    fig2.savefig(secondary_path, dpi=300)
    plt.close(fig2)

    print(f"Wrote {combined_path}")
    print(f"Wrote {secondary_path}")


if __name__ == "__main__":
    main()
