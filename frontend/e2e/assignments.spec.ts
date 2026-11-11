import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, role: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(role + '@bgtu.test');
  await page.getByLabel('Пароль').fill('demo2026');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(role === 'teacher' ? /\/assignments$/ : /\/profile$/);
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
    const detailPath = new URL(teacher.url()).pathname;

    await login(student, 'student');
    await student.getByRole('link', { name: new RegExp(title) }).click();
    await expect(student.getByText('Просрочено', { exact: true })).toBeVisible();
    await expect(student.getByText('Списано за задание:').getByText('20 АР')).toBeVisible({ timeout: 15_000 });
    const me = await (await student.request.get('/api/me')).json();
    expect((await outsider.request.get(`/api/profiles/${me.id}`)).status()).toBe(401);
    await student.getByRole('link', { name: 'Профиль' }).click();
    await expect(student.getByRole('heading', { name: 'Алексей Смирнов' })).toBeVisible();
    await expect(student.getByText('Факультет информационных технологий (ФИТ) · ИВТ-24')).toBeVisible();
    const history = student.getByRole('region', { name: 'История баллов' });
    await expect(history.getByRole('listitem').filter({ hasText: title })).toContainText('−20 АР');
    await student.setViewportSize({ width: 320, height: 800 });
    expect(await student.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await student.setViewportSize({ width: 1280, height: 820 });
    const profileAssignments = student.getByRole('region', { name: 'Задания' });
    const profileAssignment = profileAssignments.getByRole('link', { name: title, exact: true });
    await expect(profileAssignments.getByRole('listitem').filter({ hasText: title })).toContainText('Просрочено');
    await profileAssignment.click();
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
    await teacher.getByRole('navigation', { name: 'Кабинет' }).getByRole('link', { name: 'Задания' }).click();
    const taskList = teacher.getByRole('region', { name: 'Задания', exact: true });
    const task = taskList.getByRole('listitem').filter({ has: teacher.getByRole('link', { name: title, exact: true }) });
    await expect(task.getByText('ИВТ-24', { exact: true })).toBeVisible();
    const progress = task.locator('[data-assignment-progress]');
    await expect(progress).toContainText('1 из 2');
    await expect(progress).toContainText('На проверке 1');
    await teacher.getByRole('link', { name: 'Все работы на проверке' }).click();
    const pending = teacher.getByRole('listitem').filter({ hasText: 'Алексей Смирнов' }).filter({ hasText: title });
    await expect(pending.getByRole('link', { name: /Открыть ссылку/ })).toHaveAttribute('href', 'https://example.org/work');
    await pending.getByRole('button', { name: 'Вернуть на доработку' }).click();
    await expect(pending).toHaveCount(0);
    await expect(student.getByText('На доработке', { exact: true })).toBeVisible({ timeout: 10_000 });
    await student.getByLabel('Или файл до 10 МБ').setInputFiles({
      name: 'работа.txt', mimeType: 'text/plain', buffer: Buffer.from('Исправленная работа'),
    });
    await student.getByRole('button', { name: 'Сдать работу' }).click();
    await expect(student.getByText('Сдано на проверку', { exact: true })).toBeVisible();

    await teacher.goto(detailPath);
    const downloadLink = row.getByRole('link', { name: /Скачать работа.txt/ });
    await expect(downloadLink).toBeVisible();
    const download = await teacher.request.get((await downloadLink.getAttribute('href'))!);
    expect(await download.text()).toBe('Исправленная работа');
    const unauthorizedDownload = await outsider.request.get((await downloadLink.getAttribute('href'))!);
    expect(unauthorizedDownload.status()).toBe(404);
    await row.getByRole('checkbox').check();
    await teacher.getByRole('button', { name: 'Принять выбранные' }).click();
    await expect(student.getByText('Принято', { exact: true })).toBeVisible({ timeout: 10_000 });

    await student.getByRole('link', { name: 'Профиль' }).click();
    await expect(profileAssignments.getByRole('button', { name: 'Активные' })).toHaveAttribute('aria-pressed', 'true');
    await expect(profileAssignment).toHaveCount(0);
    await profileAssignments.getByRole('button', { name: 'Завершённые' }).click();
    await expect(profileAssignments.getByRole('listitem').filter({ hasText: title })).toContainText('Принято');

    await row.getByRole('link', { name: 'Алексей Смирнов' }).click();
    await expect(teacher.getByRole('heading', { name: 'Алексей Смирнов' })).toBeVisible();
    await expect(teacher.getByRole('region', { name: 'История баллов' })).toHaveCount(0);
    const publicProfile = await outsider.request.get(`/api/profiles/${me.id}`);
    expect(publicProfile.ok()).toBe(true);
    expect(await publicProfile.json()).toMatchObject({ student: { id: me.id }, personal: null });

    await teacher.getByRole('navigation', { name: 'Кабинет' }).getByRole('link', { name: 'Задания' }).click();
    await expect(progress).toContainText('Принято 1');
    await expect(progress).toContainText('На проверке 0');
    await expect(progress).toContainText('Не сдали 1');
    await teacher.getByRole('link', { name: 'Рейтинг студентов' }).click();
    const group = teacher.getByLabel('Учебная группа', { exact: true });
    await group.selectOption({ label: 'ИВТ-24' });
    const rankingRow = teacher.getByRole('row').filter({ hasText: 'Алексей Смирнов' });
    await expect(rankingRow.getByRole('cell').last()).toHaveText(String(me.rating));
    const groupId = await group.inputValue();
    expect((await student.request.get(`/api/teacher/groups/${groupId}/ranking`)).status()).toBe(403);
    await group.selectOption({ label: 'ИВТ-25' });
    await expect(teacher.getByRole('link', { name: 'Даниил Петров' })).toBeVisible();
    await expect(rankingRow).toHaveCount(0);
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
