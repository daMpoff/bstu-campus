import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { csrf, verifyEmail } from './helpers/confirmation';

const password = 'group-leadership-2026';

async function login(request: APIRequestContext, email: string, loginPassword = 'demo2026') {
  const response = await request.post('/api/login', {
    headers: await csrf(request), form: { email, password: loginPassword },
  });
  expect(response.status()).toBe(204);
  const account = await request.get('/api/me');
  expect(account.ok()).toBeTruthy();
  return account.json();
}

async function registerStudent(request: APIRequestContext, student: { email: string; fullName: string },
                               group: { id: number; facultyId: number }) {
  const response = await request.post('/api/registration', {
    headers: await csrf(request),
    data: { ...student, password, role: 'STUDENT', facultyId: group.facultyId, groupId: group.id },
  });
  expect(response.status()).toBe(204);
  await verifyEmail(request, student.email);
  return login(request, student.email, password);
}

async function chooseGroup(page: Page, name: string) {
  await page.getByRole('searchbox', { name: 'Поиск группы' }).fill(name);
  const group = page.getByRole('button', { name, exact: true });
  await group.click();
  await expect(group).toHaveAttribute('aria-pressed', 'true');
}

test('преподаватель назначает старосту своей группы, староста одобряет только заявки одногруппников', async ({ browser }) => {
  test.setTimeout(75_000);
  const [admin, teacher, leader, classmate, outsider] = await Promise.all(
    Array.from({ length: 5 }, () => browser.newPage()),
  );
  const suffix = randomUUID().slice(0, 8);
  try {
    const [, instructor] = await Promise.all([
      login(admin.request, 'admin@bgtu.test'),
      login(teacher.request, 'teacher@bgtu.test'),
    ]);
    const catalog = await (await admin.request.get('/api/registration/catalog')).json();
    const facultyId = catalog.groups[0].facultyId as number;
    const adminHeaders = await csrf(admin.request);
    const teacherHeaders = await csrf(teacher.request);
    const createGroup = async (key: string) => {
      const name = `СТ-${key}-${suffix}`;
      const response = await admin.request.post('/api/admin/catalog/groups', {
        headers: adminHeaders, data: { name, facultyId, studyForm: 'очная' },
      });
      expect(response.status()).toBe(201);
      const { id } = await response.json();
      return { id, name, facultyId };
    };
    const [own, foreign] = await Promise.all([createGroup('1'), createGroup('2')]);
    const [candidate, pending, foreignPending] = await Promise.all([
      registerStudent(leader.request, { email: `leader-${suffix}@bgtu.test`, fullName: `Кандидат ${suffix}` }, own),
      registerStudent(classmate.request, { email: `member-${suffix}@bgtu.test`, fullName: `Одногруппник ${suffix}` }, own),
      registerStudent(outsider.request, { email: `other-${suffix}@bgtu.test`, fullName: `Другая группа ${suffix}` }, foreign),
    ]);
    const teacherGroup = `/api/teacher/groups/${own.id}`;
    const adminGroup = `/api/admin/groups/${own.id}`;
    const studentGroup = `/api/student/groups/${own.id}`;
    const instructorCatalog = async () => (await teacher.request.get('/api/teacher/group-approval/groups')).json();

    expect(await instructorCatalog()).not.toContainEqual(expect.objectContaining({ id: own.id }));
    expect((await teacher.request.get(`${teacherGroup}/pending-students`)).status()).toBe(403);
    expect(await (await leader.request.get('/api/student/group-approval/groups')).json()).toEqual([]);
    expect((await leader.request.get(`${studentGroup}/pending-students`)).status()).toBe(403);

    await admin.goto('/admin');
    await admin.getByRole('link', { name: 'Подтверждение группы', exact: true }).click();
    await chooseGroup(admin, own.name);
    await admin.getByRole('group', { name: 'Ответственные преподаватели' })
      .getByRole('checkbox', { name: instructor.fullName, exact: true }).check();
    await admin.getByRole('button', { name: 'Сохранить преподавателей', exact: true }).click();
    await expect.poll(instructorCatalog).toContainEqual(expect.objectContaining({ id: own.id }));
    expect(await instructorCatalog()).not.toContainEqual(expect.objectContaining({ id: foreign.id }));
    expect((await teacher.request.get(`/api/teacher/groups/${foreign.id}/pending-students`)).status()).toBe(403);
    expect((await teacher.request.post(`/api/teacher/groups/${foreign.id}/pending-students/${foreignPending.id}`, {
      headers: teacherHeaders,
    })).status()).toBe(403);

    expect((await teacher.request.put(`${teacherGroup}/leader`, {
      headers: teacherHeaders, data: { studentId: candidate.id },
    })).status()).toBe(400);
    expect((await teacher.request.post(`${teacherGroup}/pending-students/${candidate.id}`, {
      headers: teacherHeaders,
    })).status()).toBe(204);
    expect((await admin.request.post(`/api/admin/groups/${foreign.id}/pending-students/${foreignPending.id}`, {
      headers: adminHeaders,
    })).status()).toBe(204);
    expect((await teacher.request.put(`${teacherGroup}/leader`, {
      headers: teacherHeaders, data: { studentId: foreignPending.id },
    })).status()).toBe(400);

    await teacher.setViewportSize({ width: 375, height: 760 });
    await teacher.goto('/assignments');
    await teacher.getByRole('button', { name: 'Меню', exact: true }).click();
    await teacher.getByRole('link', { name: 'Подтверждение группы', exact: true }).click();
    await chooseGroup(teacher, own.name);
    const groupHeading = teacher.getByRole('heading', { name: own.name, exact: true });
    await expect(groupHeading).toBeFocused();
    const groupSearch = teacher.getByRole('searchbox', { name: 'Поиск группы' });
    await groupSearch.fill(foreign.name);
    await expect(groupHeading).toHaveCount(0);
    await groupSearch.clear();
    await expect(groupHeading).toHaveCount(0);
    await chooseGroup(teacher, own.name);
    const selector = teacher.getByRole('combobox', { name: 'Староста группы', exact: true });
    await expect(selector.getByRole('option', { name: candidate.fullName, exact: true })).toBeAttached();
    await expect(selector.getByRole('option', { name: pending.fullName, exact: true })).toHaveCount(0);
    await selector.selectOption(String(candidate.id));
    await teacher.getByRole('button', { name: 'Назначить старосту', exact: true }).click();
    await expect.poll(async () => (await (await leader.request.get('/api/me')).json()).groupLeader).toBe(true);
    expect(await (await leader.request.get('/api/student/group-approval/groups')).json()).toEqual([
      expect.objectContaining({ id: own.id }),
    ]);
    expect((await leader.request.get(`/api/student/groups/${foreign.id}/pending-students`)).status()).toBe(403);
    expect((await leader.request.post(`/api/student/groups/${foreign.id}/pending-students/${foreignPending.id}`, {
      headers: await csrf(leader.request),
    })).status()).toBe(403);
    expect((await leader.request.put(`${studentGroup}/leader`, {
      headers: await csrf(leader.request), data: { studentId: pending.id },
    })).status()).toBe(403);

    await leader.goto('/profile');
    await leader.getByRole('link', { name: 'Подтверждение группы', exact: true }).click();
    await expect(leader.getByRole('button', { name: 'Назначить старосту', exact: true })).toHaveCount(0);
    await leader.getByRole('button', { name: `Подтвердить группу · ${pending.fullName}`, exact: true }).click();
    await expect.poll(async () => (await (await classmate.request.get('/api/me')).json()).groupVerified).toBe(true);
    expect(await (await classmate.request.get('/api/student/group-approval/groups')).json()).toEqual([]);
    expect((await classmate.request.get(`${studentGroup}/pending-students`)).status()).toBe(403);

    await teacher.reload();
    await chooseGroup(teacher, own.name);
    await selector.selectOption(String(pending.id));
    await teacher.getByRole('button', { name: 'Назначить старосту', exact: true }).click();
    await expect.poll(async () => (await (await leader.request.get('/api/me')).json()).groupLeader).toBe(false);
    await expect.poll(async () => (await (await classmate.request.get('/api/me')).json()).groupLeader).toBe(true);
    expect((await leader.request.get(`${studentGroup}/pending-students`)).status()).toBe(403);
    await expect(teacher.getByText(`Текущий староста · ${pending.fullName}`, { exact: true })).toBeVisible();
    await teacher.getByRole('button', { name: 'Снять старосту', exact: true }).click();
    await expect.poll(async () => (await (await classmate.request.get('/api/me')).json()).groupLeader).toBe(false);
    expect((await classmate.request.get(`${studentGroup}/pending-students`)).status()).toBe(403);
    const revoked = await admin.request.put(`${adminGroup}/responsible-teachers`, {
      headers: adminHeaders, data: { teacherIds: [] },
    });
    expect(revoked.status()).toBe(204);
    expect((await teacher.request.get(`${teacherGroup}/leadership`)).status()).toBe(403);
    expect((await teacher.request.put(`${teacherGroup}/leader`, {
      headers: teacherHeaders, data: { studentId: candidate.id },
    })).status()).toBe(403);
  } finally {
    await Promise.all([admin.close(), teacher.close(), leader.close(), classmate.close(), outsider.close()]);
  }
});
