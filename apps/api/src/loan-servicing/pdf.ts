/** PDF generation for repayment receipts and loan statements. pdfkit streams into a Buffer; nothing is persisted here. */
import PDFDocument from 'pdfkit';
import type { Loan, LoanInstallment, Repayment } from '@prisma/client';
import { formatLagos, formatNaira } from '@damez/shared';

function render(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}

export interface ReceiptAllocation {
  totalPenaltyKobo: number;
  totalFeeKobo: number;
  totalInterestKobo: number;
  totalPrincipalKobo: number;
}

export function generateReceiptPdf(args: { receiptNumber: string; loan: Pick<Loan, 'reference' | 'customerId'>; repayment: Pick<Repayment, 'amountKobo' | 'method' | 'kind' | 'createdAt'>; allocation: ReceiptAllocation }): Promise<Buffer> {
  const { receiptNumber, loan, repayment, allocation } = args;
  return render((doc) => {
    doc.fontSize(18).text('Damez Loan', { align: 'center' });
    doc.fontSize(12).text('Payment Receipt', { align: 'center' });
    doc.moveDown(1.5);
    doc.fontSize(10);
    doc.text(`Receipt No: ${receiptNumber}`);
    doc.text(`Loan Reference: ${loan.reference}`);
    doc.text(`Date: ${formatLagos(repayment.createdAt)}`);
    doc.text(`Method: ${repayment.method}`);
    doc.text(`Kind: ${repayment.kind}`);
    doc.moveDown();
    doc.fontSize(14).text(`Amount Paid: ${formatNaira(repayment.amountKobo)}`);
    doc.moveDown();
    doc.fontSize(11).text('Allocation');
    doc.fontSize(10);
    doc.text(`Penalty: ${formatNaira(allocation.totalPenaltyKobo)}`);
    doc.text(`Fees: ${formatNaira(allocation.totalFeeKobo)}`);
    doc.text(`Interest: ${formatNaira(allocation.totalInterestKobo)}`);
    doc.text(`Principal: ${formatNaira(allocation.totalPrincipalKobo)}`);
    doc.moveDown(2);
    doc.fontSize(8).fillColor('gray').text('This is a system-generated receipt from Damez Loan.', { align: 'center' });
  });
}

export function generateStatementPdf(args: {
  loan: Pick<Loan, 'reference' | 'principalKobo' | 'disbursedAt' | 'status' | 'outstandingPrincipalKobo'>;
  installments: LoanInstallment[];
  repayments: Repayment[];
  fromDate: Date;
  toDate: Date;
}): Promise<Buffer> {
  const { loan, installments, repayments, fromDate, toDate } = args;
  return render((doc) => {
    doc.fontSize(18).text('Damez Loan', { align: 'center' });
    doc.fontSize(12).text('Loan Statement', { align: 'center' });
    doc.moveDown(1.5);
    doc.fontSize(10);
    doc.text(`Loan Reference: ${loan.reference}`);
    doc.text(`Status: ${loan.status}`);
    doc.text(`Principal: ${formatNaira(Number(loan.principalKobo))}`);
    doc.text(`Disbursed: ${formatLagos(loan.disbursedAt, 'date')}`);
    doc.text(`Statement Period: ${formatLagos(fromDate, 'date')} – ${formatLagos(toDate, 'date')}`);
    doc.text(`Outstanding Principal (as at today): ${formatNaira(Number(loan.outstandingPrincipalKobo))}`);
    doc.moveDown();

    doc.fontSize(11).text('Repayment Schedule');
    doc.fontSize(8);
    for (const i of installments) {
      doc.text(`#${i.seq}  Due ${formatLagos(i.dueDate, 'date')}  Total ${formatNaira(Number(i.totalKobo))}  Paid ${formatNaira(Number(i.paidKobo))}  Penalty ${formatNaira(Number(i.penaltyAccruedKobo))}  [${i.status}]`);
    }
    doc.moveDown();

    doc.fontSize(11).text('Transactions in Period');
    doc.fontSize(8);
    if (!repayments.length) doc.text('No repayments in this period.');
    for (const r of repayments) {
      doc.text(`${formatLagos(r.createdAt, 'date')}  ${r.receiptNumber}  ${r.kind}/${r.method}  ${formatNaira(Number(r.amountKobo))}`);
    }
    doc.moveDown(2);
    doc.fontSize(8).fillColor('gray').text('This is a system-generated statement from Damez Loan.', { align: 'center' });
  });
}
