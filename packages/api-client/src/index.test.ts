import { describe, expect, it, vi } from 'vitest';

import { createApiClients, isProblem, newRequestId, REQUEST_ID_HEADER } from './index';

type FetchLike = (request: Request) => Promise<Response>;

function jsonResponse(status: number, body: unknown, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': contentType } });
}

describe('createApiClients', () => {
  it('routes each service through its edge prefix and attaches the token and a request id', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(200, { version: 1, questions: [] }));
    const api = createApiClients({
      baseUrl: 'http://edge.test/',
      getAccessToken: async () => 'token-123',
      fetch: fetchMock as unknown as typeof fetch,
    });

    const { data, error } = await api.profile.GET('/v1/questionnaire');

    expect(error).toBeUndefined();
    expect(data?.version).toBe(1);
    const request = fetchMock.mock.calls[0]![0];
    expect(request.url).toBe('http://edge.test/api/profile/v1/questionnaire');
    expect(request.headers.get('Authorization')).toBe('Bearer token-123');
    expect(request.headers.get(REQUEST_ID_HEADER)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('sends no Authorization header when the user is signed out', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(200, { items: [], next_cursor: null }));
    const api = createApiClients({
      baseUrl: 'http://edge.test',
      getAccessToken: () => null,
      fetch: fetchMock as unknown as typeof fetch,
    });

    await api.matching.GET('/v1/candidates');

    const request = fetchMock.mock.calls[0]![0];
    expect(request.url).toBe('http://edge.test/api/matching/v1/candidates');
    expect(request.headers.has('Authorization')).toBe(false);
  });

  it('returns API errors as a typed problem instead of throwing', async () => {
    const problem = {
      type: 'urn:sozhiteli:problem:not_implemented',
      title: 'Not Implemented',
      status: 501,
      code: 'not_implemented',
    };
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(501, problem, 'application/problem+json'));
    const api = createApiClients({
      baseUrl: 'http://edge.test',
      getAccessToken: () => 'token',
      fetch: fetchMock as unknown as typeof fetch,
    });

    const { data, error, response } = await api.interaction.GET('/v1/me/contact');

    expect(data).toBeUndefined();
    expect(response.status).toBe(501);
    expect(isProblem(error)).toBe(true);
    expect(error?.code).toBe('not_implemented');
  });
});

describe('helpers', () => {
  it('newRequestId produces identifiers the server accepts', () => {
    expect(newRequestId()).toMatch(/^[0-9a-f]{32}$/);
    expect(newRequestId()).not.toBe(newRequestId());
  });

  it('isProblem rejects values that are not problem documents', () => {
    expect(isProblem(null)).toBe(false);
    expect(isProblem('error')).toBe(false);
    expect(isProblem({ code: 'x' })).toBe(false);
    expect(isProblem({ code: 'x', status: 400 })).toBe(true);
  });
});
