// parse amount shorthand (e.g. "5k", "2.5m", or typo like "5oom") into integer cents
function parseAmountToCents(input) {
  if (input == null) return NaN;
  let s = String(input).trim();
  if (!s) return NaN;
  // normalize common typo: letter o/O -> 0
  s = s.replace(/o/gi, '0');
  // remove commas, underscores and spaces
  s = s.replace(/[,_\s]/g, '');

  const m = s.match(/^([0-9]*\.?[0-9]+)([kKmMbB])?$/);
  let naira = NaN;
  if (m) {
    naira = parseFloat(m[1]);
    const suf = (m[2] || '').toLowerCase();
    if (suf === 'k') naira *= 1_000;
    else if (suf === 'm') naira *= 1_000_000;
    else if (suf === 'b') naira *= 1_000_000_000;
  } else {
    // try to parse as plain number
    naira = parseFloat(s);
  }
  if (!isFinite(naira)) return NaN;
  // convert to cents
  return Math.round(naira * 100);
}

module.exports = { parseAmountToCents };
