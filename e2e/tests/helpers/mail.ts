import { expect } from '@playwright/test';

/**
 * Reader for the Mailpit instance the E2E stack runs (docker-compose.yml
 * locally, a service container in .github/workflows/e2e.yml).
 *
 * Specs need this because every one-time token the product mails is stored
 * hashed and never returned by an API: invitations (createInvite writes only
 * tokenHash) and workspace deletion both. The delivered message is the only
 * place a test can read the link.
 */

const apiUrl = process.env.MAILPIT_API_URL ?? 'http://localhost:8025';

/** One message summary as Mailpit's list endpoint returns it. */
interface MailpitSummary {
  ID: string;
  To: Array<{ Address: string }>;
  Subject: string;
  Created: string;
}

/** A single message with its rendered bodies. */
export interface MailMessage {
  id: string;
  subject: string;
  html: string;
  text: string;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${apiUrl}${path}`);
  if (!res.ok) throw new Error(`Mailpit ${path} responded ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Deletes every stored message, for a spec that needs an empty mailbox.
 *
 * Do NOT call this routinely. It is global, and Playwright runs fullyParallel
 * locally, so one spec clearing the mailbox can delete a message another spec
 * is waiting for. Uniqueness of the recipient address is what isolates specs
 * from each other, and `waitForMessage` already filters on it; clearing adds
 * nothing except that race.
 */
export async function clearMessages(): Promise<void> {
  const res = await fetch(`${apiUrl}/api/v1/messages`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Mailpit clear responded ${res.status}`);
}

/**
 * Waits for the newest message addressed to `to`, optionally narrowed by a
 * substring of the subject (several flows can mail the same address, so the
 * newest one is not always the one under test).
 *
 * Polls rather than subscribing: delivery is a side effect of a request the
 * spec already made, so there is nothing to await directly.
 */
export async function waitForMessage(
  to: string,
  opts: { subjectIncludes?: string; timeoutMs?: number } = {},
): Promise<MailMessage> {
  const { subjectIncludes, timeoutMs = 10_000 } = opts;
  const deadline = Date.now() + timeoutMs;
  let lastSeen = 0;

  while (Date.now() < deadline) {
    const { messages } = await getJson<{ messages: MailpitSummary[] }>(
      `/api/v1/messages?limit=50`,
    );
    lastSeen = messages.length;
    const hit = messages.find(
      (m) =>
        m.To.some((addr) => addr.Address.toLowerCase() === to.toLowerCase()) &&
        (!subjectIncludes || m.Subject.includes(subjectIncludes)),
    );
    if (hit) {
      const full = await getJson<{ HTML: string; Text: string; Subject: string }>(
        `/api/v1/message/${hit.ID}`,
      );
      return { id: hit.ID, subject: full.Subject, html: full.HTML, text: full.Text };
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  throw new Error(
    `No mail to ${to}${subjectIncludes ? ` matching subject "${subjectIncludes}"` : ''} ` +
      `within ${timeoutMs}ms (${lastSeen} message(s) in the mailbox). ` +
      `Is SMTP_URL set and Mailpit running at ${apiUrl}?`,
  );
}

/**
 * The first link in a message body. Every transactional mail the product sends
 * is a single-CTA template (renderBasicEmail), so the first href is the action
 * link. Asserts rather than returning undefined, so a template change surfaces
 * as a clear failure at the point of use.
 */
export function firstLink(message: MailMessage): string {
  const match = /href="([^"]+)"/i.exec(message.html);
  expect(match, `No link found in mail "${message.subject}"`).not.toBeNull();
  // Templates emit HTML-escaped ampersands; a URL has to be unescaped to work.
  return match![1]!.replace(/&amp;/g, '&');
}
