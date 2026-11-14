import type { ConsentPurpose } from './constants';

export const KYC_VERIFICATION_TYPES = ['BVN', 'NIN', 'PHONE', 'BANK_ACCOUNT', 'FACE', 'ADDRESS', 'GOV_ID'] as const;
export type KycVerificationType = (typeof KYC_VERIFICATION_TYPES)[number];
export type KycVerificationStatus = 'PENDING' | 'PASSED' | 'FAILED' | 'REVIEW';

export const DOCUMENT_KINDS = [
  // KYC documents (required for onboarding)
  'ID_CARD',
  'PROOF_OF_ADDRESS',
  'PAYSLIP',
  'BANK_STATEMENT',
  // Loan origination legal forms (Damez internal — must be signed and uploaded before disbursement)
  'BASIS_OF_RECOMMENDATION',      // 4-tier approval recommendation form
  'LETTER_OF_HYPOTHECATION',      // charge over collateral assets
  'STOCK_VALUATION',              // customer stock/securities valuation
  'BUSINESS_ANALYSIS',            // customer business cashflow analysis
  'ASSETS_VALUATION',             // customer physical assets valuation
  'GUARANTOR_FORM',               // guarantor pledge and details
  'FINAL_GUARANTOR_FORM',         // guarantor final information form
  'DEPOSITED_COLLATERAL_ACK',     // acknowledgement of deposited collateral
  'NARRATE_CHEQUE_AUTHORITY',     // authority to date and narrate cheque
  'LOAN_FACILITY_APPLICATION',    // formal application for loan facility through Damez
  'IRREVOCABLE_STOCK_SPECTA',     // irrevocable letter of authority – Specta
  'IRREVOCABLE_STOCK_FORTUNE',    // irrevocable letter of authority – Fortune
  'AGREEMENT_LETTER',             // credit agreement / purchase agreement
  'MEMORANDUM_OF_UNDERSTANDING',  // MOU between customer and Damez
  // Other
  'OTHER',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  ID_CARD: 'Government ID',
  PROOF_OF_ADDRESS: 'Proof of address',
  PAYSLIP: 'Latest payslip',
  BANK_STATEMENT: 'Bank statement (6 months)',
  BASIS_OF_RECOMMENDATION: 'Basis of recommendation',
  LETTER_OF_HYPOTHECATION: 'Letter of hypothecation',
  STOCK_VALUATION: 'Stock / securities valuation',
  BUSINESS_ANALYSIS: 'Business analysis',
  ASSETS_VALUATION: 'Assets valuation',
  GUARANTOR_FORM: 'Guarantor form',
  FINAL_GUARANTOR_FORM: 'Guarantor final information',
  DEPOSITED_COLLATERAL_ACK: 'Acknowledgement of deposited collateral',
  NARRATE_CHEQUE_AUTHORITY: 'Authority to date & narrate cheque',
  LOAN_FACILITY_APPLICATION: 'Application for loan facility',
  IRREVOCABLE_STOCK_SPECTA: 'Irrevocable stock authority (Specta)',
  IRREVOCABLE_STOCK_FORTUNE: 'Irrevocable stock authority (Fortune)',
  AGREEMENT_LETTER: 'Agreement letter',
  MEMORANDUM_OF_UNDERSTANDING: 'Memorandum of understanding',
  OTHER: 'Other document',
};

/** Loan origination forms that must be uploaded before disbursement for applicable products. */
export const LOAN_ORIGINATION_FORM_KINDS: DocumentKind[] = [
  'BASIS_OF_RECOMMENDATION',
  'LETTER_OF_HYPOTHECATION',
  'GUARANTOR_FORM',
  'FINAL_GUARANTOR_FORM',
  'DEPOSITED_COLLATERAL_ACK',
  'NARRATE_CHEQUE_AUTHORITY',
  'LOAN_FACILITY_APPLICATION',
  'AGREEMENT_LETTER',
  'MEMORANDUM_OF_UNDERSTANDING',
];
export const ALLOWED_UPLOAD_MIME = ['image/jpeg', 'image/png', 'application/pdf', 'text/csv'] as const;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export type KycTier = 0 | 1 | 2 | 3;

/**
 * KYC tiers (CBN three-tier KYC, adapted for lending). Requirements are cumulative.
 *  Tier 1: verified phone + BVN (name matches)
 *  Tier 2: Tier 1 + face KYC passed (liveness + BVN/NIN photo match) + NIN or government ID verified
 *  Tier 3: Tier 2 + verified address (Dojah address verification or approved proof-of-address document)
 * `kyc.tier_loan_caps` (settings, kobo) caps the maximum loan per tier.
 */
export const DEFAULT_TIER_LOAN_CAPS_KOBO: Record<'1' | '2' | '3', number> = {
  '1': 100_000_00, // ₦100,000
  '2': 1_000_000_00, // ₦1,000,000
  '3': 10_000_000_00, // ₦10,000,000
};
export const KYC_TIER_REQUIREMENTS: { tier: 1 | 2 | 3; label: string; requirements: string[] }[] = [
  { tier: 1, label: 'Tier 1: Basic', requirements: ['Verified phone number', 'Verified BVN'] },
  { tier: 2, label: 'Tier 2: Standard', requirements: ['Everything in Tier 1', 'Selfie with liveness check matched to your BVN photo', 'NIN or government ID'] },
  { tier: 3, label: 'Tier 3: Premium', requirements: ['Everything in Tier 2', 'Verified home address'] },
];

/** Face KYC thresholds (percent). Overridable in settings `kyc.face_match_*`. */
export const FACE_MATCH_PASS = 80;
export const FACE_MATCH_REVIEW = 60;

export interface ConsentText {
  purpose: ConsentPurpose;
  version: string;
  title: string;
  body: string;
  required: boolean;
}

/** Versioned consent wording shown to customers; the version + sha256(body) is stored with every grant (NDPA 2023). */
export const CONSENT_TEXTS: ConsentText[] = [
  {
    purpose: 'DATA_PROCESSING', version: 'privacy-2026-01', title: 'Privacy notice', required: true,
    body: 'We collect and process your personal data (identity, contact, employment, financial and device data) to open and manage your account, assess and service loans, prevent fraud and meet legal obligations under the Nigeria Data Protection Act 2023 and CBN/FCCPC rules. We keep your data for as long as the law requires and you can request access, correction or erasure at any time.',
  },
  {
    purpose: 'KYC_VERIFICATION', version: 'kyc-2026-01', title: 'Identity verification', required: true,
    body: 'I authorise Damez and its verification partner (Dojah) to verify my BVN, NIN, phone number, bank account, address and a live selfie against government and bank records. My selfie is not stored after verification; only the result and match score are kept.',
  },
  {
    purpose: 'BUREAU_PULL', version: 'bureau-2026-01', title: 'Credit bureau check', required: true,
    body: 'I authorise Damez to obtain my credit report and repayment history from licensed credit bureaus in Nigeria (CRC Credit Bureau, FirstCentral and CreditRegistry) to assess my loan application, before any loan is disbursed and periodically while I have an active loan. I also authorise Damez to report my repayment performance on loans from Damez to these bureaus.',
  },
  {
    purpose: 'GSI_AUTODEBIT', version: 'gsi-2026-01', title: 'Standing instruction & autodebit', required: false,
    body: 'I authorise Damez to set up a standing instruction and debit my linked accounts on repayment due dates. I can withdraw this consent in writing, subject to my repayment obligations.',
  },
  {
    purpose: 'MARKETING', version: 'marketing-2026-01', title: 'Offers & updates', required: false,
    body: 'I agree to receive offers and product updates by SMS, email or WhatsApp. I can opt out at any time.',
  },
];

/** Mock KYC scenario selection (demo/testing). The mock provider keys off the LAST digit of the BVN/NIN. */
export const MOCK_KYC_SCENARIOS = {
  '0': 'PASS',
  '1': 'NAME_MISMATCH',
  '2': 'NOT_FOUND',
  '3': 'LOW_CONFIDENCE_FACE',
  '4': 'LIVENESS_FAIL',
  '5': 'PEP_MATCH',
  '6': 'PASS',
  '7': 'PASS',
  '8': 'PASS',
  '9': 'PASS',
} as const;
