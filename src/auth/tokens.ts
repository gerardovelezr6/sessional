// Small pure helpers about access tokens. No verification happens here: the database verifies the
// token on every call. This only reads the expiry to decide when to refresh.

export const ACCESS_COOKIE = 's_at';
export const REFRESH_COOKIE = 's_rt';
export const REFRESH_MARGIN_SECONDS = 60;

export function expiryOf(accessToken: string | undefined): number | null {
  const payload = accessToken?.split('.')[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown };
    return typeof json.exp === 'number' ? json.exp : null;
  } catch {
    return null;
  }
}

export function needsRefresh(accessToken: string | undefined, refreshToken: string | undefined, nowSeconds: number): boolean {
  if (!refreshToken) return false;
  const exp = expiryOf(accessToken);
  return exp === null || exp - nowSeconds < REFRESH_MARGIN_SECONDS;
}
