import Papa from 'papaparse';

// Parse records rather than physical lines so quoted commas, doubled quotes and
// embedded newlines remain part of their field. Errors retain source line numbers.
export function readDelimitedRecords(text) {
  if (!text.trim()) return [];
  const firstLine = text.split(/\r?\n/)[0];
  const delimiter = firstLine.includes('\t') ? '\t' : firstLine.includes(',') ? ',' : firstLine.includes(';') ? ';' : null;
  if (!delimiter) return text.split(/\r?\n/).map((line, i) => ({ cells: line.trim() ? line.trim().split(/\s+/) : [], lineNumber: i + 1 })).filter(row => row.cells.length);
  const rows = [];
  let cursor = 0;
  let lineNumber = 1;
  Papa.parse(text, { delimiter, skipEmptyLines: false, step(result) {
    if (result.errors.length) throw new Error(`Invalid CSV on line ${lineNumber}: ${result.errors[0].message}`);
    const cells = result.data.map(cell => cell.trim());
    if (cells.some(Boolean) || cells.length > 1) rows.push({ cells, lineNumber });
    lineNumber += (text.slice(cursor, result.meta.cursor).match(/\r\n|\n|\r/g) ?? []).length;
    cursor = result.meta.cursor;
  } });
  return rows;
}

export function splitDataLine(line) {
  return readDelimitedRecords(line)[0]?.cells ?? [];
}

export function isHeaderLike(parts, requiredNumericCols = 1) {
  const required = parts.slice(0, requiredNumericCols);
  return required.length === requiredNumericCols
    && required.every(part => part !== '' && !Number.isFinite(Number(part)) && !/^[-+]?\d/.test(part) && !/^(nan|[-+]?infinity)$/i.test(part))
    && parts.every(part => part === '' || !Number.isFinite(Number(part)));
}

export function readNumericRows(text, requiredNumericCols = 1) {
  const lines = readDelimitedRecords(text);
  const hasHeader = lines.length > 0 && isHeaderLike(lines[0].cells, requiredNumericCols);
  return lines.slice(hasHeader ? 1 : 0).map(({ cells, lineNumber }) => {
    const required = cells.slice(0, requiredNumericCols);
    if (required.length !== requiredNumericCols || required.some(cell => cell === '' || !Number.isFinite(Number(cell)))) {
      throw new Error(`Invalid or missing required numeric field on line ${lineNumber}.`);
    }
    const replicateCells = cells.slice(requiredNumericCols);
    if (replicateCells.some(cell => cell !== '' && !Number.isFinite(Number(cell)))) {
      throw new Error(`Invalid replicate value on line ${lineNumber}.`);
    }
    const values = replicateCells.filter(cell => cell !== '').map(Number);
    if (values.length === 0) throw new Error(`At least one replicate is required on line ${lineNumber}.`);
    return { required: required.map(Number), values, lineNumber };
  });
}

function buildGeneratedHeader(index) {
  return `Col ${index + 1}`;
}

function isReplicateHeader(header) {
  return /^(rep(?:licate)?|重复)\s*[_-]?\s*\d+$/i.test(String(header ?? '').trim());
}

function buildExtendedHeader(index, fallbackHeaders, replicateStartIndex) {
  const replicateIndex = index - replicateStartIndex + 1;
  if (replicateIndex > 0) return `rep${replicateIndex}`;

  const fallbackHeader = fallbackHeaders[index];
  if (fallbackHeader) return fallbackHeader;

  return buildGeneratedHeader(index);
}

export function buildPastePreview(text, {
  fallbackHeaders = [],
  requiredNumericCols = 1,
  maxRows = 12,
} = {}) {
  let parsedLines;
  try { parsedLines = readDelimitedRecords(text); }
  catch (error) { return { parseError: error.message, headers: [], rows: [], visibleRows: [], hiddenRowCount: 0 }; }

  if (parsedLines.length === 0) return null;

  const hasHeader = isHeaderLike(parsedLines[0].cells, requiredNumericCols);
  const headerCells = hasHeader ? parsedLines[0].cells : fallbackHeaders;
  const dataRows = hasHeader ? parsedLines.slice(1) : parsedLines;
  const firstReplicateHeaderIndex = hasHeader
    ? headerCells.findIndex((header) => isReplicateHeader(header))
    : -1;
  const replicateStartIndex = firstReplicateHeaderIndex >= 0
    ? firstReplicateHeaderIndex
    : requiredNumericCols;
  const maxCols = Math.max(
    headerCells.length,
    fallbackHeaders.length,
    ...dataRows.map((row) => row.cells.length),
  );
  const headers = Array.from({ length: maxCols }, (_, index) =>
    index >= replicateStartIndex
      ? buildExtendedHeader(index, fallbackHeaders, replicateStartIndex)
      : (headerCells[index] || buildExtendedHeader(index, fallbackHeaders, replicateStartIndex))
  );
  const expectedCols = hasHeader
    ? headerCells.length
    : (dataRows[0]?.cells.length ?? fallbackHeaders.length);
  const rows = dataRows.map((row) => ({
    ...row,
    isInconsistent: row.cells.length !== expectedCols,
  }));
  const inconsistentLineNumbers = rows
    .filter((row) => row.isInconsistent)
    .map((row) => row.lineNumber);

  return {
    headers,
    rows,
    visibleRows: rows.slice(0, maxRows),
    hiddenRowCount: Math.max(rows.length - maxRows, 0),
    expectedCols,
    maxCols,
    hasHeader,
    hasInvalidRequiredFields: (hasHeader ? headerCells.slice(0, requiredNumericCols).some(cell => !cell) : false)
      || dataRows.some(row => row.cells.length < requiredNumericCols || row.cells.slice(0, requiredNumericCols).some(cell => cell === '' || !Number.isFinite(Number(cell)))),
    hasInconsistentRows: inconsistentLineNumbers.length > 0,
    inconsistentLineNumbers,
    hasReplicateHeaderMismatch: firstReplicateHeaderIndex >= 0 && firstReplicateHeaderIndex < requiredNumericCols,
    replicateHeaderStartIndex: firstReplicateHeaderIndex,
  };
}
