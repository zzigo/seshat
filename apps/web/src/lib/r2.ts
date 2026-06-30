import { S3Client } from '@aws-sdk/client-s3';

let client: S3Client | undefined;

export const getR2Bucket = (): string => {
  const bucket = process.env.R2_BUCKET?.trim();
  if (!bucket) throw new Error('R2_BUCKET_NOT_CONFIGURED');
  return bucket;
};

export const getR2Client = (): S3Client => {
  if (client) return client;
  const endpoint = process.env.R2_ENDPOINT?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !accessKeyId || !secretAccessKey) throw new Error('R2_NOT_CONFIGURED');
  client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
  return client;
};
