const nodemailer = require('nodemailer');

function getTransport() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  return nodemailer.createTransport({
    host: host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

async function sendMagicLink(email, link) {
  const transport = getTransport();
  if (!transport) return false;
  await transport.sendMail({
    from: process.env.SMTP_FROM || 'no-reply@test-env.local',
    to: email,
    subject: 'Your magic link',
    text: `Open this link to sign in: ${link}`,
    html: `<p>Open this link to sign in: <a href="${link}">${link}</a></p>`,
  });
  return true;
}

module.exports = { sendMagicLink };
