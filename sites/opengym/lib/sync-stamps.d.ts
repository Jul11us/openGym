/** Types for the unmodified upstream pure synchronization helper. */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue | undefined };
export function stampPut(
  current: Record<string, JsonValue | undefined> | null,
  next: Record<string, JsonValue | undefined>,
  options?: { overRead?: boolean; stamped?: boolean; now?: number; report?: { changed?: boolean } | null },
): Record<string, JsonValue | undefined>;
