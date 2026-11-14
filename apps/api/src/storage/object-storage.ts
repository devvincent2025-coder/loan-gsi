import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { promises as fs } from 'fs';
import { dirname, resolve, sep } from 'path';

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

/** Blob store for ENCRYPTED document bytes. Keys look like `kyc/<customerId>/<docId>`. */
export interface ObjectStorage {
  readonly name: string;
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

/** Default (mock) storage: files under STORAGE_LOCAL_DIR. Never serve this directory over HTTP. */
export class LocalObjectStorage implements ObjectStorage {
  readonly name = 'local';
  private root: string;
  constructor(dir: string) { this.root = resolve(dir); }

  private path(key: string): string {
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + sep)) throw new Error('Invalid storage key');
    return p;
  }
  async put(key: string, bytes: Buffer): Promise<void> {
    const p = this.path(key);
    await fs.mkdir(dirname(p), { recursive: true });
    await fs.writeFile(p, bytes, { mode: 0o600 });
  }
  get(key: string): Promise<Buffer> { return fs.readFile(this.path(key)); }
  async delete(key: string): Promise<void> { await fs.rm(this.path(key), { force: true }); }
}

/** S3-compatible storage (AWS, MinIO, R2…). Objects are encrypted by us already; SSE AES256 is defence in depth. */
export class S3ObjectStorage implements ObjectStorage {
  readonly name = 's3';
  private client: S3Client;
  constructor(private opts: { endpoint?: string; region: string; bucket?: string; accessKeyId?: string; secretAccessKey?: string; forcePathStyle: boolean }) {
    this.client = new S3Client({
      region: opts.region, endpoint: opts.endpoint, forcePathStyle: opts.forcePathStyle,
      credentials: opts.accessKeyId && opts.secretAccessKey ? { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey } : undefined,
    });
  }
  private bucket(): string {
    if (!this.opts.bucket) throw new Error('S3_BUCKET is not configured');
    return this.opts.bucket;
  }
  async put(key: string, bytes: Buffer): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket(), Key: key, Body: bytes, ContentType: 'application/octet-stream', ServerSideEncryption: 'AES256' }));
  }
  async get(key: string): Promise<Buffer> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket(), Key: key }));
    if (!r.Body) throw new Error('Empty object body');
    return Buffer.from(await r.Body.transformToByteArray());
  }
  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket(), Key: key }));
  }
}
