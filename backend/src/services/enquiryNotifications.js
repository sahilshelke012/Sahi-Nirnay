import nodemailer from 'nodemailer';

const subject = 'New Sahi Nirrnay Website Enquiry';

function emailChannel(env, createTransport, log) {
  if (env.EMAIL_ENABLED !== 'true') return;

  const { EMAIL_HOST: host, EMAIL_PORT, EMAIL_USER: user, EMAIL_PASSWORD: pass,
    EMAIL_FROM: from, ADMIN_EMAIL: to } = env;
  const port = Number(EMAIL_PORT);
  if (![host, user, pass, from, to].every(Boolean) || !Number.isInteger(port) || port < 1 || port > 65535) {
    log('Email notifications disabled. Check SMTP configuration.');
    return;
  }

  const transport = createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user, pass },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000,
    dnsTimeout: 5000,
  });
  return async fields => {
    const result = await transport.sendMail({
      from,
      to,
      subject,
      text: fields.map(([label, value]) => `${label}: ${value}`).join('\n'),
    });
    if (!result.accepted?.length || result.rejected?.length) throw new Error('SMTP did not accept the recipient.');
  };
}

function whatsappChannel(env, fetchMessage, log) {
  if (env.WHATSAPP_ENABLED !== 'true') return;

  const { WHATSAPP_GRAPH_VERSION: version, WHATSAPP_PHONE_NUMBER_ID: id,
    WHATSAPP_ACCESS_TOKEN: token, WHATSAPP_ADMIN_NUMBER: to,
    WHATSAPP_TEMPLATE_NAME: name, WHATSAPP_TEMPLATE_LANGUAGE: code } = env;
  if (!token || !/^v\d+\.\d+$/.test(version || '') || !/^\d+$/.test(id || '') ||
      !/^[1-9]\d{6,14}$/.test(to || '') || !/^[a-z0-9_]+$/.test(name || '') ||
      !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(code || '')) {
    log('WhatsApp notifications disabled. Check Cloud API configuration.');
    return;
  }

  return async fields => {
    const parameters = fields.map(([label, value]) => {
      const text = value.replace(/\s+/g, ' ').trim();
      const preview = label === 'Message' && text.length > 300
        ? `${Array.from(text).slice(0, 280).join('')}… (full message saved)`
        : text;
      return { type: 'text', text: preview };
    });
    const response = await fetchMessage(`https://graph.facebook.com/${version}/${id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(7000),
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: { name, language: { code }, components: [{ type: 'body', parameters }] },
      }),
    });
    if (!response.ok || !(await response.json()).messages?.[0]?.id) {
      throw new Error('Cloud API did not accept the message.');
    }
  };
}

export function createEnquiryNotifier({
  env = process.env,
  createTransport = nodemailer.createTransport,
  fetchMessage = globalThis.fetch,
  log = console.error,
} = {}) {
  const channels = [
    ['Email', emailChannel(env, createTransport, log)],
    ['WhatsApp', whatsappChannel(env, fetchMessage, log)],
  ].filter(([, send]) => send);
  if (!channels.length) return;

  return async contact => {
    const fields = [
      ['Full Name', contact.fullName],
      ['Email Address', contact.email],
      ['Phone Number', contact.phone],
      ['Programme Interest', contact.programmeInterest || 'Not specified'],
      ['Message', contact.message],
      ['Submission Date (UTC)', contact.createdAt.toISOString()],
    ];

    await Promise.all(channels.map(async ([channel, send]) => {
      try {
        await send(fields);
      } catch {
        log(`${channel} notification failed for a saved enquiry.`);
      }
    }));
  };
}
