import { expect, test } from '@playwright/test';

test('черновик задания можно перенести в форму и отредактировать до публикации', async ({ page, request }) => {
  expect((await request.get('/api/teacher/assignment-drafts/status')).status()).toBe(401);
  await page.route('**/api/teacher/assignment-drafts/status', route => route.fulfill({ json: { available: true } }));
  await page.route('**/api/teacher/assignment-drafts', route => route.fulfill({
    json: { title: 'Запросы SQL', description: 'Напишите три запроса с SELECT и WHERE.' },
  }));
  await page.goto('/assignments/new');
  await page.getByRole('button', { name: 'Преподаватель', exact: true }).click();
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/\/assignments\/new$/);

  const title = page.getByLabel('Название');
  const description = page.getByLabel('Описание');
  const group = page.getByRole('checkbox', { name: 'ИВТ-24', exact: true });
  await title.fill('Мой заголовок');
  await description.fill('Мой исходный текст');
  await group.check();

  const available = await page.request.get('/api/teacher/assignment-drafts/status');
  expect(available.ok()).toBeTruthy();
  expect(typeof (await available.json()).available).toBe('boolean');

  let published = false;
  page.on('request', pending => {
    if (pending.method() === 'POST' && new URL(pending.url()).pathname === '/api/teacher/assignments') published = true;
  });
  await page.setViewportSize({ width: 320, height: 800 });
  await page.getByText('Черновик с ИИ', { exact: true }).click();
  await page.getByLabel('Тезисы задания').fill('SQL: SELECT и WHERE, три запроса');
  const generated = page.waitForRequest(pending => pending.method() === 'POST' && pending.url().endsWith('/api/teacher/assignment-drafts'));
  await page.getByRole('button', { name: 'Сгенерировать черновик' }).click();
  expect((await generated).postDataJSON()).toEqual({ notes: 'SQL: SELECT и WHERE, три запроса' });
  await expect(page.getByRole('region', { name: 'Черновик задания' })).toBeVisible();
  await expect(title).toHaveValue('Мой заголовок');
  await expect(description).toHaveValue('Мой исходный текст');
  await page.getByRole('button', { name: 'Перенести в задание' }).click();
  await expect(title).toHaveValue('Запросы SQL');
  await expect(title).toBeFocused();
  await expect(description).toHaveValue('Напишите три запроса с SELECT и WHERE.');
  await expect(group).toBeChecked();
  await description.fill('Четыре запроса, приложите SQL-файл.');
  await expect(description).toHaveValue('Четыре запроса, приложите SQL-файл.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  expect(published).toBe(false);
});
