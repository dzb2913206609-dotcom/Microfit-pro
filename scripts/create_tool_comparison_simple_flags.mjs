import fs from 'node:fs/promises';

import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const outPath = '/Users/dengzhengbin/Desktop/microbial-inactivation-app _副本/reports/tool_comparison_with_new_references_simple_flags.xlsx';

const rows = [
  ['Feature', 'GInaFiT', 'IPMP Global Fit', 'Bioinactivation ecosystem', 'ComBase', 'MicroHibro', 'Growth Predictor', 'Tarlak et al. platform', 'MicroFit Pro'],
  ['Web-based interface', '✗', '✗', '(✓)', '✓', '✓', '✓', '✓', '✓'],
  ['Open source / source availability', '✗', '✗', '✓', '✗', '✗', '✗', '(✓)', '✓'],
  ['Primary model fitting', '✓', '✓', '✓', '(✓)', '(✓)', '(✓)', '✓', '✓'],
  ['Model comparison / ranking', '✓', '(✓)', '✓', '✗', '✗', '(✓)', '✓', '✓'],
  ['Secondary modelling', '✗', '✓', '✓', '(✓)', '(✓)', '✓', '✓', '✓'],
  ['Dynamic simulation', '✗', '✗', '✓', '✗', '✓', '✓', '✗', '✓'],
  ['Monte Carlo / stochastic uncertainty', '✗', '✗', '✓', '✗', '(✓)', '✓', '(✓)', '✓'],
  ['Sensitivity analysis', '✗', '✗', '✗', '✗', '(✓)', '(✓)', '✗', '✓'],
  ['Machine-learning prediction', '✗', '✗', '✗', '✗', '✗', '✗', '✓', '✗'],
  ['QMRA / dose-response workflow', '✗', '✗', '✗', '(✓)', '✓', '✓', '✗', '✗'],
  ['One-step global fitting', '✗', '✓', '(✓)', '✗', '✗', '✗', '✓', '✗'],
  ['Bayesian / MCMC estimation', '✗', '✗', '✓', '✗', '✗', '✗', '✗', '✗'],
  ['Multi-technology scope', '(✓)', '(✓)', '(✓)', '(✓)', '✓', '(✓)', '(✓)', '✓'],
];

const legend = [
  ['Symbol', 'Meaning'],
  ['✓', 'Supported'],
  ['(✓)', 'Partially supported, limited support, or indirectly available'],
  ['✗', 'Not supported, not applicable, or not specified in the source'],
];

const workbook = Workbook.create();
const sheet = workbook.worksheets.add('Simple comparison');
sheet.getRange(`A1:I${rows.length}`).values = rows;
sheet.getRange('A1:I1').format.font.bold = true;
sheet.getRange(`A1:I${rows.length}`).format.wrapText = true;
sheet.getRange(`A1:A${rows.length}`).format.columnWidthPx = 230;
sheet.getRange(`B1:I${rows.length}`).format.columnWidthPx = 130;

const legendSheet = workbook.worksheets.add('Legend');
legendSheet.getRange(`A1:B${legend.length}`).values = legend;
legendSheet.getRange('A1:B1').format.font.bold = true;
legendSheet.getRange(`A1:A${legend.length}`).format.columnWidthPx = 120;
legendSheet.getRange(`B1:B${legend.length}`).format.columnWidthPx = 430;

await fs.mkdir('/Users/dengzhengbin/Desktop/microbial-inactivation-app _副本/reports', { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outPath);
console.log(outPath);
