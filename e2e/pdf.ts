/** Test documents built at run time, so the repository holds no binary fixture. */

/**
 * Builds a one-page, text-layer PDF at run time, so the repository holds no binary fixture.
 * Offsets in the cross-reference table are computed, not hand-counted, so pdf.js reads it
 * without falling back to repair.
 */
export function textPdf(lines: readonly string[]): Buffer {
  const escape = (text: string) => text.replace(/[\\()]/g, (char) => `\\${char}`);
  const content = [
    'BT /F1 11 Tf 14 TL 56 780 Td',
    ...lines.map((line) => `(${escape(line)}) Tj T*`),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${String(Buffer.byteLength(content))} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, index) => {
    const offset = Buffer.byteLength(pdf);
    pdf += `${String(index + 1)} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/** A short offer letter with three numbered clauses, as a PDF. */
export const OFFER_LETTER_PDF_LINES = [
  '1. Appointment',
  'You are appointed as Software Engineer with effect from the joining date.',
  '2. Notice period',
  'Either party may end this employment by giving ninety days written notice.',
  '3. Probation',
  'You will be on probation for six months from the date of joining.',
] as const;
