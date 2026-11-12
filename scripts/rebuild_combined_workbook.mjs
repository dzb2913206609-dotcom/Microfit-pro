import fs from 'node:fs/promises';

import {
  SpreadsheetFile,
  Workbook,
} from '/Users/dengzhengbin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';

const csvPath = '/Users/dengzhengbin/Desktop/microbial-inactivation-app _副本/reports/table2_table4_literature_model_comparison_combined.csv';
const outputPath = '/Users/dengzhengbin/Desktop/microbial-inactivation-app _副本/reports/table2_table4_literature_model_comparison_combined.xlsx';

const csvText = await fs.readFile(csvPath, 'utf8');
const workbook = await Workbook.fromCSV(csvText, { sheetName: 'Combined comparison' });
const sheet = workbook.worksheets.getItem('Combined comparison');

sheet.getRange('A1:H16').format = {
  font: { name: 'Arial', size: 10, color: '#111827' },
  verticalAlignment: 'center',
  wrapText: true,
  borders: { preset: 'all', style: 'thin', color: '#D1D5DB' },
};
sheet.getRange('A1:H1').format = {
  fill: { type: 'solid', color: '#E5EEF8' },
  font: { name: 'Arial', size: 10, bold: true, color: '#111827' },
  horizontalAlignment: 'center',
  verticalAlignment: 'center',
  wrapText: true,
  borders: { preset: 'all', style: 'thin', color: '#9CA3AF' },
};
sheet.getRange('A1:A16').format.columnWidthPx = 96;
sheet.getRange('B1:B16').format.columnWidthPx = 110;
sheet.getRange('C1:C16').format.columnWidthPx = 160;
sheet.getRange('D1:G16').format.columnWidthPx = 96;
sheet.getRange('H1:H16').format.columnWidthPx = 330;
sheet.getRange('A1:H1').format.rowHeightPx = 36;
sheet.getRange('A2:H16').format.rowHeightPx = 44;
sheet.getRange('D2:G16').format.horizontalAlignment = 'center';
sheet.getRange('D2:E16').format.numberFormat = '0.000';
sheet.freezePanes.freezeRows(1);

const errors = await workbook.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
  options: { useRegex: true, maxResults: 50 },
  summary: 'formula error scan',
});

const preview = await workbook.inspect({
  kind: 'table',
  range: 'Combined comparison!A1:H16',
  include: 'values',
  tableMaxRows: 16,
  tableMaxCols: 8,
});

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

const previewImage = await workbook.render({
  sheetName: 'Combined comparison',
  range: 'A1:H16',
  scale: 2,
});
await fs.writeFile(
  '/Users/dengzhengbin/Desktop/microbial-inactivation-app _副本/reports/combined_workbook_preview.png',
  Buffer.from(await previewImage.arrayBuffer()),
);

console.log(JSON.stringify({
  outputPath,
  formulaErrors: errors.ndjson,
  preview: preview.ndjson,
}, null, 2));
