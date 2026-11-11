import { expect, test, type Page } from '@playwright/test';
import type { StudentAssignment } from '../src/api';

async function login(page: Page, role: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(role + '@bgtu.test');
  await page.getByLabel('Пароль').fill('demo2026');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(role === 'teacher' ? /\/assignments$/ : /\/profile$/);
  await expect(page.getByRole('heading', { name: 'Задания', exact: true })).toBeVisible();
}

function penaltyValue(page: Page, label: string) {
  return page.getByRole('region', { name: 'Списание по заданию' })
    .getByText(label, { exact: true }).locator('..').locator('dd');
}

test('группа получает задание, студент сдаёт работу, преподаватель возвращает и принимает', async ({ browser, request }) => {
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
    await expect(penaltyValue(student, 'Списано за задание')).toHaveText('20 АР', { timeout: 15_000 });
    await expect(penaltyValue(student, 'Ещё может списаться')).toHaveText('0 АР');
    const penaltySummary = student.getByRole('region', { name: 'Списание по заданию' });
    await expect(penaltySummary).toContainText('После сдачи списание по этому заданию остановится.');
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
    await expect(penaltySummary).toHaveCount(0);

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
    await outsider.goto(`/profiles/${me.id}`);
    const publicActiveAssignments = outsider.getByRole('region', { name: 'Задания' });
    await expect(publicActiveAssignments.getByRole('listitem').filter({ hasText: title })).toContainText('Сдано на проверку');
    await expect(publicActiveAssignments.getByRole('link')).toHaveCount(0);

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
    await expect(student.getByRole('link', { name: 'Открыть в браузере', exact: true })).toHaveCount(0);

    const previewPath = `/api/teacher${detailPath}/works/${me.id}/preview`;
    await teacher.goto('/review');
    const queuePreview = pending.getByRole('link', { name: 'Открыть в браузере', exact: true });
    await expect(queuePreview).toHaveAttribute('href', previewPath);
    await expect(queuePreview).toHaveAttribute('target', '_blank');
    const [previewTab] = await Promise.all([teacher.context().waitForEvent('page'), queuePreview.click()]);
    await expect(previewTab.locator('body')).toHaveText('Исправленная работа');
    await previewTab.close();

    await teacher.goto(detailPath);
    const cardPreview = row.getByRole('link', { name: 'Открыть в браузере', exact: true });
    await expect(cardPreview).toHaveAttribute('href', previewPath);
    await expect(cardPreview).toHaveAttribute('target', '_blank');
    const preview = await teacher.request.get(previewPath);
    expect(preview.status()).toBe(200);
    expect(preview.headers()['content-type']).toMatch(/^text\/plain\b/i);
    expect(preview.headers()['content-disposition']).toMatch(/^inline\b/i);
    expect(await preview.text()).toBe('Исправленная работа');
    expect((await request.get(previewPath)).status()).toBe(401);
    expect((await student.request.get(previewPath)).status()).toBe(403);
    expect((await outsider.request.get(previewPath)).status()).toBe(403);
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
    for (const viewer of [teacher, outsider]) {
      const publicProfile = await viewer.request.get(`/api/profiles/${me.id}`);
      expect(publicProfile.ok()).toBe(true);
      expect(await publicProfile.json()).toMatchObject({
        student: { id: me.id, academicActivityPoints: expect.any(Number), publicActivityPoints: expect.any(Number) },
        personal: {
          assignments: expect.arrayContaining([expect.objectContaining({ title, status: 'ACCEPTED' })]),
          ratingHistory: expect.arrayContaining([expect.objectContaining({ assignmentTitle: title, amount: -20, currency: 'AR' })]),
        },
      });
      await viewer.goto(`/profiles/${me.id}`);
      await expect(viewer.getByRole('region', { name: 'История баллов' }).getByRole('listitem').filter({ hasText: title })).toContainText('−20 АР');
      const publicAssignments = viewer.getByRole('region', { name: 'Задания' });
      await publicAssignments.getByRole('button', { name: 'Завершённые' }).click();
      await expect(publicAssignments.getByRole('listitem').filter({ hasText: title })).toContainText('Принято');
      await expect(publicAssignments.getByRole('link')).toHaveCount(0);
    }

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

test('сводка списания учитывает остаток лимита задания и текущий АР', async ({ page }) => {
  await login(page, 'student');
  const account = await (await page.request.get('/api/me')).json();
  const item: StudentAssignment = {
    id: 99999999, title: 'Проверка остатка списания', description: 'Сдайте работу.',
    teacherName: 'Елена Крылова', deadline: new Date(Date.now() - 60_000).toISOString(),
    penaltyLimit: 100, deducted: 40, status: 'OVERDUE', link: null, fileName: null,
  };
  let rating = 15;
  await page.route('**/api/me', route => route.fulfill({ json: { ...account, rating } }));
  await page.route('**/api/student/assignments', route => route.fulfill({ json: [item] }));

  await page.goto(`/assignments/${item.id}`);
  await expect(penaltyValue(page, 'Списано за задание')).toHaveText('40 АР');
  await expect(penaltyValue(page, 'Ещё может списаться')).toHaveText('до 15 АР');

  rating = 1000;
  await page.reload();
  await expect(penaltyValue(page, 'Ещё может списаться')).toHaveText('до 60 АР');

  rating = 0;
  await page.reload();
  await expect(penaltyValue(page, 'Ещё может списаться')).toHaveText('0 АР');
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
