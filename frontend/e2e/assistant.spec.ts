import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { csrf, verifyEmail } from './helpers/confirmation';

async function login(page: Page, email: string, password = 'demo2026') {
  const response = await page.request.post('/api/login', {
    headers: await csrf(page.request), form: { email, password },
  });
  expect(response.status()).toBe(204);
}

async function multipart(request: APIRequestContext, path: string, values: Record<string, string>) {
  return request.post(path, { headers: await csrf(request), multipart: values });
}

async function command(page: Page, text: string) {
  const panel = page.getByRole('dialog', { name: 'Помощник' });
  await panel.getByLabel('Сообщение помощнику').fill(text);
  await panel.getByRole('button', { name: 'Отправить', exact: true }).click();
  return panel;
}

test('черновик в помощнике заполняет поля и сохраняет ручные правки до подтверждения', async ({ page }) => {
  await login(page, 'teacher@bgtu.test');
  const initial = { title: 'Первичный и внешний ключи', description: 'Сравните ключи на примере двух таблиц.' };
  const revised = { title: 'Ссылочная целостность', description: 'Покажите ограничение внешнего ключа в SQL.' };
  let generations = 0;
  let publications = 0;
  await page.route('**/api/teacher/assignment-drafts/status', route => route.fulfill({ json: { available: true } }));
  await page.route('**/api/teacher/assignment-drafts', route => {
    expect(route.request().postDataJSON()).toEqual({ notes: 'Связи в реляционных базах' });
    return route.fulfill({ json: generations++ === 0 ? initial : revised });
  });
  await page.route('**/api/assistant/assignments', route => {
    publications++;
    return route.abort();
  });

  await page.goto('/assignments');
  await page.getByRole('button', { name: 'Помощник', exact: true }).click();
  const panel = await command(page, 'Назначь задание Алексею Смирнову');
  await panel.getByRole('button', { name: /Алексей Смирнов/ }).click();
  const date = new Date(Date.now() + 4 * 86400_000).toISOString().slice(0, 10);
  await panel.getByLabel('Дата сдачи').fill(date);
  await panel.getByLabel('Время (МСК)').fill('20:15');
  await panel.getByLabel('Лимит списания, АР').fill('40');
  await panel.getByText('Черновик с ИИ', { exact: true }).click();
  const notes = panel.getByLabel('Тезисы задания');
  await notes.fill('Связи в реляционных базах');
  const generate = panel.getByRole('button', { name: 'Сгенерировать черновик', exact: true });
  await generate.click();
  const title = panel.getByLabel('Название задания');
  const description = panel.getByLabel('Описание');
  await expect(title).toHaveValue(initial.title);
  await expect(description).toHaveValue(initial.description);

  await title.fill('Моя правка названия');
  await generate.click();
  const preview = panel.getByRole('region', { name: 'Черновик задания' });
  await expect(preview).toContainText(revised.title);
  await expect(title).toHaveValue('Моя правка названия');
  await expect(description).toHaveValue(initial.description);
  await preview.getByRole('button', { name: 'Перенести в задание' }).click();
  await expect(title).toHaveValue(revised.title);
  await expect(description).toHaveValue(revised.description);
  await expect(panel.getByLabel('Дата сдачи')).toHaveValue(date);
  await expect(panel.getByLabel('Время (МСК)')).toHaveValue('20:15');
  await expect(panel.getByLabel('Лимит списания, АР')).toHaveValue('40');
  await panel.getByRole('button', { name: 'Проверить назначение' }).click();
  await expect(panel.getByRole('button', { name: 'Подтвердить и назначить' })).toBeVisible();
  expect(generations).toBe(2);
  expect(publications).toBe(0);
});

test('помощник назначает задание лично, передаёт материалы и сдаёт работу с явным подтверждением', async ({ browser, request }) => {
  test.setTimeout(75_000);
  const teacher = await browser.newPage();
  const student = await browser.newPage({ viewport: { width: 320, height: 800 } });
  const otherStudent = await browser.newPage();
  const title = 'Реляционные связи · ' + Date.now();
  try {
    await Promise.all([login(teacher, 'teacher@bgtu.test'), login(student, 'student@bgtu.test'),
      login(otherStudent, 'student2@bgtu.test')]);
    const [teacherAccount, studentAccount] = await Promise.all([teacher, student].map(page =>
      page.request.get('/api/me').then(response => response.json())));
    await teacher.goto('/assignments');
    await teacher.getByRole('button', { name: 'Помощник', exact: true }).click();
    const teacherPanel = await command(teacher, 'Назначь задание Алексею Смирнову');
    await teacherPanel.getByRole('button', { name: /Алексей Смирнов/ }).click();
    await teacherPanel.getByLabel('Название задания').fill(title);
    await teacherPanel.getByLabel('Описание').fill('Опишите первичный и внешний ключи.');
    const date = new Date(Date.now() + 4 * 86400_000).toISOString().slice(0, 10);
    await teacherPanel.getByLabel('Дата сдачи').fill(date);
    await teacherPanel.getByLabel('Лимит списания, АР').fill('50');
    await teacherPanel.getByRole('button', { name: 'Проверить назначение' }).click();
    expect((await (await student.request.get('/api/student/assignments')).json())
      .some((item: { title: string }) => item.title === title)).toBe(false);
    const [publication] = await Promise.all([
      teacher.waitForResponse(response => response.url().endsWith('/api/assistant/assignments') && response.request().method() === 'POST'),
      teacherPanel.getByRole('button', { name: 'Подтвердить и назначить' }).click(),
    ]);
    expect(publication.status()).toBe(201);
    const { assignmentId, path } = await publication.json();
    await expect(teacherPanel.getByRole('link', { name: /Открыть задание/ })).toHaveAttribute('href', path);
    const published = (await (await teacher.request.get(`/api/teacher/assignments/${assignmentId}/works`)).json());
    expect(published).toEqual([expect.objectContaining({ studentId: studentAccount.id, status: 'OPEN' })]);
    expect((await (await otherStudent.request.get('/api/student/assignments')).json())
      .some((item: { id: number }) => item.id === assignmentId)).toBe(false);
    const publicProfile = await (await otherStudent.request.get(`/api/profiles/${studentAccount.id}`)).json();
    expect(publicProfile.personal.assignments.some((item: { id: number }) => item.id === assignmentId)).toBe(false);
    const authorView = await (await teacher.request.get(`/api/profiles/${studentAccount.id}`)).json();
    expect(authorView.personal.assignments.some((item: { id: number }) => item.id === assignmentId)).toBe(true);

    await teacherPanel.locator('input[type=file]').setInputFiles({
      name: 'Условия.txt', mimeType: 'text/plain', buffer: Buffer.from('Уточнение преподавателя'),
    });
    await command(teacher, 'Отправить файл Алексей Смирнов');
    await teacherPanel.getByRole('button', { name: /Алексей Смирнов/ }).click();
    await teacherPanel.getByRole('button', { name: new RegExp(title) }).click();
    await teacherPanel.getByRole('button', { name: 'Подтвердить и отправить' }).click();
    await expect(teacherPanel.getByRole('log')).toContainText('Файл прикреплён к заданию');
    await student.goto(path);
    await expect(student.getByText(/Елена Крылова · личное задание/)).toBeVisible();
    const materials = student.getByRole('region', { name: 'Материалы преподавателя' });
    await expect(materials).toContainText('Елена Крылова');
    await materials.getByRole('button', { name: 'Предпросмотр Условия.txt' }).click();
    await expect(student.getByRole('dialog', { name: 'Предпросмотр вложения' })).toContainText('Уточнение преподавателя');
    await student.keyboard.press('Escape');
    const [material] = await (await student.request.get(`/api/assignments/${assignmentId}/materials`)).json();
    expect((await otherStudent.request.get(`/api/assignment-materials/${material.id}/preview`)).status()).toBe(404);
    expect((await request.get(`/api/assignment-materials/${material.id}/download`)).status()).toBe(401);

    const payload = await student.evaluateHandle(() => {
      const data = new DataTransfer();
      data.items.add(new File(['Студент ответил из кабинета'], 'Решение.txt', { type: 'text/plain' }));
      return data;
    });
    await student.getByRole('button', { name: 'Помощник', exact: true }).dispatchEvent('drop', { dataTransfer: payload });
    await payload.dispose();
    const studentPanel = await command(student, 'Отправить файл Елене Крыловой');
    await studentPanel.getByRole('button', { name: /Елена Крылова/ }).click();
    await studentPanel.getByRole('button', { name: new RegExp(title) }).click();
    await expect(studentPanel).toContainText('Решение.txt');
    expect(await student.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    const wrongRecipient = await student.request.post('/api/assistant/transfers', {
      headers: await csrf(student.request),
      multipart: { recipientId: teacherAccount.id + 90000, assignmentId,
        file: { name: 'Проверка.txt', mimeType: 'text/plain', buffer: Buffer.from('Не должно уйти') } },
    });
    expect(wrongRecipient.status()).toBe(404);
    await studentPanel.getByRole('button', { name: 'Подтвердить и отправить' }).click();
    await expect(studentPanel.getByRole('log')).toContainText('сдана на проверку');
    const queue = await (await teacher.request.get('/api/teacher/dashboard')).json();
    expect(queue.pendingWorks).toContainEqual(expect.objectContaining({
      assignmentId, studentId: studentAccount.id, fileName: 'Решение.txt', previewAvailable: true,
    }));
  } finally {
    await Promise.all([teacher.close(), student.close(), otherStudent.close()]);
  }
});

test('повтор назначения идемпотентен, новая группа не наследует личное задание', async ({ browser }) => {
  test.setTimeout(65_000);
  const [teacher, first, second, admin] = await Promise.all(Array.from({ length: 4 }, () => browser.newPage()));
  try {
    await Promise.all([login(teacher, 'teacher@bgtu.test'), login(admin, 'admin@bgtu.test')]);
    const catalog = await (await first.request.get('/api/registration/catalog')).json();
    const group = catalog.groups.at(-1);
    const password = 'assistant-work-2026';
    const suffix = Date.now();
    const register = async (page: Page, index: number) => {
      const email = `assistant-${suffix}-${index}@bgtu.test`;
      const registered = await page.request.post('/api/registration', {
        headers: await csrf(page.request), data: { email, password, fullName: `Студент ${index}`, role: 'STUDENT',
          facultyId: group.facultyId, groupId: group.id },
      });
      expect(registered.status()).toBe(204);
      await verifyEmail(page.request, email);
      await login(page, email, password);
      const { id } = await (await page.request.get('/api/me')).json();
      expect((await admin.request.post(`/api/admin/groups/${group.id}/pending-students/${id}`, {
        headers: await csrf(admin.request),
      })).status()).toBe(204);
      return id;
    };
    const firstId = await register(first, 1);
    const command = {
      requestId: randomUUID(), recipientId: String(firstId), title: 'Личное задание ' + suffix,
      description: 'Проверить связи.', deadline: new Date(Date.now() + 86400_000).toISOString(), penaltyLimit: '50',
    };
    expect((await multipart(admin.request, '/api/assistant/assignments', command)).status()).toBe(403);
    const headers = await csrf(teacher.request);
    const file = { name: 'Задание.txt', mimeType: 'text/plain', buffer: Buffer.from('Проверьте связи.') };
    const send = () => teacher.request.post('/api/assistant/assignments', { headers, multipart: { ...command, file } });
    const [a, b] = await Promise.all([send(), send()]);
    expect(a.status()).toBe(201);
    expect(b.status()).toBe(201);
    const receipt = await a.json();
    expect(await b.json()).toEqual(receipt);
    const materials = await (await first.request.get(`/api/assignments/${receipt.assignmentId}/materials`)).json();
    expect(materials).toEqual([expect.objectContaining({ fileName: file.name })]);
    await register(second, 2);
    const works = await (await second.request.get('/api/student/assignments')).json();
    expect(works.some((item: { id: number }) => item.id === receipt.assignmentId)).toBe(false);
  } finally {
    await Promise.all([teacher.close(), first.close(), second.close(), admin.close()]);
  }
});
