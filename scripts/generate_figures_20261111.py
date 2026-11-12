#!/usr/bin/env python3
"""Generate manuscript figures for the renumbered T1-T5 dataset order."""
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import openpyxl
import pandas as pd
from matplotlib.colors import Normalize
from matplotlib.patches import Patch
from mpl_toolkits.axes_grid1.inset_locator import inset_axes

ROOT = Path(__file__).resolve().parents[1]
REP = ROOT / "reports" / "paper_sync_20261111"
OUT = ROOT / "figures" / "paper_20261111"
OUT.mkdir(parents=True, exist_ok=True)

MILK_XLSX = Path(
    "/Users/dengzhengbin/Library/Application Support/CherryStudio/Data/Files/"
    "01a1c9dd-3032-7658-8d66-b5123f0410b5.xlsx"
)

plt.rcParams.update({
    "font.family": "DejaVu Sans",
    "font.size": 9,
    "axes.titlesize": 10,
    "axes.labelsize": 9,
    "xtick.labelsize": 8,
    "ytick.labelsize": 8,
    "legend.fontsize": 7.5,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "figure.dpi": 120,
    "savefig.dpi": 300,
    "savefig.bbox": "tight",
})

C_BLUE = "#1f4e79"
C_ORANGE = "#c55a11"
C_GREEN = "#548235"
C_PURPLE = "#7030a0"
C_GREY = "#7f7f7f"
CAT_COLORS = {"factor": C_BLUE, "secondary": C_ORANGE, "model": C_GREEN}


def load_milk_groups():
    wb = openpyxl.load_workbook(MILK_XLSX, data_only=True)
    ws = wb["Sheet1"]
    rows = list(ws.iter_rows(values_only=True))
    product = str(rows[0][0]).strip().upper()
    groups = {}
    for row in rows[1:]:
        if row[0] is not None:
            product = "NFDM" if str(row[0]).strip().lower() == "nfdm" else str(row[0]).strip().upper()
        batch, temp, aw, time, value = row[1], row[2], row[3], row[4], row[5]
        if None in (batch, temp, aw, time, value):
            continue
        key = (product, float(temp), float(aw), int(batch))
        groups.setdefault(key, []).append((float(time), float(value)))
    return groups


def condition_means(groups, product, temp, aw):
    batches = [groups[(product, temp, aw, b)] for b in (1, 2, 3)]
    times = sorted(t for t, _ in batches[0])
    means, sds, raw = [], [], []
    for time in times:
        values = []
        for batch in batches:
            values.append(dict(batch)[time])
        means.append(float(np.mean(values)))
        sds.append(float(np.std(values, ddof=1)))
        raw.append(values)
    return np.array(times), np.array(means), np.array(sds), raw


def save(fig, name):
    fig.savefig(OUT / name)
    stem = Path(name).stem
    fig.savefig(OUT / f"{stem}.pdf")
    fig.savefig(OUT / f"{stem}.svg")
    plt.close(fig)


# ── Figure 2: primary fits for T1 and T2 ────────────────────────────────────
def figure_primary():
    groups = load_milk_groups()
    summary = json.loads((REP / "summary_key_numbers.json").read_text())
    fig, axes = plt.subplots(1, 2, figsize=(7.2, 3.1))
    specs = [
        ("A", "WMP", 75.0, 0.10, summary["T1"], C_BLUE),
        ("B", "NFDM", 75.0, 0.10, summary["T2"], C_GREEN),
    ]
    for ax, (panel, product, temp, aw, metric, color) in zip(axes, specs):
        times, means, sds, raw = condition_means(groups, product, temp, aw)
        for batch_idx in range(3):
            ax.plot(times, [row[batch_idx] for row in raw], "o", ms=3.2,
                    mfc="white", mec=C_GREY, mew=0.7, alpha=0.85,
                    label="Batches" if batch_idx == 0 else None)
        ax.errorbar(times, means, yerr=sds, fmt="o", ms=4.2, color=color,
                    ecolor=color, capsize=2.2, lw=0.8, label="Mean ± SD", zorder=4)
        fit_t = np.linspace(0, times.max() * 1.03, 200)
        fit_y = metric["logN0"] - metric["kmax"] * fit_t / np.log(10)
        ax.plot(fit_t, fit_y, "-", color=color, lw=1.8, label="Log-linear fit")
        ax.set_xlabel("Time (min)")
        ax.set_ylabel("log$_{10}$(N / CFU g$^{-1}$)")
        ax.set_title(f"({panel}) {product} {temp:.0f} °C, a$_w$ = {aw:.2f}")
        ax.text(0.03, 0.04,
                f"D = {metric['D']:.1f} min\nR² = {metric['r2']:.3f}\nRMSE = {metric['rmse']:.3f}",
                transform=ax.transAxes, va="bottom", ha="left", fontsize=7.5,
                bbox=dict(boxstyle="round,pad=0.25", fc="white", ec="#d0d0d0", lw=0.5))
        ax.legend(loc="upper right", frameon=False, ncol=1)
    fig.tight_layout()
    save(fig, "Fig2_primary_T1_T2.png")


# ── Secondary surface / parity helper ───────────────────────────────────────
def surface_grid(path):
    df = pd.read_csv(path)
    temps = np.sort(df["temp"].unique())
    aws = np.sort(df["aw"].unique())
    z = df.pivot(index="aw", columns="temp", values="logD").values
    return temps, aws, z


def plot_surface(ax, path, points, title, log_scale=True):
    temps, aws, z = surface_grid(path)
    cf = ax.contourf(temps, aws, z, levels=18, cmap="viridis")
    ax.contour(temps, aws, z, levels=8, colors="white", linewidths=0.35, alpha=0.55)
    obs_t = [p["factors"]["temp"] for p in points]
    obs_aw = [p["factors"]["aw"] for p in points]
    obs_d = [np.log10(p["rawValue"]) if log_scale else p["rawValue"] for p in points]
    ax.scatter(obs_t, obs_aw, c=obs_d, cmap="viridis", edgecolors="white",
               linewidths=0.8, s=34, zorder=5)
    ax.set_xlabel("Temperature (°C)")
    ax.set_ylabel("Water activity (a$_w$)")
    ax.set_title(title)
    return cf


def plot_parity(ax, points, title, color):
    obs = np.log10([p["rawValue"] for p in points])
    pred = np.log10([p["predictedD"] for p in points])
    lo = min(obs.min(), pred.min())
    hi = max(obs.max(), pred.max())
    ax.plot([lo, hi], [lo, hi], "--", color="#555555", lw=1.0, label="1:1")
    ax.scatter(obs, pred, s=26, color=color, edgecolors="white", linewidths=0.6, zorder=3)
    ss_res = np.sum((obs - pred) ** 2)
    ss_tot = np.sum((obs - obs.mean()) ** 2)
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else np.nan
    ax.set_xlabel("Observed log$_{10}$(D / min)")
    ax.set_ylabel("Predicted log$_{10}$(D / min)")
    ax.set_title(title)
    ax.text(0.04, 0.96, f"R² = {r2:.3f}\nRMSE = {np.sqrt(np.mean((obs-pred)**2)):.3f}",
            transform=ax.transAxes, va="top", ha="left", fontsize=7.5)
    ax.legend(loc="lower right", frameon=False)


def draw_secondary_figure(specs, filename):
    """Draw a spacious 2x2 secondary-model figure with a shared colour scale.

    specs: four tuples (points, surface_csv, surface_title, parity_title, color).
    """
    norm = Normalize(vmin=-0.6, vmax=2.7)
    levels = np.linspace(-0.6, 2.7, 27)

    fig = plt.figure(figsize=(7.8, 7.6))
    gs = fig.add_gridspec(
        2, 2, left=0.085, right=0.855, top=0.935, bottom=0.075,
        wspace=0.28, hspace=0.40, height_ratios=[1.0, 0.92],
    )
    axes = np.array([
        [fig.add_subplot(gs[0, 0]), fig.add_subplot(gs[0, 1])],
        [fig.add_subplot(gs[1, 0]), fig.add_subplot(gs[1, 1])],
    ])

    for ax, (points, path, surface_title, _, _) in zip(axes[0], specs):
        temps, aws, z = surface_grid(path)
        cf = ax.contourf(temps, aws, z, levels=levels, cmap="viridis", norm=norm)
        ax.contour(temps, aws, z, levels=8, colors="white", linewidths=0.35, alpha=0.55)
        obs_t = [point["factors"]["temp"] for point in points]
        obs_aw = [point["factors"]["aw"] for point in points]
        obs_log = np.log10([point["rawValue"] for point in points])
        ax.scatter(obs_t, obs_aw, c=obs_log, cmap="viridis", norm=norm,
                   edgecolors="white", linewidths=1.0, s=52, zorder=5)
        ax.set_xlabel("Temperature (°C)", fontsize=10, labelpad=5)
        ax.set_ylabel("Water activity (a$_w$)", fontsize=10, labelpad=5)
        ax.set_title(surface_title, fontsize=9.5, pad=8)
        ax.tick_params(axis="both", labelsize=8.5, length=3, width=0.8)

    cax = fig.add_axes([0.885, 0.58, 0.022, 0.32])
    cbar = fig.colorbar(cf, cax=cax)
    cbar.set_label("log$_{10}$(D / min)", fontsize=10, labelpad=8)
    cbar.ax.tick_params(labelsize=8.5, length=3, width=0.8)
    cbar.outline.set_linewidth(0.5)

    for ax, (points, _, _, parity_title, color) in zip(axes[1], specs):
        obs = np.log10([point["rawValue"] for point in points])
        pred = np.log10([point["predictedD"] for point in points])
        lo = min(obs.min(), pred.min()) - 0.08
        hi = max(obs.max(), pred.max()) + 0.08
        ax.plot([lo, hi], [lo, hi], "--", color="#555555", lw=1.0, label="1:1")
        ax.scatter(obs, pred, s=38, color=color, edgecolors="white",
                   linewidths=0.8, zorder=3)
        ss_res = np.sum((obs - pred) ** 2)
        ss_tot = np.sum((obs - obs.mean()) ** 2)
        r2 = 1 - ss_res / ss_tot if ss_tot > 0 else np.nan
        rmse = np.sqrt(np.mean((obs - pred) ** 2))
        ax.set_xlabel("Observed log$_{10}$(D / min)", fontsize=10, labelpad=5)
        ax.set_ylabel("Predicted log$_{10}$(D / min)", fontsize=10, labelpad=5)
        ax.set_title(parity_title, fontsize=9.5, pad=8)
        ax.set_aspect("equal", adjustable="box")
        ax.set_xlim(lo, hi)
        ax.set_ylim(lo, hi)
        ax.tick_params(axis="both", labelsize=8.5, length=3, width=0.8)
        ax.grid(color="#e6e6e6", lw=0.5, zorder=0)
        ax.text(0.04, 0.96, f"R² = {r2:.3f}\nRMSE = {rmse:.3f}",
                transform=ax.transAxes, va="top", ha="left", fontsize=8.5,
                bbox=dict(boxstyle="round,pad=0.25", fc="white", ec="#d0d0d0", lw=0.5))
        ax.legend(loc="lower right", frameon=False, fontsize=7.5)

    for ax, letter in zip(axes.flat, "ABCD"):
        ax.text(-0.11, 1.07, f"({letter})", transform=ax.transAxes,
                fontsize=11, fontweight="bold", va="top", ha="left")

    save(fig, filename)


def figure_secondary_milk():
    points1 = json.loads((REP / "t1_secondary_points.json").read_text())
    points2 = json.loads((REP / "t2_secondary_points.json").read_text())
    draw_secondary_figure([
        (points1, REP / "t1_secondary_surface.csv",
         "T1 WMP — response surface", "T1 WMP — parity", C_BLUE),
        (points2, REP / "t2_secondary_surface.csv",
         "T2 NFDM — response surface", "T2 NFDM — parity", C_GREEN),
    ], "Fig3_secondary_T1_T2.png")


def figure_secondary_pepper():
    points3 = json.loads((REP / "t3_secondary_points.json").read_text())
    points4 = json.loads((REP / "t4_secondary_points.json").read_text())
    draw_secondary_figure([
        (points3, REP / "t3_secondary_surface.csv",
         "T3 E. faecium — response surface", "T3 E. faecium — parity", C_ORANGE),
        (points4, REP / "t4_secondary_surface.csv",
         "T4 Salmonella — response surface", "T4 Salmonella — parity", C_PURPLE),
    ], "Fig4_secondary_T3_T4.png")


# ── Figure 5: hold-out diagnostics ─────────────────────────────────────────
def figure_holdout():
    hold = json.loads((REP / "holdout_t1_t2.json").read_text())
    fig, axes = plt.subplots(2, 2, figsize=(7.4, 5.8))

    for row, (key, color) in enumerate((("T1", C_BLUE), ("T2", C_GREEN))):
        data = hold[key]
        pm = data["parameterMetrics"]
        cm = data["curveMetrics"]
        obs_d = data["observedD"]
        pred_d = data["predictedD"]

        ax = axes[row, 0]
        ax.hlines(0, min(obs_d, pred_d), max(obs_d, pred_d), color="#9a9a9a", lw=1.4, zorder=1)
        ax.scatter([obs_d], [0], s=70, color=color, edgecolors="white",
                   linewidths=0.8, zorder=3, label="Observed")
        ax.scatter([pred_d], [0], s=70, facecolors="white", edgecolors=color,
                   linewidths=1.6, zorder=4, label="Predicted")
        ax.set_yticks([0])
        ax.set_yticklabels(["Held-out\ncondition"])
        ax.set_xlabel("D (min)")
        ax.set_xlim(0, max(obs_d, pred_d) * 1.28)
        ax.set_ylim(-0.45, 0.45)
        ax.set_title(f"({'A' if key == 'T1' else 'C'}) {key} hold-out — parameter level")
        ax.text(0.04, 0.94,
                f"B$_f$ = {pm['Bf']:.2f}; A$_f$ = {pm['Af']:.2f}\nlog$_{{10}}$(D) RMSE = {pm['RMSE']:.3f}",
                transform=ax.transAxes, va="top", ha="left", fontsize=8)
        ax.legend(loc="lower right", frameon=False)

        ax = axes[row, 1]
        points = data["points"]
        t = np.array([p["t"] for p in points])
        obs = np.array([p["observed"] for p in points])
        sds = np.array([p["sd"] for p in points])
        params = data["conditionalParams"]
        fit_t = np.linspace(0, t.max() * 1.03, 200)
        fit_y = params["logN0"] - params["kmax"] * fit_t / np.log(10)
        ax.errorbar(t, obs, yerr=sds, fmt="o", ms=4.4, color=color, ecolor=color,
                    capsize=2.2, lw=0.9, label="Observed mean ± SD", zorder=4)
        ax.plot(fit_t, fit_y, "-", color="#333333", lw=1.7, label="Hold-out prediction")
        ax.set_xlabel("Time (min)")
        ax.set_ylabel("log$_{10}$(N / CFU g$^{-1}$)")
        ax.set_title(f"({'B' if key == 'T1' else 'D'}) {key} hold-out — curve level")
        ax.set_ylim(min(obs - sds) - 0.35, max(obs + sds) + 0.35)
        ax.text(0.04, 0.94,
                f"B$_f$ = {cm['Bf']:.2f}; A$_f$ = {cm['Af']:.2f}\nRMSE = {cm['RMSE']:.3f} (n = {cm['n']})",
                transform=ax.transAxes, va="top", ha="left", fontsize=8)
        ax.legend(loc="lower left", frameon=False)

    fig.tight_layout()
    save(fig, "Fig5_holdout_T1_T2.png")


# ── Figure 6: Monte Carlo and sensitivity ──────────────────────────────────
def figure_mc():
    bands = pd.read_csv(REP / "mc_percentile_bands_t1.csv")
    endpoint = pd.read_csv(REP / "mc_endpoint_t1.csv")
    oat = pd.read_csv(REP / "sensitivity_oat_t1.csv")
    src = pd.read_csv(REP / "sensitivity_src_t1.csv")
    summary = json.loads((REP / "figure_mc_summary_t1.json").read_text())["summary"]

    fig, axes = plt.subplots(2, 2, figsize=(7.4, 6.2))

    ax = axes[0, 0]
    ax.fill_between(bands["t"], bands["p5"], bands["p95"], color=C_BLUE, alpha=0.15, label="5–95th")
    ax.fill_between(bands["t"], bands["p25"], bands["p75"], color=C_BLUE, alpha=0.30, label="25–75th")
    ax.plot(bands["t"], bands["p50"], color=C_BLUE, lw=1.7, label="Median")
    ax.axhline(bands["p5"].iloc[0] - 5, color=C_ORANGE, ls="--", lw=1.0, label="5-log target")
    ax.set_xlabel("Time (min)")
    ax.set_ylabel("log$_{10}$(N / CFU g$^{-1}$)")
    ax.set_title("(A) T1 WMP — Monte Carlo survival bands")
    ax.set_xlim(0, 120)
    ax.legend(loc="upper right", frameon=False, fontsize=7)
    ax.text(0.03, 0.04,
            f"60-min success = {summary['successPercent']:.1f}%\n99% time-to-target = {summary['safeTimeUI']:.1f} min",
            transform=ax.transAxes, va="bottom", ha="left", fontsize=8,
            bbox=dict(boxstyle="round,pad=0.25", fc="white", ec="#d0d0d0", lw=0.5))

    ax = axes[0, 1]
    ax.hist(endpoint["reduction60"], bins=35, color=C_BLUE, alpha=0.78, edgecolor="white", linewidth=0.3)
    ax.axvline(5, color=C_ORANGE, ls="--", lw=1.1, label="5-log target")
    ax.set_xlabel("Reduction at 60 min (log$_{10}$)")
    ax.set_ylabel("Count")
    ax.set_title("(B) T1 WMP — endpoint distribution")
    ax.legend(loc="upper left", frameon=False, fontsize=7)

    for ax, df, title in (
        (axes[1, 0], oat, "(C) Local OAT influence"),
        (axes[1, 1], src, "(D) SRC normalized coefficients"),
    ):
        data = df.sort_values("contribution", ascending=True)
        colors = [CAT_COLORS.get(category, C_GREY) for category in data["category"]]
        ax.barh(data["label"], data["contribution"], color=colors, height=0.62)
        ax.set_xlabel("Relative influence (%)")
        ax.set_title(title)
        for y, value in enumerate(data["contribution"]):
            ax.text(value + max(data["contribution"]) * 0.015, y, f"{value:.1f}",
                    va="center", fontsize=7)
        ax.set_xlim(0, max(data["contribution"]) * 1.18)

    handles = [Patch(color=CAT_COLORS["factor"], label="Process factor"),
               Patch(color=CAT_COLORS["secondary"], label="Secondary parameter"),
               Patch(color=CAT_COLORS["model"], label="Primary parameter")]
    fig.legend(handles=handles, loc="lower center", ncol=3, frameon=False,
               bbox_to_anchor=(0.5, -0.01))
    fig.tight_layout(rect=[0, 0.04, 1, 1])
    save(fig, "Fig6_mc_sensitivity_T1.png")


def figure_supplementary_sensitivity():
    morris = pd.read_csv(REP / "sensitivity_morris_t1.csv")
    sobol = pd.read_csv(REP / "sensitivity_sobol_t1.csv")
    fig, axes = plt.subplots(1, 2, figsize=(7.2, 3.2))
    for ax, df, title, value_key in (
        (axes[0], morris, "(S1) Morris screening", "muStar"),
        (axes[1], sobol, "(S2) Sobol total effects", "st"),
    ):
        df = df.sort_values("contribution", ascending=True)
        colors = [CAT_COLORS.get(category, C_GREY) for category in df["category"]]
        ax.barh(df["label"], df["contribution"], color=colors, height=0.62)
        ax.set_xlabel("Normalized influence (%)")
        ax.set_title(title)
        for y, value in enumerate(df["contribution"]):
            ax.text(value + max(df["contribution"]) * 0.015, y, f"{value:.1f}",
                    va="center", fontsize=6.5)
        ax.set_xlim(0, max(df["contribution"]) * 1.18)
    fig.tight_layout()
    save(fig, "FigS1_S2_morris_sobol_T1.png")

    # Separate panels for the supplementary material.
    for df, name, title in ((morris, "FigS1_morris_T1.png", "(S1) Morris screening"),
                            (sobol, "FigS2_sobol_T1.png", "(S2) Sobol total effects")):
        fig, ax = plt.subplots(figsize=(6.4, 3.0))
        data = df.sort_values("contribution", ascending=True)
        colors = [CAT_COLORS.get(category, C_GREY) for category in data["category"]]
        ax.barh(data["label"], data["contribution"], color=colors, height=0.62)
        ax.set_xlabel("Normalized influence (%)")
        ax.set_title(title)
        for y, value in enumerate(data["contribution"]):
            ax.text(value + max(data["contribution"]) * 0.015, y, f"{value:.1f}",
                    va="center", fontsize=7)
        ax.set_xlim(0, max(data["contribution"]) * 1.18)
        fig.tight_layout()
        save(fig, name)


# ── Figure 7: dynamic simulation T5 ────────────────────────────────────────
def figure_dynamic():
    data = json.loads((REP / "figure_dynamic_t5.json").read_text())
    sim = data["simulation"]
    t = np.array([row["t"] for row in sim])
    logn = np.array([row["logN"] for row in sim])
    fval = np.array([row["F"] for row in sim])
    temp = np.array([row["env"]["temp"] for row in sim])
    obs = data["config"]["observations"]

    fig, axes = plt.subplots(2, 1, figsize=(7.2, 5.4), sharex=True,
                             gridspec_kw={"height_ratios": [0.5, 1.7]},
                             constrained_layout=True)

    ax = axes[0]
    ax.plot(t, temp, color=C_ORANGE, lw=1.7)
    ax.fill_between(t, 25, temp, color=C_ORANGE, alpha=0.12)
    ax.axvline(28, color="#777777", ls=":", lw=0.9)
    ax.set_ylabel("Temperature (°C)")
    ax.set_title("(A) Linear heating profile")
    ax.set_ylim(25, 70)

    ax = axes[1]
    ax.plot(t, logn, color=C_BLUE, lw=1.8, label="Predicted survival")
    ax.axvline(28, color="#777777", ls=":", lw=0.9)
    ax.set_xlabel("Time (min)")
    ax.set_ylabel("log$_{10}$(N / CFU g$^{-1}$)")
    ax.set_title("(B) Dynamic survival and cumulative lethality")
    ax2 = ax.twinx()
    ax2.plot(t, fval, color=C_ORANGE, lw=1.4, ls="--", label="Cumulative F-value")
    ax2.set_ylabel("F-value (min at 60 °C)", color=C_ORANGE, labelpad=8)
    ax2.tick_params(axis="y", colors=C_ORANGE)
    ax2.spines["right"].set_visible(True)
    ax2.spines["right"].set_color(C_ORANGE)
    ax.scatter([point["t"] for point in obs], [point["logN"] for point in obs],
               facecolors="none", edgecolors="#333333", s=20, linewidths=0.8,
               label="Digitized observations", zorder=4)
    ax.text(0.03, 0.04,
            f"RMSE = {data['observationFit']['rmse']:.3f} log$_{{10}}$ CFU g$^{{-1}}$\n(n = {data['observationFit']['n']})",
            transform=ax.transAxes, va="bottom", ha="left", fontsize=8,
            bbox=dict(boxstyle="round,pad=0.25", fc="white", ec="#d0d0d0", lw=0.5))
    lines1, labels1 = ax.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax.legend(lines1 + lines2, labels1 + labels2, loc="upper right", frameon=False, fontsize=7)
    ax.set_xlim(0, 29)
    save(fig, "Fig7_dynamic_T5.png")




if __name__ == "__main__":
    figure_primary()
    figure_secondary_milk()
    figure_secondary_pepper()
    figure_holdout()
    figure_mc()
    figure_supplementary_sensitivity()
    figure_dynamic()
    print("figures written to", OUT)
