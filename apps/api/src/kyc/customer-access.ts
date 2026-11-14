import { NotFoundException } from '@nestjs/common';
import type { Customer } from '@prisma/client';
import { AuthUser, canSeeBranch } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';

/** Load a customer for a STAFF caller, enforcing branch scope (404 rather than 403 so ids do not leak). */
export async function loadScopedCustomer(prisma: PrismaService, user: AuthUser, id: string): Promise<Customer> {
  const c = await prisma.customer.findUnique({ where: { id } });
  if (!c || c.erasedAt || !canSeeBranch(user, c.branchId)) throw new NotFoundException('Customer not found');
  return c;
}
