let counter = 0;

export function createId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'state';
}

export function toIdentifier(value: string): string {
  const normalized = slugify(value).replace(/_+([a-z])/g, (_, ch: string) => ch.toUpperCase());
  return /^[a-zA-Z_]/.test(normalized) ? normalized : `s_${normalized}`;
}
