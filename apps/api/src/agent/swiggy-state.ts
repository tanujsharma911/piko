interface PendingAuth {
  userId: string;
  verifier: string;
  expiresAt: number;
}

const stateStore = new Map<string, PendingAuth>();

const STATE_TTL_MS = 120_000;

export function saveState(
  state: string,
  userId: string,
  verifier: string,
): void {
  stateStore.set(state, {
    userId,
    verifier,
    expiresAt: Date.now() + STATE_TTL_MS,
  });
}

export function consumeState(state: string): PendingAuth | null {
  const entry = stateStore.get(state);
  if (!entry) return null;
  stateStore.delete(state);
  if (Date.now() > entry.expiresAt) return null;
  return entry;
}
