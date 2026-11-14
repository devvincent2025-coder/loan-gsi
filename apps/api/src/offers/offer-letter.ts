/**
 * Offer letter PDF (pdfkit). No external PII beyond the borrower's name (not encrypted on Customer) and the
 * offer's financial terms — nothing here needs decryption, so this stays a pure render function.
 */
import PDFDocument from 'pdfkit';
import { formatNaira, formatLagos } from '@damez/shared';
import type { OfferScheduleRowDto } from '@damez/shared';

export interface OfferLetterInput {
  borrowerName: string;
  reference: string;
  offerNumber: string;
  isCounterOffer: boolean;
  productName: string;
  principalKobo: number;
  tenorMonths: number;
  monthlyRateBps: number;
  interestMethod: string;
  totalInterestKobo: number;
  totalFeesKobo: number;
  totalCostOfCreditKobo: number;
  totalRepayableKobo: number;
  schedule: OfferScheduleRowDto[];
  expiresAt: Date;
  coolingOffHours: number;
  autodebitConsentRequired: boolean;
  gsiConsentRequired: boolean;
  generatedAt: Date;
}

const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

export function renderOfferLetterPdf(o: OfferLetterInput): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolvePromise(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text('Damez Loan — Loan Offer Letter', { align: 'left' });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#555').text(`Generated ${formatLagos(o.generatedAt)}`);
    doc.fillColor('#000');
    doc.moveDown();

    doc.fontSize(12).text(`Dear ${o.borrowerName},`);
    doc.moveDown(0.5);
    doc.fontSize(10).text(
      `We are pleased to offer you a ${o.productName} loan${o.isCounterOffer ? ' (revised offer)' : ''} under application ${o.reference}, offer ${o.offerNumber}, on the terms below. ` +
        'This offer is governed by the Central Bank of Nigeria consumer protection rules and the Federal Competition and Consumer Protection Commission (FCCPC) 2025 lending regulations.',
      { align: 'justify' },
    );
    doc.moveDown();

    doc.fontSize(12).text('Loan terms', { underline: true });
    doc.moveDown(0.3);
    const terms: [string, string][] = [
      ['Principal amount', formatNaira(o.principalKobo)],
      ['Tenor', `${o.tenorMonths} months`],
      ['Interest method', o.interestMethod === 'FLAT' ? 'Flat rate' : 'Reducing balance'],
      ['Monthly interest rate', pct(o.monthlyRateBps)],
      ['Total interest', formatNaira(o.totalInterestKobo)],
      ['Total fees (processing/management/insurance)', formatNaira(o.totalFeesKobo)],
      ['Total cost of credit', formatNaira(o.totalCostOfCreditKobo)],
      ['Total repayable (principal + interest)', formatNaira(o.totalRepayableKobo)],
      ['Offer expires', formatLagos(o.expiresAt)],
    ];
    doc.fontSize(10);
    for (const [k, v] of terms) {
      doc.text(k, { continued: true, width: 300 });
      doc.text(v, { align: 'right' });
    }
    doc.moveDown();

    doc.fontSize(12).text('Repayment schedule', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(9);
    const colX = [48, 90, 190, 280, 370, 460];
    const header = ['#', 'Due date', 'Principal', 'Interest', 'Instalment', 'Balance'];
    header.forEach((h, i) => doc.text(h, colX[i], doc.y, { continued: i < header.length - 1 }));
    doc.moveDown(0.2);
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').stroke();
    doc.moveDown(0.2);
    for (const row of o.schedule) {
      if (doc.y > 760) doc.addPage();
      const y = doc.y;
      doc.text(String(row.seq), colX[0], y);
      doc.text(row.dueDate, colX[1], y);
      doc.text(formatNaira(row.principalKobo), colX[2], y);
      doc.text(formatNaira(row.interestKobo), colX[3], y);
      doc.text(formatNaira(row.totalKobo), colX[4], y);
      doc.text(formatNaira(row.balanceAfterKobo), colX[5], y);
      doc.moveDown(0.3);
    }
    doc.moveDown();

    doc.fontSize(12).text('Standing instruction / autodebit consent', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10).text(
      o.autodebitConsentRequired
        ? 'By accepting this offer you authorise Damez Loan to collect repayments on each due date via a standing instruction (NIBSS e-Mandate) or tokenised card on your linked account(s). ' +
            (o.gsiConsentRequired
              ? 'You separately authorise Damez Loan to use the CBN Global Standing Instruction (GSI) to recover overdue amounts from your BVN-linked accounts across Nigerian banks if a scheduled debit fails, as permitted by CBN regulation. '
              : '') +
            'You may withdraw this consent in writing, subject to your continuing repayment obligations.'
        : 'No autodebit consent is required for this offer.',
      { align: 'justify' },
    );
    doc.moveDown();

    doc.fontSize(12).text('Cooling-off period (FCCPC 2025 lending regulations)', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10).text(
      `You have a cooling-off period of ${o.coolingOffHours} hours from the time you accept this offer during which you may withdraw from this loan agreement without ` +
        'penalty, provided no funds have been disbursed to you. To withdraw, contact Damez Loan customer support quoting this offer number.',
      { align: 'justify' },
    );
    doc.moveDown();

    doc.fontSize(9).fillColor('#555').text(
      'This letter is a system-generated offer document and does not require a wet signature. Acceptance is recorded via your e-signature and one-time passcode (OTP) verification in the Damez customer portal.',
      { align: 'justify' },
    );

    doc.end();
  });
}
