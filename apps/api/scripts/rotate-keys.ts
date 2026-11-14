// Re-encrypt PII columns still on an old key: npm run rotate-keys -w @damez/api
import { PrismaClient } from '@prisma/client';
import { loadEnv } from '../src/config/env';
import { FieldCipher } from '../src/crypto/field-cipher';

const env = loadEnv();
const cipher = new FieldCipher(env.ENCRYPTION_KEYS, env.ENCRYPTION_ACTIVE_KEY, env.BLIND_INDEX_KEY);
const prisma = new PrismaClient();
const FIELDS = ['phone', 'email', 'bvn', 'nin', 'accountNumber'] as const;

async function main() {
  let rotated = 0;
  for (const c of await prisma.customer.findMany()) {
    const data: Record<string, string> = {};
    for (const f of FIELDS) {
      const col = `${f}Enc` as const;
      const v = (c as unknown as Record<string, string | null>)[col];
      if (v && cipher.needsRotation(v)) data[col] = cipher.rotate(v, `customer:${c.id}:${f}`);
    }
    if (Object.keys(data).length) { await prisma.customer.update({ where: { id: c.id }, data }); rotated++; }
  }
  for (const u of await prisma.staffUser.findMany({ where: { totpSecretEnc: { not: null } } })) {
    if (u.totpSecretEnc && cipher.needsRotation(u.totpSecretEnc)) {
      await prisma.staffUser.update({ where: { id: u.id }, data: { totpSecretEnc: cipher.rotate(u.totpSecretEnc, `totp:${u.id}`) } });
      rotated++;
    }
  }
  console.log(`Rotated ${rotated} rows to key ${cipher.activeKeyId}`);
}
main().finally(() => prisma.$disconnect());
