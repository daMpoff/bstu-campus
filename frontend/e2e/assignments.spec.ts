import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, role: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(role + '@bgtu.test');
  await page.getByLabel('Пароль').fill('demo2026');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Задания', exact: true })).toBeVisible();
}

test('группа получает задание, студент сдаёт работу, преподаватель возвращает и принимает', async ({ browser }) => {
  const teacher = await browser.newPage();
  const student = await browser.newPage();
  const outsider = await browser.newPage();
  try {
    await login(teacher, 'teacher');
    const title = 'Курсовая работа ' + Date.now();
    await teacher.getByRole('link', { name: /Новое задание/ }).click();
    await teacher.setViewportSize({ width: 320, height: 800 });
    expect(await teacher.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await teacher.setViewportSize({ width: 1280, height: 820 });
    await teacher.getByLabel('Название').fill(title);
    await teacher.getByLabel('Описание').fill('Подготовьте теоретическую часть.');
    await teacher.getByRole('checkbox', { name: 'ИВТ-24' }).check();
    const moscowPast = new Date(Date.now() + 3 * 60 * 60_000 - 3 * 60_000).toISOString();
    await teacher.getByLabel('Дата').fill(moscowPast.slice(0, 10));
    await teacher.getByLabel('Время (МСК)').fill(moscowPast.slice(11, 16));
    await teacher.getByLabel('Лимит списания, АР').fill('20');
    await teacher.getByRole('button', { name: 'Назначить задание' }).click();
    await expect(teacher.getByRole('heading', { name: title })).toBeVisible();

    await login(student, 'student');
    await student.getByRole('link', { name: new RegExp(title) }).click();
    await expect(student.getByText('Просрочено', { exact: true })).toBeVisible();
    await expect(student.getByText('Списано за задание:').getByText('20 АР')).toBeVisible({ timeout: 15_000 });
    await student.getByLabel('Ссылка на работу').fill('https://example.org/work');
    await student.getByRole('button', { name: 'Сдать работу' }).click();
    await expect(student.getByText('Сдано на проверку', { exact: true })).toBeVisible();

    await login(outsider, 'student3');
    await expect(outsider.getByText(title)).toHaveCount(0);
    await outsider.goto(new URL(student.url()).pathname);
    await expect(outsider.getByRole('alert')).toHaveText('Задание недоступно.');
    const csrf = await outsider.request.get('/api/csrf');
    const { headerName, token } = await csrf.json();
    const forgedWork = await outsider.request.post(`/api/student${new URL(student.url()).pathname}/submit`, {
      headers: { [headerName]: token },
      multipart: { link: 'https://example.org/unauthorized' },
    });
    expect(forgedWork.status()).toBe(404);

    const row = teacher.getByRole('listitem').filter({ hasText: 'Алексей Смирнов' });
    await teacher.getByRole('button', { name: 'Обновить' }).click();
    await expect(row.getByRole('link', { name: /Открыть ссылку/ })).toHaveAttribute('href', 'https://example.org/work');
    await row.getByRole('checkbox').check();
    await teacher.getByRole('button', { name: 'Вернуть на доработку' }).click();
    await expect(student.getByText('На доработке', { exact: true })).toBeVisible({ timeout: 10_000 });
    await student.getByLabel('Или файл до 10 МБ').setInputFiles({
      name: 'работа.txt', mimeType: 'text/plain', buffer: Buffer.from('Исправленная работа'),
    });
    await student.getByRole('button', { name: 'Сдать работу' }).click();
    await expect(student.getByText('Сдано на проверку', { exact: true })).toBeVisible();

    await teacher.getByRole('button', { name: 'Обновить' }).click();
    const downloadLink = row.getByRole('link', { name: /Скачать работа.txt/ });
    await expect(downloadLink).toBeVisible();
    const download = await teacher.request.get((await downloadLink.getAttribute('href'))!);
    expect(await download.text()).toBe('Исправленная работа');
    const unauthorizedDownload = await outsider.request.get((await downloadLink.getAttribute('href'))!);
    expect(unauthorizedDownload.status()).toBe(404);
    await row.getByRole('checkbox').check();
    await teacher.getByRole('button', { name: 'Принять выбранные' }).click();
    await expect(student.getByText('Принято', { exact: true })).toBeVisible({ timeout: 10_000 });
  } finally {
    await Promise.all([teacher.close(), student.close(), outsider.close()]);
  }
});

test('главная переключает дневное и ночное фото', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const hero = page.getByRole('region', { name: 'БГТУ' });
  await expect(hero).toHaveCSS('background-image', /bgtu-day\.jpg/);
  await page.getByRole('button', { name: 'Тёмная тема' }).click();
  await expect(hero).toHaveCSS('background-image', /bgtu-night\.png/);
  const night = await page.evaluate(async () => {
    const image = new Image();
    image.src = '/images/bgtu-night.png';
    await image.decode();
    return image.naturalWidth;
  });
  expect(night).toBeGreaterThan(1000);
  await page.reload();
  await expect(hero).toHaveCSS('background-image', /bgtu-night\.png/);
});
