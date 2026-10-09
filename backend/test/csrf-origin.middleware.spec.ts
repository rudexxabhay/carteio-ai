import { csrfOriginMiddleware } from '../src/common/middleware/csrf-origin.middleware';

describe('auth CSRF origin validation', () => {
  const make = (method: string, headers: Record<string, string> = {}) => {
    const req = { method, get: (name: string) => headers[name.toLowerCase()] } as any;
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as any;
    const next = jest.fn();
    return { req, res, next };
  };
  it('rejects a missing or foreign origin', () => {
    const guard = csrfOriginMiddleware(['http://localhost:3000']);
    for (const headers of [{}, { origin: 'https://attacker.example' }]) {
      const ctx = make('POST', headers); guard(ctx.req, ctx.res, ctx.next); expect(ctx.res.status).toHaveBeenCalledWith(403); expect(ctx.next).not.toHaveBeenCalled();
    }
  });
  it('accepts the configured origin and safe methods', () => {
    const guard = csrfOriginMiddleware(['http://localhost:3000']);
    const post = make('POST', { origin: 'http://localhost:3000', referer: 'http://localhost:3000/login' }); guard(post.req, post.res, post.next); expect(post.next).toHaveBeenCalled();
    const get = make('GET'); guard(get.req, get.res, get.next); expect(get.next).toHaveBeenCalled();
  });
});
