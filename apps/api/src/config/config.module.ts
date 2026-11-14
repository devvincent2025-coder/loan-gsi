import { Global, Module } from '@nestjs/common';
import { Env, loadEnv } from './env';

export const APP_ENV = 'APP_ENV';
export type AppEnv = Env;

@Global()
@Module({
  providers: [{ provide: APP_ENV, useFactory: () => loadEnv() }],
  exports: [APP_ENV],
})
export class ConfigModule {}
