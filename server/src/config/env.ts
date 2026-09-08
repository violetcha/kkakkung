import { z } from 'zod';

const environment = z.object({
  NODE_ENV: z.enum(['development', 'test']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(2567),
  ALLOWED_ORIGINS: z
    .string()
    .default(
      'http://localhost:5173,http://127.0.0.1:5173,http://localhost:2567,http://127.0.0.1:2567',
    ),
  SERVICE_NAMESPACE: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .default('kkakkung-local'),
  MEDIA_MODE: z.literal('disabled').default('disabled'),
  MAX_ROOMS: z.coerce
    .number()
    .refine((n) => n === 1)
    .default(1),
  MAX_SLOTS: z.coerce
    .number()
    .refine((n) => n === 6)
    .default(6),
  OPS_DATA_DIR: z.string().default('./.local/operations'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
});

export function parseConfig(env: Record<string, string | undefined>) {
  const parsed = environment.safeParse(env);
  if (!parsed.success) {
    // Report names only; never echo environment values or secrets.
    throw new Error(
      `Unsupported skeleton configuration: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}. Production authentication and media readiness are not implemented.`,
    );
  }
  const raw = parsed.data;
  const allowedOrigins = raw.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  if (
    !allowedOrigins.length ||
    allowedOrigins.some((s) => {
      try {
        const u = new URL(s);
        return !['http:', 'https:'].includes(u.protocol) || u.origin !== s;
      } catch {
        return true;
      }
    })
  )
    throw new Error('ALLOWED_ORIGINS must contain exact HTTP origins');
  return {
    host: raw.HOST,
    port: raw.PORT,
    allowedOrigins,
    namespace: raw.SERVICE_NAMESPACE,
    mediaMode: raw.MEDIA_MODE,
    maxRooms: raw.MAX_ROOMS,
    maxSlots: raw.MAX_SLOTS,
    opsDataDir: raw.OPS_DATA_DIR,
    logLevel: raw.LOG_LEVEL,
  };
}

export type AppConfig = ReturnType<typeof parseConfig>;
