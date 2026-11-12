import assert from 'node:assert/strict';
import {
  applyHeldOutInitialState,
  classifyDiagnosticAgreement,
  getEvidenceLevel,
  interpretValidationMetrics,
  resolveValidationTarget,
} from '../src/utils/validationDiagnostics.js';

assert.equal(classifyDiagnosticAgreement(1.12).label, 'Close agreement');
assert.equal(classifyDiagnosticAgreement(1.32).label, 'Moderate agreement');
assert.equal(classifyDiagnosticAgreement(1.75).label, 'Appreciable discrepancy');
assert.equal(classifyDiagnosticAgreement(2.2).label, 'Large discrepancy');

assert.equal(getEvidenceLevel({ setCount: 1, sourceType: 'heldout' }).label, 'Single-condition diagnostic');
assert.equal(getEvidenceLevel({ setCount: 3, sourceType: 'heldout' }).label, 'Multi-condition hold-out check');
assert.equal(getEvidenceLevel({ setCount: 1, sourceType: 'external' }).label, 'External validation dataset');
assert.equal(getEvidenceLevel({ sourceType: 'crossValidation' }).label, 'Cross-validation summary');

const resolvedMappedTarget = resolveValidationTarget({
  targetKeys: ['D', 'kmax'],
  bindings: { kmax: 'EXTENDED_BIGELOW_D' },
  fittedModels: {
    EXTENDED_BIGELOW_D: {
      targetKey: 'D',
      secondaryModelId: 'EXTENDED_BIGELOW',
    },
  },
});

assert.equal(resolvedMappedTarget.targetKey, 'D');
assert.equal(resolvedMappedTarget.primaryParamName, 'kmax');

const conditionalCurveParams = applyHeldOutInitialState({
  predictedParams: { logN0: 7.2, kmax: 0.12, logNres: 1.1 },
  fittedParams: { logN0: 6.8, kmax: 0.2, logNres: 0.4 },
  primaryModel: {
    params: [
      { name: 'logN0', role: 'state' },
      { name: 'kmax', role: 'rate' },
      { name: 'logNres', role: 'residual' },
    ],
  },
});

assert.deepEqual(conditionalCurveParams, { logN0: 6.8, kmax: 0.12, logNres: 1.1 });

const parameterResult = interpretValidationMetrics({
  Bf: 0.758,
  Af: 1.320,
  RMSE: 0.121,
  n: 1,
  mode: 'parameter',
  targetKey: 'D',
  setCount: 1,
  sourceType: 'heldout',
});

assert.equal(parameterResult.agreement.label, 'Moderate agreement');
assert.equal(parameterResult.strictZone.label, 'Outside preset zone');
assert.equal(parameterResult.biasDirection, 'Predicted resistance lower than observed');
assert.equal(parameterResult.evidence.label, 'Single-condition diagnostic');
assert.match(parameterResult.useNote, /not a full external validation/i);

const curveResult = interpretValidationMetrics({
  Bf: 1.729,
  Af: 2.417,
  RMSE: 0.463,
  n: 14,
  mode: 'curve',
  setCount: 1,
  sourceType: 'heldout',
});

assert.equal(curveResult.agreement.label, 'Large discrepancy');
assert.equal(curveResult.biasDirection, 'Predicted log10(N) higher than observed on average');

console.log('validation diagnostics tests passed');
