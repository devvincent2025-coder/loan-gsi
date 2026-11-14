import type { Page } from '@damez/shared';

export function paged<T>(items: T[], total: number, page: number, pageSize: number): Page<T> {
  return { items, total, page, pageSize };
}
export const skipTake = (page: number, pageSize: number) => ({ skip: (page - 1) * pageSize, take: pageSize });
