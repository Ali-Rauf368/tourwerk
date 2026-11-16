import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { AuthProvider } from '../context/AuthContext';

type Handler = (url: string, init?: RequestInit) => { status?: number; body: unknown };

/** Replace fetch with a small router of canned JSON responses; returns the call log. */
export function mockFetch(handler: Handler) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const { status = 200, body } = handler(url, init);
    // jsdom has no Response class; the API client only needs these members.
    return { ok: status < 400, status, statusText: '', headers: new Map([['content-type', 'application/json']]), json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
  }) as typeof fetch;
  return calls;
}

export function renderWithProviders(ui: ReactNode, path = '/') {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </AuthProvider>,
  );
}
