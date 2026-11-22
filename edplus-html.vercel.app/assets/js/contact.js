const form = document.querySelector('#contact-form');

if (form) {
  const status = document.querySelector('#enquiry-status');
  const fields = form.querySelector('fieldset');
  const submit = form.querySelector('button[type="submit"]');
  const localPreview = location.protocol === 'http:' && location.port === '5500' &&
    ['127.0.0.1', 'localhost'].includes(location.hostname);
  const apiOrigin = localPreview ? 'http://127.0.0.1:5000' : location.origin;
  const contactUrl = new URL(form.getAttribute('action'), apiOrigin);
  let pending = false;
  let attempted = false;

  async function checkAvailability() {
    try {
      const response = await fetch(new URL('/api/health', apiOrigin), {
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
      const health = response.ok ? await response.json() : null;
      if (health?.ok === true && health.status === 'ready') return;
    } catch {
      // The visitor can keep editing and retry after the service comes back.
    }
    if (!attempted) status.textContent = 'Enquiries are temporarily unavailable. You can enter your details and try again.';
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending || fields.disabled) return;

    const values = new FormData(form);
    attempted = true;
    pending = true;
    submit.disabled = true;
    status.textContent = 'Sending your message…';

    try {
      const response = await fetch(contactUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: values.get('full_name'),
          email: values.get('email'),
          phone: values.get('phone'),
          programmeInterest: values.get('programme_interest'),
          message: values.get('message'),
        }),
      });
      const result = await response.json();

      if (response.status === 201 && result.ok === true) {
        form.reset();
        status.textContent = result.message;
      } else {
        status.textContent = Object.values(result.errors || {})[0] ||
          result.message || 'Your message could not be submitted.';
      }
    } catch {
      status.textContent = 'We could not confirm that your message was saved. Your details are still in the form.';
    } finally {
      pending = false;
      submit.disabled = false;
    }
  });

  fields.disabled = false;
  status.textContent = 'Tell us how we can help.';
  checkAvailability();
}
