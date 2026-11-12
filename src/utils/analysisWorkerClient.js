function createAnalysisWorker() {
  return new Worker(new URL('../workers/analysisWorker.js', import.meta.url), { type: 'module' });
}

export function startAnalysisTask(type, config, workerFactory = createAnalysisWorker) {
  let worker;
  let settled = false;
  let rejectTask;
  const promise = new Promise((resolve, reject) => {
    rejectTask = reject;
    try {
      worker = workerFactory();
      worker.onmessage = ({ data }) => {
        if (settled) return;
        settled = true;
        worker.terminate();
        if (data.error) reject(new Error(data.error));
        else resolve(data.result);
      };
      worker.onerror = error => {
        if (settled) return;
        settled = true;
        worker.terminate();
        reject(new Error(error.message || 'Background analysis failed.'));
      };
      worker.onmessageerror = () => worker.onerror({ message: 'Could not read the background analysis result.' });
      worker.postMessage({ type, config });
    } catch (error) {
      settled = true;
      worker?.terminate();
      reject(error);
    }
  });
  return { promise, cancel() {
    if (settled) return;
    settled = true;
    worker?.terminate();
    rejectTask(new DOMException('Analysis cancelled.', 'AbortError'));
  } };
}
