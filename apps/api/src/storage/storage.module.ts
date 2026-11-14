import { Global, Module } from '@nestjs/common';
import { APP_ENV, AppEnv } from '../config/config.module';
import { LocalObjectStorage, OBJECT_STORAGE, ObjectStorage, S3ObjectStorage } from './object-storage';

@Global()
@Module({
  providers: [{
    provide: OBJECT_STORAGE, inject: [APP_ENV],
    useFactory: (e: AppEnv): ObjectStorage => e.STORAGE_PROVIDER === 's3'
      ? new S3ObjectStorage({ endpoint: e.S3_ENDPOINT, region: e.S3_REGION, bucket: e.S3_BUCKET, accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY, forcePathStyle: e.S3_FORCE_PATH_STYLE })
      : new LocalObjectStorage(e.STORAGE_LOCAL_DIR),
  }],
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}
