export const NIGERIAN_STATES = [
  'Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River','Delta',
  'Ebonyi','Edo','Ekiti','Enugu','FCT','Gombe','Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi',
  'Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto',
  'Taraba','Yobe','Zamfara',
] as const;

export interface BankInfo { code: string; name: string }
/** CBN / NIBSS bank codes (common subset). */
export const NIGERIAN_BANKS: BankInfo[] = [
  { code: '044', name: 'Access Bank' },
  { code: '058', name: 'Guaranty Trust Bank' },
  { code: '011', name: 'First Bank of Nigeria' },
  { code: '033', name: 'United Bank for Africa' },
  { code: '057', name: 'Zenith Bank' },
  { code: '070', name: 'Fidelity Bank' },
  { code: '221', name: 'Stanbic IBTC Bank' },
  { code: '232', name: 'Sterling Bank' },
  { code: '032', name: 'Union Bank' },
  { code: '035', name: 'Wema Bank' },
  { code: '076', name: 'Polaris Bank' },
  { code: '214', name: 'FCMB' },
  { code: '050', name: 'Ecobank Nigeria' },
  { code: '215', name: 'Unity Bank' },
  { code: '068', name: 'Standard Chartered' },
  { code: '50211', name: 'Kuda Microfinance Bank' },
  { code: '50515', name: 'Moniepoint MFB' },
  { code: '999992', name: 'OPay' },
  { code: '999991', name: 'PalmPay' },
];

export const SESSION_DEFAULTS = {
  idleTimeoutSeconds: 30 * 60,
  absoluteTimeoutSeconds: 12 * 60 * 60,
  maxFailedLogins: 5,
  lockoutMinutes: 15,
} as const;

export const CONSENT_PURPOSES = [
  'DATA_PROCESSING',
  'BUREAU_PULL',
  'GSI_AUTODEBIT',
  'MARKETING',
  'KYC_VERIFICATION',
  'LLM_PROCESSING',
] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
