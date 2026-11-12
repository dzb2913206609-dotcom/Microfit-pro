import { useEffect, useRef, useState } from 'react';

/**
 * Solute database grouped by category.
 * NaCl: empirical polynomial.
 * Others: Norrish equation — aw = Xw * exp(K * Xs²)
 */
const SOLUTE_DB = {
  Salts: {
    label: 'Salts',
    solutes: {
      NaCl:   { label: 'NaCl',    M: 58.44,  K: null,  method: 'empirical' },
      KCl:    { label: 'KCl',     M: 74.55,  K: -0.18, method: 'norrish' },
      Na2SO4: { label: 'Na₂SO₄',  M: 142.04, K: -0.90, method: 'norrish' },
      CaCl2:  { label: 'CaCl₂',   M: 110.98, K: -0.46, method: 'norrish' },
      MgCl2:  { label: 'MgCl₂',   M: 95.21,  K: -0.50, method: 'norrish' },
      LiCl:   { label: 'LiCl',    M: 42.39,  K: -0.28, method: 'norrish' },
      NaBr:   { label: 'NaBr',    M: 102.89, K: -0.21, method: 'norrish' },
    },
  },
  Sugars: {
    label: 'Sugars',
    solutes: {
      Sucrose:   { label: 'Sucrose',   M: 342.3,  K: -2.26, method: 'norrish' },
      Glucose:   { label: 'Glucose',   M: 180.16, K: -1.55, method: 'norrish' },
      Fructose:  { label: 'Fructose',  M: 180.16, K: -1.43, method: 'norrish' },
      Sorbitol:  { label: 'Sorbitol',  M: 182.17, K: -1.65, method: 'norrish' },
      Lactose:   { label: 'Lactose',   M: 342.3,  K: -1.81, method: 'norrish' },
      Maltose:   { label: 'Maltose',   M: 342.3,  K: -1.95, method: 'norrish' },
      Trehalose: { label: 'Trehalose', M: 342.3,  K: -2.08, method: 'norrish' },
    },
  },
  Alcohols: {
    label: 'Alcohols',
    solutes: {
      Glycerol: { label: 'Glycerol', M: 92.09,  K: -1.16, method: 'norrish' },
      Ethanol:  { label: 'Ethanol',  M: 46.07,  K: -0.56, method: 'norrish' },
      PEG400:   { label: 'PEG 400',  M: 400,    K: -0.80, method: 'norrish' },
    },
  },
  OrganicAcids: {
    label: 'Organic Acids',
    solutes: {
      CitricAcid: { label: 'Citric acid',  M: 192.12, K: -1.05, method: 'norrish' },
      LacticAcid: { label: 'Lactic acid',  M: 90.08,  K: -0.72, method: 'norrish' },
      AceticAcid: { label: 'Acetic acid',  M: 60.05,  K: -0.52, method: 'norrish' },
    },
  },
};

function findSolute(soluteId) {
  for (const cat of Object.values(SOLUTE_DB)) {
    if (cat.solutes[soluteId]) return cat.solutes[soluteId];
  }
  return null;
}

function computeAw(soluteId, concentration) {
  const solute = findSolute(soluteId);
  if (!solute || concentration <= 0 || concentration >= 100) return null;

  if (solute.method === 'empirical') {
    // NaCl empirical: aw = 1 - 0.00534·c - 0.000209·c²
    const aw = 1 - 0.00534 * concentration - 0.000209 * concentration * concentration;
    return Math.max(0, Math.min(1, aw));
  }

  // Norrish equation: aw = Xw * exp(K * Xs²)
  const nw = (100 - concentration) / 18.015;
  const ns = concentration / solute.M;
  const Xw = nw / (nw + ns);
  const Xs = ns / (nw + ns);
  const aw = Xw * Math.exp(solute.K * Xs * Xs);
  return Math.max(0, Math.min(1, aw));
}

export default function AwQuickConvert({ onAwChange }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('Salts');
  const [soluteId, setSoluteId] = useState('NaCl');
  const [concentration, setConcentration] = useState('');
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const currentSolutes = SOLUTE_DB[category]?.solutes ?? {};

  const concNum = parseFloat(concentration);
  const aw = Number.isFinite(concNum) && concNum > 0 ? computeAw(soluteId, concNum) : null;

  useEffect(() => {
    if (aw != null && Number.isFinite(aw)) {
      onAwChange(parseFloat(aw.toFixed(4)));
    }
  }, [aw, onAwChange]);

  if (!open) {
    return (
      <button
        type="button"
        className="aw-convert-trigger"
        title="Quick aw converter"
        onClick={() => setOpen(true)}
      >
        %
      </button>
    );
  }

  return (
    <div ref={ref} className="aw-convert-popover">
      <div className="aw-tabs">
        {Object.entries(SOLUTE_DB).map(([id, cat]) => (
          <button
            key={id}
            type="button"
            className={`aw-tab${category === id ? ' active' : ''}`}
            onClick={() => {
              setCategory(id);
              const firstKey = Object.keys(cat.solutes)[0];
              if (firstKey) setSoluteId(firstKey);
            }}
          >
            {cat.label}
          </button>
        ))}
      </div>
      <div className="aw-solute-chips">
        {Object.entries(currentSolutes).map(([id, s]) => (
          <button
            key={id}
            type="button"
            className={`aw-chip${soluteId === id ? ' active' : ''}`}
            onClick={() => setSoluteId(id)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="aw-input-row">
        <input
          type="number"
          min={0}
          max={99}
          step={0.5}
          value={concentration}
          onChange={(e) => setConcentration(e.target.value)}
          placeholder="Conc. (%)"
          autoFocus
        />
        {aw != null && (
          <span className="aw-convert-result">
            a<sub>w</sub> = {aw.toFixed(4)}
            {aw < 0.6 && <span className="aw-warning" title="Extreme concentration"> !</span>}
          </span>
        )}
      </div>
    </div>
  );
}
