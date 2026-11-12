import factoryModule from 'react-plotly.js/factory';
import Plotly from 'plotly.js-dist-min';

// CJS interop: Vite may deliver the factory as .default or directly
const createPlotlyComponent = typeof factoryModule === 'function' ? factoryModule : factoryModule.default;
const Plot = createPlotlyComponent(Plotly);
export default Plot;
