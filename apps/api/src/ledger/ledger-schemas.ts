import { z } from 'zod';

const kobo = z.number().int().positive().max(100_000_000_000);
const bps = z.number().int().min(0).max(10_000);

export const manualPostingSchema = z.object({
  memo: z.string().trim().min(3).max(500),
  date: z.string().datetime().optional(),
  loanId: z.string().cuid().optional(),
  postings: z
    .array(z.object({ accountCode: z.string().min(1).max(20), side: z.enum(['DEBIT', 'CREDIT']), amountKobo: kobo }))
    .min(2)
    .max(50),
}).strict();
export type ManualPostingInput = z.infer<typeof manualPostingSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected yyyy-mm-dd');

export const journalQuerySchema = z.object({
  loanId: z.string().cuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
}).strict();
export type JournalQuery = z.infer<typeof journalQuerySchema>;

export const glExportQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  format: z.enum(['csv', 'json']).default('json'),
}).strict();
export type GlExportQuery = z.infer<typeof glExportQuerySchema>;

export const reconciliationSummaryQuerySchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/, 'expected yyyy-mm'),
}).strict();
export type ReconciliationSummaryQuery = z.infer<typeof reconciliationSummaryQuerySchema>;

export const provisioningReportQuerySchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected yyyy-mm-dd').optional(),
}).strict();
export type ProvisioningReportQuery = z.infer<typeof provisioningReportQuerySchema>;

export const eclConfigSchema = z.object({
  stage1PdBps: bps,
  stage2PdBps: bps,
  stage3PdBps: bps,
  lgdBps: bps,
  stage2DpdThreshold: z.number().int().min(1).max(365),
  stage3DpdThreshold: z.number().int().min(1).max(365),
}).strict().refine((c) => c.stage1PdBps < c.stage2PdBps && c.stage2PdBps < c.stage3PdBps, {
  message: 'PD must increase with stage (stage1 < stage2 < stage3)',
}).refine((c) => c.stage2DpdThreshold < c.stage3DpdThreshold, {
  message: 'stage2DpdThreshold must be less than stage3DpdThreshold',
});
export type EclConfigInput = z.infer<typeof eclConfigSchema>;
