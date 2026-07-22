// Serves the PUBLIC half of the VAPID keypair to client-side code
// subscribing to push. Public keys are safe to expose this way —
// fetched at subscribe-time instead of hardcoded in client JS, so
// setting VAPID_PUBLIC_KEY in Netlify's env vars is all that's
// needed to activate this; no code redeploy required.
//
// Real key generation (Frank runs this once, locally):
//   npx web-push generate-vapid-keys
// Then sets VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY as Netlify
// environment variables (Site settings -> Environment variables).
// Until those are set, this returns a real, honest error — never
// a fake placeholder key that would silently fail subscription.

exports.handler = async () => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Push notifications are not configured yet.' }) };
  }
  return { statusCode: 200, body: JSON.stringify({ publicKey }) };
};
