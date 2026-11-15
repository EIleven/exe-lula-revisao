/** Validacao civil declarada. Isto nao comprova identidade nem idade real. */
export function isAdultBirthDate(value: string, now = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
    || year < 1900
  ) return false;
  const cutoff = new Date(Date.UTC(now.getUTCFullYear() - 18, now.getUTCMonth(), now.getUTCDate()));
  return parsed <= cutoff;
}

/** Maior data aceita por um input date para uma pessoa que declara 18 anos. */
export function adultBirthDateMax(now = new Date()): string {
  const cutoff = new Date(Date.UTC(now.getUTCFullYear() - 18, now.getUTCMonth(), now.getUTCDate()));
  return cutoff.toISOString().slice(0, 10);
}
