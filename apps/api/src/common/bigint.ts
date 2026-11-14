/** Money is BigInt kobo in Prisma. JSON has no BigInt: serialise as a JSON number (safe below ₦90 trillion). */
export function installBigIntJson(): void {
  (BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function (this: bigint) {
    const n = Number(this);
    if (!Number.isSafeInteger(n)) throw new Error('BigInt outside JSON safe integer range');
    return n;
  };
}
export const n = (v: bigint | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));
