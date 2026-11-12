import { useState } from 'react';

const SECTIONS = [
  {
    id: 'overview',
    title: 'Overview',
    content: `MicroFit Pro is a browser-based analytical platform for microbial inactivation kinetics, integrating five core analysis stages:

• Primary model fitting — mathematical modelling of survival curves under fixed conditions
• Secondary model fitting — quantifying the dependence of kinetic parameters on environmental factors
• Dynamic simulation — predicting microbial survival under time-varying conditions
• Monte Carlo uncertainty analysis — quantifying prediction confidence intervals
• Sensitivity analysis — identifying the key factors driving prediction outcomes

Six processing technologies are supported: thermal treatment, high-pressure processing (HPP), photoinactivation, pulsed electric fields (PEF), chemical disinfection, and irradiation.

All computations are executed client-side in the browser — no server required. Your data never leaves your device, and the platform works fully offline.`,
  },
  {
    id: 'quickstart',
    title: 'Quick Start',
    content: `1. Select a processing technology
   Choose the appropriate technology mode from the top navigation bar (Thermal, HPP, Photo, PEF, Chemical, Irradiation), or select Custom to define your own factors.

2. Enter data
   In the left panel, enter or paste time–survival data (time t and log₁₀N). You can add multiple datasets, each corresponding to different processing conditions.

3. View fitting results
   The platform automatically fits all 11 primary models. The right panel displays fitted curves and statistical results, ranked by AICc.

4. Secondary modelling
   Switch to the "Secondary models" tab. The platform automatically establishes relationships between kinetic parameters and environmental factors.

5. Dynamic simulation
   Switch to the "Dynamic simulation" tab. Define time-varying processing profiles and predict microbial survival trajectories.`,
  },
  {
    id: 'primary',
    title: 'Primary Model Fitting',
    content: `Primary models describe how the surviving microbial population changes with treatment time under fixed conditions. The platform includes 11 models in five categories:

Log-linear family
• Log-linear — classical first-order kinetics; parameter: D-value (decimal reduction time)
• Log-linear + tail — first-order model with a resistant subpopulation

Shoulder-tail family (Geeraerd framework)
• Linear + shoulder — log-linear inactivation with an initial shoulder phase
• Linear + shoulder + tail — shoulder and residual population combined

Weibull family
• Weibull — nonlinear survival curves; p < 1 produces concave (upward) curves, p > 1 produces convex (downward) curves
• Weibull + tail — Weibull model with a residual subpopulation

Biphasic family
• Biphasic — two-subpopulation model with distinct inactivation rates
• Biphasic + shoulder — biphasic model with an initial shoulder
• Double Weibull — superposition of two Weibull distributions

Sigmoidal family
• Modified Gompertz — S-shaped inactivation curve
• Baranyi Inactivation — adapted from the Baranyi and Roberts growth framework

Model selection
The platform ranks models automatically using the corrected Akaike Information Criterion (AICc). The model with the lowest AICc is selected as the best fit. RMSE, adjusted R², and the Shapiro-Wilk residual normality test are provided as supplementary diagnostics.

Statistical definitions
RMSE = sqrt(SSE/n). Residual standard error = sqrt(SSE/(n-k)) and is used for local parameter uncertainty; k counts estimated regression parameters and excludes fixed parameters. Adjusted R² = 1 - (1-R²)(n-1)/(n-k). Negative R² is retained; centered R² is unavailable for constant observations.

AICc uses a Gaussian residual likelihood with K = k+1, including estimated residual variance: n ln(SSE/n) + 2K + 2K(K+1)/(n-K-1), with constants common to the compared data omitted. It is unavailable when n ≤ k+2, the fit is invalid, or SSE is exactly zero. Secondary likelihoods include the response-transform Jacobian so models are compared on the same observed target scale. Transformed-response RMSE and raw-target RMSE have distinct labels. Rankings only compare converged, valid fits using the same observations.

The Shapiro-Wilk p-value uses the AS R94 approximation for 3–5000 finite residuals; it is unavailable for constant residuals. Parameter intervals are local covariance approximations. Monte Carlo adds no artificial minimum parameter error; absent or zero covariance contributes no fitted primary-parameter noise.

Dose-based axis mode
For photoinactivation and irradiation, a dose-based axis mode is available. The independent variable switches from time to fluence (J/cm²) or absorbed dose (kGy).`,
  },
  {
    id: 'data-input',
    title: 'Data Input',
    content: `Data format
Enter one data point per line in the format "time  log₁₀N", separated by spaces or tabs.

Adding datasets
Click "Add Dataset" to create a new dataset. Each dataset requires the corresponding processing conditions (e.g., temperature, water activity), which are used for subsequent secondary model fitting.

Condition settings
Depending on the selected technology mode, different environmental factors are required:
• Thermal: temperature (°C), water activity (aw), pH
• HPP: pressure (MPa), temperature (°C), water activity (aw)
• Photoinactivation: light intensity (mW/cm²)
• PEF: electric field strength (kV/cm)
• Chemical disinfection: sanitiser concentration (mg/L)
• Irradiation: dose rate (kGy/min)

Multiple datasets
At least 2 datasets under different conditions are required for secondary model fitting. Providing more condition combinations improves the quality of the secondary model fit.

Data requirements
• Each dataset requires a minimum of 3 data points
• Time values must be non-negative
• log₁₀N values typically decrease from the initial log₁₀(N₀)`,
  },
  {
    id: 'secondary',
    title: 'Secondary Model Fitting',
    content: `Secondary models describe how primary model parameters (e.g., D-value, δ) change as a function of environmental factors.

The platform supports 43 secondary models across six processing technologies. Commonly used models include:

Classical models
• Bigelow z-value model — log-linear relationship between D-value and a single factor
• Extended Bigelow — multi-factor extensions (e.g., T + aw, T + aw + pH)
• Arrhenius model — exponential relationship between rate constant and temperature
• Arrhenius-Eyring — dual-factor model (temperature + pressure)
• Ratkowsky square-root model

Fitting procedure
1. The platform extracts the target parameter from each dataset's primary fit results
2. An appropriate response transformation is applied (log₁₀ for D-values, ln for rate constants, square root for Ratkowsky)
3. Regression establishes the parameter–factor relationship
4. The inverse transformation predicts parameters at arbitrary conditions

Visualisation
• Contour map — parameter response surface over two factors (50 × 50 grid)
• 3D response surface — interactive three-dimensional visualisation
• Observed vs. predicted parity plot — 1:1 reference line to assess fit quality

Hold-out prediction diagnostic
The platform provides a hold-out prediction diagnostic to compare secondary-model predictions with datasets not included in calibration. The output is a diagnostic summary, not a pass-fail validation decision.

Two validation modes are available, selectable via a toggle in the results panel:

Parameter-level (recommended)
Each validation dataset is independently fitted with the selected primary model to obtain observed target values (e.g., D-value, δ, or kmax). The secondary model then predicts the same target for the corresponding conditions. Bf and Af are computed by comparing observed vs. predicted values in log₁₀ space (Ross, 1996). Each validation dataset requires at least 3 data points for independent fitting.

Curve-level
The fitted initial count from each held-out survival curve is retained, while the secondary-model-predicted kinetic parameter is propagated through the primary model. The resulting conditional survival curve is compared point-by-point against the observed data. Bf and Af are computed from the residuals across all time points. This mode is retained as a supplementary diagnostic of curve-shape agreement.

Metrics
• Bf (bias factor) — systematic over- or under-prediction. Bf = 1 indicates no bias.
• Strict Bf zone — predefined Bf zones used for transparent reporting:
  - 0.95–1.05: Excellent fit
  - 0.85–0.95 or 1.05–1.15: Acceptable
  - outside 0.85–1.15: Outside preset zone
• Af (accuracy factor) — average absolute deviation. Closer to 1 is better.
• Diagnostic agreement — Af-based magnitude summary:
  - ≤ 1.25: Close agreement
  - > 1.25 to 1.50: Moderate agreement
  - > 1.50 to 2.00: Appreciable discrepancy
  - > 2.00: Large discrepancy
• RMSE — root mean square error of the comparison.

Evidence level
The panel automatically summarizes the evidence level from the number and declared source of validation datasets: single-condition diagnostic, multi-condition hold-out check, external validation dataset, or exploratory diagnostic.

Extrapolation warning
Conditions falling outside the calibration range are automatically flagged with a ⚠ symbol.`,
  },
  {
    id: 'dynamic',
    title: 'Dynamic Simulation',
    content: `The dynamic simulation module predicts microbial survival under time-varying processing conditions.

How it works
1. The user defines time–factor profiles (e.g., heating ramp – holding – cooling)
2. At each time step, the secondary model computes the instantaneous kinetic parameters
3. The instantaneous log-survival rate is integrated with Simpson quadrature on a 500-step base grid augmented with every profile breakpoint; cumulative exposure uses the same interval quadrature
4. The output includes a survival curve and cumulative lethality

Steps
1. Complete secondary model fitting first
2. Switch to the "Dynamic simulation" tab
3. Define how processing conditions change over time in the profile table
4. Run the simulation and view the predicted results

Cumulative lethality
The platform automatically computes the appropriate cumulative lethality metric for each technology:
• Thermal — F-value (min)
• Photoinactivation — cumulative fluence (mJ/cm²)
• PEF — specific energy (kJ/kg)
• Chemical disinfection — CT value (mg·min/L)
• Irradiation — absorbed dose (kGy)
• HPP — log reduction read directly from the ODE state

Environmental variables at intermediate time points are obtained by piecewise linear interpolation.`,
  },
  {
    id: 'montecarlo',
    title: 'Monte Carlo Uncertainty',
    content: `The Monte Carlo module quantifies prediction uncertainty through random sampling.

Parameter sampling
• Multivariate normal sampling via Cholesky decomposition of the variance–covariance matrix from the fitting procedure
• Strictly positive parameters (e.g., kmax, δ, p) are sampled in log-normal space to prevent negative values
• For parameters with CV > 100%, deviates are truncated to [-3, +3] to avoid extreme outliers
• If the covariance matrix is non-positive-definite, independent diagonal sampling is used as a fallback

Extended Monte Carlo
Simultaneously propagates parameter uncertainty and environmental factor variability:
• Environmental factors are independently perturbed according to user-specified standard deviations
• Perturbed conditions are passed through the secondary model to re-predict primary parameters
• Model parameter covariance noise is then added on top

Output
• Predicted median with 5th, 25th, 75th, and 95th percentile envelopes
• Inactivation success rate (proportion of iterations achieving the target log reduction)
• Suggested safe treatment time (time required to ensure target achievement at the specified confidence level)

How to use
In the Monte Carlo panel at the bottom of the Secondary models page, set the number of iterations, target log reduction, confidence level, and process control standard deviations for each factor, then run the analysis. Each sampled curve uses its own initial population for the reduction target. Suggested treatment coordinates use the selected time or dose unit and are limited to the saved simulation grid.`,
  },
  {
    id: 'sensitivity',
    title: 'Sensitivity Analysis',
    content: `The sensitivity analysis module identifies which input factors have the greatest impact on prediction outcomes, providing guidance for process optimisation and experimental design.

OAT local sensitivity analysis
• Each input is perturbed by ±5% around its nominal value, one at a time
• All other inputs are held fixed
• A tornado chart displays the local sensitivity ranking
• Reflects local influence near the current operating point

SRC relative regression influence
• Based on Standardised Regression Coefficients (SRC)
• Independently sampled uncertainty sources and the selected output are standardised to zero mean and unit variance; factor-derived kinetic values are not counted again as independent causes
• Normalised SRC² gives a relative linear attribution score; correlated sources and nonlinear responses limit its interpretation as a variance contribution
• R² measures the overall linearity of the input–output relationship

Three input categories
• Process control factors — environmental variables (temperature, water activity, etc.)
• Primary model parameters — fitted kinetic constants
• Secondary model parameters — fitted regression coefficients (Dref, zT, zaw, etc.)

Morris reports effect magnitudes and variability. Sobol first-order indices (S1) estimate main-effect shares, while total-effect indices (ST) include main effects plus interactions; neither establishes whether increasing an input increases or decreases the output. Global environmental ranges default to the intersection of bound secondary-model calibration boxes, with fixed factors omitted. This rectangular domain does not validate every factor combination. Actual input ranges and estimation warnings are included in the CSV export. Estimates require sample-size and seed stability checks; S1 can be negative or noisy in finite samples, and ΣST > 1 can reflect interactions or sampling uncertainty. An unavailable selected algorithm is reported explicitly.

Normalized influence scores compare inputs within the selected scenario and ranges. They are not additive explained-variance fractions and do not establish process risk or justify fixing an input. Use the rankings to guide further checks and data collection.`,
  },
  {
    id: 'custom',
    title: 'Custom Mode',
    content: `Custom mode allows users to define their own experimental factors, suitable for emerging or non-standard processing technologies.

Setup steps
1. Select "Custom" from the top navigation bar
2. Define the primary x-axis and 1–3 condition factors with name, abbreviation, and unit
3. Click "Start" to confirm the configuration
4. The platform automatically generates corresponding z-value secondary models

Each factor requires:
• Name — full factor name (e.g., "Temperature")
• Short label — abbreviation (e.g., "T")
• Unit — measurement unit (e.g., "°C")

Once configured, the workflow is identical to the built-in technology modes.`,
  },
  {
    id: 'export',
    title: 'Exporting Results',
    content: `Chart export
All charts are rendered with Plotly.js and support:
• Hover to view data point details
• Box-select to zoom in / double-click to reset
• Click the camera icon in the top-right corner to export as PNG
• Click legend items to toggle curve visibility

Data export
• Fitted parameter tables can be copied directly
• Model comparison results include AICc, RMSE, adj. R², and other statistics
• Monte Carlo results include percentiles and success rates

Recommended workflow
1. Complete primary fitting → save model comparison table and fitted curves
2. Complete secondary fitting → export response surface plots and parameter tables
3. Run Monte Carlo → save uncertainty envelopes and sensitivity charts
4. Dynamic simulation → export survival prediction curves and cumulative lethality`,
  },
  {
    id: 'faq',
    title: 'FAQ',
    content: `Q: Why do some models fail to fit?
A: Fitting may not converge when there are too few data points (< 3) or the data shape is incompatible with the model. Add more data points or check data quality.

Q: Is it normal for AICc values to be negative?
A: Yes. The absolute value of AICc has no meaning — only relative comparisons between models matter. Lower is better.

Q: What if two parameters are highly correlated?
A: The curve may fit well while the individual parameters are poorly separated. Consider reparameterizing, adding data that distinguishes the parameters, or fixing one parameter only when an independent value is available. Fixing one parameter makes the other estimate conditional and does not restore separate identifiability.

Q: What should I do if a parameter has a very large standard error or is near a bound?
A: Treat it as an identifiability warning, not a reliable estimate. Check the parameter table, confidence intervals, boundary warnings and residual degrees of freedom; consider a simpler model or reduced parameterization; add informative observations or replicates; and fix a parameter only when an independent value is available. The program does not automatically choose a parameter to hold constant.

Q: How many datasets are needed for secondary model fitting?
A: At least 2 datasets under different conditions. More factors require more condition combinations. A minimum of 3 levels per factor is recommended.

Q: How many Monte Carlo iterations should I use?
A: 1,000 iterations generally provide stable percentile estimates. For more precise tail probabilities, increase to 5,000–10,000.

Q: Can the number of dynamic simulation time steps be adjusted?
A: The default base grid has 500 steps and includes every profile breakpoint. Increase the step count and compare results to check convergence for steep nonlinear rate changes.

Q: Is my data uploaded to a server?
A: No. All computations are performed locally in your browser. Your data never leaves your device.

Q: Which browsers are supported?
A: Chrome, Edge, and Firefox (latest versions) are recommended. Safari also works, but 3D chart performance may be lower.`,
  },
  {
    id: 'contact',
    title: 'Contact',
    content: `For questions, bug reports, or collaboration inquiries, please contact:

Dr. Xinyao Wei
• xwei@fzu.edu.cn
• weixinyao3@gmail.com

Zhengbin Deng
• zhengbin.deng@outlook.com`,
  },
];

export default function UserGuide({ open, onClose }) {
  const [activeSection, setActiveSection] = useState('overview');

  if (!open) return null;

  return (
    <div className="guide-overlay" onClick={onClose}>
      <div className="guide-modal" onClick={(e) => e.stopPropagation()}>
        <div className="guide-header">
          <h2>MicroFit Pro User Guide</h2>
          <button className="guide-close" onClick={onClose}>&times;</button>
        </div>
        <div className="guide-body">
          <nav className="guide-nav">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={`guide-nav-item ${activeSection === s.id ? 'active' : ''}`}
                onClick={() => setActiveSection(s.id)}
              >
                {s.title}
              </button>
            ))}
          </nav>
          <div className="guide-content">
            {SECTIONS.filter((s) => s.id === activeSection).map((s) => (
              <div key={s.id}>
                <h3>{s.title}</h3>
                <div className="guide-text">
                  {s.content.split('\n').map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
