/**
 * Playwright `globalSetup` of the API-mode audit: puts `serverReply` (`server-mock.ts`) on the audit API origin
 * (`127.0.0.1:4100`) for the length of the run, so the Next server's own fetches while rendering are answered
 * instead of refused. Runs inside Playwright's process (its TypeScript loader resolves the shared package, which
 * plain Node cannot). The returned function is the teardown. Nothing here is imported by `src/` or any image.
 */
import { createServer, type Server } from 'node:http';
import { AUDIT_API_ORIGIN } from './session.ts';
import { serverReply } from './server-mock.ts';

export default async function setup(): Promise<() => Promise<void>> {
  const origin = new URL(AUDIT_API_ORIGIN);
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', AUDIT_API_ORIGIN);
    const reply = serverReply(req.method ?? 'GET', url.pathname, url.searchParams);
    res.writeHead(reply.status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(reply.body));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', (e: NodeJS.ErrnoException) => {
      reject(
        new Error(
          e.code === 'EADDRINUSE'
            ? `the audit API origin ${AUDIT_API_ORIGIN} is already taken: stop what is listening there (a leftover audit run?)`
            : e.message,
        ),
      );
    });
    server.listen(Number(origin.port), origin.hostname, () => {
      resolve();
    });
  });
  return () =>
    new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
      server.closeAllConnections();
    });
}
