import { beforeAll, afterEach, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { HttpResponse, http } from 'msw';
import { webcrypto } from 'node:crypto';

// Add fetch and crypto polyfills
import 'undici';

if (!globalThis.crypto) {
    (globalThis as any).crypto = webcrypto;
}

export const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
