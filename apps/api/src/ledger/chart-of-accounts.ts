import { AccountType, PostingSide } from '@prisma/client';

/** The fixed system chart of accounts. Codes are referenced by name throughout the ledger/ECL code. */
export interface ChartAccountSeed { code: string; name: string; type: AccountType; normalSide: PostingSide }

export const ACCOUNT_CODES = {
  CASH: '1000',
  LOAN_PRINCIPAL_RECEIVABLE: '1100',
  INTEREST_RECEIVABLE: '1200',
  FEES_RECEIVABLE: '1300',
  PENALTY_RECEIVABLE: '1400',
  CUSTOMER_SUSPENSE: '2000',
  DISBURSEMENT_CLEARING: '3000',
  INTEREST_INCOME: '4000',
  FEE_INCOME: '4100',
  PENALTY_INCOME: '4200',
  RECOVERY_INCOME: '4300',
  WRITE_OFF_EXPENSE: '5000',
  ECL_PROVISION_EXPENSE: '5100',
  ALLOWANCE_FOR_ECL: '1900',
} as const;

/** Receivable control accounts a loan's postings land on (used to compute loan outstanding). */
export const RECEIVABLE_ACCOUNT_CODES: string[] = [
  ACCOUNT_CODES.LOAN_PRINCIPAL_RECEIVABLE,
  ACCOUNT_CODES.INTEREST_RECEIVABLE,
  ACCOUNT_CODES.FEES_RECEIVABLE,
  ACCOUNT_CODES.PENALTY_RECEIVABLE,
];

export const CHART_OF_ACCOUNTS: ChartAccountSeed[] = [
  { code: ACCOUNT_CODES.CASH, name: 'Cash/Bank', type: AccountType.ASSET, normalSide: PostingSide.DEBIT },
  { code: ACCOUNT_CODES.LOAN_PRINCIPAL_RECEIVABLE, name: 'Loan Principal Receivable', type: AccountType.ASSET, normalSide: PostingSide.DEBIT },
  { code: ACCOUNT_CODES.INTEREST_RECEIVABLE, name: 'Interest Receivable', type: AccountType.ASSET, normalSide: PostingSide.DEBIT },
  { code: ACCOUNT_CODES.FEES_RECEIVABLE, name: 'Fees Receivable', type: AccountType.ASSET, normalSide: PostingSide.DEBIT },
  { code: ACCOUNT_CODES.PENALTY_RECEIVABLE, name: 'Penalty Receivable', type: AccountType.ASSET, normalSide: PostingSide.DEBIT },
  { code: ACCOUNT_CODES.CUSTOMER_SUSPENSE, name: 'Customer Suspense', type: AccountType.LIABILITY, normalSide: PostingSide.CREDIT },
  { code: ACCOUNT_CODES.DISBURSEMENT_CLEARING, name: 'Disbursement Clearing', type: AccountType.ASSET, normalSide: PostingSide.DEBIT },
  { code: ACCOUNT_CODES.INTEREST_INCOME, name: 'Interest Income', type: AccountType.INCOME, normalSide: PostingSide.CREDIT },
  { code: ACCOUNT_CODES.FEE_INCOME, name: 'Fee Income', type: AccountType.INCOME, normalSide: PostingSide.CREDIT },
  { code: ACCOUNT_CODES.PENALTY_INCOME, name: 'Penalty Income', type: AccountType.INCOME, normalSide: PostingSide.CREDIT },
  { code: ACCOUNT_CODES.RECOVERY_INCOME, name: 'Recovery Income', type: AccountType.INCOME, normalSide: PostingSide.CREDIT },
  { code: ACCOUNT_CODES.WRITE_OFF_EXPENSE, name: 'Write-off Expense', type: AccountType.EXPENSE, normalSide: PostingSide.DEBIT },
  { code: ACCOUNT_CODES.ECL_PROVISION_EXPENSE, name: 'ECL Provision Expense', type: AccountType.EXPENSE, normalSide: PostingSide.DEBIT },
  // Contra-asset: carried as type ASSET per spec, but its normal balance is a credit (reduces receivables).
  { code: ACCOUNT_CODES.ALLOWANCE_FOR_ECL, name: 'Allowance for ECL', type: AccountType.ASSET, normalSide: PostingSide.CREDIT },
];
