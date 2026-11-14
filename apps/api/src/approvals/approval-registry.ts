import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ApprovalActionType } from '@damez/shared';
import type { AuthUser } from '../common/auth-user';

export interface ApprovalExecutionContext {
  id: string;
  type: ApprovalActionType;
  payload: Record<string, unknown>;
  amountKobo: bigint | null;
  makerId: string;
  summary: string;
  reason: string | null;
}

/**
 * A module that wants four-eyes control registers a handler. `execute` runs inside the approving
 * transaction: throw to roll back and mark the request FAILED.
 */
export interface ApprovalHandler {
  type: ApprovalActionType;
  /** permission the maker needs to submit this type */
  submitPermission: string;
  /** validate/normalise the payload at submit time; throw BadRequestException on error */
  validate(payload: Record<string, unknown>, amountKobo: bigint | null): Promise<Record<string, unknown>> | Record<string, unknown>;
  execute(req: ApprovalExecutionContext, tx: Prisma.TransactionClient, approver: AuthUser): Promise<unknown>;
}

@Injectable()
export class ApprovalRegistry {
  private handlers = new Map<ApprovalActionType, ApprovalHandler>();
  register(h: ApprovalHandler): void { this.handlers.set(h.type, h); }
  get(type: ApprovalActionType): ApprovalHandler | undefined { return this.handlers.get(type); }
}
