import fs from 'node:fs/promises';

import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const outPath = '/Users/dengzhengbin/Desktop/microbial-inactivation-app _副本/reports/tool_comparison_with_new_references.xlsx';

const rows = [
  [
    'Feature',
    'GInaFiT',
    'IPMP Global Fit',
    'Bioinactivation ecosystem',
    'ComBase',
    'MicroHibro',
    'Growth Predictor (Skandamis 2025)',
    'Tarlak et al. platform (2025)',
    'MicroFit Pro',
  ],
  ['Platform type', 'Excel add-in', 'Standalone desktop software', 'R package / web app', 'Web database', 'Web app / expert system', 'R/Shiny web app / QMRA tool', 'Python/Flask web platform', 'Web app (browser)'],
  ['Open source', '✗', '✗', '✓', '✗', '✗', 'Not specified; free web app', 'GitHub materials reported', '✓'],
  ['Primary models (including non-log-linear forms)', '✓', '✓', '✓', '✗', '(✓)', 'Baranyi growth model; Bigelow thermal reduction in QMRA', '✓ growth + inhibition models', '✓'],
  ['Model comparison / ranking support', '✓', '(✓)', '✓', '✗', '✗', '(✓) gamma-term selection; no broad ranking', '✓ side-by-side model comparison', '✓'],
  ['Secondary models', '✗', '✓', '✓', '(✓)', '(✓)', '✓ gamma/cardinal models', '✓ two-step and one-step workflows', '✓'],
  ['Dynamic simulation under time-varying conditions', '✗', '✗', '✓', '✗', '✓', '✓ static/dynamic growth profiles', 'Not clearly specified', '✓'],
  ['Monte Carlo uncertainty analysis', '✗', '✗', '✓ (MCMC/Bayesian-oriented)', '✗', '(✓)', '✓ probability-distribution inputs and Monte Carlo simulation', '(✓) confidence intervals / bootstrap; no explicit MC module', '✓'],
  ['Sensitivity screening / analysis', '✗', '✗', '✗', '✗', '(✓)', '(✓) real-time input exploration; formal method not specified', '✗', '✓'],
  ['Machine-learning prediction', '✗', '✗', '✗', '✗', '✗', '✗', '✓ SVR, Random Forest, Gaussian Process Regression', '✗'],
  ['QMRA / dose-response workflow', '✗', '✗', '✗', '(✓)', '✓', '✓ modular QMRA and dose-response models', '✗', '✗'],
  ['Multi-technology support', 'Mainly thermal', 'Mainly thermal', 'Mainly thermal / limited extension', 'Broad predictive microbiology scope; limited inactivation fitting', 'Broad predictive microbiology / QMRA scope', 'Growth/QMRA; thermal reduction module', 'Growth and inhibition; ML-supported', '6 technologies'],
  ['One-step global fitting across conditions', '✗', '✓', '(✓)', '✗', '✗', '✗', '✓', '✗'],
  ['Bayesian / MCMC estimation', '✗', '✗', '✓', '✗', '✗', '✗', '✗ (GPR gives probabilistic prediction intervals)', '✗'],
];

const notes = [
  ['Reference', 'How it was used for the added columns'],
  ['Skandamis 2025, Food Research International 209:116329', 'Growth Predictor is described as an R/Shiny online predictive modelling and QMRA tool using Baranyi primary fitting, gamma/cardinal secondary models, static/dynamic growth simulation, stochastic inputs, Monte Carlo simulation, QMRA modules, Bigelow thermal reduction, and dose-response models.'],
  ['Tarlak et al. 2025, Foods 14:3158', 'The platform is described as a Python/Flask web tool combining two-step and one-step classical growth/inhibition modelling with ML models including SVR, Random Forest Regression, and Gaussian Process Regression; it reports parameter uncertainty and goodness-of-fit statistics.'],
];

const workbook = Workbook.create();
const comparison = workbook.worksheets.add('Tool comparison');
comparison.getRange(`A1:I${rows.length}`).values = rows;
comparison.getRange('A1:I1').format.font.bold = true;
comparison.getRange(`A1:I${rows.length}`).format.wrapText = true;
comparison.getRange(`A1:A${rows.length}`).format.columnWidthPx = 230;
comparison.getRange(`B1:F${rows.length}`).format.columnWidthPx = 145;
comparison.getRange(`G1:H${rows.length}`).format.columnWidthPx = 220;
comparison.getRange(`I1:I${rows.length}`).format.columnWidthPx = 145;

const sourceNotes = workbook.worksheets.add('Source notes');
sourceNotes.getRange(`A1:B${notes.length}`).values = notes;
sourceNotes.getRange('A1:B1').format.font.bold = true;
sourceNotes.getRange(`A1:B${notes.length}`).format.wrapText = true;
sourceNotes.getRange(`A1:A${notes.length}`).format.columnWidthPx = 290;
sourceNotes.getRange(`B1:B${notes.length}`).format.columnWidthPx = 620;

await fs.mkdir('/Users/dengzhengbin/Desktop/microbial-inactivation-app _副本/reports', { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outPath);
console.log(outPath);
