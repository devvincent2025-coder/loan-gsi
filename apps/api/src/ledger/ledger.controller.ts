import { BadRequestException, Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { GlExportRowDto, JournalEntryDto, LedgerAccountDto } from '@damez/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { GlExportQuery, glExportQuerySchema, JournalQuery, journalQuerySchema, ManualPostingInput, manualPostingSchema } from './ledger-schemas';
import { LedgerService } from './ledger.service';

@Controller('ledger')
export class LedgerController {
  constructor(private ledger: LedgerService, private audit: AuditService) {}

  @Get('accounts')
  @RequirePermission('ledger:read')
  accounts(): Promise<LedgerAccountDto[]> {
    return this.ledger.listAccountsWithBalances();
  }

  @Get('journal')
  @RequirePermission('ledger:read')
  journal(@Query(new ZodPipe(journalQuerySchema)) q: JournalQuery): Promise<JournalEntryDto[]> {
    return this.ledger.listJournal(q);
  }

  @Post('manual')
  @RequirePermission('ledger:post')
  async manual(@Body(new ZodPipe(manualPostingSchema)) b: ManualPostingInput, @CurrentUser() user: AuthUser): Promise<JournalEntryDto> {
    const { id } = await this.ledger.post({
      memo: b.memo,
      date: b.date ? new Date(b.date) : undefined,
      sourceType: 'MANUAL',
      loanId: b.loanId,
      createdById: user.id,
      postings: b.postings,
    });
    const dto = await this.ledger.getJournalEntry(id);
    if (!dto) throw new BadRequestException('Failed to load the posted journal entry');
    return dto;
  }

  @Get('gl-export')
  @RequirePermission('ledger:read')
  async glExport(@Query(new ZodPipe(glExportQuerySchema)) q: GlExportQuery, @Res() res: Response): Promise<void> {
    const rows = await this.ledger.glExportRows(q);
    await this.audit.record({ action: 'ledger.gl_export', resourceType: 'JournalEntry', metadata: { filters: q, rowCount: rows.length } });

    if (q.format === 'csv') {
      const esc = (v: unknown) => {
        let s = v === null || v === undefined ? '' : String(v);
        if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
        return `"${s.replace(/"/g, '""')}"`;
      };
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="gl-export.csv"');
      res.write('date,reference,account_code,account_name,debit_kobo,credit_kobo,memo\n');
      for (const r of rows) {
        res.write([r.date, r.reference, r.accountCode, r.accountName, r.debitKobo, r.creditKobo, r.memo].map(esc).join(',') + '\n');
      }
      res.end();
      return;
    }
    res.json(rows satisfies GlExportRowDto[]);
  }
}
