import type { Consent, FraudSignal, KycDocument, KycVerification, ScreeningResult } from '@prisma/client';
import type { ConsentDto, DocumentDto, DocumentKind, FraudSignalDto, KycVerificationDto, KycVerificationStatus, KycVerificationType, ScreeningDto, StaffDocumentDto } from '@damez/shared';

export const verificationDto = (v: KycVerification): KycVerificationDto => ({
  id: v.id, type: v.type as KycVerificationType, provider: v.provider, status: v.status as KycVerificationStatus, referenceId: v.referenceId,
  matchConfidence: v.matchConfidence, livenessPassed: v.livenessPassed, summary: v.summary, createdAt: v.createdAt.toISOString(), completedAt: v.completedAt?.toISOString() ?? null,
});

export const documentDto = (d: KycDocument): DocumentDto => ({
  id: d.id, kind: d.kind as DocumentKind, fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes, scanStatus: d.scanStatus as DocumentDto['scanStatus'],
  reviewStatus: d.reviewStatus as DocumentDto['reviewStatus'], reviewNote: d.reviewNote, applicationId: d.applicationId, uploadedAt: d.uploadedAt.toISOString(),
});

export const staffDocumentDto = (d: KycDocument, reviewer: { id: string; fullName: string } | null): StaffDocumentDto => ({
  ...documentDto(d), customerId: d.customerId, sha256: d.sha256, scanEngine: d.scanEngine, reviewedBy: reviewer ? { id: reviewer.id, name: reviewer.fullName } : null,
});

export const consentDto = (c: Consent): ConsentDto => ({
  id: c.id, purpose: c.purpose as ConsentDto['purpose'],
  status: c.status === 'GRANTED' && c.expiresAt && c.expiresAt.getTime() <= Date.now() ? 'EXPIRED' : (c.status as ConsentDto['status']),
  textVersion: c.textVersion, grantedAt: c.grantedAt.toISOString(), revokedAt: c.revokedAt?.toISOString() ?? null, expiresAt: c.expiresAt?.toISOString() ?? null,
});

export const fraudDto = (s: FraudSignal): FraudSignalDto => ({
  id: s.id, type: s.type as FraudSignalDto['type'], severity: s.severity as FraudSignalDto['severity'], detail: s.detail, relatedCustomerId: s.relatedCustomerId,
  createdAt: s.createdAt.toISOString(), resolvedAt: s.resolvedAt?.toISOString() ?? null, resolutionNote: s.resolutionNote,
});

export const screeningDto = (s: ScreeningResult): ScreeningDto => ({
  id: s.id, type: s.type as ScreeningDto['type'], provider: s.provider, status: s.status as ScreeningDto['status'], matchCount: s.matchCount, reference: s.reference, createdAt: s.createdAt.toISOString(),
});
