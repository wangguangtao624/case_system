import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { getRuntimeMode } from '@/lib/runtime';

const runtimeMode = getRuntimeMode();
const dev = runtimeMode !== 'production';
const hostname = process.env.HOSTNAME || '0.0.0.0';
const port = Number.parseInt(process.env.PORT || '5000', 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT value: ${process.env.PORT}`);
}

// Create Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

async function main() {
  await app.prepare();

  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url || '/', true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);

      // A browser can close a streaming response while Next.js is still
      // rendering it. Do not write a second response to an ended socket.
      if (!res.headersSent && !res.writableEnded && !res.destroyed) {
        res.statusCode = 500;
        res.end('Internal server error');
      } else if (!res.destroyed) {
        res.destroy();
      }
    }
  });

  // Keep slow or abandoned clients from retaining sockets indefinitely.
  server.requestTimeout = 5 * 60 * 1000;
  server.headersTimeout = 60 * 1000;
  server.keepAliveTimeout = 5 * 1000;

  server.on('clientError', (error, socket) => {
    console.warn('HTTP client connection error:', error.message);
    if (socket.writable) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    }
  });

  server.once('error', error => {
    console.error('HTTP server error:', error);
    process.exit(1);
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; shutting down gracefully.`);
    server.close(error => {
      if (error) {
        console.error('HTTP server shutdown failed:', error);
        process.exit(1);
      }
      process.exit(0);
    });
    server.closeIdleConnections();

    setTimeout(() => {
      console.error('Graceful shutdown timed out; closing open connections.');
      server.closeAllConnections();
      process.exit(0);
    }, 8_000).unref();
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  server.listen(port, () => {
    console.log(
      `> Server listening at http://${hostname}:${port} as ${
        dev ? 'development' : runtimeMode
      }`,
    );
  });
}

main().catch(error => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
