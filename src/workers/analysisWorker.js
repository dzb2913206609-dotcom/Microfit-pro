import { executeAnalysisTask } from './analysisTasks.js';

self.addEventListener('message', ({ data: { type, config } }) => {
  try {
    const result = executeAnalysisTask(type, config);
    const transfers = [];
    if (type === 'monteCarlo') {
      // Transfer the millions of curve values without cloning them on the UI thread.
      result.allSamples = result.allSamples.map(row => {
        const values = Float64Array.from(row);
        transfers.push(values.buffer);
        return values;
      });
    }
    postMessage({ result }, transfers);
  } catch (error) {
    postMessage({ error: error.message || 'Analysis failed.' });
  }
});
