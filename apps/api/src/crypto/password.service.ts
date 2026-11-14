import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

// argon2id (algorithm: 2). OWASP-aligned parameters.
const OPTS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService {
  private dummy: Promise<string> | null = null;

  hash(password: string): Promise<string> {
    return hash(password, OPTS);
  }

  async verify(hashed: string, password: string): Promise<boolean> {
    try {
      return await verify(hashed, password);
    } catch {
      return false;
    }
  }

  /** Burn comparable CPU time for unknown users so timing does not reveal account existence. */
  async verifyDummy(password: string): Promise<void> {
    this.dummy ??= this.hash('dummy-password-for-timing');
    await this.verify(await this.dummy, password);
  }
}
