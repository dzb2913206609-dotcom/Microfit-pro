import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/components/ExternalValidation.jsx', 'utf8');

assert.match(
  source,
  /import\s+\{\s*FormattedLabel\s*\}\s+from\s+['"]\.\.\/utils\/formatLabels\.jsx['"]/,
  'ExternalValidation should import FormattedLabel for scientific labels.',
);

assert.match(
  source,
  /<FormattedLabel\s+text=\{interpretation\.targetLabel\}\s*\/>/,
  'The Target metric should render through FormattedLabel so log10 uses a subscript.',
);

assert.match(
  source,
  /<FormattedLabel\s+text=\{interpretation\.biasDirection\}\s*\/>/,
  'Bias direction should render through FormattedLabel for consistent log10 formatting.',
);

console.log('external validation label formatting checks passed');
