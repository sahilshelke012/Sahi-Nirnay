import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEnquiryNotifier } from '../src/services/enquiryNotifications.js';

const env = {
  EMAIL_ENABLED: 'true',
  EMAIL_HOST: 'smtp.example.test',
  EMAIL_PORT: '587',
  EMAIL_USER: 'sender@example.test',
  EMAIL_PASSWORD: 'synthetic-password',
  EMAIL_FROM: 'sender@example.test',
  ADMIN_EMAIL: 'admin@example.test',
  WHATSAPP_ENABLED: 'true',
  WHATSAPP_GRAPH_VERSION: 'v24.0',
  WHATSAPP_PHONE_NUMBER_ID: '123456',
  WHATSAPP_ACCESS_TOKEN: 'synthetic-token',
  WHATSAPP_ADMIN_NUMBER: '12025550101',
  WHATSAPP_TEMPLATE_NAME: 'website_enquiry',
  WHATSAPP_TEMPLATE_LANGUAGE: 'en_US',
};

const contact = {
  fullName: 'Example Visitor',
  email: 'visitor@example.test',
  phone: '+1 202 555 0102',
  programmeInterest: 'The Decision Lab',
  message: 'First line.\nSecond line.',
  createdAt: new Date('2026-11-21T09:00:00Z'),
};

test('notifications start disabled and incomplete opt-in configuration stays disabled', () => {
  const fail = () => assert.fail('A notification provider was called');
  const logs = [];
  const mock = { createTransport: fail, fetchMessage: fail, log: message => logs.push(message) };
  assert.equal(createEnquiryNotifier({ ...mock, env: {} }), undefined);
  assert.equal(createEnquiryNotifier({
    ...mock, env: { EMAIL_ENABLED: 'true', WHATSAPP_ENABLED: 'true', WHATSAPP_ACCESS_TOKEN: 'secret' },
  }), undefined);
  assert.equal(logs.length, 2);
  assert.ok(logs.every(message => !message.includes('secret')));
});

test('sends enquiry fields through TLS SMTP and the approved WhatsApp body template', async () => {
  let email;
  let whatsapp;
  const send = createEnquiryNotifier({
    env,
    createTransport: options => {
      assert.ok(options.requireTLS);
      return { sendMail: async message => {
        email = message;
        return { accepted: [env.ADMIN_EMAIL] };
      } };
    },
    fetchMessage: async (url, options) => {
      assert.equal(url, 'https://graph.facebook.com/v24.0/123456/messages');
      assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
      whatsapp = JSON.parse(options.body);
      return Response.json({ messages: [{ id: 'test-message-id' }] });
    },
    log: () => assert.fail('Unexpected provider error'),
  });

  await send(contact);
  assert.equal(email.to, env.ADMIN_EMAIL);
  assert.equal(email.subject, 'New Sahi Nirrnay Website Enquiry');
  assert.ok(email.text.includes(contact.message));
  assert.ok(email.text.includes(contact.createdAt.toISOString()));
  assert.equal(whatsapp.to, env.WHATSAPP_ADMIN_NUMBER);
  assert.equal(whatsapp.type, 'template');
  assert.equal(whatsapp.template.name, env.WHATSAPP_TEMPLATE_NAME);
  assert.deepEqual(whatsapp.template.components[0].parameters.map(item => item.text), [
    contact.fullName, contact.email, contact.phone, contact.programmeInterest,
    'First line. Second line.', contact.createdAt.toISOString(),
  ]);
});

test('provider rejections are logged without credentials or personal details', async () => {
  const logs = [];
  const send = createEnquiryNotifier({
    env,
    createTransport: () => ({ sendMail: async () => { throw new Error(env.EMAIL_PASSWORD); } }),
    fetchMessage: async () => Response.json({ error: contact.email }, { status: 401 }),
    log: message => logs.push(message),
  });
  await send(contact);
  assert.deepEqual(logs.sort(), [
    'Email notification failed for a saved enquiry.',
    'WhatsApp notification failed for a saved enquiry.',
  ]);
});
