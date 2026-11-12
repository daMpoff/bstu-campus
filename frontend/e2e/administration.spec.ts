import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { csrf, verificationToken } from './helpers/confirmation';

const importedPassword = 'change-this-2026';

async function authenticate(request: APIRequestContext, email: string, password = 'demo2026') {
  return request.post('/api/login', { headers: await csrf(request), form: { email, password } });
}

async function csv(request: APIRequestContext, kind: 'groups' | 'students', text: string) {
  return request.post(`/api/admin/import/${kind}`, {
    headers: await csrf(request), multipart: { file: { name: `${kind}.csv`, mimeType: 'text/csv', buffer: Buffer.from(text) } },
  });
}

async function post(request: APIRequestContext, path: string, data: unknown) {
  return request.post(path, { headers: await csrf(request), data });
}

async function confirmEmail(request: APIRequestContext, email: string) {
  const token = await verificationToken(email);
  expect((await post(request, '/api/registration/confirm-email', { token })).status()).toBe(204);
}

async function uploadOnPage(page: Page, content: string) {
  await page.getByLabel('Файл CSV').setInputFiles({ name: 'import.csv', mimeType: 'text/csv', buffer: Buffer.from(content) });
  await page.getByRole('button', { name: 'Импортировать', exact: true }).click();
}

test('администратор управляет справочником и настройками, импортирует атомарно и отправляет подтверждение email', async ({ browser }) => {
  test.setTimeout(75_000);
  const admin = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const teacher = await browser.newPage();
  const student = await browser.newPage();
  const suffix = Date.now().toString(36);
  const code = `test-${suffix}`;
  const faculty = `Учебное подразделение ${suffix}`;
  const group = `TEST-${suffix}`;
  const email = `import-${suffix}@bgtu.test`;
  try {
    expect((await admin.request.get('/api/admin/catalog')).status()).toBe(401);
    expect((await authenticate(teacher.request, 'teacher@bgtu.test')).status()).toBe(204);
    expect((await teacher.request.get('/api/admin/settings')).status()).toBe(403);
    expect((await authenticate(admin.request, 'admin@bgtu.test')).status()).toBe(204);
    await admin.goto('/admin');
    await expect(admin.getByRole('heading', { name: 'Администрирование' })).toBeVisible();
    await admin.getByRole('button', { name: 'Добавить запись' }).click();
    await admin.getByLabel('Название', { exact: true }).fill(faculty);
    await admin.getByLabel('Код', { exact: true }).fill(code);
    await admin.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(admin.getByText('Запись добавлена.')).toBeVisible();
    await admin.getByRole('button', { name: `Изменить ${faculty}` }).click();
    const changedFaculty = `${faculty} (обновлено)`;
    await admin.getByLabel('Название', { exact: true }).fill(changedFaculty);
    await admin.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(admin.getByText(changedFaculty, { exact: true })).toBeVisible();

    const getCatalog = async () => (await admin.request.get('/api/admin/catalog')).json();
    const facultyId = (await getCatalog()).faculties.find((entry: { code: string }) => entry.code === code).id;
    const created = await post(admin.request, '/api/admin/catalog/departments', { name: `Кафедра ${suffix}`, code, facultyId });
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    const removed = await admin.request.delete(`/api/admin/catalog/departments/${id}`, { headers: await csrf(admin.request) });
    expect(removed.status()).toBe(204);

    await admin.getByRole('button', { name: 'Импорт CSV', exact: true }).click();
    const header = 'name;faculty_code;study_form\r\n';
    await uploadOnPage(admin, header + `${group};${code};очная\r\nИВТ-24;fit;очная\r\n`);
    await expect(admin.getByRole('alert')).toContainText('группа уже существует');
    expect((await getCatalog()).groups.some((entry: { name: string }) => entry.name === group)).toBe(false);
    await uploadOnPage(admin, '\ufeff' + header + `${group};${code};очная\r\n`);
    await expect(admin.getByRole('status')).toContainText('Импортировано записей: 1');
    const groupId = (await getCatalog()).groups.find((entry: { name: string }) => entry.name === group).id;

    const assignment = await post(teacher.request, '/api/teacher/assignments', {
      title: `Открытое задание ${suffix}`, description: 'Доступно после подтверждения email.', groupIds: [groupId],
      deadline: new Date(Date.now() + 3600_000).toISOString(), penaltyLimit: 45,
    });
    expect(assignment.status()).toBe(201);
    await admin.getByLabel('Что импортировать').selectOption('students');
    await uploadOnPage(admin, `email,full_name,group_name,password\n${email},Тестовый Студент,${group},${importedPassword}\n`);
    await expect(admin.getByRole('status')).toContainText('Импортировано записей: 1');
    expect((await authenticate(student.request, email, importedPassword)).status()).toBe(401);
    await confirmEmail(student.request, email);
    expect((await authenticate(student.request, email, importedPassword)).status()).toBe(204);
    expect(await (await student.request.get('/api/student/assignments')).json()).toContainEqual(expect.objectContaining({ title: `Открытое задание ${suffix}` }));
    expect((await student.request.get('/api/admin/catalog')).status()).toBe(403);

    await admin.getByRole('button', { name: 'Настройки', exact: true }).click();
    await admin.getByRole('button', { name: 'Сохранить настройки' }).click();
    await expect(admin.getByRole('status')).toHaveText('Настройки сохранены.');
    const settings = await (await admin.request.get('/api/admin/settings')).json();
    const invalid = await admin.request.put('/api/admin/settings', { headers: await csrf(admin.request), data: { ...settings, semesterStartDays: '02-30,09-01' } });
    expect(invalid.status()).toBe(400);
    expect(await (await admin.request.get('/api/admin/settings')).json()).toEqual(settings);
    expect(await admin.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  } finally {
    await Promise.all([admin.close(), teacher.close(), student.close()]);
  }
});

test('аналитика показывает историю АР, обе валюты и расходы только вошедшего преподавателя', async ({ browser }) => {
  test.setTimeout(90_000);
  const admin = await browser.newPage();
  const teacher = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const student = await browser.newPage();
  const observer = await browser.newPage();
  const suffix = Date.now().toString(36);
  const group = `AN-${suffix}`;
  const email = `analytics-student-${suffix}@bgtu.test`;
  try {
    expect((await authenticate(admin.request, 'admin@bgtu.test')).status()).toBe(204);
    expect((await authenticate(teacher.request, 'teacher@bgtu.test')).status()).toBe(204);
    expect((await csv(admin.request, 'groups', `name,faculty_code,study_form\n${group},fit,очная\n`)).status()).toBe(200);
    expect((await csv(admin.request, 'students', `email,full_name,group_name,password\n${email},Аналитика Студент,${group},${importedPassword}\n`)).status()).toBe(200);
    await confirmEmail(student.request, email);
    expect((await authenticate(student.request, email, importedPassword)).status()).toBe(204);
    const studentId = (await (await student.request.get('/api/me')).json()).id;
    const catalog = await (await observer.request.get('/api/registration/catalog')).json();
    const groupId = catalog.groups.find((entry: { name: string }) => entry.name === group).id;

    const observerEmail = `analytics-teacher-${suffix}@bgtu.test`;
    expect((await post(observer.request, '/api/registration', { email: observerEmail, password: importedPassword,
      fullName: 'Аналитика Преподаватель', role: 'TEACHER', departmentId: catalog.departments[0].id })).status()).toBe(204);
    await confirmEmail(observer.request, observerEmail);
    expect((await authenticate(observer.request, observerEmail, importedPassword)).status()).toBe(204);

    expect((await post(teacher.request, '/api/teacher/assignments', { title: `Проверка АР ${suffix}`, description: 'Просроченная работа.',
      groupIds: [groupId], deadline: new Date(Date.now() - 4 * 60_000).toISOString(), penaltyLimit: 45 })).status()).toBe(201);
    const occursAt = new Date(Date.now() + 6500).toISOString();
    const ids = await Promise.all(['ACADEMIC', 'PUBLIC'].map(async kind => {
      const response = await post(teacher.request, '/api/teacher/activities', {
        title: `Активность ${kind} ${suffix}`, description: 'Проверка начислений.', groupIds: [groupId], maxPoints: 80, kind, occursAt,
      });
      expect(response.status()).toBe(201);
      return (await response.json()).id;
    }));
    expect((await post(student.request, `/api/student/activities/${ids[1]}/enroll`, {})).status()).toBe(204);
    await expect.poll(async () => (await teacher.request.get(`/api/teacher/activities/${ids[0]}`)).json().then(data => data.canConfirm), { timeout: 15_000 }).toBe(true);
    expect((await post(teacher.request, `/api/teacher/activities/${ids[0]}/confirm`, { studentId, participation: 75 })).status()).toBe(204);
    expect((await post(teacher.request, `/api/teacher/activities/${ids[1]}/confirm`, { studentId, participation: 50 })).status()).toBe(204);

    const url = `/api/teacher/analytics?groupId=${groupId}&months=3`;
    expect((await student.request.get(url)).status()).toBe(403);
    const report = await (await teacher.request.get(url)).json();
    expect(report.rating.map((entry: { averageRating: number }) => entry.averageRating)).toEqual([1000, 1000, 955]);
    expect(report.students).toEqual([expect.objectContaining({ id: studentId, academicPoints: 60, publicPoints: 40 })]);
    expect(report.budget[0]).toMatchObject({ spent: 100, awards: 2, academicPoints: 60, publicPoints: 40 });
    expect((await (await observer.request.get(url)).json()).budget[0]).toMatchObject({ spent: 0, awards: 0 });

    await teacher.goto('/analytics');
    await teacher.getByLabel('Учебная группа').selectOption({ label: group });
    await teacher.getByLabel('Период отчёта').selectOption('3');
    const trend = teacher.getByRole('region', { name: 'Динамика академического рейтинга' });
    const activeRating = trend.getByLabel('Средний АР за выбранный месяц');
    await expect(activeRating).toContainText('955');
    await trend.getByLabel('Месяц на графике').press('ArrowUp');
    await expect(activeRating).toContainText(/1\s000/);
    await trend.getByText('Помесячные значения', { exact: true }).press('Enter');
    await expect(trend.getByRole('table')).toBeVisible();
    const ranks = teacher.getByRole('region', { name: 'Рейтинг активности' });
    await ranks.getByRole('button', { name: 'По БОА' }).click();
    await expect(ranks.getByRole('link', { name: 'Аналитика Студент' })).toBeVisible();
    await expect(ranks).toContainText('60 БУА');
    await expect(ranks).toContainText('40 БОА');
    await expect(teacher.getByRole('region', { name: 'Ваш бюджет и начисления' })).toContainText('Расход 100');
    expect(await teacher.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
    await teacher.getByLabel('Период отчёта').selectOption('12');
    await expect(trend.getByLabel('Месяц на графике').locator('option')).toHaveCount(12);
    await teacher.getByRole('button', { name: 'Меню', exact: true }).click();
    const drawer = teacher.getByRole('dialog', { name: 'Меню кабинета', exact: true });
    await drawer.getByRole('button', { name: 'Тёмная тема', exact: true }).click();
    await drawer.getByRole('button', { name: 'Закрыть меню', exact: true }).click();
    await teacher.setViewportSize({ width: 320, height: 812 });
    expect(await teacher.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  } finally {
    await Promise.all([admin.close(), teacher.close(), student.close(), observer.close()]);
  }
});
