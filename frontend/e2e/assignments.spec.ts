import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Group, StudentAssignment } from '../src/api';

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

function penaltyPanel(page: Page) {
  return page.getByRole('complementary').filter({
    has: page.getByRole('heading', { name: 'Списание по заданию', exact: true }),
  });
}

async function expectInlinePreview(page: Page, trigger: Locator, closeWithEscape = false) {
  const location = page.url();
  const openPages = page.context().pages().length;
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Предпросмотр вложения' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('работа.txt');
  await expect(dialog).toContainText('Исправленная работа');
  await expect(dialog.getByRole('link', { name: /Скачать/ })).toHaveCount(0);
  await expect(page).toHaveURL(location);
  expect(page.context().pages()).toHaveLength(openPages);

  const close = dialog.getByRole('button', { name: 'Закрыть', exact: true });
  await expect(close).toBeVisible();
  if (closeWithEscape) await page.keyboard.press('Escape');
  else await close.click();
  await expect(dialog).toBeHidden();
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
    await expect(student.getByRole('timer', { name: 'Время просрочки' })).toContainText('Просрочка');
    await expect(penaltyValue(student, 'Списано за задание')).toHaveText('20 АР', { timeout: 15_000 });
    await expect(penaltyValue(student, 'Ещё может списаться')).toHaveText('0 АР');
    const penaltySummary = student.getByRole('region', { name: 'Списание по заданию' });
    await expect(penaltySummary).toContainText('Лимит задания исчерпан. Больше АР по нему не спишется.');
    const penaltyCard = penaltyPanel(student);
    const me = await (await student.request.get('/api/me')).json();
    expect((await outsider.request.get(`/api/profiles/${me.id}`)).status()).toBe(401);
    await student.getByRole('link', { name: 'Профиль' }).click();
    const identity = student.getByRole('region', { name: 'Алексей Смирнов' });
    await expect(identity.getByRole('heading', { name: 'Алексей Смирнов' })).toBeVisible();
    await expect(identity.getByText('Факультет информационных технологий (ФИТ)', { exact: true })).toBeVisible();
    await expect(identity.getByText('ИВТ-24', { exact: true })).toBeVisible();
    const history = student.getByRole('region', { name: 'История баллов' });
    await expect(history.getByRole('listitem').filter({ hasText: title })).toContainText('−20 АР');
    await student.setViewportSize({ width: 320, height: 800 });
    expect(await student.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await student.setViewportSize({ width: 1280, height: 820 });
    const profileAssignments = student.getByRole('region', { name: 'Задания' });
    const profileAssignment = profileAssignments.getByRole('link', { name: title, exact: true });
    const profileRow = profileAssignments.getByRole('listitem').filter({ hasText: title });
    await expect(profileRow).toContainText('Просрочено');
    await expect(profileRow).toContainText('Списано 20 АР');
    await expect(profileRow).toContainText('Ещё 0 АР');
    await profileAssignment.click();
    await student.getByLabel('Ссылка на работу').fill('https://example.org/work');
    await student.getByRole('button', { name: 'Сдать работу' }).click();
    await expect(student.getByText('Сдано на проверку', { exact: true })).toBeVisible();
    await expect(penaltySummary).toHaveCount(0);
    await expect(penaltyCard).toContainText('Работа на проверке. Больше АР по этому заданию не спишется.');
    await expect(penaltyCard.getByText('Списано за задание', { exact: true }).locator('..')).toContainText('20 АР');

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
    await expect(outsider.getByRole('region', { name: 'Сдача работ' })).toHaveCount(0);

    const row = teacher.getByRole('listitem').filter({ hasText: 'Алексей Смирнов' });
    await teacher.getByRole('button', { name: 'Обновить' }).click();
    await expect(row.getByRole('link', { name: /Открыть ссылку/ })).toHaveAttribute('href', 'https://example.org/work');
    await teacher.getByRole('navigation', { name: 'Кабинет' }).getByRole('link', { name: 'Задания' }).click();
    const taskList = teacher.getByRole('region', { name: 'Задания', exact: true });
    const task = taskList.getByRole('listitem').filter({ has: teacher.getByRole('link', { name: title, exact: true }) });
    await expect(task.getByText('ИВТ-24', { exact: true })).toBeVisible();
    await expect(task.getByRole('timer', { name: 'Время просрочки' })).toBeVisible();
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
    await expectInlinePreview(student, student.getByRole('button', { name: /Предпросмотр/ }));
    await expect(student.getByRole('link', { name: /Скачать работа\.txt/ })).toHaveCount(0);

    const teacherPreviewPath = `/api/teacher${detailPath}/works/${me.id}/preview`;
    const studentPreviewPath = `/api/student${detailPath}/preview`;
    await teacher.goto('/review');
    await expectInlinePreview(teacher, pending.getByRole('button', { name: /Предпросмотр/ }), true);
    await expect(pending.getByRole('link', { name: /Скачать/ })).toHaveCount(0);

    await teacher.goto(detailPath);
    await expectInlinePreview(teacher, row.getByRole('button', { name: /Предпросмотр/ }));
    await expect(row.getByRole('link', { name: /Скачать/ })).toHaveCount(0);
    const previews = await Promise.all([teacher.request.get(teacherPreviewPath), student.request.get(studentPreviewPath)]);
    for (const preview of previews) {
      expect(preview.status()).toBe(200);
      expect(preview.headers()['content-type']).toMatch(/^text\/plain\b/i);
      expect(preview.headers()['content-disposition']).toMatch(/^inline\b/i);
      expect(await preview.text()).toBe('Исправленная работа');
    }
    expect((await request.get(teacherPreviewPath)).status()).toBe(401);
    expect((await request.get(studentPreviewPath)).status()).toBe(401);
    expect((await student.request.get(teacherPreviewPath)).status()).toBe(403);
    expect((await outsider.request.get(teacherPreviewPath)).status()).toBe(403);
    expect((await teacher.request.get(studentPreviewPath)).status()).toBe(403);
    expect((await outsider.request.get(studentPreviewPath)).status()).toBe(404);
    await row.getByRole('checkbox').check();
    await teacher.getByRole('button', { name: 'Принять выбранные' }).click();
    await expect(student.getByText('Принято', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(penaltyCard).toContainText('Работа принята. Больше АР по этому заданию не спишется.');
    await expect(penaltyCard.getByText('Списано за задание', { exact: true }).locator('..')).toContainText('20 АР');

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
          assignments: expect.arrayContaining([expect.objectContaining({ title, status: 'ACCEPTED', penaltyLimit: null, deducted: null })]),
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

test('неподдерживаемое вложение доступно для скачивания студенту и преподавателю', async ({ browser, request }) => {
  const teacher = await browser.newPage();
  const student = await browser.newPage();
  const outsider = await browser.newPage();
  try {
    await Promise.all([login(teacher, 'teacher'), login(student, 'student'), login(outsider, 'student3')]);
    const groups: Group[] = await (await teacher.request.get('/api/teacher/groups')).json();
    const group = groups.find(candidate => candidate.name === 'ИВТ-24');
    expect(group).toBeDefined();
    const { headerName, token } = await (await teacher.request.get('/api/csrf')).json();
    const title = 'Сдача работы с архивом ' + Date.now();
    const assignment = await teacher.request.post('/api/teacher/assignments', {
      headers: { [headerName]: token },
      data: {
        title, description: 'Приложите архив.', groupIds: [group!.id], penaltyLimit: 0,
        deadline: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      },
    });
    expect(assignment.status()).toBe(201);
    const { id } = await assignment.json();
    const { id: studentId } = await (await student.request.get('/api/me')).json();
    await student.goto(`/assignments/${id}`);
    const archive = Buffer.from('504b0506000000000000000000000000000000000000', 'hex');
    await student.getByLabel('Или файл до 10 МБ').setInputFiles({
      name: 'работа.zip', mimeType: 'application/zip', buffer: archive,
    });
    await student.getByRole('button', { name: 'Сдать работу' }).click();
    await expect(student.getByText('Сдано на проверку', { exact: true })).toBeVisible();
    await teacher.goto('/review');
    const pending = teacher.getByRole('listitem').filter({ hasText: title });
    const downloadPath = `/api/works/${id}/files/${studentId}`;

    for (const [page, attachment] of [[student, student.locator('main')], [teacher, pending]] as const) {
      const downloadLink = attachment.getByRole('link', { name: /Скачать работа\.zip/ });
      await expect(downloadLink).toHaveAttribute('href', downloadPath);
      await expect(attachment.getByRole('button', { name: /Предпросмотр/ })).toHaveCount(0);
      const downloaded = await page.request.get(downloadPath);
      expect(downloaded.status()).toBe(200);
      expect(downloaded.headers()['content-disposition']).toMatch(/^attachment\b/i);
      expect(await downloaded.body()).toEqual(archive);
    }
    expect((await request.get(downloadPath)).status()).toBe(401);
    expect((await outsider.request.get(downloadPath)).status()).toBe(404);
    expect((await student.request.get(`/api/student/assignments/${id}/preview`)).status()).toBe(415);
    expect((await teacher.request.get(`/api/teacher/assignments/${id}/works/${studentId}/preview`)).status()).toBe(415);
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

  rating = 1000;
  item.status = 'SUBMITTED';
  await page.reload();
  const panel = penaltyPanel(page);
  await expect(panel).toContainText('Списание приостановлено на время проверки. Если работу вернут после дедлайна, оно может возобновиться.');
  await expect(panel.getByText('Списано за задание', { exact: true }).locator('..')).toContainText('40 АР');
});

test('таймер переходит в просрочку без запросов и дашборд открывает нужные действия', async ({ page }) => {
  await login(page, 'student');
  const account = await (await page.request.get('/api/me')).json();
  const baseTime = new Date('2026-04-16T12:00:00Z');
  await page.clock.install({ time: baseTime });
  await page.clock.pauseAt(new Date(baseTime.getTime() + 10_000));
  const item: StudentAssignment = {
    id: 99999998, title: 'Подготовить отчёт', description: 'Приложите файл.',
    teacherName: 'Елена Крылова', deadline: new Date(baseTime.getTime() + 14_000).toISOString(),
    penaltyLimit: 55, deducted: 0, status: 'OPEN', link: null, fileName: null,
  };
  const eventAt = new Date(baseTime.getTime() + 3_600_000).toISOString();
  const activity = {
    id: 31415, title: 'Помощь на дне открытых дверей', description: 'Работа с посетителями.',
    occursAt: eventAt, maxPoints: 75, kind: 'PUBLIC', teacherName: item.teacherName, groups: ['ИВТ-24'],
  };
  const poll = { id: 27182, title: 'Тема консультации', endsAt: eventAt, closed: false, voted: false };
  let assignmentReads = 0;
  await page.route('**/api/me', route => route.fulfill({ json: { ...account, rating: 15 } }));
  await page.route('**/api/student/ranking/summary', route => route.fulfill({ json: { rating: 15, arPlace: 2 } }));
  await page.route('**/api/student/assignments', route => {
    assignmentReads++;
    return route.fulfill({ json: [item] });
  });
  await page.route(`**/api/profiles/${account.id}`, route => route.fulfill({
    json: { student: { ...account, rating: 15, academicActivityPoints: 12, publicActivityPoints: 5 },
      personal: { assignments: [item], ratingHistory: [] } },
  }));
  await page.route('**/api/student/activities', route => route.fulfill({
    json: [{ activity, participation: null, points: null, enrolled: false, canEnroll: true }],
  }));
  await page.route('**/api/student/polls', route => route.fulfill({ json: [poll] }));

  await page.goto('/assignments');
  const card = page.getByRole('link', { name: item.title, exact: true });
  const timer = card.getByRole('timer', { name: 'До дедлайна' });
  await expect(timer).toHaveText('Осталось 4 с');
  await page.clock.runFor(2500);
  await expect(timer).toHaveText('Осталось 2 с');
  await page.clock.runFor(2000);
  await expect(card.getByRole('timer', { name: 'Время просрочки' })).toContainText('Просрочка');
  await expect(card).toContainText('Списано 0 АР');
  await expect(card).toContainText('Ещё до 15 АР');
  expect(assignmentReads).toBe(1);

  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/profile');
  const overview = page.getByRole('region', { name: 'Сдача работ' });
  await expect(overview.getByText('Просрочено', { exact: true }).locator('..').locator('dd')).toHaveText('1');
  await expect(overview.getByRole('link', { name: 'Открыть задание' })).toHaveAttribute('href', `/assignments/${item.id}`);
  const events = page.getByRole('region', { name: 'Ближайшие события' });
  await expect(events.getByRole('link', { name: poll.title })).toHaveAttribute('href', `/polls/${poll.id}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await events.getByRole('link', { name: activity.title }).click();
  await expect(page).toHaveURL(/\/activities#activity-31415$/);
  const activityCard = page.getByRole('article', { name: activity.title });
  await expect(activityCard).toBeFocused();
  await expect(activityCard.getByRole('button', { name: 'Записаться' })).toBeVisible();
});

test('главная переключает дневное и ночное фото', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const hero = page.getByRole('region', { name: 'БГТУ' });
  const photo = hero.locator('img');
  const loadedSource = () => photo.evaluate(element => {
    const image = element as HTMLImageElement;
    return image.complete && image.naturalWidth > 0 ? image.currentSrc : '';
  });
  await expect.poll(loadedSource).toMatch(/bgtu-hero-day-\d+\.webp$/);
  await expect(photo).toHaveJSProperty('fetchPriority', 'high');
  await page.getByRole('button', { name: 'Тёмная тема' }).click();
  await expect.poll(loadedSource).toMatch(/bgtu-hero-night-\d+\.webp$/);
  const reloadedPhotos: string[] = [];
  page.on('request', request => {
    if (request.resourceType() === 'image') reloadedPhotos.push(request.url());
  });
  await page.reload();
  await expect.poll(loadedSource).toMatch(/bgtu-hero-night-\d+\.webp$/);
  expect(reloadedPhotos.some(url => url.includes('bgtu-hero-day-'))).toBe(false);
});
