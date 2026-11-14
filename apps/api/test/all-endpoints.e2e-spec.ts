import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createApp } from '../src/main';

/**
 * Generic route-wiring smoke test. Walks every GET route Nest actually
 * registered and hits it with an authenticated, high-privilege session,
 * substituting discovered seed IDs for path params. It does not assert
 * business-logic correctness — only that the route exists (no Express
 * "Cannot GET ..." fallback) and the handler doesn't crash (no 5xx).
 *
 * This exists because frontend<->backend path mismatches (e.g. `/ptps` vs
 * `/ptp`) and stale generated clients have repeatedly caused silent
 * "Cannot POST ..." failures that only surface in the browser.
 */
const PASSWORD = 'Damez@Demo2026';
let app: NestExpressApplication;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Client {
  get: (url: string) => request.Test;
}

async function login(email: string): Promise<Client> {
  const agent = request.agent(app.getHttpServer());
  const l = await agent.post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
  for (let attempt = 0; attempt < 3; attempt++) {
    const { body } = await agent.get(`/api/v1/auth/demo-totp?email=${email}`).expect(200);
    const res = await agent.post('/api/v1/auth/totp/verify').send({ challengeToken: l.body.challengeToken, code: body.code });
    if (res.status === 200) {
      return { get: (u) => agent.get(`/api/v1${u}`) };
    }
    // TOTP replay protection: wait for the next 30s step and retry
    await sleep((30 - (Math.floor(Date.now() / 1000) % 30) + 1) * 1000);
  }
  throw new Error(`could not log in ${email}`);
}

interface RouteDef { method: string; path: string }

interface ExpressRoute {
  route?: { path: string; methods: Record<string, boolean> };
}

function collectRoutes(): RouteDef[] {
  const server = app.getHttpAdapter().getInstance() as unknown as { router?: { stack: ExpressRoute[] }; _router?: { stack: ExpressRoute[] } };
  const stack = server.router?.stack ?? server._router?.stack ?? [];
  const routes: RouteDef[] = [];
  for (const layer of stack) {
    if (!layer.route) continue;
    const { path, methods } = layer.route;
    for (const m of Object.keys(methods)) {
      if (methods[m]) routes.push({ method: m.toUpperCase(), path });
    }
  }
  return routes;
}

const CANNOT_PATTERN = /^Cannot (GET|POST|PUT|PATCH|DELETE) /;

/** Routes that are known to be slow, destructive, or require external (non-mock) providers; excluded from the blanket GET sweep. */
const SKIP_PATH_SUBSTRINGS = ['/admin/queues'];

describe('every registered GET route is reachable', () => {
  let client: Client;
  const idMap: Record<string, string> = {};

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    client = await login('admin@damez.ng');

    const seed = async (url: string, pick: (body: unknown) => string | undefined, keys: string[]) => {
      try {
        const res = await client.get(url);
        const id = pick(res.body);
        if (id) for (const k of keys) idMap[k] = id;
      } catch {
        /* best-effort: leave unmapped params to fall back to a placeholder */
      }
    };

    const items0 = (b: unknown) => (b as { items?: Array<{ id?: string }> })?.items?.[0]?.id;
    const arr0 = (b: unknown) => (b as Array<{ id?: string }>)?.[0]?.id;

    await seed('/customers?pageSize=1', items0, ['customerId']);
    await seed('/loans?pageSize=1', items0, ['loanId']);
    await seed('/applications?pageSize=1', items0, ['applicationId', 'appId']);
    await seed('/collections?pageSize=1', items0, ['caseId']);
    await seed('/collections/agencies', arr0, ['agencyId']);
    await seed('/branches', arr0, ['branchId']);
    await seed('/roles', arr0, ['roleId']);
    await seed('/users?pageSize=1', items0, ['userId']);
    await seed('/settings/products', arr0, ['productId']);
    await seed('/approvals?pageSize=1', items0, ['approvalId']);
  }, 60_000);

  afterAll(async () => { await app.close(); });

  it('responds to every GET route without a routing 404 or a server crash', async () => {
    const routes = collectRoutes().filter(
      (r) => r.method === 'GET' && !SKIP_PATH_SUBSTRINGS.some((s) => r.path.includes(s)),
    );
    expect(routes.length).toBeGreaterThan(20); // sanity: route discovery actually found the app's routes

    const failures: string[] = [];
    for (const route of routes) {
      const url = route.path
        .replace(/^\/api\/v1/, '')
        .replace(/:([A-Za-z0-9_]+)/g, (_, name: string) => idMap[name] ?? `smoke-test-missing-${name}`);

      const res = await client.get(url).timeout({ response: 10_000, deadline: 15_000 });

      if (res.status >= 500) {
        failures.push(`${route.method} ${route.path} -> ${res.status} (server error): ${JSON.stringify(res.body).slice(0, 300)}`);
        continue;
      }
      const bodyText = typeof res.text === 'string' ? res.text : '';
      if (CANNOT_PATTERN.test(bodyText)) {
        failures.push(`${route.method} ${route.path} -> ${res.status} (route not actually wired): ${bodyText.slice(0, 200)}`);
      }
    }

    if (failures.length) {
      throw new Error(`${failures.length} route(s) failed:\n${failures.join('\n')}`);
    }
  }, 120_000);
});
