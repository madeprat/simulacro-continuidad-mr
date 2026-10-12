// Celdas CSV seguras para abrir en Excel o Google Sheets: comillas cuando hace falta y, si el texto empieza por
// = + - @ (o tabulador/retorno), se antepone un apóstrofo para que la hoja no lo ejecute como fórmula.
// Lo usan las exportaciones del visor y del debrief (los hallazgos los edita el facilitador a mano).
export function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = "'" + s;
  return /[",;\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function csvRow(values) {
  return values.map(csvCell).join(',');
}
