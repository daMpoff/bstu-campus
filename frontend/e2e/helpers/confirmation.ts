import { expect, type APIRequestContext } from '@playwright/test';

export async function csrf(request: APIRequestContext) {
  const { headerName, token } = await (await request.get('/api/csrf')).json();
  return { [headerName]: token };
}

const mailbox = process.env.CAMPUS_MAILBOX_URL ?? 'http://127.0.0.1:8025';
type MailSummary = { ID: string; Subject: string; To: { Address: string }[] };

export async function mailFor(email: string) {
  const query = new URLSearchParams({ query: `to:"${email}"`, limit: '50' });
  const response = await fetch(`${mailbox}/api/v1/search?${query}`);
  expect(response.ok).toBeTruthy();
  const result = await response.json() as { messages: MailSummary[] | null };
  return (result.messages ?? []).filter(message => message.To.some(recipient => recipient.Address === email));
}

export async function mailText(id: string) {
  const response = await fetch(`${mailbox}/api/v1/message/${id}`);
  expect(response.ok).toBeTruthy();
  return (await response.json() as { Text: string }).Text;
}

export async function verificationToken(email: string) {
  let message: MailSummary | undefined;
  await expect.poll(async () => {
    message = (await mailFor(email)).find(item => item.Subject === 'Подтвердите email в БГТУ');
    return Boolean(message);
  }, { timeout: 15_000 }).toBeTruthy();
  const token = (await mailText(message!.ID)).match(/\/confirm-email#([A-Za-z0-9_-]{43})/)?.[1];
  expect(token).toBeTruthy();
  return token!;
}

export async function verifyEmail(request: APIRequestContext, email: string) {
  const result = await request.post('/api/registration/confirm-email', {
    headers: await csrf(request), data: { token: await verificationToken(email) },
  });
  expect(result.status()).toBe(204);
}
