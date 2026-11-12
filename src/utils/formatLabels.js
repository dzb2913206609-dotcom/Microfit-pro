const COMPACT_LABEL_REPLACEMENTS = [
  [/\blogDref\b/g, 'log₁₀(D_ref)'],
  [/\bDref_irrad\b/g, 'D_ref'],
  [/\bDref\b/g, 'D_ref'],
  [/\bTref\b/g, 'T_ref'],
  [/\bPref\b/g, 'P_ref'],
  [/\bIref\b/g, 'I_ref'],
  [/\bEref\b/g, 'E_ref'],
  [/\bCref\b/g, 'C_ref'],
  [/\bDRref\b/g, 'DR_ref'],
  [/\bAref\b/g, 'A_ref'],
  [/\bpHref\b/g, 'pH_ref'],
  [/\bawRef\b/g, 'a_w,ref'],
  [/\bsigmaRef\b/g, 'σ_ref'],
  [/\bzTurb\b/g, 'z_Turb'],
  [/\bzSigma\b/g, 'z_σ'],
  [/\bzCond\b/g, 'z_σ'],
  [/\bzaw\b/g, 'z_aw'],
  [/\bzpH\b/g, 'z_pH'],
  [/\bzT\b/g, 'z_T'],
  [/\bzP\b/g, 'z_P'],
  [/\bzI\b/g, 'z_I'],
  [/\bzE\b/g, 'z_E'],
  [/\bzC\b/g, 'z_C'],
  [/\bzDR\b/g, 'z_DR'],
  [/\bkTurb\b/g, 'k_turb'],
  [/\bkmax1\b/g, 'k_1'],
  [/\bkmax2\b/g, 'k_2'],
  [/\bkmax\b/g, 'k_max'],
  [/\blogNres\b/g, 'log₁₀(N_res)'],
  [/\blogNmin\b/g, 'log₁₀(N_min)'],
  [/\blogN0\b/g, 'log₁₀(N₀)'],
];

const TOKEN_PATTERN = /(log₁₀|AICc|a_w,ref|aw_ref|[A-Za-zΑ-Ωα-ωµμσδλ]+_[A-Za-z0-9Α-Ωα-ωµμσδλ]+(?:,[A-Za-z0-9Α-Ωα-ωµμσδλ]+)?)/gu;

function normalizeLabelText(value) {
  let text = String(value ?? '');
  text = text.replace(/\blog10\b/g, 'log₁₀');
  for (const [pattern, replacement] of COMPACT_LABEL_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

export function getFormattedLabelParts(value) {
  const text = normalizeLabelText(value);
  const parts = [];
  let lastIndex = 0;

  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, index) });
    }

    if (token === 'log₁₀') {
      parts.push({ base: 'log', sub: '10' });
    } else if (token === 'AICc') {
      parts.push({ base: 'AIC', sub: 'c' });
    } else if (token === 'a_w,ref' || token === 'aw_ref') {
      parts.push({ base: 'a', sub: 'w,ref' });
    } else {
      const underscoreIndex = token.indexOf('_');
      parts.push({
        base: token.slice(0, underscoreIndex),
        sub: token.slice(underscoreIndex + 1),
      });
    }

    lastIndex = index + token.length;
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex) });
  }

  return parts;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatLabelToHtml(value) {
  return getFormattedLabelParts(value).map((part) => {
    if (part.sub != null) {
      return `${escapeHtml(part.base)}<sub>${escapeHtml(part.sub)}</sub>`;
    }
    return escapeHtml(part.text);
  }).join('');
}
