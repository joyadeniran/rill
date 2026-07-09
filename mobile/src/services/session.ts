import * as SecureStore from 'expo-secure-store';

// Persisted CO session (token + profile) so officers are not forced to
// re-login on every app cold start. SecureStore = encrypted at rest
// (Keychain / Android Keystore), unlike AsyncStorage.

const SESSION_KEY = 'rill.session.v1';

export interface StoredSession {
  token: string;
  userData: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: 'co';
  };
}

/** Best-effort client-side expiry check. The token body is base64url JSON with
 * an `exp` (ms epoch). If it cannot be decoded, return null (treat as valid —
 * the server's 401 remains the authority and triggers logout via the
 * onUnauthorized hook). */
export function tokenExpiryMs(token: string): number | null {
  try {
    const body = token.split('.')[0];
    if (!body) return null;
    const b64 = body.replace(/-/g, '+').replace(/_/g, '/');
    // global atob is available on Hermes (RN >= 0.74)
    const json = typeof atob === 'function' ? atob(b64) : null;
    if (!json) return null;
    const payload = JSON.parse(json);
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

export async function saveSession(session: StoredSession): Promise<void> {
  try {
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Persistence is best-effort; the in-memory session still works.
  }
}

export async function loadSession(): Promise<StoredSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as StoredSession;
    if (!session?.token || !session?.userData?.id) return null;
    const exp = tokenExpiryMs(session.token);
    if (exp !== null && exp < Date.now()) {
      await clearSession();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  } catch {
    // ignore
  }
}
