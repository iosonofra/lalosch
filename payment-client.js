/** Public checkout client. Credentials and STEP files stay on the server. */
export function purchaseStorageKey(environment = 'sandbox') {
  if (environment === 'sandbox') return 'lalosch-paypal-v2';
  if (environment === 'live') return 'lalosch-paypal-v2-live';
  if (environment === 'test') return 'lalosch-free-test-v2';
  throw new Error('La modalità di pagamento non è valida.');
}

export function paypalReturn(search) {
  const query = new URLSearchParams(search);
  const action = query.get('paypal');
  if (action === 'cancel') return { action: 'cancel' };
  if (action === 'return' && query.get('token')) return { action: 'capture', orderId: query.get('token') };
  return null;
}

export function safeApprovalUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !(url.hostname === 'paypal.com' || url.hostname.endsWith('.paypal.com'))) {
    throw new Error('Il collegamento di pagamento PayPal non è valido.');
  }
  return url.href;
}

export function sameOriginDownload(value, origin) {
  const url = new URL(value, origin);
  if (url.origin !== origin || !url.pathname.startsWith('/api/')) {
    throw new Error('Il collegamento per i file non è valido.');
  }
  return url.href;
}

export function formatPrice(amount, currency, locale = 'it-IT') {
  if (amount == null || !currency || !Number.isFinite(Number(amount))) return '';
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(amount)); }
  catch { return ''; }
}

export async function requestJson(path, { method = 'GET', body, accessToken, fetcher = fetch } = {}) {
  const response = await fetcher(path, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.message ?? result.error ?? 'Il servizio non è disponibile. Riprova tra poco.');
    error.status = response.status; error.code = result.error;
    throw error;
  }
  return result;
}
