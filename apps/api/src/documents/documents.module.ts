import { Body, Controller, Delete, Get, Global, HttpCode, Module, Param, Post, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { DOCUMENT_KINDS, MAX_UPLOAD_BYTES } from '@damez/shared';
import { AuthUser } from '../common/auth-user';
import { CurrentCustomer, CurrentUser, PortalAuth, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { APP_ENV, AppEnv } from '../config/config.module';
import { DOCUMENTS_PORT } from '../contracts/ports';
import type { PortalUser } from '../portal/portal-session.service';
import { StorageModule } from '../storage/storage.module';
import { DocumentsService } from './documents.service';
import { ClamAvScanner, MockVirusScanner, VIRUS_SCANNER, VirusScanner } from './virus-scanner';

const uploadSchema = z.object({ kind: z.enum(DOCUMENT_KINDS), applicationId: z.string().min(1).max(64).optional() });
const reviewSchema = z.object({ status: z.enum(['APPROVED', 'REJECTED']), note: z.string().trim().max(500).optional() });

@Controller('portal/documents')
@PortalAuth()
class PortalDocumentsController {
  constructor(private svc: DocumentsService) {}

  @Post() @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 } }))
  upload(@CurrentCustomer() c: PortalUser, @UploadedFile() file: Express.Multer.File | undefined, @Body(new ZodPipe(uploadSchema)) b: z.infer<typeof uploadSchema>) {
    return this.svc.upload(c.id, { kind: b.kind, applicationId: b.applicationId, file: file ?? { buffer: Buffer.alloc(0) } });
  }

  @Get() list(@CurrentCustomer() c: PortalUser) { return this.svc.listForCustomer(c.id); }

  @Delete(':id') remove(@CurrentCustomer() c: PortalUser, @Param('id') id: string) { return this.svc.softDelete(c.id, id); }
}

@Controller()
class StaffDocumentsController {
  constructor(private svc: DocumentsService) {}

  @Get('customers/:id/documents') @RequirePermission('document:read')
  list(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.listStaff(u, id); }

  @Get('documents/:id/download') @RequirePermission('document:read')
  async download(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const f = await this.svc.download(u, id);
    const ascii = f.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    res.set({
      'Content-Type': f.mimeType,
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      'Content-Length': String(f.bytes.length),
    });
    return new StreamableFile(f.bytes);
  }

  @Post('documents/:id/review') @HttpCode(200) @RequirePermission('document:review')
  review(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(reviewSchema)) b: z.infer<typeof reviewSchema>) { return this.svc.review(u, id, b.status, b.note); }
}

/** Provides DOCUMENTS_PORT. Requires StorageModule (OBJECT_STORAGE) and a KYC_TIER_PORT provider. */
@Global()
@Module({
  imports: [StorageModule],
  controllers: [PortalDocumentsController, StaffDocumentsController],
  providers: [
    { provide: VIRUS_SCANNER, inject: [APP_ENV], useFactory: (e: AppEnv): VirusScanner => (e.VIRUS_SCAN_PROVIDER === 'clamav' ? new ClamAvScanner(e.CLAMAV_HOST, e.CLAMAV_PORT) : new MockVirusScanner()) },
    DocumentsService,
    { provide: DOCUMENTS_PORT, useExisting: DocumentsService },
  ],
  exports: [DocumentsService, DOCUMENTS_PORT],
})
export class DocumentsModule {}
