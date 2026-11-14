import { Body, Controller, Get, HttpCode, Param, Post, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { LOAN_STATUSES, pageQuerySchema, type ApprovalDto, type LoanDetailDto, type LoanDto, type Page, type RepaymentDto } from '@damez/shared';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { LoanServicingService } from './loan-servicing.service';

const kobo = z.number().int().positive();
const listSchema = pageQuerySchema.extend({ status: z.enum(LOAN_STATUSES).optional(), branchId: z.string().optional(), customerId: z.string().optional() });
const makeRepaymentSchema = z.object({ amountKobo: kobo, kind: z.enum(['EARLY', 'PART', 'TOPUP_NET']), method: z.enum(['MANUAL', 'CASH', 'TRANSFER']), reference: z.string().trim().max(120).optional() });
const restructureSchema = z.object({ newTenorMonths: z.number().int().min(1).max(120), newMonthlyRateBps: z.number().int().min(1).max(2500).optional(), reason: z.string().trim().min(5).max(500) });
const writeOffSchema = z.object({ reason: z.string().trim().min(5).max(500) });
const recoverySchema = z.object({ amountKobo: kobo, method: z.enum(['MANUAL', 'CASH', 'TRANSFER']) });
const statementQuery = z.object({ from: z.string().trim().optional(), to: z.string().trim().optional() });

/**
 * Staff loan servicing console. Early/part repayment, top-ups, restructuring, write-off and statements/receipts.
 * Permission note: `POST /loans/:id/repayments` (staff recording a manual/cash/transfer repayment) uses `loan:create`
 * — the closest existing permission to "mutate a booked loan" (no dedicated `loan:repay` key exists in the shared
 * permission catalog, and adding one was out of scope per the hard constraints on packages/shared).
 * `POST /loans/:id/recovery` (post write-off collections) uses `loan:writeoff`, the closest existing permission for
 * post-write-off loan actions.
 */
@Controller()
export class LoanServicingController {
  constructor(private svc: LoanServicingService) {}

  @Get('loans') @RequirePermission('loan:read')
  list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>): Promise<Page<LoanDto>> {
    return this.svc.list(u, q);
  }

  @Get('loans/:id') @RequirePermission('loan:read')
  detail(@Param('id') id: string): Promise<LoanDetailDto> { return this.svc.getLoanDetail(id); }

  @Post('loans/:id/repayments') @HttpCode(201) @RequirePermission('loan:create')
  repay(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(makeRepaymentSchema)) b: z.infer<typeof makeRepaymentSchema>): Promise<RepaymentDto> {
    return this.svc.makeRepayment(id, b, u.id);
  }

  @Post('loans/:id/restructure') @HttpCode(200) @RequirePermission('loan:restructure')
  restructure(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(restructureSchema)) b: z.infer<typeof restructureSchema>): Promise<ApprovalDto> {
    return this.svc.requestRestructure(id, b, u);
  }

  @Post('loans/:id/writeoff') @HttpCode(200) @RequirePermission('loan:writeoff')
  writeOff(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(writeOffSchema)) b: z.infer<typeof writeOffSchema>): Promise<ApprovalDto> {
    return this.svc.requestWriteOff(id, b.reason, u);
  }

  @Post('loans/:id/recovery') @HttpCode(201) @RequirePermission('loan:writeoff')
  recovery(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(recoverySchema)) b: z.infer<typeof recoverySchema>): Promise<RepaymentDto> {
    return this.svc.recordRecovery(id, b.amountKobo, b.method, u.id);
  }

  @Get('loans/:id/statement.pdf') @RequirePermission('loan:read')
  async statement(@Param('id') id: string, @Query(new ZodPipe(statementQuery)) q: z.infer<typeof statementQuery>, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const pdf = await this.svc.statementPdf(id, q.from, q.to);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="statement-${id}.pdf"`, 'Cache-Control': 'no-store' });
    return new StreamableFile(pdf);
  }

  @Get('repayments/:id/receipt.pdf') @RequirePermission('loan:read')
  async receipt(@Param('id') id: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const pdf = await this.svc.receiptPdf(id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="receipt-${id}.pdf"`, 'Cache-Control': 'no-store' });
    return new StreamableFile(pdf);
  }
}
