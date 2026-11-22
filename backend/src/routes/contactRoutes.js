import { Router, json } from 'express';
import { rateLimit } from 'express-rate-limit';
import { PROGRAMMES } from '../models/Contact.js';

const rules = {
  fullName: { label: 'Full name', max: 100, required: true },
  email: { label: 'Email address', max: 254, required: true, valid: value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) },
  phone: { label: 'Phone number', max: 30, required: true, valid: value =>
    /^\+?[\d(). -]+$/.test(value) && /^\d{7,15}$/.test(value.replace(/\D/g, '')) },
  subject: { label: 'Subject', max: 120 },
  programmeInterest: { label: 'Programme interest', max: 30, valid: value => PROGRAMMES.includes(value) },
  message: { label: 'Message', max: 2000, required: true },
};

function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: { request: 'Provide a JSON object.' } };
  }

  const data = {};
  const errors = {};
  if (Object.keys(body).some(key => !Object.hasOwn(rules, key))) {
    errors.request = 'The request contains unsupported fields.';
  }

  for (const [key, { label, max, required, valid }] of Object.entries(rules)) {
    const raw = Object.hasOwn(body, key) ? body[key] : '';
    const value = typeof raw === 'string' ? raw.trim() : null;
    if (value === null || (required && !value) || value.length > max || (value && valid && !valid(value))) {
      errors[key] = `${label} is missing or invalid.`;
    } else if (value) {
      data[key] = key === 'email' ? value.toLowerCase() : value;
    }
  }
  return { data, errors };
}

export function contactRoutes({ Contact, isDatabaseReady, notifyEnquiry, logError }) {
  const router = Router();
  const limit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { ok: false, message: 'Too many requests. Please try again later.' },
  });

  router.post('/', limit, (req, res, next) => {
    if (!req.is('application/json')) {
      return res.status(415).json({ ok: false, message: 'Send the request as application/json.' });
    }
    next();
  }, json({ limit: '16kb', inflate: false }), async (req, res) => {
    const { data, errors } = validate(req.body);
    if (Object.keys(errors).length) {
      return res.status(400).json({ ok: false, message: 'Check the highlighted details and try again.', errors });
    }

    let contact;
    if (isDatabaseReady()) {
      try {
        contact = await Contact.create(data);
      } catch {
        logError('Contact submission could not be saved.');
      }
    }
    if (!contact) {
      return res.status(503).json({ ok: false, message: 'Unable to submit your enquiry. Please try again.' });
    }

    try {
      await notifyEnquiry?.(contact);
    } catch {
      logError('Notifications could not be completed for a saved enquiry.');
    }
    return res.status(201).json({
      ok: true,
      message: 'Thank you! Your enquiry has been submitted successfully. Our team will contact you soon.',
    });
  });

  return router;
}
