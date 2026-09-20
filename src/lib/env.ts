export function envOr(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value && value.length > 0) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable: ${name}`);
}

export function envOrNull(name: string): string | null {
  const value = process.env[name];
  return value && value.length > 0 ? value : null;
}
