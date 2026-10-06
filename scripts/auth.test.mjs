import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { ServerOidcAuth, safeAuthReturnPath } from '../src/lib/internal/server-oidc.ts';

const authority = 'https://identity.example';
const origin = 'https://viewer.example';
const clientId = 'paraframe-test';
const clientSecret = 'test-only-client-secret';
const sessionSecret = 'test-only-session-encryption-secret-1234567890';
const pair = await generateKeyPair('RS256');
const otherPair = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(pair.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
const originalFetch = globalThis.fetch;
let fixture, authorization, tokenRequests, refreshRequests;

class Cookies {
 values = new Map(); options = new Map();
 get(name) { return this.values.get(name); }
 set(name, value, options) { this.values.set(name, value); this.options.set(name, options); }
 delete(name) { this.values.delete(name); }
}

function setup(config = {}) {
 fixture = {}; tokenRequests = refreshRequests = 0;
 const auth = new ServerOidcAuth({ authority, clientId, clientSecret, sessionSecret, ...config });
 const cookies = new Cookies();
 const call = async (path, method = 'GET', headers = {}) => {
  const url = new URL(path, origin);
  return auth.handle({ request: new Request(url, { method, headers }), url, cookies });
 };
 return { auth, cookies, call };
}

async function tokens(refreshed = false) {
 const now = Math.floor(Date.now() / 1000);
 const payload = { iss: authority, aud: clientId, sub: 'user-1', iat: now, exp: now + 3600,
  nonce: authorization.searchParams.get('nonce'), name: 'Florence Example', email: 'florence@example.com', ...fixture.claims };
 return { id_token: await new SignJWT(payload).setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
  .sign(fixture.badSignature ? otherPair.privateKey : pair.privateKey),
  access_token: 'private-access-token', refresh_token: fixture.noRefresh ? undefined : 'private-refresh-token',
  token_type: 'Bearer', expires_in: refreshed ? 3600 : (fixture.expiresIn ?? 3600), scope: 'openid profile email offline_access' };
}

before(() => {
 globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  assert.equal(url.origin, authority);
  if (url.pathname === '/.well-known/openid-configuration') return Response.json({ issuer: authority,
   authorization_endpoint: `${authority}/authorize`, token_endpoint: `${authority}/token`, jwks_uri: `${authority}/jwks`,
   end_session_endpoint: `${authority}/logout`, id_token_signing_alg_values_supported: ['RS256'],
   authorization_response_iss_parameter_supported: true, token_endpoint_auth_methods_supported: ['client_secret_post'] });
  if (url.pathname === '/jwks') return Response.json({ keys: [jwk] });
  if (url.pathname === '/token') {
   const body = new URLSearchParams(init.body);
   assert.equal(body.get('client_id'), clientId);
   assert.equal(body.get('client_secret'), clientSecret);
   if (body.get('grant_type') === 'refresh_token') {
    refreshRequests++;
    if (fixture.refreshError) return Response.json({ error: 'invalid_grant' }, { status: 400 });
    return Response.json(await tokens(true));
   }
   tokenRequests++;
   assert.equal(body.get('grant_type'), 'authorization_code');
   assert.equal(body.get('redirect_uri'), `${origin}/`);
   assert.equal(body.get('code'), 'valid-code');
   assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'), authorization.searchParams.get('code_challenge'));
   return Response.json(await tokens());
  }
  throw Error(`Unexpected OIDC request ${url.pathname}`);
 };
});
after(() => { globalThis.fetch = originalFetch; });

async function begin(context) {
 const response = await context.call('/auth/login?returnTo=%2Fplay%2Foverview%3Fflow%3Dreview%23details');
 assert.equal(response.status, 303);
 authorization = new URL(response.headers.get('location'));
 assert.equal(authorization.searchParams.get('response_type'), 'code');
 assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
 assert.ok(authorization.searchParams.get('nonce'));
 assert.equal(authorization.searchParams.has('client_secret'), false);
 const options = context.cookies.options.get('pf-oidc-transaction');
 assert.equal(options.httpOnly, true); assert.equal(options.secure, true); assert.equal(options.sameSite, 'lax');
 return `/?${new URLSearchParams({ code: 'valid-code', state: authorization.searchParams.get('state'), iss: authority })}`;
}
async function signIn(context) { return context.call(await begin(context)); }
async function session(context) { return (await context.call('/auth/session')).json(); }

 test('confidential PKCE flow keeps secrets/tokens server-side and restores the deep link', async () => {
 const context = setup();
 const response = await signIn(context);
 assert.equal(response.headers.get('location'), '/play/overview?flow=review#details');
 const result = await session(context);
 assert.deepEqual(result.user, { sub: 'user-1', name: 'Florence Example', email: 'florence@example.com' });
 const json = JSON.stringify(result);
 for (const secret of [clientSecret, 'private-access-token', 'private-refresh-token', 'idToken']) assert.equal(json.includes(secret), false);
 const cookie = context.cookies.get('pf-session');
 assert.equal(cookie.split('.').length, 5); // encrypted JWE, not a readable JWT
 assert.equal(cookie.includes('Florence'), false);
 assert.ok(cookie.length < 3800);
 assert.equal(context.cookies.options.get('pf-session').httpOnly, true);
 assert.equal(context.cookies.get('pf-oidc-transaction'), undefined);
 assert.equal(tokenRequests, 1);
});

test('viewing remains public without secrets; auth reports its configuration status', async () => {
 const context = setup({ clientSecret: '', sessionSecret: '' });
 assert.equal(await context.call('/frame/overview'), undefined);
 assert.deepEqual((await session(context)).user, null);
 assert.equal((await session(context)).configured, false);
 assert.equal((await context.call('/auth/login')).status, 503);
});

test('logout requires a same-origin POST and clears cookies before provider redirect', async () => {
 const context = setup(); await signIn(context);
 assert.equal((await context.call('/auth/logout', 'POST', { origin: 'https://evil.example' })).status, 403);
 assert.ok(context.cookies.get('pf-session'));
 assert.equal((await context.call('/auth/logout')).status, 405);
 const response = await context.call('/auth/logout', 'POST', { origin });
 const target = new URL(response.headers.get('location'));
 assert.equal(target.pathname, '/logout');
 assert.ok(target.searchParams.get('id_token_hint'));
 assert.equal(target.searchParams.get('post_logout_redirect_uri'), `${origin}/`);
 assert.equal(context.cookies.get('pf-session'), undefined);
 assert.equal((await session(context)).user, null);
});

test('unmatched state is rejected before token exchange', async () => {
 const context = setup(); const path = new URL(await begin(context), origin);
 path.searchParams.set('state', 'incorrect-state');
 const response = await context.call(path.href);
 assert.equal(response.headers.get('location'), '/?auth_error=signin_failed');
 assert.equal(tokenRequests, 0); assert.equal(context.cookies.get('pf-session'), undefined);
});

for (const [name, invalid] of [
 ['nonce', { claims: { nonce: 'incorrect-nonce' } }],
 ['issuer', { claims: { iss: 'https://different.example' } }],
 ['audience', { claims: { aud: 'different-client' } }],
 ['authorized party', { claims: { azp: 'different-client' } }],
 ['expired token', { claims: { exp: 1 } }],
 ['signature', { badSignature: true }]
]) test(`rejects invalid ${name}`, async () => {
 const context = setup(); fixture = invalid;
 const response = await signIn(context);
 assert.equal(response.headers.get('location'), '/?auth_error=signin_failed');
 assert.equal(context.cookies.get('pf-session'), undefined);
});

test('provider cancellation returns a safe error without provider details', async () => {
 const context = setup(); await begin(context);
 const response = await context.call(`/?${new URLSearchParams({ error: 'access_denied', error_description: 'private details', state: authorization.searchParams.get('state'), iss: authority })}`);
 assert.equal(response.headers.get('location'), '/?auth_error=cancelled');
 assert.equal(tokenRequests, 0);
});

test('consumed callbacks cannot be replayed', async () => {
 const context = setup(); const path = await begin(context);
 await context.call(path);
 assert.equal((await context.call(path)).headers.get('location'), '/?auth_error=signin_failed');
 assert.equal(tokenRequests, 1);
});

test('modified encrypted cookies fail closed', async () => {
 const context = setup(); await signIn(context);
 const parts = context.cookies.get('pf-session').split('.');
 parts[3] = (parts[3][0] === 'A' ? 'B' : 'A') + parts[3].slice(1);
 context.cookies.set('pf-session', parts.join('.'), {});
 assert.equal((await session(context)).user, null);
 assert.equal(context.cookies.get('pf-session'), undefined);
});

test('near-expiry sessions renew on the server and concurrent requests share a refresh', async () => {
 const context = setup(); fixture.expiresIn = 1;
 await signIn(context);
 const results = await Promise.all([session(context), session(context)]);
 assert.equal(refreshRequests, 1);
 for (const result of results) assert.equal(result.user.sub, 'user-1');
});

test('failed renewal clears the session and tokens', async () => {
 const context = setup(); fixture.expiresIn = 1; await signIn(context);
 fixture.refreshError = true;
 const result = await session(context);
 assert.equal(result.user, null); assert.match(result.error, /could not be renewed/);
 assert.equal(context.cookies.get('pf-session'), undefined);
});

test('sessions without refresh tokens expire with the signed identity', async () => {
 const context = setup(); fixture.noRefresh = true; fixture.expiresIn = 1;
 await signIn(context); await setTimeout(1100);
 assert.equal((await session(context)).user, null);
});

test('return targets reject external URLs and preserve local base paths, queries and hashes', () => {
 for (const path of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', null]) {
  assert.equal(safeAuthReturnPath(path, '/base/', origin), '/base/');
 }
 assert.equal(safeAuthReturnPath('/base/play/inbox?q=one#two', '/base/', origin), '/base/play/inbox?q=one#two');
});
