import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

const envSchema = z.object({
  PORT: z.string().default('3000').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  LLM_BASE_URL: z.string().default('https://api.openai.com/v1'),
  LLM_API_KEY: z.string().min(1, 'LLM_API_KEY is required'),
  LLM_MODEL: z.string().default('gpt-4o'),

  GITHUB_TOKEN: z.string().default(''),
  GITHUB_WEBHOOK_SECRET: z.string().default(''),

  SANDBOX_CPU_QUOTA: z.string().default('50000').transform(Number),
  SANDBOX_MEM_LIMIT: z.string().default('512m'),
  SANDBOX_TIMEOUT_MS: z.string().default('120000').transform(Number),
  SANDBOX_IMAGE: z.string().default('node:20-alpine'),

  AGENT_MAX_ATTEMPTS: z.string().default('5').transform(Number),
  AGENT_MAX_TOKENS: z.string().default('32000').transform(Number),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌  Invalid environment variables:');
  for (const issue of parsed.error.issues) {
    console.error(`   ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = parsed.data;
