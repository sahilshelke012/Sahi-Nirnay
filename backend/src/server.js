import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createApp } from './app.js';
import { connectDatabase } from './config/database.js';
import { contactModel } from './models/Contact.js';
import { createEnquiryNotifier } from './services/enquiryNotifications.js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 5000);
let connection;
let server;

try {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  connection = await connectDatabase(process.env.MONGODB_URI);
  connection.on('error', () => console.error('MongoDB connection error.'));
  const app = createApp({
    Contact: contactModel(connection),
    isDatabaseReady: () => connection.readyState === 1,
    notifyEnquiry: createEnquiryNotifier(),
    production: process.env.NODE_ENV === 'production',
  });
  server = app.listen(port, host);
  await once(server, 'listening');
  console.log(`Sahi Nirrnay is listening at http://${host}:${port}`);
} catch (error) {
  console.error(error.code === 'EADDRINUSE'
    ? `Port ${port} is already in use.`
    : 'Startup failed. Check HOST, PORT, MONGODB_URI, and MongoDB availability.');
  await connection?.close();
  process.exitCode = 1;
}

if (server?.listening) {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      server.close(() => {
        connection.close().catch(() => {
          console.error('MongoDB shutdown did not complete.');
          process.exitCode = 1;
        });
      });
    });
  }
}
