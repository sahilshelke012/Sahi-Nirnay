import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { connectDatabase } from '../src/config/database.js';
import { contactModel } from '../src/models/Contact.js';

const fixture = {
  fullName: 'Example Visitor',
  email: 'Visitor@example.test',
  phone: '+91 98765 43210',
  programmeInterest: 'The Decision Lab',
  message: 'I would like to learn more.',
};

let connection;
let Contact;
let server;
let base;
let writeFailure = false;
let ready = true;
let notificationAttempts = 0;
let persistedBeforeNotification = false;

before(async () => {
  const dbName = `sahi_nirrnay_test_${randomUUID().replaceAll('-', '')}`;
  connection = await connectDatabase('mongodb://127.0.0.1:27017', { dbName });
  Contact = contactModel(connection);
  server = createApp({
    Contact: { create: data => {
      if (writeFailure) throw new Error('Simulated database write failure');
      return Contact.create(data);
    } },
    notifyEnquiry: async contact => {
      notificationAttempts++;
      persistedBeforeNotification = Boolean(await Contact.exists({ _id: contact._id, createdAt: contact.createdAt }));
      throw new Error('Simulated notification failure');
    },
    isDatabaseReady: () => ready && connection.readyState === 1,
    logError: () => {},
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  if (connection) {
    try {
      await connection.dropDatabase();
    } finally {
      await connection.close();
    }
  }
});

const post = (body, type = 'application/json') => fetch(`${base}/api/contact`, {
  method: 'POST',
  headers: { 'Content-Type': type },
  body,
});

test('health reports ready with security headers', async () => {
  const response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { ok: true, status: 'ready' });
});

test('saved contact is acknowledged even when notification fails', async () => {
  const response = await post(JSON.stringify(fixture));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    ok: true,
    message: 'Thank you! Your enquiry has been submitted successfully. Our team will contact you soon.',
  });
  assert.equal(notificationAttempts, 1);
  assert.equal(persistedBeforeNotification, true);
  const saved = await Contact.findOne({ email: 'visitor@example.test' }).lean();
  assert.equal(saved.fullName, fixture.fullName);
  assert.equal(saved.programmeInterest, fixture.programmeInterest);
  assert.equal(saved.message, fixture.message);
  assert.ok(saved.createdAt instanceof Date);
});

test('rejects invalid or unexpected fields without writing to MongoDB', async () => {
  const response = await post(JSON.stringify({
    ...fixture, email: 'broken', phone: { $ne: '' }, programmeInterest: 'Unknown', createdAt: 'invalid',
  }));
  assert.equal(response.status, 400);
  const { errors } = await response.json();
  assert.deepEqual(Object.keys(errors).sort(), ['email', 'phone', 'programmeInterest', 'request']);
  assert.equal(await Contact.countDocuments(), 1);
});

test('rejects malformed, oversized and unsupported requests', async () => {
  assert.equal((await post('{')).status, 400);
  assert.equal((await post(JSON.stringify({ message: 'x'.repeat(17_000) }))).status, 413);
  assert.equal((await post('message=test', 'application/x-www-form-urlencoded')).status, 415);
});

test('database outages and write failures return a safe 503', async () => {
  ready = false;
  try {
    assert.equal((await fetch(`${base}/api/health`)).status, 503);
    assert.equal((await post(JSON.stringify(fixture))).status, 503);
  } finally {
    ready = true;
  }
  writeFailure = true;
  try {
    const response = await post(JSON.stringify(fixture));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false, message: 'Unable to submit your enquiry. Please try again.',
    });
    assert.equal(await Contact.countDocuments(), 1);
    assert.equal(notificationAttempts, 1);
  } finally {
    writeFailure = false;
  }
});

test('serves the existing contact page and keeps configuration private', async () => {
  const response = await fetch(`${base}/contact.html`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /action="\/api\/contact"/);
  assert.equal((await fetch(`${base}/.env`)).status, 404);
  assert.equal((await fetch(`${base}/backend/package.json`)).status, 404);
});

test('allows the local development preview to read health and preflight contact', async () => {
  for (const origin of ['http://127.0.0.1:5500', 'http://localhost:5500']) {
    const health = await fetch(`${base}/api/health`, { headers: { Origin: origin } });
    assert.equal(health.headers.get('access-control-allow-origin'), origin);
    const response = await fetch(`${base}/api/contact`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.equal(response.headers.get('access-control-allow-methods'), 'POST');
  }

  const denied = await fetch(`${base}/api/health`, { headers: { Origin: 'https://other.example' } });
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
});

test('limits repeated contact submissions', async () => {
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.equal((await post('{}')).status, 400);
  }
  assert.equal((await post('{}')).status, 429);
});
