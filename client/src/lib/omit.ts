export function omit<T extends object, K extends keyof T>(
  object: T,
  keys: readonly K[]
): Omit<T, K> {
  const rest = { ...object };
  for (const key of keys) delete rest[key];
  return rest;
}
