import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  APPLICATION_STATUSES, applicationExtrasSchema, guarantorCreateSchema, pageQuerySchema,
  type ApplicationDetailDto, type ApplicationSummaryDto, type EligibilityCustomerDto, type GuarantorDto,
  type LoanQuoteDto, type Page, type PortalApplicationDto, type PortalProductDto, type StateMachineDto,
} from '@damez/shared';
import type { AuthUser } from '../common/auth-user';
import { CurrentCustomer, CurrentUser, PortalAuth, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { PortalUser } from '../portal/portal-session.service';
import { ApplicationsService } from './applications.service';
import { stateMachineDto } from './state-machine';

const kobo = z.number().int().positive();
const quoteSchema = z.object({ productId: z.string().min(1), amountKobo: kobo, tenorMonths: z.number().int().min(1).max(120) });
const createSchema = quoteSchema.extend({ customerId: z.string().min(1), purpose: z.string().trim().max(300).optional() });
const transitionSchema = z.object({ to: z.enum(APPLICATION_STATUSES), reason: z.string().trim().max(500).optional() });
const listSchema = pageQuerySchema.extend({
  status: z.enum(APPLICATION_STATUSES).optional(), productId: z.string().optional(), branchId: z.string().optional(),
  outcome: z.enum(['ELIGIBLE', 'CONDITIONAL', 'INELIGIBLE']).optional(),
});
const portalCreateSchema = quoteSchema.extend({
  purpose: z.string().trim().min(3).max(300),
  acceptDisclosure: z.literal(true, { errorMap: () => ({ message: 'You must accept the loan disclosure to continue' }) }),
}).merge(applicationExtrasSchema).extend({
  guarantors: z.array(guarantorCreateSchema).max(2).optional(),
});
const portalCancelSchema = z.object({ reason: z.string().trim().max(300).optional() });

/** Staff console endpoints. */
@Controller()
export class ApplicationsController {
  constructor(private svc: ApplicationsService) {}

  @Get('applications') @RequirePermission('application:read')
  list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>): Promise<Page<ApplicationSummaryDto>> { return this.svc.list(u, q); }

  // declared before :id so it is not captured as an id
  @Get('applications/state-machine') @RequirePermission('application:read')
  stateMachine(): StateMachineDto { return stateMachineDto(); }

  @Get('applications/:id') @RequirePermission('application:read')
  detail(@CurrentUser() u: AuthUser, @Param('id') id: string): Promise<ApplicationDetailDto> { return this.svc.detail(u, id); }

  @Post('applications') @RequirePermission('application:create')
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createSchema)) b: z.infer<typeof createSchema>): Promise<ApplicationDetailDto> { return this.svc.createStaff(u, b); }

  @Post('applications/:id/submit') @HttpCode(200) @RequirePermission('application:update')
  submit(@CurrentUser() u: AuthUser, @Param('id') id: string): Promise<ApplicationDetailDto> { return this.svc.submitStaff(u, id); }

  // permission is checked per transition inside the service (loan:reject, application:update, ...)
  @Post('applications/:id/transition') @HttpCode(200) @RequirePermission('application:read')
  transition(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(transitionSchema)) b: z.infer<typeof transitionSchema>): Promise<ApplicationDetailDto> {
    return this.svc.transitionStaff(u, id, b.to, b.reason);
  }

  @Post('applications/:id/reassess') @HttpCode(200) @RequirePermission('eligibility:run')
  reassess(@CurrentUser() u: AuthUser, @Param('id') id: string): Promise<ApplicationDetailDto> { return this.svc.reassess(u, id); }

  @Get('applications/:id/guarantors') @RequirePermission('application:read')
  staffListGuarantors(@Param('id') id: string): Promise<GuarantorDto[]> { return this.svc.listGuarantorsStaff(id); }

  @Post('loans/schedule-preview') @HttpCode(200) @RequirePermission('application:read')
  preview(@Body(new ZodPipe(quoteSchema)) b: z.infer<typeof quoteSchema>): Promise<LoanQuoteDto> { return this.svc.schedulePreview(b); }
}

/** Customer portal endpoints: callers only ever see their own applications. */
@Controller('portal')
export class PortalApplicationsController {
  constructor(private svc: ApplicationsService) {}

  @Get('products') @PortalAuth()
  products(@CurrentCustomer() c: PortalUser): Promise<PortalProductDto[]> { return this.svc.portalProducts(c.id); }

  @Post('loans/schedule-preview') @HttpCode(200) @PortalAuth()
  preview(@Body(new ZodPipe(quoteSchema)) b: z.infer<typeof quoteSchema>): Promise<LoanQuoteDto> { return this.svc.schedulePreview(b); }

  @Post('eligibility/preview') @HttpCode(200) @PortalAuth()
  eligibility(@CurrentCustomer() c: PortalUser, @Body(new ZodPipe(quoteSchema)) b: z.infer<typeof quoteSchema>): Promise<EligibilityCustomerDto> { return this.svc.portalEligibilityPreview(c.id, b); }

  @Post('applications') @PortalAuth()
  create(@CurrentCustomer() c: PortalUser, @Body(new ZodPipe(portalCreateSchema)) b: z.infer<typeof portalCreateSchema>): Promise<PortalApplicationDto> {
    return this.svc.portalCreate(c.id, {
      productId: b.productId, amountKobo: b.amountKobo, tenorMonths: b.tenorMonths, purpose: b.purpose,
      selfReportedIncomeKobo: b.selfReportedIncomeKobo, selfReportedOutstandingKobo: b.selfReportedOutstandingKobo,
      collateralStockDesc: b.collateralStockDesc, collateralPropertyDesc: b.collateralPropertyDesc,
      guarantors: b.guarantors,
    });
  }

  @Get('applications') @PortalAuth()
  list(@CurrentCustomer() c: PortalUser): Promise<PortalApplicationDto[]> { return this.svc.portalList(c.id); }

  @Get('applications/:id') @PortalAuth()
  get(@CurrentCustomer() c: PortalUser, @Param('id') id: string): Promise<PortalApplicationDto> { return this.svc.portalGet(c.id, id); }

  @Post('applications/:id/cancel') @HttpCode(200) @PortalAuth()
  cancel(@CurrentCustomer() c: PortalUser, @Param('id') id: string, @Body(new ZodPipe(portalCancelSchema)) b: z.infer<typeof portalCancelSchema>): Promise<PortalApplicationDto> { return this.svc.portalCancel(c.id, id, b.reason); }

  /** Re-evaluate after the customer did something (consent, KYC step, document upload). Idempotent. */
  @Post('applications/:id/advance') @HttpCode(200) @PortalAuth()
  advance(@CurrentCustomer() c: PortalUser, @Param('id') id: string): Promise<PortalApplicationDto> { return this.svc.portalAdvance(c.id, id); }

  /** Update self-reported income and collateral while application is still DRAFT. */
  @Patch('applications/:id/extras') @HttpCode(200) @PortalAuth()
  extras(@CurrentCustomer() c: PortalUser, @Param('id') id: string, @Body(new ZodPipe(applicationExtrasSchema)) b: z.infer<typeof applicationExtrasSchema>): Promise<PortalApplicationDto> {
    return this.svc.updateExtras(id, c.id, b).then(() => this.svc.portalGet(c.id, id));
  }

  @Get('applications/:id/guarantors') @PortalAuth()
  listGuarantors(@CurrentCustomer() c: PortalUser, @Param('id') id: string): Promise<GuarantorDto[]> { return this.svc.listGuarantors(id, c.id); }

  @Post('applications/:id/guarantors') @PortalAuth()
  addGuarantor(@CurrentCustomer() c: PortalUser, @Param('id') id: string, @Body(new ZodPipe(guarantorCreateSchema)) b: z.infer<typeof guarantorCreateSchema>): Promise<GuarantorDto> {
    return this.svc.addGuarantor(id, c.id, b);
  }

  @Delete('applications/:id/guarantors/:gid') @HttpCode(200) @PortalAuth()
  removeGuarantor(@CurrentCustomer() c: PortalUser, @Param('id') id: string, @Param('gid') gid: string): Promise<{ ok: true }> {
    return this.svc.removeGuarantor(id, gid, c.id).then(() => ({ ok: true as const }));
  }
}
