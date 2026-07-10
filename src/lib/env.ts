import { z } from "zod";

const isMock = process.env.USE_MOCK_DB === "true";

const envSchema = z.object({
  // DB vars are optional in mock mode
  DATABASE_URL: isMock
    ? z.string().optional().default("mock")
    : z.string().min(1, "DATABASE_URL is required"),
  MSSQL_CONNECTION_STRING: isMock
    ? z.string().optional().default("mock")
    : z.string().min(1, "MSSQL_CONNECTION_STRING is required"),
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters"),
  // Optional — email provider credentials, added when provider is chosen
  EMAIL_FROM: z.string().optional().default("noreply@example.com"),
  RESEND_API_KEY: z.string().optional(),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${issues}`);
  }
  return result.data;
}

// Validate once at module load. In Next.js dev, this runs each cold start.
export const env = validateEnv();
