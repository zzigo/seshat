import { S3Client } from '@aws-sdk/client-s3';

let client: S3Client | undefined;

const configuredEndpoint = (): string => {
  const value = process.env.WASABI_ENDPOINT?.trim() || 'https://s3.us-east-2.wasabisys.com';
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
};

export const getWasabiBucket = (): string => {
  const bucket = process.env.WASABI_BUCKET?.trim() || 'untref-licmusica';
  if (!bucket) throw new Error('WASABI_BUCKET_NOT_CONFIGURED');
  return bucket;
};

export const getWasabiClient = (): S3Client => {
  if (client) return client;
  const accessKeyId = process.env.WASABI_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.WASABI_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) throw new Error('WASABI_NOT_CONFIGURED');
  client = new S3Client({
    region: process.env.WASABI_REGION?.trim() || 'us-east-2',
    endpoint: configuredEndpoint(),
    forcePathStyle: false,
    credentials: { accessKeyId, secretAccessKey },
  });
  return client;
};
