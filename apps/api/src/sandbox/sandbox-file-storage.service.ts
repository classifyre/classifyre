import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  NoSuchKey,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';

export interface SandboxFileUploadResult {
  s3Key: string;
  contentHash: string;
}

interface S3Config {
  client: S3Client;
  bucket: string;
  prefix: string;
}

@Injectable()
export class SandboxFileStorageService implements OnModuleInit {
  private readonly logger = new Logger(SandboxFileStorageService.name);
  private s3: S3Config | null = null;

  async onModuleInit(): Promise<void> {
    const bucket = process.env.S3_SANDBOX_BUCKET;
    if (!bucket) return;

    const endpoint = process.env.S3_ENDPOINT;
    const region = process.env.S3_REGION || 'us-east-1';
    const forcePathStyle = process.env.S3_FORCE_PATH_STYLE !== 'false';

    const client = new S3Client({
      region,
      ...(endpoint ? { endpoint } : {}),
      forcePathStyle,
      credentials:
        process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
          ? {
              accessKeyId: process.env.S3_ACCESS_KEY_ID,
              secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
            }
          : undefined,
    });

    this.s3 = {
      client,
      bucket,
      prefix: 'sandbox-files/',
    };

    await this.ensureBucket();
    this.logger.log(
      `Sandbox S3 storage: bucket=${bucket} endpoint=${endpoint || 'aws'}`,
    );
  }

  get isEnabled(): boolean {
    return this.s3 !== null;
  }

  /** SHA-256 hex digest of the file buffer. */
  computeHash(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Upload a file to S3. Uses content-addressable key so duplicate files share
   * the same S3 object. Returns the S3 key and content hash.
   * No-op (returns existing key) when the object already exists.
   */
  async uploadFile(
    buffer: Buffer,
    extension: string,
  ): Promise<SandboxFileUploadResult> {
    if (!this.s3) throw new Error('Sandbox S3 storage is not configured');

    const contentHash = this.computeHash(buffer);
    const s3Key = `${this.s3.prefix}${contentHash}${extension}`;

    // Skip upload if the object already exists (idempotent, content-addressed)
    try {
      await this.s3.client.send(
        new HeadObjectCommand({ Bucket: this.s3.bucket, Key: s3Key }),
      );
      return { s3Key, contentHash };
    } catch {
      // Object does not exist — upload it
    }

    await this.s3.client.send(
      new PutObjectCommand({
        Bucket: this.s3.bucket,
        Key: s3Key,
        Body: buffer,
        ContentLength: buffer.length,
        ContentType: 'application/octet-stream',
      }),
    );

    this.logger.debug(`Uploaded sandbox file: ${s3Key} (${buffer.length} B)`);
    return { s3Key, contentHash };
  }

  /** Download a file from S3 and return its contents as a Buffer. */
  async downloadFile(s3Key: string): Promise<Buffer> {
    if (!this.s3) throw new Error('Sandbox S3 storage is not configured');

    const obj = await this.s3.client.send(
      new GetObjectCommand({ Bucket: this.s3.bucket, Key: s3Key }),
    );

    const chunks: Buffer[] = [];
    for await (const chunk of obj.Body as Readable) {
      chunks.push(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string),
      );
    }
    return Buffer.concat(chunks);
  }

  /**
   * Delete the S3 object for a run. Pass the number of OTHER runs that still
   * reference the same contentHash — if > 0 the object is shared and kept.
   */
  async deleteFile(s3Key: string, otherRefCount: number): Promise<void> {
    if (!this.s3) return;
    if (otherRefCount > 0) {
      this.logger.debug(
        `Skipping S3 delete for ${s3Key}: ${otherRefCount} other run(s) share this file`,
      );
      return;
    }

    try {
      await this.s3.client.send(
        new DeleteObjectCommand({ Bucket: this.s3.bucket, Key: s3Key }),
      );
      this.logger.debug(`Deleted sandbox S3 file: ${s3Key}`);
    } catch (err: any) {
      if (!(err instanceof NoSuchKey) && err?.name !== 'NoSuchKey') {
        this.logger.warn(
          `Failed to delete sandbox S3 file ${s3Key}: ${err?.message}`,
        );
      }
    }
  }

  private async ensureBucket(): Promise<void> {
    const { client, bucket } = this.s3!;
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      try {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
        this.logger.log(`Created sandbox S3 bucket: ${bucket}`);
      } catch (err: any) {
        if (err?.Code !== 'BucketAlreadyOwnedByYou') {
          this.logger.error(
            `Failed to create sandbox S3 bucket ${bucket}: ${err?.message}`,
          );
        }
      }
    }
  }
}
