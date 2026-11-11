import { expect, test } from '@playwright/test';

test('студент попадает в профиль после входа и по кнопкам кабинета', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('region', { name: 'БГТУ' }).getByRole('link', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('button', { name: 'Студент', exact: true }).click();
  await page.getByLabel('Пароль').fill('wrong-password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Проверьте email и пароль.');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Пароль').fill('demo2026');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole('heading', { name: 'Алексей Смирнов' })).toBeVisible();

  await page.getByRole('link', { name: 'БГТУ, главная' }).click();
  await expect(page.getByRole('link', { name: 'Кабинет', exact: true })).toHaveAttribute('href', '/profile');
  await page.getByRole('link', { name: 'Открыть кабинет' }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await page.goto('/assignments/new');
  await expect(page).toHaveURL(/\/profile$/);
  expect((await page.request.get('/api/teacher/assignments')).status()).toBe(403);

  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page.getByRole('region', { name: 'БГТУ' })).toBeVisible();
  expect((await page.request.get('/api/me')).status()).toBe(401);
});

test('преподаватель возвращается к открытой странице после входа', async ({ page }) => {
  await page.goto('/assignments/new');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('link', { name: 'Зарегистрироваться' }).click();
  await page.getByRole('banner').getByRole('link', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('button', { name: 'Преподаватель', exact: true }).click();
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/\/assignments\/new$/);
  await expect(page.getByRole('heading', { name: 'Новое задание' })).toBeVisible();

  await page.getByRole('link', { name: 'БГТУ, главная' }).click();
  await page.getByRole('link', { name: 'Кабинет', exact: true }).click();
  await expect(page).toHaveURL(/\/assignments$/);
  await expect(page.getByRole('heading', { name: 'Задания', exact: true })).toBeVisible();
  await page.goto('/login');
  await expect(page).toHaveURL(/\/assignments$/);
});

test('истёкшая сессия возвращает на вход и сохраняет запрошенную страницу', async ({ page, context }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Студент', exact: true }).click();
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);

  await context.clearCookies();
  await page.getByRole('link', { name: 'Активности', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('link', { name: 'Профиль', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Студент', exact: true }).click();
  await page.getByLabel('Пароль').fill('wrong-password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Проверьте email и пароль.');
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Пароль').fill('demo2026');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/\/activities$/);
  await expect(page.getByRole('heading', { name: 'Активности', exact: true })).toBeVisible();
  expect((await page.request.get('/api/me')).status()).toBe(200);
});
