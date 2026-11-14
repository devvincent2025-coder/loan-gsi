import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import type { EligibilityResultDto, LoanDetailDto, LoanDto, LoanInstallmentDto, RepaymentDto } from '@damez/shared';
import { CurrentCustomer, PortalAuth } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ELIGIBILITY_PORT, EligibilityPort } from '../contracts/ports';
import type { PortalUser } from '../portal/portal-session.service';
import { LoanServicingService } from './loan-servicing.service';

const kobo = z.number().int().positive();
const portalRepaySchema = z.object({ amountKobo: kobo, kind: z.enum(['EARLY', 'PART']).default('PART') });
const statementQuery = z.object({ from: z.string().trim().optional(), to: z.string().trim().optional() });
const repeatBorrowingQuery = z.object({ productId: z.string().min(1), amountKobo: z.coerce.number().int().positive(), tenorMonths: z.coerce.number().int().min(1).max(120) });

/**
 * Customer portal: "my loans". The one-tap repay endpoint is MANUAL-initiated by the customer (method: 'MANUAL')
 * rather than triggering a live mandate debit — live mandate-initiated repayment belongs to the autodebit module
 * (MANDATE_PORT), which is out of scope here and may not exist yet at build time. Documented choice: no
 * @Optional() MANDATE_PORT wiring was added, to keep this module's dependencies limited to ports that are frozen
 * and stable (LEDGER_PORT, ELIGIBILITY_PORT).
 */
@Controller('portal')
export class PortalLoanServicingController {
  constructor(private svc: LoanServicingService, @Inject(ELIGIBILITY_PORT) private eligibility: EligibilityPort) {}

  @Get('loans') @PortalAuth()
  list(@CurrentCustomer() c: PortalUser): Promise<LoanDto[]> { return this.svc.listForCustomer(c.id); }

  @Get('loans/:id') @PortalAuth()
  detail(@CurrentCustomer() c: PortalUser, @Param('id') id: string): Promise<LoanDetailDto> { return this.svc.getLoanDetailForCustomer(c.id, id); }

  @Get('loans/:id/repayment-calendar') @PortalAuth()
  calendar(@CurrentCustomer() c: PortalUser, @Param('id') id: string): Promise<LoanInstallmentDto[]> { return this.svc.repaymentCalendarForCustomer(c.id, id); }

  @Post('loans/:id/repay') @HttpCode(201) @PortalAuth()
  async repay(@CurrentCustomer() c: PortalUser, @Param('id') id: string, @Body(new ZodPipe(portalRepaySchema)) b: z.infer<typeof portalRepaySchema>): Promise<RepaymentDto> {
    await this.svc.getLoanDetailForCustomer(c.id, id); // 404s if the loan is not this customer's
    return this.svc.makeRepayment(id, { amountKobo: b.amountKobo, kind: b.kind, method: 'MANUAL' }, null);
  }

  @Get('loans/:id/statement.pdf') @PortalAuth()
  async statement(@CurrentCustomer() c: PortalUser, @Param('id') id: string, @Query(new ZodPipe(statementQuery)) q: z.infer<typeof statementQuery>, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const pdf = await this.svc.statementPdfForCustomer(c.id, id, q.from, q.to);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="statement-${id}.pdf"`, 'Cache-Control': 'no-store' });
    return new StreamableFile(pdf);
  }

  @Get('eligibility/repeat-borrowing') @PortalAuth()
  repeatBorrowing(@CurrentCustomer() c: PortalUser, @Query(new ZodPipe(repeatBorrowingQuery)) q: z.infer<typeof repeatBorrowingQuery>): Promise<EligibilityResultDto> {
    return this.eligibility.assess({ customerId: c.id, productId: q.productId, amountKobo: q.amountKobo, tenorMonths: q.tenorMonths, noPull: true });
  }
}
