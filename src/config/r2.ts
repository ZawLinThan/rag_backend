import { S3Client } from "@aws-sdk/client-s3";
import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
    R2_ENDPOINT: z.url(),
    R2_ACCESS_KEY_ID: z.string().trim().min(1),
    R2_SECRET_ACCESS_KEY: z.string().trim().min(1),
});

const env = envSchema.parse(process.env);

export const s3 = new S3Client({
    region: "auto", // Required by AWS SDK, not used by R2
    forcePathStyle: true,
    // Provide your R2 endpoint: https://<ACCOUNT_ID>.r2.cloudflarestorage.com
    endpoint: env.R2_ENDPOINT,
    credentials: {
        // Provide your R2 Access Key ID and Secret Access Key
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
});
