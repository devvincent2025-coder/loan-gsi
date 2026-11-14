import {
  BadRequestException, HttpException, Inject, Injectable, NotFoundException, UnprocessableEntityException, UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { KycDocument } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { ALLOWED_UPLOAD_MIME, DocumentDto, DocumentKind, MAX_UPLOAD_BYTES, StaffDocumentDto } from '@damez/shared';
import { AuditService } from '../audit/audit.service';
import { AuthUser, canSeeBranch } from '../common/auth-user';
import { DocumentsPort, KYC_TIER_PORT, KycTierPort } from '../contracts/ports';
import { FieldCipher } from '../crypto/field-cipher';
import { loadScopedCustomer } from '../kyc/customer-access';
import { documentDto, staffDocumentDto } from '../kyc/mappers';
import { PrismaService } from '../prisma/prisma.service';
import { OBJECT_STORAGE, ObjectStorage } from '../storage/object-storage';
import { decryptDocument, encryptDocument } from './doc-crypto';
import { declaredMatches, sanitizeFileName, sniffMime } from './mime';
import { VIRUS_SCANNER, VirusScanner } from './virus-scanner';

const MAX_ACTIVE_DOCS = 40;

@Injectable()
export class DocumentsService implements DocumentsPort {
  constructor(
    private prisma: PrismaService, private audit: AuditService, private cipher: FieldCipher,
    @Inject(OBJECT_STORAGE) private storage: ObjectStorage,
    @Inject(VIRUS_SCANNER) private scanner: VirusScanner,
    @Inject(KYC_TIER_PORT) private tiers: KycTierPort,
  ) {}

  /**
   * Validate (size, real type), scan BEFORE storing, encrypt, store, record. The customer sees one friendly error per failure mode.
   * `trusted` skips the customer-facing upload quota (used for system-generated files).
   */
  async upload(customerId: string, input: { kind: DocumentKind; applicationId?: string | null; file: { buffer: Buffer; originalname?: string; mimetype?: string } }): Promise<DocumentDto> {
    const { buffer, originalname, mimetype } = input.file;
    if (!buffer || buffer.length === 0) throw new BadRequestException({ message: 'That file is empty', code: 'EMPTY_FILE' });
    if (buffer.length > MAX_UPLOAD_BYTES) throw new HttpException({ message: `Files must be ${MAX_UPLOAD_BYTES / 1024 / 1024}MB or smaller`, code: 'FILE_TOO_LARGE' }, 413);
    const mime = sniffMime(buffer);
    if (!mime || !(ALLOWED_UPLOAD_MIME as readonly string[]).includes(mime) || !declaredMatches(mimetype, mime)) {
      throw new UnsupportedMediaTypeException({ message: 'Upload a JPG, PNG, PDF or CSV file', code: 'UNSUPPORTED_FILE_TYPE' });
    }
    const count = await this.prisma.kycDocument.count({ where: { customerId, deletedAt: null } });
    if (count >= MAX_ACTIVE_DOCS) throw new BadRequestException({ message: 'You have reached the document limit. Delete one before uploading another', code: 'DOCUMENT_LIMIT' });
    if (input.applicationId) {
      const app = await this.prisma.loanApplication.findFirst({ where: { id: input.applicationId, customerId }, select: { id: true } });
      if (!app) throw new NotFoundException('Application not found');
    }

    const scan = await this.scanner.scan(buffer);
    if (scan.status === 'INFECTED') {
      await this.audit.record({ action: 'document.rejected_infected', resourceType: 'Customer', resourceId: customerId, outcome: 'DENIED', metadata: { kind: input.kind, engine: scan.engine, signature: scan.signature } });
      throw new UnprocessableEntityException({ message: 'This file did not pass our security check and was not saved', code: 'FILE_INFECTED' });
    }
    if (scan.status !== 'CLEAN') {
      throw new UnprocessableEntityException({ message: 'We could not check this file right now. Please try again in a moment', code: 'SCAN_UNAVAILABLE' });
    }

    const id = randomUUID();
    const { blob, keyEnc } = encryptDocument(this.cipher, id, buffer);
    const storageKey = `kyc/${customerId}/${id}`;
    await this.storage.put(storageKey, blob);
    const c = await this.prisma.customer.findUniqueOrThrow({ where: { id: customerId }, select: { branchId: true } });
    const doc = await this.prisma.kycDocument.create({
      data: {
        id, customerId, applicationId: input.applicationId ?? null, kind: input.kind, fileName: sanitizeFileName(originalname, mime), mimeType: mime, sizeBytes: buffer.length,
        sha256: createHash('sha256').update(buffer).digest('hex'), storageKey, keyEnc, scanStatus: 'CLEAN', scanEngine: scan.engine,
      },
    });
    await this.audit.record({ action: 'document.uploaded', resourceType: 'KycDocument', resourceId: id, branchId: c.branchId, after: { customerId, kind: doc.kind, mimeType: mime, sizeBytes: doc.sizeBytes, sha256: doc.sha256 } });
    return documentDto(doc);
  }

  /** System-internal store (e.g. retained biometrics): same encrypted pipeline, no sniffing of declared types. */
  async storeInternal(customerId: string, kind: DocumentKind, fileName: string, bytes: Buffer): Promise<KycDocument> {
    const scan = await this.scanner.scan(bytes);
    if (scan.status !== 'CLEAN') throw new UnprocessableEntityException('File failed the security scan');
    const id = randomUUID();
    const { blob, keyEnc } = encryptDocument(this.cipher, id, bytes);
    const storageKey = `kyc/${customerId}/${id}`;
    await this.storage.put(storageKey, blob);
    return this.prisma.kycDocument.create({
      data: {
        id, customerId, kind, fileName, mimeType: sniffMime(bytes) ?? 'application/octet-stream', sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
        storageKey, keyEnc, scanStatus: 'CLEAN', scanEngine: scan.engine, reviewStatus: 'PENDING',
      },
    });
  }

  async listForCustomer(customerId: string): Promise<DocumentDto[]> {
    const rows = await this.prisma.kycDocument.findMany({ where: { customerId, deletedAt: null }, orderBy: { uploadedAt: 'desc' } });
    return rows.map(documentDto);
  }

  /** Soft delete, only while the review is still PENDING (reviewed documents are evidence). */
  async softDelete(customerId: string, id: string): Promise<{ ok: true }> {
    const d = await this.prisma.kycDocument.findFirst({ where: { id, customerId, deletedAt: null } });
    if (!d) throw new NotFoundException('Document not found');
    if (d.reviewStatus !== 'PENDING') throw new BadRequestException({ message: 'Reviewed documents cannot be deleted', code: 'DOCUMENT_LOCKED' });
    await this.prisma.kycDocument.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({ action: 'document.deleted', resourceType: 'KycDocument', resourceId: id, metadata: { customerId, kind: d.kind } });
    return { ok: true };
  }

  /* ── staff ── */
  async listStaff(user: AuthUser, customerId: string): Promise<StaffDocumentDto[]> {
    await loadScopedCustomer(this.prisma, user, customerId);
    return this.staffRows(customerId);
  }

  async staffRows(customerId: string): Promise<StaffDocumentDto[]> {
    const rows = await this.prisma.kycDocument.findMany({ where: { customerId, deletedAt: null }, orderBy: { uploadedAt: 'desc' } });
    const ids = [...new Set(rows.map((r) => r.reviewedById).filter((x): x is string => !!x))];
    const users = ids.length ? await this.prisma.staffUser.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }) : [];
    return rows.map((r) => staffDocumentDto(r, users.find((u) => u.id === r.reviewedById) ?? null));
  }

  private async scopedDoc(user: AuthUser, id: string) {
    const d = await this.prisma.kycDocument.findFirst({ where: { id, deletedAt: null }, include: { customer: { select: { branchId: true } } } });
    if (!d || !canSeeBranch(user, d.customer.branchId)) throw new NotFoundException('Document not found');
    return d;
  }

  /** Decrypts for a staff download. ALWAYS audited (document.viewed), every single time. */
  async download(user: AuthUser, id: string): Promise<{ bytes: Buffer; mimeType: string; fileName: string }> {
    const d = await this.scopedDoc(user, id);
    const bytes = await this.read(d);
    await this.audit.record({ action: 'document.viewed', resourceType: 'KycDocument', resourceId: id, branchId: d.customer.branchId, metadata: { customerId: d.customerId, kind: d.kind, fileName: d.fileName } });
    return { bytes, mimeType: d.mimeType, fileName: d.fileName };
  }

  async review(user: AuthUser, id: string, status: 'APPROVED' | 'REJECTED', note?: string): Promise<StaffDocumentDto> {
    const d = await this.scopedDoc(user, id);
    const r = await this.prisma.kycDocument.update({ where: { id }, data: { reviewStatus: status, reviewNote: note ?? null, reviewedById: user.id, reviewedAt: new Date() } });
    await this.audit.record({
      action: 'document.reviewed', resourceType: 'KycDocument', resourceId: id, branchId: d.customer.branchId,
      before: { reviewStatus: d.reviewStatus }, after: { reviewStatus: status, note }, metadata: { customerId: d.customerId, kind: d.kind },
    });
    if (d.kind === 'PROOF_OF_ADDRESS') await this.tiers.refreshTier(d.customerId);
    return staffDocumentDto(r, { id: user.id, fullName: user.fullName });
  }

  private async read(d: KycDocument): Promise<Buffer> {
    return decryptDocument(this.cipher, d.id, d.keyEnc, await this.storage.get(d.storageKey));
  }

  /* ── DocumentsPort ── */
  async satisfiedKinds(customerId: string, applicationId?: string | null): Promise<Set<DocumentKind>> {
    const rows = await this.prisma.kycDocument.findMany({
      where: { customerId, deletedAt: null, scanStatus: 'CLEAN', reviewStatus: { not: 'REJECTED' }, ...(applicationId ? { OR: [{ applicationId: null }, { applicationId }] } : {}) },
      select: { kind: true },
    });
    return new Set(rows.map((r) => r.kind as DocumentKind));
  }

  async readContent(documentId: string): Promise<{ bytes: Buffer; mimeType: string; kind: DocumentKind }> {
    const d = await this.prisma.kycDocument.findFirst({ where: { id: documentId, deletedAt: null, scanStatus: 'CLEAN' } });
    if (!d) throw new NotFoundException('Document not found');
    return { bytes: await this.read(d), mimeType: d.mimeType, kind: d.kind as DocumentKind };
  }

  async listIds(customerId: string, kind: DocumentKind): Promise<string[]> {
    const rows = await this.prisma.kycDocument.findMany({ where: { customerId, kind, deletedAt: null, scanStatus: 'CLEAN', reviewStatus: { not: 'REJECTED' } }, orderBy: { uploadedAt: 'desc' }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  async attachToApplication(customerId: string, applicationId: string): Promise<void> {
    await this.prisma.kycDocument.updateMany({ where: { customerId, applicationId: null, deletedAt: null }, data: { applicationId } });
  }
}
