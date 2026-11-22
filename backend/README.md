# Sahi Nirrnay contact backend

Express serves the existing EdPlus site and contact API. A successful contact request saves the message, submission time, and optional programme interest in MongoDB. After the save, the API attempts any enabled administrator notifications. A provider failure leaves the saved record and HTTP 201 response intact.

## Run locally in PowerShell

You need Node.js 22 or newer, npm, and a running MongoDB instance. Run the following from the outer workspace folder. If VS Code Live Server is running, stop it from the Command Palette with **Live Server: Stop Live Server**. Express serves both the pages and API.

```powershell
Get-Service MongoDB
# If the service is stopped, run this with permission to start it.
# Start-Service MongoDB
Set-Location backend
npm.cmd ci
if (-not (Test-Path -LiteralPath .env)) {
    Copy-Item -LiteralPath .env.example -Destination .env
}
# If needed, edit MONGODB_URI in .env locally. The example targets the local MongoDB service.
npm.cmd start
```

In a second terminal, check the API and open the contact page.

```powershell
Invoke-RestMethod 'http://127.0.0.1:5000/api/health'
Start-Process 'http://127.0.0.1:5000/contact.html'
```

Fill out the contact form and submit it. Wait for the confirmation. To check the saved submission without printing its contents, run the following from `backend` and enter the email used for your test.

For local development, the contact form also works when viewed through VS Code Live Server on port 5500 while Express runs on port 5000. Use `http://127.0.0.1:5500` or `http://localhost:5500` with Live Server rooted in the frontend folder. This cross-origin support applies only to the health and contact endpoints and is disabled when `NODE_ENV=production`.

```powershell
$env:SAHI_LOOKUP_EMAIL = Read-Host 'Email used for the test submission'
@'
import dotenv from 'dotenv';
import { connectDatabase } from './src/config/database.js';
import { contactModel } from './src/models/Contact.js';
dotenv.config({ quiet: true });
const connection = await connectDatabase(process.env.MONGODB_URI);
try {
  const email = process.env.SAHI_LOOKUP_EMAIL.trim().toLowerCase();
  const exists = Boolean(await contactModel(connection).exists({ email }));
  console.log(exists ? 'Matching contact found.' : 'No matching contact found.');
} finally {
  await connection.close();
}
'@ | node --input-type=module
Remove-Item Env:SAHI_LOOKUP_EMAIL
```

## Endpoints

| Method and path | Result |
| --- | --- |
| `GET /api/health` | HTTP 200 when MongoDB is connected, or 503 when unavailable. |
| `POST /api/contact` | Accepts a JSON object with `fullName`, `email`, `phone`, `message`, and optional `subject` and `programmeInterest`. Returns HTTP 201 after storing the submission. |

Programme interest accepts The Decision Lab or The Transformation. Contact requests have a 16 KB JSON body limit and a 10-request limit per IP per 15 minutes. The API has no public endpoint for retrieving messages. Keep `.env` private. Serve the application over HTTPS for deployment and keep the MongoDB instance private.

## Mobile notifications

Add the relevant settings from `.env.example` to your existing `.env`. Both channels start disabled. Configure an administrator-controlled recipient authorised to receive enquiry details before enabling either channel. Restart Express after editing `.env`.

### Email

Set `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASSWORD`, `EMAIL_FROM`, and `ADMIN_EMAIL`, then set `EMAIL_ENABLED=true`. Use your provider's SMTP credentials and a permitted sender. Port 465 uses TLS from connection start. Other ports require STARTTLS. For Gmail, use the SMTP credentials allowed by your account, such as an app password if your account supports it. The recipient can read incoming notifications in their mobile email app. The email contains the full message and the saved UTC timestamp. [Nodemailer SMTP options](https://nodemailer.com/smtp)

### WhatsApp

1. Set up a WhatsApp Business Account and sending number in Meta. Obtain the sending **phone number ID** and an access token with `whatsapp_business_messaging` permission and access to that sender.
2. Obtain the administrator's opt-in to receive these notifications. For a Meta test sender, also add and verify the administrator as a test recipient.
3. Submit a positional body template for Meta approval. Use the following parameter order and set the template language to the exact approved locale.

```text
New Sahi Nirrnay Enquiry

Name: {{1}}
Email: {{2}}
Phone: {{3}}
Programme: {{4}}
Message: {{5}}
Date (UTC): {{6}}

This enquiry was received through the website.
```

4. Set `WHATSAPP_GRAPH_VERSION` to the supported version shown in Meta API Setup, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_ADMIN_NUMBER` (international digits only), `WHATSAPP_TEMPLATE_NAME`, and `WHATSAPP_TEMPLATE_LANGUAGE`. Set `WHATSAPP_ENABLED=true` only once the sender, template, and recipient are ready.

WhatsApp includes a preview for messages longer than 300 characters. The full text remains in MongoDB and in the email notification if enabled. A successful Cloud API response indicates provider acceptance. Verify handset receipt with a synthetic enquiry after connecting the provider. Notification failures are logged by channel without including the enquiry, credentials, or provider response. [Meta WhatsApp Cloud API](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api)

## Automated tests

Run `npm.cmd test` from `backend`. The suite uses the local MongoDB service on port 27017 with a unique disposable database. It tests persisted submissions, validation, rate limits, failure responses, and private configuration paths. The suite removes only the database it creates. Notification tests use provider substitutes and never contact real recipients.
