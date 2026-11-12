import { readFileSync } from 'node:fs';
import { executeAnalysisTask } from '../../src/workers/analysisTasks.js';

// Exercise the component's calculation and event-handler section without DOM
// rendering. JSX is excluded; computational imports remain the real modules.
export function panelHarness(path, name, dependencies, returnedNames) {
  const source = readFileSync(path, 'utf8');
  const start = source.indexOf('const DEFAULT_SAMPLES');
  const end = source.indexOf('\n  return (', source.indexOf(`export default function ${name}`));
  const body = source.slice(start, end).replace('export default function ', 'function ')
    + `\n return { ${returnedNames.join(', ')} };\n}\nreturn ${name};`;
  const slots = [];
  let cursor = 0;
  const useState = initial => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
    return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
  };
  const scope = { ...dependencies, useState, useRef: initial => useState({ current: initial })[0],
    useEffect: () => {}, useMemo: fn => fn(), useCallback: fn => fn, setTimeout: fn => { fn(); },
    // Numerical component tests use the real task runner; thread transport has its own tests.
    startAnalysisTask: (type, config) => ({ promise: Promise.resolve().then(() => executeAnalysisTask(type, config)), cancel: () => {} }),
  };
  const component = new Function(...Object.keys(scope), body)(...Object.values(scope));
  return props => { cursor = 0; return component(props); };
}
