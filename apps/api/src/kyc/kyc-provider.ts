import type { FaceSessionDto } from '@damez/shared';

export const KYC_PROVIDER = Symbol('KYC_PROVIDER');

/** Thrown by live adapters when keys are missing. The service maps it to 503 NOT_CONFIGURED. */
export class KycNotConfiguredError extends Error {
  constructor(provider: string) { super(`${provider} is not configured (missing API keys)`); this.name = 'KycNotConfiguredError'; }
}
/** Thrown for transport / upstream failures. Mapped to 503 KYC_UNAVAILABLE (customer may retry). */
export class KycProviderError extends Error {
  constructor(message: string, public readonly status?: number) { super(message); this.name = 'KycProviderError'; }
}

export interface IdentityRecord {
  found: boolean;
  reference: string;
  firstName?: string;
  lastName?: string;
  middleName?: string;
  /** yyyy-mm-dd */
  dateOfBirth?: string;
  /** Nigerian local format */
  phone?: string;
  gender?: 'MALE' | 'FEMALE';
  /** sha256 of the registered photo. The image itself is never kept. */
  photoHash?: string;
}
export interface NameEnquiryResult { found: boolean; reference: string; accountName?: string }
export interface AddressResult { status: 'VERIFIED' | 'NOT_VERIFIED' | 'PENDING'; reference: string }
export type GovIdType = 'DRIVERS_LICENSE' | 'VOTERS_CARD' | 'INTL_PASSPORT';
export interface FaceResult {
  state: 'COMPLETED' | 'PENDING' | 'NOT_FOUND';
  referenceId: string;
  /** 0-100 */
  confidence?: number;
  liveness?: boolean;
  /** only populated by providers that return it; kept ONLY when kyc.retain_biometrics is true */
  selfieImage?: Buffer;
}
export type KycWebhookEvent = { kind: 'FACE'; face: FaceResult } | { kind: 'IGNORED' };

export interface KycProvider {
  readonly name: string;
  lookupBvn(bvn: string): Promise<IdentityRecord>;
  lookupNin(nin: string): Promise<IdentityRecord>;
  lookupPhone(phone: string): Promise<IdentityRecord>;
  nameEnquiry(a: { accountNumber: string; bankCode: string }): Promise<NameEnquiryResult>;
  verifyAddress(a: { line1: string; city: string; state: string; landmark?: string }): Promise<AddressResult>;
  /** Poll a PENDING address check by reference (Dojah's address verification is async). */
  fetchAddressResult(reference: string): Promise<AddressResult>;
  /** `imageBase64` is the customer's uploaded ID_CARD document (front side), stripped of any data-URI prefix — required by Dojah's document-analysis product (OCR, not an ID-number lookup). */
  verifyGovId(a: { idType: GovIdType; idNumber: string; imageBase64: string }): Promise<IdentityRecord>;
  startFaceSession(a: { customerId: string }): Promise<FaceSessionDto>;
  fetchFaceResult(referenceId: string): Promise<FaceResult>;
  /** Signature is verified by the controller BEFORE this is called. */
  parseWebhook(rawBody: Buffer | string, headers: Record<string, string | string[] | undefined>): KycWebhookEvent;
}
