import { expect, test } from '@playwright/test';

test('код Telegram можно скрыть, обновить и отключить привязку после использования', async ({ page }) => {
  let connected = false;
  let issued = 0;
  const firstCode = 'LK3P-CR7Y-28FN';
  const nextCode = 'A20C-F28D-83MN';
  const status = () => ({ configured: true, botUsername: 'campus_demo_bot', connected });
  await page.route('**/api/telegram', async route => {
    if (route.request().method() === 'DELETE') connected = false;
    await route.fulfill({ json: status() });
  });
  await page.route('**/api/telegram/code', async route => {
    expect(route.request().method()).toBe('POST');
    issued++;
    await route.fulfill({ json: { code: issued === 1 ? firstCode : nextCode, expiresAt: new Date(Date.now() + 600_000).toISOString() } });
  });

  await page.goto('/login');
  await page.getByRole('button', { name: 'Студент', exact: true }).click();
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('link', { name: 'Настройки профиля' }).click();
  await expect(page).toHaveURL('/settings');
  const settings = page.getByRole('region', { name: 'Уведомления в Telegram' });
  const show = settings.getByRole('button', { name: 'Показать код' });
  const plaintext = settings.getByText(firstCode, { exact: true });
  const replacement = settings.getByText(nextCode, { exact: true });
  await expect(settings.getByRole('link', { name: 'Открыть бота' })).toHaveAttribute('href', 'https://t.me/campus_demo_bot');
  await expect(plaintext).toHaveCount(0);
  expect(issued).toBe(0);
  await show.click();
  await expect(plaintext).toBeVisible();
  await settings.getByRole('button', { name: 'Скрыть код' }).click();
  await expect(plaintext).toHaveCount(0);
  await show.click();
  await expect(plaintext).toBeVisible();
  expect(issued).toBe(1);
  await settings.getByRole('button', { name: 'Скрыть код' }).click();
  await settings.getByRole('button', { name: 'Обновить код' }).click();
  await expect(plaintext).toHaveCount(0);
  await expect(replacement).toBeVisible();
  await expect(settings.getByRole('status')).toHaveText('Код обновлён. Предыдущий код недействителен.');
  expect(issued).toBe(2);

  connected = true;
  await expect(settings.getByText('Подключено', { exact: true })).toBeVisible({ timeout: 8000 });
  await expect(plaintext).toHaveCount(0);
  await expect(replacement).toHaveCount(0);
  await settings.getByRole('button', { name: 'Отключить Telegram' }).click();
  await expect(settings.getByText('Не подключено', { exact: true })).toBeVisible();
  await expect(plaintext).toHaveCount(0);
  await expect(show).toBeVisible();
});
