import { PrismaService } from '../prisma/prisma.service';

/** Read a SystemSetting value with a typed fallback (settings may not be seeded in every environment). */
export async function getSetting<T>(prisma: PrismaService, key: string, fallback: T): Promise<T> {
  const r = await prisma.systemSetting.findUnique({ where: { key } });
  return r && r.value !== null && r.value !== undefined ? (r.value as unknown as T) : fallback;
}
