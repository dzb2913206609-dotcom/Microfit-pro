# MicroFit Pro

MicroFit Pro is a browser-executed platform for predictive microbial inactivation modeling. It integrates primary model fitting, secondary environmental modeling, dynamic process simulation, Monte Carlo uncertainty propagation, and sensitivity analysis for thermal and non-thermal processing technologies.

The app is designed to support the accompanying paper:

> MicroFit Pro: A Web-Based Platform for Predictive Microbial Inactivation Modeling and Sensitivity Analysis Across Processing Technologies

## Main Features

- 11 primary microbial inactivation models, including log-linear, shoulder-tail, Weibull, biphasic, Gompertz, and Baranyi-type forms.
- 43 secondary models across thermal treatment, HPP, photoinactivation, PEF, chemical disinfection, irradiation, and custom factor modes.
- AICc-based model ranking, residual diagnostics, parameter standard errors, and confidence intervals.
- Secondary response surfaces, contour maps, 3D surfaces, and observed-vs-predicted plots.
- Hold-out prediction diagnostics with bias factor, accuracy factor, RMSE, bias direction, and evidence-level labels.
- Dynamic simulation under time-varying processing profiles with technology-specific cumulative exposure metrics.
- Monte Carlo uncertainty propagation with covariance-aware parameter sampling.
- OAT, SRC, Morris, and Sobol first-order/total-effect sensitivity analysis.
- Reproducible stochastic analyses through user-controlled random seeds.
- CSV, SVG, PNG, and JSON export for manuscript figures, tables, and supplementary materials.

## Reproducing Paper Examples

Use the `Examples` menu in the app header to load the manuscript samples. Each loaded sample displays its source, x-axis unit, default chart behavior, and secondary-model availability.

| Example | Mode | X-axis | Default chart | Intended use |
| --- | --- | --- | --- | --- |
| `T1 Milk powder thermal demo (WMP)` | Thermal | Time (min) | Log-linear fitted curves | Primary fitting and Extended Bigelow T-aw secondary modeling of the Wei et al. (2020) whole milk powder data |
| `T2 Milk powder thermal demo (NFDM)` | Thermal | Time (min) | Log-linear fitted curves | Primary fitting and Extended Bigelow T-aw secondary modeling of the Wei et al. (2020) nonfat dry milk data |
| `T3 Ground black pepper D-value demo (E. faecium)` | Thermal | Time (min) | Secondary D-value fit | Extended Bigelow secondary fitting of 27 literature D-values for *E. faecium* |
| `T4 Ground black pepper D-value demo (Salmonella)` | Thermal | Time (min) | Secondary D-value fit | Extended Bigelow secondary fitting of 27 literature D-values for Salmonella |
| `T5 Full thermal workflow demo (Huang 2013)` | Thermal | Time (min) | Primary fits, secondary Bigelow, dynamic profile | Complete primary → secondary → dynamic workflow using digitized Huang (2013) isothermal and dynamic data |
| `N1 Irradiation primary fitting demo — N1-Li, N1-Se, N1-Ec` | Irradiation | Absorbed Dose (kGy) | Points only | Primary-model data visualization and optional fitting |
| `N2 Photoinactivation primary fitting demo — N2-Ec, N2-Se, N2-Lm` | Photoinactivation | Fluence (J/cm²) | Points only | Primary-model data visualization and optional fitting |
| `N3 HPP primary fitting demo — N3-St, N3-Ec, N3-Lm` | HPP | Time (min) | Points only | Primary-model data visualization and optional fitting |
| `N4 Chemical disinfection primary fitting demo — N4-Bs, N4-Sa` | Chemical | Time (min) | Points only | Primary-model data visualization and optional fitting |
| `N5 PEF primary fitting demo — N5-Lm, N5-Sa` | PEF | Time (μs) | Points only | Primary-model data visualization and optional fitting |

The T1 and T2 milk powder examples load `combine_survival.xlsx` from Wei et al. (2020, *J. Dairy Sci.* 103:6904-6917). Each sample contains 9 temperature-aw conditions (75, 80, and 85 °C across aw 0.10, 0.20, and 0.30); each point is the mean of three biological batches, and every original measurement, batch identifier, and worksheet row is retained. The secondary defaults use `LOG_LINEAR / D / Extended Bigelow` with `T_ref = 80 °C` and `aw_ref = 0.20`. The published universal model is:

```text
D = 32.58 × 10^((0.12 - aw)/0.47) × 10^((75.7 - T)/16.65)
```

The T3 and T4 black pepper examples load the D-values from Wei et al. (2021, *Int. J. Food Microbiol.* 344:109114). Each sample preloads 27 replicate D-values (3 temperatures × 3 aw levels × 3 replicates) into the `Literature D-value Import` table and opens the Secondary models tab. The secondary defaults use `LOG_LINEAR / D / Extended Bigelow` with `T_ref = 75 °C` and `aw_ref = 0.45`. The published modified Bigelow parameters are:

```text
E. faecium: D_ref = 14.9 min, z_T = 13.5 °C, z_aw = 0.31
Salmonella: D_ref = 8.94 min, z_T = 13.9 °C, z_aw = 0.30
```

The app fits log10(D) by ordinary least squares, whereas the paper fitted D directly, so the fitted parameters can differ slightly from the published values.

The T1 and T2 examples exercise the complete thermal workflow:

1. Primary model fitting and AICc ranking for all 11 candidate models.
2. Secondary model fitting with an Extended Bigelow temperature-aw surface.
3. Monte Carlo uncertainty and sensitivity analysis.

The T5 example now demonstrates the complete thermal workflow from primary fitting to secondary modelling and dynamic prediction:

1. Four digitized isothermal survival curves from Huang (2013) Fig. 1 at 57, 60, 63 and 66 °C (aw = 1). The 54 °C condition is not present in Fig. 1.
2. Log-linear primary fits give D = 304.48, 80.81, 17.73 and 5.11 s, with local standard errors and 95% confidence intervals reported in Supplementary Table S5.
3. A Bigelow secondary fit to these D values at T_ref = 60 °C gives D_ref = 1.283 min (77.0 s) and z = 5.014 °C.
4. The dynamic simulation uses the estimated parameters, a fixed log10(N0) = 9, the linear heating profile from 30 to 65 °C over 28 min, and 500 base integration steps. The 33 digitized dynamic observations are used only for forward comparison, not for parameter estimation.

The N1-N5 examples intentionally omit treatment-condition metadata. They are provided as primary-model reproducibility samples only. After loading one of these examples, select one or more models in `Model Selection` to draw fitted curves.

For reproducible Monte Carlo and sensitivity outputs, keep a fixed random seed such as the default:

```text
20260430
```

Leave the seed field blank to auto-generate a new seed on each Monte Carlo run, or click `Generate` to create and keep a new seed for later reproduction. Export JSON reports from the secondary model and Monte Carlo panels to archive the full analysis state, model parameters, settings, and the seed used for that run.

Current manuscript outputs can be regenerated with `node scripts/recompute_paper_20261111.mjs`; exact settings and numerical diagnostics are saved in `reports/paper_sync_20261111/` as JSON/CSV files. Manuscript figures can be regenerated with `python3 scripts/generate_figures_20261111.py`. Prediction RMSE uses √(SSE/n), residual SE uses √[SSE/(n−k)], adjusted R² uses residual degrees of freedom n−k, and Gaussian AICc counts K=k+1 including residual variance. Secondary likelihood comparisons include response Jacobians on a common observed scale.

Morris/Sobol environmental ranges default to the intersection of bound secondary calibration boxes. Fixed factors are omitted; the rectangular screening domain does not validate every combination. Sensitivity CSV exports include ranges and estimation warnings. Normalized sensitivity scores describe relative influence, with limited variance interpretation for correlated SRC inputs and overlapping Sobol effects. Sobol S1 estimates main-effect shares; ST includes interactions and is more stable at small sample sizes than S1. The N5-Sa example uses the 15 kV/cm, pH 7.0 curve; its Weibull scale is consistent with the source estimate, and the reported local SE should still be considered when interpreting the fitted parameters.

## Figure And Table Export

Primary and secondary Plotly charts export manuscript-ready SVG and PNG files using a 1200 x 750 canvas at 3x scale. The export buttons preserve axis titles, units, legends, and chart settings. Primary residual plots, dynamic simulation charts, sensitivity charts, model-comparison tables, secondary fit reports, Monte Carlo summaries, and validation results can also be exported for supplementary materials.

For publication figures, verify the x-axis unit before export:

- Irradiation examples use absorbed dose.
- Photoinactivation examples use fluence.
- PEF examples can use min, ms, or μs; the N5 sample uses μs.
- Thermal, HPP, and chemical examples use time unless manually changed.

## Data Input

Primary survival data can be pasted or uploaded as CSV/TXT/TSV. The first column is the treatment axis, followed by one or more replicate log10 survival values:

```text
time    rep1    rep2    rep3
0       7.00    7.02    6.98
10      5.20    5.10    5.25
20      3.40    3.35    3.48
```

For photoinactivation and irradiation, the treatment axis can be switched to fluence or absorbed dose. For PEF, treatment time can be entered in min, ms, or microseconds.

Primary models fit all supplied individual log10 survival observations. SSE, RMSE, R², adjusted R², AICc, residuals and parameter uncertainty use the same observations; `n` counts those values. Charts retain means and SD. If only a mean or a digitized point is supplied, it contributes one observation; replicate counts and SD are never used to fabricate individual values. The likelihood assumes independent, homoscedastic Gaussian errors. Secondary regression remains based on condition-level primary parameter estimates; linked curve RMSE uses all available survival observations.

## Development

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Build the web app:

```bash
npm run build
```

Run lint checks:

```bash
npm run lint
```

Run the Tauri desktop app in development:

```bash
npm run tauri:dev
```

This command starts the frontend on port 1420 before launching the desktop window. A normal `npm run dev` session can continue using Vite's default port independently.

Build the Tauri desktop app:

```bash
npm run tauri:build
```

## Reproducibility Notes

Monte Carlo, Morris, and Sobol analyses are stochastic. Set a fixed random seed before running these analyses if results will be reported in a manuscript. Leave the seed field blank only when you intentionally want a new random run; the generated seed is recorded in JSON exports. The same input data, model settings, sample count, and seed should reproduce the same stochastic outputs.

JSON exports are intended as archival analysis records. They include model settings, selected parameters, uncertainty settings, covariance mode, seed, and output summaries.

## Citation

If you use MicroFit Pro in a manuscript, cite the accompanying paper and the software record. A machine-readable citation template is provided in [CITATION.cff](CITATION.cff).

## Limitations

MicroFit Pro uses a frequentist two-step workflow for primary and secondary fitting. It does not currently implement one-step global fitting or Bayesian MCMC estimation. Dynamic simulation is restricted to log-linear-compatible kinetic interpretations when instantaneous rate or D-value updates are scientifically defensible.

## License

MIT License. See [LICENSE](LICENSE).
