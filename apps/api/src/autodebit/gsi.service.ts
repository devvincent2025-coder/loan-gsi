import { Inject, Injectable } from '@nestjs/common';
import { APP_ENV, AppEnv } from '../config/config.module';
import type { GsiPort } from '../contracts/ports';
import { pseudoPercent } from './mandate.service';

/**
 * CBN Global Standing Instruction: a bank-wide, BVN-linked debit that can pull from ANY account the borrower's
 * BVN is linked to (not just ones they explicitly connected to us), used as a last-resort recovery fallback once
 * the primary mandate/retry ladder is exhausted. Requires the lender to be a CBN/NIBSS GSI participant.
 */
@Injectable()
export class GsiService implements GsiPort {
  constructor(@Inject(APP_ENV) private env: AppEnv) {}

  async trigger(args: {
    customerId: string; bvn: string; amountKobo: number; idempotencyKey: string;
    accounts: { accountNumber: string; bankCode: string; priority: number }[];
  }): Promise<{ status: 'SUCCESS' | 'PARTIAL' | 'FAILED'; collectedKobo: number; perAccount: { accountNumber: string; bankCode: string; collectedKobo: number }[] }> {
    if (this.env.GSI_PROVIDER === 'live') {
      // TODO(cbn): GSI is triggered through NIBSS as the CBN's designated GSI operator. TODO(nibss): submit a
      // GSI trigger request keyed by BVN + amount; NIBSS fans the debit out across the BVN's linked accounts
      // bank-wide and returns a consolidated (and sometimes a per-bank) collection result, typically async
      // (poll or webhook). Requires `GSI_BASE_URL`/`GSI_API_KEY` and the lender's CBN/NIBSS GSI participant code.
      throw new Error('GSI live provider not implemented');
    }

    // Mock: walk accounts by priority, pulling a deterministic pseudo-available amount from each until covered.
    const sorted = [...args.accounts].sort((a, b) => a.priority - b.priority);
    let remaining = args.amountKobo;
    const perAccount: { accountNumber: string; bankCode: string; collectedKobo: number }[] = [];
    for (const acct of sorted) {
      if (remaining <= 0) { perAccount.push({ accountNumber: acct.accountNumber, bankCode: acct.bankCode, collectedKobo: 0 }); continue; }
      const availablePct = pseudoPercent(`${args.idempotencyKey}:${acct.accountNumber}:${acct.bankCode}`);
      const available = Math.round(args.amountKobo * (availablePct / 100));
      const collected = Math.min(remaining, available);
      remaining -= collected;
      perAccount.push({ accountNumber: acct.accountNumber, bankCode: acct.bankCode, collectedKobo: collected });
    }
    const collectedKobo = args.amountKobo - remaining;
    const status = collectedKobo >= args.amountKobo ? 'SUCCESS' : collectedKobo > 0 ? 'PARTIAL' : 'FAILED';
    return { status, collectedKobo, perAccount };
  }
}
