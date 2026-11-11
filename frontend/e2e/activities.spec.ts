import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { verifyEmail } from './helpers/confirmation';

async function csrf(context: APIRequestContext) {
  const { headerName, token } = await (await context.get('/api/csrf')).json();
  return { [headerName]: token };
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Активности', exact: true })).toBeVisible();
}

async function registerTeacher(context: APIRequestContext, email: string, password: string) {
  const catalog = await (await context.get('/api/registration/catalog')).json();
  const registration = await context.post('/api/registration', {
    headers: await csrf(context),
    data: { email, password, fullName: 'Преподаватель практикума', role: 'TEACHER', departmentId: catalog.departments[0].id },
  });
  expect(registration.status()).toBe(204);
  await verifyEmail(context, email);
}

test('учебная активность начисляет долю БУА один раз и соблюдает бюджет каждой группы', async ({ browser }) => {
  test.setTimeout(60_000);
  const teacher = await browser.newPage();
  const student = await browser.newPage();
  const outsider = await browser.newPage();
  const otherTeacher = await browser.newPage();
  const suffix = Date.now();
  const email = `activity-teacher-${suffix}@bgtu.test`;
  const password = 'test-activity-2026';
  const title = `Практикум ${suffix}`;
  const upcoming = `Семинар ${suffix}`;

  try {
    await registerTeacher(teacher.request, email, password);
    await Promise.all([
      login(teacher, email, password),
      login(student, 'student@bgtu.test', 'demo2026'),
      login(outsider, 'student3@bgtu.test', 'demo2026'),
      login(otherTeacher, 'teacher@bgtu.test', 'demo2026'),
    ]);
    const [me, outsiderAccount] = await Promise.all([student, outsider].map(async page => (await page.request.get('/api/me')).json()));
    const readProfile = async () => (await student.request.get(`/api/profiles/${me.id}`)).json();
    const before = (await readProfile()).student.academicActivityPoints;

    await teacher.getByRole('link', { name: 'Активности', exact: true }).click();
    await teacher.getByRole('link', { name: 'Новая активность' }).click();
    const format = teacher.getByRole('combobox', { name: 'Формат проведения' });
    await expect(format).toHaveValue('IN_PERSON');
    await format.selectOption({ label: 'Заочно' });
    await teacher.getByLabel('Название').fill(upcoming);
    await teacher.getByLabel('Описание').fill('Разбор решений в группах.');
    await teacher.getByRole('checkbox', { name: 'ИВТ-24', exact: true }).check();
    await teacher.getByRole('checkbox', { name: 'ИВТ-25', exact: true }).check();
    await teacher.getByLabel('Дата проведения').fill(new Date(Date.now() + 27 * 60 * 60_000).toISOString().slice(0, 10));
    await teacher.getByRole('button', { name: 'Создать активность' }).click();
    await expect(teacher.getByRole('heading', { name: upcoming })).toBeVisible();
    await expect(teacher.getByText('Заочно', { exact: true })).toBeVisible();
    await expect(teacher.getByText('Участие можно подтвердить после наступления даты проведения.')).toBeVisible();

    const groups = await (await teacher.request.get('/api/teacher/groups')).json() as { id: number; name: string }[];
    const group24 = groups.find(group => group.name === 'ИВТ-24')!.id;
    const group25 = groups.find(group => group.name === 'ИВТ-25')!.id;
    const teacherHeaders = await csrf(teacher.request);
    const occursAt = new Date(Date.now() + 8000).toISOString();
    const create = async (name: string, maxPoints: number, groupIds: number[]) => {
      const response = await teacher.request.post('/api/teacher/activities', {
        headers: teacherHeaders, data: { title: name, description: 'Решение практической задачи.', occursAt, maxPoints, groupIds },
      });
      expect(response.status()).toBe(201);
      return (await response.json()).id as number;
    };
    const [activityId, costlyId, firstConcurrentId, secondConcurrentId] = await Promise.all([
      create(title, 80, [group24]), create(`Лимит ${suffix}`, 1000, [group24, group25]),
      create(`Бюджет 1 ${suffix}`, 1000, [group24]), create(`Бюджет 2 ${suffix}`, 1000, [group24]),
    ]);
    const confirm = (id: number, studentId: number, participation: number) => teacher.request.post(
      `/api/teacher/activities/${id}/confirm`, { headers: teacherHeaders, data: { studentId, participation } },
    );
    expect((await confirm(activityId, me.id, 75)).status()).toBe(409);
    expect((await otherTeacher.request.get(`/api/teacher/activities/${activityId}`)).status()).toBe(404);
    const legacyFormat = await (await teacher.request.get(`/api/teacher/activities/${activityId}`)).json();
    expect(legacyFormat.activity.format).toBeNull();

    await Promise.all([student, outsider].map(page => page.getByRole('link', { name: 'Активности', exact: true }).click()));
    await expect(student.getByRole('article').filter({ hasText: title })).toContainText('80 БУА');
    await expect(outsider.getByRole('heading', { name: upcoming })).toBeVisible();
    await expect(student.getByRole('article', { name: upcoming }).getByText('Заочно', { exact: true })).toBeVisible();
    await expect(student.getByRole('article', { name: title, exact: true }).getByText('Очно', { exact: true })).toHaveCount(0);
    await expect(outsider.getByRole('heading', { name: title })).toHaveCount(0);
    expect((await outsider.request.get(`/api/teacher/activities/${activityId}`)).status()).toBe(403);

    await teacher.goto(`/activities/${activityId}`);
    const participant = teacher.getByRole('listitem').filter({ hasText: 'Алексей Смирнов' });
    const level = participant.getByRole('combobox');
    await expect(level).toBeVisible({ timeout: 20_000 });
    expect((await confirm(activityId, outsiderAccount.id, 75)).status()).toBe(404);
    expect((await confirm(activityId, me.id, 25.5)).status()).toBe(400);
    await expect(level.getByRole('option', { name: '75% · 60 БУА' })).toBeAttached();
    await level.selectOption('75');
    await participant.getByRole('button', { name: 'Подтвердить' }).click();
    await expect(participant).toContainText('Участие 75% · +60 БУА');
    await expect(teacher.getByRole('region', { name: 'Бюджет групп' })).toContainText('Осталось 940');
    expect((await confirm(activityId, me.id, 75)).status()).toBe(409);

    await student.getByRole('link', { name: 'Профиль' }).click();
    const history = student.getByRole('region', { name: 'История баллов' });
    const entry = history.getByRole('listitem').filter({ hasText: title });
    await expect(entry).toContainText('+60 БУА');
    await expect(entry).toContainText('Преподаватель практикума');
    expect((await readProfile()).student.academicActivityPoints).toBe(before + 60);
    await student.setViewportSize({ width: 320, height: 800 });
    expect(await student.evaluate(() => document.documentElement.scrollWidth)).toBe(320);

    expect((await confirm(costlyId, me.id, 100)).status()).toBe(409);
    expect((await readProfile()).student.academicActivityPoints).toBe(before + 60);
    expect((await confirm(costlyId, outsiderAccount.id, 100)).status()).toBe(204);
    expect((await confirm(costlyId, me.id, 50)).status()).toBe(204);
    expect((await readProfile()).student.academicActivityPoints).toBe(before + 560);

    const concurrent = await Promise.all([
      confirm(firstConcurrentId, me.id, 25), confirm(secondConcurrentId, me.id, 25),
    ]);
    expect(concurrent.map(response => response.status()).sort()).toEqual([204, 409]);
    expect((await readProfile()).student.academicActivityPoints).toBe(before + 810);
  } finally {
    await Promise.all([teacher.close(), student.close(), outsider.close(), otherTeacher.close()]);
  }
});

test('общественная активность принимает запись заранее, а лента показывает БУА и БОА', async ({ browser }) => {
  test.setTimeout(65_000);
  const [teacher, student, classmate, observer] = await Promise.all([
    browser.newPage(), browser.newPage({ viewport: { width: 320, height: 800 } }), browser.newPage(), browser.newPage(),
  ]);
  const suffix = Date.now();
  const email = `public-teacher-${suffix}@bgtu.test`;
  const password = 'test-public-2026';
  const upcoming = `Волонтёрская встреча ${suffix}`;
  const publicTitle = `Волонтёрство ${suffix}`;
  const academicTitle = `Учебная активность ${suffix}`;
  try {
    expect((await observer.request.get('/api/rewards')).status()).toBe(401);
    await registerTeacher(teacher.request, email, password);
    await Promise.all([
      login(teacher, email, password),
      login(student, 'student@bgtu.test', 'demo2026'),
      login(classmate, 'student2@bgtu.test', 'demo2026'),
      login(observer, 'student3@bgtu.test', 'demo2026'),
    ]);
    const [me, late] = await Promise.all([student, classmate].map(async page => (await page.request.get('/api/me')).json()));
    const readProfile = async () => (await student.request.get(`/api/profiles/${me.id}`)).json();
    const before = (await readProfile()).student;

    await teacher.getByRole('link', { name: 'Активности', exact: true }).click();
    await teacher.getByRole('link', { name: 'Новая активность' }).click();
    await teacher.getByLabel('Тип активности').selectOption('PUBLIC');
    await teacher.getByLabel('Название').fill(upcoming);
    await teacher.getByLabel('Описание').fill('Подготовка университетского мероприятия.');
    await teacher.getByRole('checkbox', { name: 'ИВТ-24', exact: true }).check();
    await teacher.getByLabel('Дата проведения').fill(new Date(Date.now() + 27 * 60 * 60_000).toISOString().slice(0, 10));
    await expect(teacher.getByLabel('Максимум, БОА')).toHaveValue('80');
    await teacher.getByRole('button', { name: 'Создать активность' }).click();
    await expect(teacher.getByRole('heading', { name: upcoming })).toBeVisible();
    await expect(teacher.getByText('Очно', { exact: true })).toBeVisible();
    await expect(teacher.getByText('Пока никто не записался.')).toBeVisible();

    const groups = await (await teacher.request.get('/api/teacher/groups')).json() as { id: number; name: string }[];
    const group24 = groups.find(group => group.name === 'ИВТ-24')!.id;
    const teacherHeaders = await csrf(teacher.request);
    const occursAt = new Date(Date.now() + 10_000).toISOString();
    const create = async (title: string, kind: 'ACADEMIC' | 'PUBLIC') => {
      const response = await teacher.request.post('/api/teacher/activities', {
        headers: teacherHeaders,
        data: { title, description: 'Мероприятие для группы.', occursAt, maxPoints: 80, groupIds: [group24], kind },
      });
      expect(response.status()).toBe(201);
      return (await response.json()).id as number;
    };
    const [publicId, academicId] = await Promise.all([create(publicTitle, 'PUBLIC'), create(academicTitle, 'ACADEMIC')]);
    const confirm = (id: number, studentId: number, participation: number) => teacher.request.post(
      `/api/teacher/activities/${id}/confirm`, { headers: teacherHeaders, data: { studentId, participation } },
    );
    const enroll = async (page: Page, id: number) => page.request.post(`/api/student/activities/${id}/enroll`, {
      headers: await csrf(page.request),
    });
    expect((await enroll(observer, publicId)).status()).toBe(404);
    expect((await enroll(student, academicId)).status()).toBe(400);
    await student.getByRole('link', { name: 'Активности', exact: true }).click();
    await expect(student.getByRole('article', { name: upcoming, exact: true }).getByText('Очно', { exact: true })).toBeVisible();
    const event = student.getByRole('article').filter({ hasText: publicTitle });
    await expect(event).toContainText('80 БОА');
    await event.getByRole('button', { name: 'Записаться' }).click();
    await expect(event.getByText('Вы записаны')).toBeVisible();
    expect(await student.evaluate(() => document.documentElement.scrollWidth)).toBe(320);

    await teacher.goto(`/activities/${publicId}`);
    const participants = teacher.getByRole('region', { name: 'Участники' });
    const participant = participants.getByRole('listitem').filter({ hasText: 'Алексей Смирнов' });
    await expect(participants.getByRole('listitem')).toHaveCount(1);
    const level = participant.getByRole('combobox');
    await expect(level).toBeVisible({ timeout: 20_000 });
    expect((await enroll(classmate, publicId)).status()).toBe(409);
    expect((await confirm(publicId, late.id, 75)).status()).toBe(409);
    await expect(level.getByRole('option', { name: '75% · 60 БОА' })).toBeAttached();
    await level.selectOption('75');
    await participant.getByRole('button', { name: 'Подтвердить' }).click();
    await expect(participant).toContainText('+60 БОА');
    expect((await confirm(academicId, me.id, 50)).status()).toBe(204);
    await expect(teacher.getByRole('region', { name: 'Бюджет групп' })).toContainText('Осталось 900', { timeout: 9000 });

    await student.getByRole('link', { name: 'Профиль' }).click();
    const history = student.getByRole('region', { name: 'История баллов' });
    await expect(history.getByRole('listitem').filter({ hasText: publicTitle })).toContainText('+60 БОА');
    await expect(history.getByRole('listitem').filter({ hasText: academicTitle })).toContainText('+40 БУА');
    expect((await readProfile()).student).toMatchObject({
      academicActivityPoints: before.academicActivityPoints + 40,
      publicActivityPoints: before.publicActivityPoints + 60,
    });

    for (const page of [observer, teacher]) {
      await page.getByRole('link', { name: 'Лента наград' }).click();
      const feed = page.getByRole('region', { name: 'Начисления за активности' }).getByRole('listitem');
      await expect(feed.nth(0)).toContainText(academicTitle);
      await expect(feed.nth(0)).toContainText('+40 БУА');
      await expect(feed.nth(1)).toContainText(publicTitle);
      await expect(feed.nth(1)).toContainText('+60 БОА');
    }
    const { entries } = await (await observer.request.get('/api/rewards')).json();
    const older = await (await observer.request.get(`/api/rewards?beforeId=${entries[0].id}`)).json();
    expect(older.entries[0]).toMatchObject({ activityTitle: publicTitle, kind: 'PUBLIC', points: 60 });
  } finally {
    await Promise.all([teacher.close(), student.close(), classmate.close(), observer.close()]);
  }
});
