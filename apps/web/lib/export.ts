export type ExportCell = string | number | boolean | null | undefined;
export interface ExportColumn<T> {
  header: string;
  value: (row: T) => ExportCell;
}

function csvCell(v: ExportCell): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // neutralise spreadsheet formula injection
  if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build RFC4180 CSV text from typed columns. */
export function toCsv<T>(columns: ExportColumn<T>[], rows: T[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => csvCell(c.value(r))).join(','));
  return lines.join('\r\n');
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv<T>(filename: string, columns: ExportColumn<T>[], rows: T[]) {
  downloadBlob(new Blob(['﻿' + toCsv(columns, rows)], { type: 'text/csv;charset=utf-8' }), filename);
}

export async function downloadExcel<T>(filename: string, columns: ExportColumn<T>[], rows: T[]) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Export');
  ws.columns = columns.map((c) => ({ header: c.header, key: c.header, width: Math.max(14, c.header.length + 4) }));
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(columns.map((c) => c.value(r) ?? ''));
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename,
  );
}
