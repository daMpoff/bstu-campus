import { expect, test, type Page } from '@playwright/test';
import { csrf as csrfHeaders, verificationToken } from './helpers/confirmation';

const password = 'register-demo-2026';

type ApprovalGroup = { id: number; name: string; facultyId: number | null; studyForm: string | null; pendingCount: number };

async function fillCredentials(page: Page, fullName: string, email: string) {
  await page.getByLabel('ФИО').fill(fullName);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
}

async function registerAndLogin(page: Page, email: string, destination: RegExp, flow: 'direct' | 'resend' = 'direct') {
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page.getByRole('status')).toHaveText('Аккаунт создан. Подтвердите email по ссылке из письма.');
  await expect(page.getByLabel('Email')).toHaveValue(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Проверьте email и пароль.');
  const token = await verificationToken(email);
  if (flow === 'resend') {
    await page.goto('/confirm-email');
    const resend = page.getByRole('button', { name: 'Отправить письмо', exact: true });
    await expect(resend).toBeVisible();
    await page.evaluate(() => { window.location.hash = 'invalid-token'; });
    await page.getByRole('button', { name: 'Подтвердить email', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Ссылка недействительна. Запросите новое письмо.');
    await page.getByRole('button', { name: 'Запросить новое письмо', exact: true }).click();
    await expect(resend).toBeVisible();
    await page.evaluate(value => { window.location.hash = value; }, token);
    await expect(resend).toHaveCount(0);
  } else {
    await page.goto(`/confirm-email#${token}`);
  }
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

test('обе роли регистрируются со справочниками, администратор подтверждает группу студента', async ({ browser }) => {
  test.setTimeout(75_000);
  const teacher = await browser.newPage();
  const student = await browser.newPage({ viewport: { width: 320, height: 800 }, hasTouch: true });
  const admin = await browser.newPage();
  const suffix = Date.now();
  const teacherEmail = 'teacher-' + suffix + '@bgtu.test';
  const studentEmail = 'student-' + suffix + '@bgtu.test';
  const studentName = 'Тестовый Студент ' + suffix;
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
    const teacherAccount = await (await teacher.request.get('/api/me')).json();
    expect(teacherAccount).toMatchObject({
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
    await fillCredentials(student, studentName, studentEmail);
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
    await registerAndLogin(student, studentEmail, /\/profile$/, 'resend');
    await expect(student.getByText(/Группа ожидает подтверждения/)).toBeVisible();
    expect(await (await student.request.get('/api/student/assignments')).json()).toEqual([]);
    expect(await (await student.request.get('/api/student/activities')).json()).toEqual([]);
    const pending = await (await student.request.get('/api/me')).json();
    expect(pending.groupVerified).toBe(false);
    const pendingProfile = await student.request.get(`/api/profiles/${pending.id}`);
    await expect(pendingProfile).toBeOK();
    expect((await pendingProfile.json()).student.arPlace).toBeNull();
    await expect(student.getByRole('link', { name: 'Открыть рейтинг', exact: true })).toHaveAttribute('href', '/rating');
    const teacherPendingPath = `/api/teacher/groups/${groupId}/pending-students`;
    const adminApprovalPath = `/api/admin/groups/${groupId}/pending-students/${pending.id}`;
    const approvalCatalogPath = '/api/admin/group-approval/groups';
    const studentHeaders = await csrfHeaders(student.request);
    expect((await student.request.post(`${teacherPendingPath}/${pending.id}`, { headers: studentHeaders })).status()).toBe(403);
    expect((await student.request.post(adminApprovalPath, { headers: studentHeaders })).status()).toBe(403);
    expect((await student.request.get(approvalCatalogPath)).status()).toBe(403);
    expect((await teacher.request.get(approvalCatalogPath)).status()).toBe(403);
    expect((await teacher.request.post(adminApprovalPath, { headers: await csrfHeaders(teacher.request) })).status()).toBe(403);
    expect((await teacher.request.get(teacherPendingPath)).status()).toBe(403);
    expect(await (await teacher.request.get('/api/teacher/group-approval/groups')).json()).toEqual([]);

    const adminLogin = await admin.request.post('/api/login', {
      headers: await csrfHeaders(admin.request), form: { email: 'admin@bgtu.test', password: 'demo2026' },
    });
    expect(adminLogin.status()).toBe(204);
    const { teacherIds } = await (await admin.request.get(`/api/admin/groups/${groupId}/leadership`)).json();
    const responsibility = await admin.request.put(`/api/admin/groups/${groupId}/responsible-teachers`, {
      headers: await csrfHeaders(admin.request), data: { teacherIds: [...teacherIds, teacherAccount.id] },
    });
    expect(responsibility.status()).toBe(204);
    const teacherPending = await teacher.request.get(teacherPendingPath);
    expect(teacherPending.ok()).toBeTruthy();
    expect(await teacherPending.json()).toContainEqual({ id: pending.id, fullName: studentName });
    expect(await (await teacher.request.get('/api/teacher/group-approval/groups')).json()).toEqual([
      expect.objectContaining({ id: groupId }),
    ]);
    const response = await admin.request.get(approvalCatalogPath);
    expect(response.ok()).toBeTruthy();
    const approvalCatalog: ApprovalGroup[] = await response.json();
    const pendingGroup = approvalCatalog.find(group => group.id === groupId)!;
    expect(pendingGroup).toMatchObject({ facultyId, studyForm: 'очная' });
    expect(pendingGroup.pendingCount).toBeGreaterThan(0);
    const legacyGroup = approvalCatalog.find(group => group.studyForm === null && group.pendingCount === 0)!;
    expect(legacyGroup).toBeDefined();

    await admin.goto('/admin');
    await admin.getByRole('link', { name: 'Подтверждение группы', exact: true }).click();
    const approvalGroup = admin.getByRole('combobox', { name: 'Учебная группа' });
    const approvalResults = admin.getByRole('listbox', { name: 'Учебная группа' });
    const approvalFaculty = admin.getByLabel('Факультет или институт');
    const studyForm = admin.getByLabel('Форма обучения');
    const pendingOnly = admin.getByRole('checkbox', { name: 'Только с заявками' });
    await studyForm.selectOption({ label: 'Не указана' });
    await approvalGroup.fill(legacyGroup.name.toLowerCase());
    await expect(approvalResults.getByRole('option', { name: legacyGroup.name })).toBeVisible();
    await admin.getByRole('button', { name: 'Сбросить фильтры' }).click();
    await expect(studyForm.getByRole('option', { name: 'Все формы', selected: true })).toBeAttached();
    await pendingOnly.check();
    await approvalGroup.fill(legacyGroup.name);
    await expect(approvalResults.getByRole('option', { name: legacyGroup.name })).toHaveCount(0);
    await approvalFaculty.selectOption({ label: instituteName });
    await approvalGroup.fill(groupName);
    await expect(approvalResults.getByRole('option', { name: groupName })).toHaveCount(0);
    await approvalFaculty.selectOption({ label: facultyName });
    await studyForm.selectOption({ label: 'Очная форма' });
    await approvalGroup.fill(groupName.toLowerCase());
    await expect(approvalResults.getByRole('option', { name: groupName })).toBeVisible();
    await approvalGroup.press('ArrowDown');
    await approvalGroup.press('Enter');
    await expect(approvalGroup).toHaveValue(groupName);

    await admin.getByRole('button', { name: `Подтвердить группу · ${studentName}` }).click();
    await expect(admin.getByText(`Группа подтверждена · ${studentName}`, { exact: true })).toBeVisible();
    await expect.poll(async () => {
      const groups: ApprovalGroup[] = await (await admin.request.get(approvalCatalogPath)).json();
      return groups.find(group => group.id === groupId)?.pendingCount;
    }).toBe(pendingGroup.pendingCount - 1);
    await expect(admin.getByRole('button', { name: `Подтвердить группу · ${studentName}` })).toHaveCount(0);
    if (pendingGroup.pendingCount === 1) {
      await approvalGroup.fill(groupName.toLowerCase());
      await expect(approvalResults.getByRole('option', { name: groupName })).toHaveCount(0);
    }
    await expect(student.getByText(/Группа ожидает подтверждения/)).toHaveCount(0, { timeout: 10_000 });
    await expect(student.getByRole('link', { name: new RegExp(title) })).toBeVisible();
    await expect(student.getByText(expiredTitle)).toHaveCount(0);
    expect(await (await student.request.get('/api/me')).json()).toMatchObject({
      role: 'STUDENT', facultyName, groupName, rating: 1000, groupVerified: true,
    });

    const payload = { role: 'STUDENT', email: studentEmail.toUpperCase(), password,
      fullName: studentName, facultyId, groupId };
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
    await Promise.all([teacher.close(), student.close(), admin.close()]);
  }
});
