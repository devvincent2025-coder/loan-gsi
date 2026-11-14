export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  branchId: string | null;
  allBranches: boolean;
  branchScoped: boolean;
  permissions: Set<string>;
  sessionId: string;
}

/** Prisma `where` fragment restricting rows to the user's branch scope. */
export function branchWhere(user: AuthUser, field = 'branchId'): Record<string, unknown> {
  if (user.allBranches || !user.branchScoped) return {};
  return { [field]: user.branchId ?? '__no_branch__' };
}
export function canSeeBranch(user: AuthUser, branchId: string | null): boolean {
  if (user.allBranches || !user.branchScoped) return true;
  return !!user.branchId && user.branchId === branchId;
}
