import nodemailer, { type Transporter } from 'nodemailer';
import { Resend } from 'resend';
import { loadEnv } from '@palouse/config';

/**
 * Transactional mail — the project's single mail-send path.
 *
 * Transport is chosen per send, most specific first:
 *   SMTP_URL set        -> SMTP (local dev and the E2E stack use Mailpit)
 *   RESEND_API_KEY set  -> Resend (hosted staging and prod)
 *   neither             -> logged no-op
 *
 * Self-hosted deployments that set neither get a logged no-op instead of an
 * error, so mail stays strictly optional infrastructure.
 *
 * The sending domain must be verified in the Resend dashboard before
 * MAIL_FROM can use it; until then Resend's shared onboarding sender only
 * delivers to the account owner's own address.
 */

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
}

export interface SendEmailResult {
  sent: boolean;
  id: string | null;
  skippedReason?: 'no_api_key';
}

let client: Resend | undefined;
let transporter: Transporter | undefined;

function getClient(apiKey: string): Resend {
  if (!client) client = new Resend(apiKey);
  return client;
}

function getTransporter(smtpUrl: string): Transporter {
  if (!transporter) transporter = nodemailer.createTransport(smtpUrl);
  return transporter;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const env = loadEnv();

  // SMTP wins when configured: it is the explicit, locally-pointed transport,
  // so a dev or CI box with both set never sends real mail through Resend.
  if (env.SMTP_URL) {
    const info = await getTransporter(env.SMTP_URL).sendMail({
      from: env.MAIL_FROM,
      to: Array.isArray(input.to) ? input.to : [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text ?? (input.html ? undefined : ''),
      replyTo: input.replyTo,
    });
    return { sent: true, id: info.messageId ?? null };
  }

  if (!env.RESEND_API_KEY) {
    console.warn(
      `[mail] RESEND_API_KEY not set, skipping email "${input.subject}" to ${
        Array.isArray(input.to) ? input.to.join(', ') : input.to
      }`,
    );
    return { sent: false, id: null, skippedReason: 'no_api_key' };
  }

  const resend = getClient(env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: env.MAIL_FROM,
    to: Array.isArray(input.to) ? input.to : [input.to],
    subject: input.subject,
    // Resend requires at least one body; fall back to text-only.
    html: input.html,
    text: input.text ?? (input.html ? undefined : ''),
    replyTo: input.replyTo,
  } as Parameters<typeof resend.emails.send>[0]);

  if (error) throw new Error(`Resend send failed: ${error.name}: ${error.message}`);
  return { sent: true, id: data?.id ?? null };
}

/** Minimal branded wrapper so transactional emails share one look. */
export function renderBasicEmail(opts: { heading: string; bodyLines: string[]; ctaLabel?: string; ctaUrl?: string }): string {
  const cta =
    opts.ctaLabel && opts.ctaUrl
      ? `<p style="margin:24px 0"><a href="${opts.ctaUrl}" style="background:#111;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:14px">${opts.ctaLabel}</a></p>`
      : '';
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:520px;margin:0 auto;padding:32px 16px">
  <p style="font-weight:600;font-size:15px">Palouse</p>
  <h1 style="font-size:18px;margin:16px 0 8px">${opts.heading}</h1>
  ${opts.bodyLines.map((l) => `<p style="font-size:14px;line-height:1.6;color:#333">${l}</p>`).join('\n  ')}
  ${cta}
  <p style="font-size:12px;color:#888;margin-top:32px">You're receiving this because of activity in your Palouse workspace.</p>
</body></html>`;
}
