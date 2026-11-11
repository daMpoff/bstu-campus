import { expect, test, type Page } from '@playwright/test';
import { csrf as csrfHeaders, verificationToken } from './helpers/confirmation';

const password = 'register-demo-2026';

async function fillCredentials(page: Page, fullName: string, email: string) {
  await page.getByLabel('ФИО').fill(fullName);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
}

async function registerAndLogin(page: Page, email: string, destination: RegExp) {
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page.getByRole('status')).toHaveText('Аккаунт создан. Подтвердите email по ссылке из письма.');
  await expect(page.getByLabel('Email')).toHaveValue(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Проверьте email и пароль.');
  const token = await verificationToken(email);
  await page.goto(`/confirm-email#${token}`);
  await page.getByRole('button', { name: 'Подтвердить email' }).click();
  await expect(page.getByRole('status')).toHaveText('Email подтверждён. Войдите в кабинет.');
  const reused = await page.request.post('/api/registration/confirm-email', {
    headers: await csrfHeaders(page.request), data: { token },
  });
  expect(reused.status()).toBe(400);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(destination);
  await expect(page.getByRole('heading', { name: 'Задания', exact: true })).toBeVisible();
}

test('обе роли регистрируются со справочниками, студент получает открытое задание своей группы', async ({ browser }) => {
  test.setTimeout(75_000);
  const teacher = await browser.newPage();
  const student = await browser.newPage({ viewport: { width: 320, height: 800 }, hasTouch: true });
  const suffix = Date.now();
  const teacherEmail = 'teacher-' + suffix + '@bgtu.test';
  const studentEmail = 'student-' + suffix + '@bgtu.test';
  const departmentName = 'Информатика и программное обеспечение (ИиПО)';
  const facultyName = 'Факультет информационных технологий (ФИТ)';
  const instituteName = 'Учебно-научный институт транспорта (УНИТ)';
  const groupName = 'О-26-ИВТ-1-по-Б';
  const instituteGroup = 'О-26-ТТП-ацтт-Б';
  const title = 'Открытое задание ' + suffix;
  const expiredTitle = 'Прошедшее задание ' + suffix;
  try {
    await teacher.goto('/login');
    await teacher.getByRole('link', { name: 'Зарегистрироваться' }).click();
    await teacher.getByRole('radio', { name: 'Преподаватель', exact: true }).check();
    await fillCredentials(teacher, 'Тестовый Преподаватель', teacherEmail);
    await teacher.getByLabel('Кафедра').selectOption({ label: departmentName });
    await registerAndLogin(teacher, teacherEmail, /\/assignments$/);
    expect(await (await teacher.request.get('/api/me')).json()).toMatchObject({
      role: 'TEACHER', departmentName,
    });

    await teacher.getByRole('link', { name: /Новое задание/ }).click();
    await teacher.getByLabel('Название').fill(title);
    await teacher.getByLabel('Описание').fill('Сдайте работу по ссылке.');
    await teacher.getByRole('searchbox', { name: 'Поиск учебной группы' }).fill(groupName);
    await teacher.getByRole('checkbox', { name: groupName, exact: true }).check();
    const tomorrow = new Date(Date.now() + 27 * 60 * 60_000).toISOString().slice(0, 10);
    await teacher.getByLabel('Дата').fill(tomorrow);
    await teacher.getByRole('button', { name: 'Назначить задание' }).click();
    await expect(teacher.getByRole('heading', { name: title })).toBeVisible();

    const catalog = await (await student.request.get('/api/registration/catalog')).json();
    const groupId = catalog.groups.find((group: { name: string }) => group.name === groupName).id;
    const facultyId = catalog.faculties.find((faculty: { name: string }) => faculty.name === facultyName).id;
    const instituteId = catalog.faculties.find((faculty: { name: string }) => faculty.name === instituteName).id;
    const csrf = await (await teacher.request.get('/api/csrf')).json();
    const expired = await teacher.request.post('/api/teacher/assignments', {
      headers: { [csrf.headerName]: csrf.token },
      data: { title: expiredTitle, description: 'Срок прошёл.', groupIds: [groupId],
        deadline: new Date(Date.now() - 3600_000).toISOString(), penaltyLimit: 100 },
    });
    expect(expired.ok()).toBeTruthy();

    await student.goto('/register');
    await fillCredentials(student, 'Тестовый Студент', studentEmail);
    const facultySelect = student.getByLabel('Факультет или подразделение');
    const groupField = student.getByRole('combobox', { name: 'Учебная группа' });
    const results = student.getByRole('listbox', { name: 'Учебная группа' });
    await expect(groupField).toBeDisabled();
    await expect(facultySelect.getByRole('option', { name: /Политехнический колледж.*групп пока нет/ }))
      .toHaveJSProperty('disabled', true);
    await facultySelect.selectOption({ label: facultyName });
    await facultySelect.press('Tab');
    await expect(groupField).toBeFocused();
    await expect(results.getByRole('option', { name: groupName, exact: true })).toBeAttached();
    await expect(results.getByRole('option', { name: instituteGroup })).toHaveCount(0);
    await groupField.press('Tab');
    await expect(student.getByRole('button', { name: 'Зарегистрироваться' })).toBeFocused();
    await expect(results).toHaveCount(0);
    await groupField.fill(instituteGroup);
    await expect(student.getByRole('status')).toHaveText('Группы не найдены');
    await expect(groupField).toHaveJSProperty('validationMessage', 'Выберите группу из подсказок.');
    await groupField.fill('26-ивт-1');
    await groupField.press('Escape');
    await expect(groupField).toHaveAttribute('aria-expanded', 'false');
    await groupField.press('ArrowDown');
    await expect(results.getByRole('option', { name: groupName, selected: true })).toBeVisible();
    await groupField.press('Enter');
    await expect(groupField).toHaveValue(groupName);
    await expect(groupField).toHaveAttribute('aria-expanded', 'false');
    await facultySelect.selectOption({ label: instituteName });
    await expect(groupField).toHaveValue('');
    await groupField.fill(instituteGroup.toLowerCase());
    await expect(results.getByRole('option', { name: groupName })).toHaveCount(0);
    await results.getByRole('option', { name: instituteGroup, exact: true }).tap();
    await expect(groupField).toHaveValue(instituteGroup);
    await expect(groupField).toHaveAttribute('aria-expanded', 'false');
    await facultySelect.selectOption({ label: facultyName });
    await groupField.fill(groupName.toLowerCase());
    await results.getByRole('option', { name: groupName, exact: true }).tap();
    expect(await student.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await registerAndLogin(student, studentEmail, /\/profile$/);
    await expect(student.getByText(/Группа ожидает подтверждения/)).toBeVisible();
    expect(await (await student.request.get('/api/student/assignments')).json()).toEqual([]);
    expect(await (await student.request.get('/api/student/activities')).json()).toEqual([]);
    const pending = await (await student.request.get('/api/me')).json();
    expect(pending.groupVerified).toBe(false);
    const approvalPath = `/api/teacher/groups/${groupId}/pending-students/${pending.id}`;
    expect((await student.request.post(approvalPath, { headers: await csrfHeaders(student.request) })).status()).toBe(403);
    await teacher.getByRole('link', { name: 'Подтверждение группы', exact: true }).click();
    await teacher.getByLabel('Учебная группа').selectOption(String(groupId));
    await teacher.getByRole('button', { name: 'Подтвердить группу · Тестовый Студент' }).click();
    await expect(teacher.getByRole('status')).toContainText('Группа подтверждена');
    await expect(student.getByText(/Группа ожидает подтверждения/)).toHaveCount(0, { timeout: 10_000 });
    await expect(student.getByRole('link', { name: new RegExp(title) })).toBeVisible();
    await expect(student.getByText(expiredTitle)).toHaveCount(0);
    expect(await (await student.request.get('/api/me')).json()).toMatchObject({
      role: 'STUDENT', facultyName, groupName, rating: 1000, groupVerified: true,
    });

    const payload = { role: 'STUDENT', email: studentEmail.toUpperCase(), password,
      fullName: 'Тестовый Студент', facultyId, groupId };
    expect((await teacher.request.post('/api/registration', { data: payload })).status()).toBe(403);
    const headers = { [csrf.headerName]: csrf.token };
    expect((await teacher.request.post('/api/registration', { headers, data: payload })).status()).toBe(409);
    expect((await teacher.request.post('/api/registration', {
      headers, data: { ...payload, email: 'invalid-' + suffix + '@bgtu.test', groupId: -1 },
    })).status()).toBe(400);
    const mismatched = await teacher.request.post('/api/registration', {
      headers, data: { ...payload, email: 'mismatched-' + suffix + '@bgtu.test', facultyId: instituteId },
    });
    expect(mismatched.status()).toBe(400);
  } finally {
    await Promise.all([teacher.close(), student.close()]);
  }
});
