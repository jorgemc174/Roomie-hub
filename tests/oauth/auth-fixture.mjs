import { createServer } from 'node:http';
import { createHash, createHmac, randomUUID } from 'node:crypto';

// HTTP protocol fixture used only by tests. It is never imported by the application.
export async function startAuthFixture() {
  const origin = 'http://127.0.0.1:54331';
  const appOrigin = 'http://127.0.0.1:3200';
  const user = {
    id: '11111111-1111-4111-8111-111111111111',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'oauth@example.test',
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: { name: 'OAuth fixture' },
    created_at: new Date().toISOString(),
  };
  const flows = new Map();
  const codes = new Map();
  const tokens = new Set();
  const refreshTokens = new Set();
  function session() {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ aud: 'authenticated', sub: user.id, role: 'authenticated', iss: origin + '/auth/v1', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, jti: randomUUID() })}`;
    const token = `${unsigned}.${createHmac('sha256', 'local-fixture-only').update(unsigned).digest('base64url')}`;
    const refreshToken = randomUUID();
    tokens.add(token);
    refreshTokens.add(refreshToken);
    return {
      access_token: token,
      refresh_token: refreshToken,
      token_type: 'bearer',
      expires_in: 3600,
      user,
    };
  }
  let state;
  function reset(settings = {}) {
    state = {
      google: true,
      delay: 0,
      status: 200,
      tokenError: false,
      malformed: false,
      ...settings,
      settingsCalls: 0,
      authorizations: 0,
      exchanges: 0,
      refreshes: 0,
      matched: 0,
      joins: 0,
    };
    flows.clear();
    codes.clear();
    tokens.clear();
    refreshTokens.clear();
  }
  reset();
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin);
      const json = (value, status = 200) => {
        res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(value));
      };
      const body = async () => {
        let value = '';
        for await (const part of req) value += part;
        return JSON.parse(value || '{}');
      };
      const redirect = (location) => {
        res.writeHead(302, { location, 'cache-control': 'no-store' });
        res.end();
      };
      if (url.pathname === '/__test/reset') {
        reset(await body());
        return json({ ok: true });
      }
      if (url.pathname === '/__test/state') return json(state);
      if (url.pathname === '/auth/v1/settings') {
        state.settingsCalls++;
        if (state.delay) await new Promise((resolve) => setTimeout(resolve, state.delay));
        return json(state.malformed ? null : { external: { google: state.google } }, state.status);
      }
      if (url.pathname === '/auth/v1/authorize') {
        state.authorizations++;
        const target = new URL(url.searchParams.get('redirect_to'));
        if (
          target.origin !== appOrigin ||
          target.pathname !== '/auth/callback' ||
          url.searchParams.get('provider') !== 'google' ||
          url.searchParams.get('code_challenge_method') !== 's256'
        )
          return json({ error: 'invalid_authorize_request' }, 400);
        const id = randomUUID();
        flows.set(id, {
          target: target.toString(),
          challenge: url.searchParams.get('code_challenge'),
        });
        res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
        return res.end(
          `<h1>Local OAuth fixture</h1><a href="/__test/consent?id=${id}&result=allow">Allow fixture</a><a href="/__test/consent?id=${id}&result=cancel">Cancel fixture</a>`,
        );
      }
      if (url.pathname === '/__test/consent') {
        const flow = flows.get(url.searchParams.get('id'));
        if (!flow) return json({ error: 'invalid_flow' }, 400);
        const target = new URL(flow.target);
        if (url.searchParams.get('result') === 'allow') {
          const code = randomUUID();
          codes.set(code, flow);
          target.searchParams.set('code', code);
        } else {
          target.searchParams.set('error', 'access_denied');
          target.searchParams.set('error_description', 'private-provider-details');
        }
        return redirect(target.toString());
      }
      if (url.pathname === '/auth/v1/token') {
        const input = await body();
        if (url.searchParams.get('grant_type') === 'refresh_token') {
          state.refreshes++;
          if (!refreshTokens.delete(input.refresh_token))
            return json(
              { code: 'refresh_token_not_found', msg: 'invalid test refresh token' },
              400,
            );
          return json(session());
        }
        state.exchanges++;
        const flow = codes.get(input.auth_code);
        codes.delete(input.auth_code);
        const matched =
          flow &&
          createHash('sha256')
            .update(input.code_verifier || '')
            .digest('base64url') === flow.challenge;
        if (matched) state.matched++;
        if (!matched || state.tokenError || url.searchParams.get('grant_type') !== 'pkce')
          return json({ code: 'flow_state_not_found', msg: 'private-provider-details' }, 400);
        return json(session());
      }
      if (url.pathname === '/auth/v1/user')
        return tokens.has(req.headers.authorization?.replace('Bearer ', ''))
          ? json(user)
          : json({ code: 'bad_jwt', msg: 'invalid test session' }, 401);
      if (url.pathname === '/rest/v1/rpc/join_home') {
        state.joins++;
        return json({ error: 'must_not_join_automatically' }, 400);
      }
      if (url.pathname.startsWith('/rest/v1/')) return json([]);
      return json({ error: 'unexpected_fixture_request' }, 404);
    } catch {
      res.writeHead(500);
      res.end('fixture_error');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(54331, '127.0.0.1', resolve);
  });
  return {
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}
