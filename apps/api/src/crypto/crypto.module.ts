import { Global, Module } from '@nestjs/common';
import { APP_ENV, AppEnv } from '../config/config.module';
import { FieldCipher } from './field-cipher';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

@Global()
@Module({
  providers: [
    {
      provide: FieldCipher,
      inject: [APP_ENV],
      useFactory: (env: AppEnv) => new FieldCipher(env.ENCRYPTION_KEYS, env.ENCRYPTION_ACTIVE_KEY, env.BLIND_INDEX_KEY),
    },
    PasswordService,
    TokenService,
  ],
  exports: [FieldCipher, PasswordService, TokenService],
})
export class CryptoModule {}
