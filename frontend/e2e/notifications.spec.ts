import { expect, test, type APIRequestContext } from '@playwright/test';
import { csrf, mailFor, mailText } from './helpers/confirmation';

async function login(context: APIRequestContext, email: string) {
  expect((await context.post('/api/login', {
    headers: await csrf(context), form: { email, password: 'demo2026' },
  })).status()).toBe(204);
}

async function waitForMail(email: string, subject: string, title: string, path: string) {
  await expect.poll(async () => {
    const matches = (await mailFor(email)).filter(message => message.Subject === `${subject} · БГТУ`);
    const bodies = await Promise.all(matches.map(message => mailText(message.ID)));
    return bodies.filter(body => body.includes(title) && body.includes(path)).length;
  }, { timeout: 20_000 }).toBe(1);
}

test('студент получает четыре email-уведомления по событиям своей группы', async ({ playwright }, info) => {
  test.setTimeout(75_000);
  const teacher = await playwright.request.newContext({ baseURL: info.project.use.baseURL });
  const student = await playwright.request.newContext({ baseURL: info.project.use.baseURL });
  const email = 'student3@bgtu.test';
  try {
    await Promise.all([login(teacher, 'teacher@bgtu.test'), login(student, email)]);
    const teacherHeaders = await csrf(teacher);
    const studentHeaders = await csrf(student);
    const groups = await (await teacher.get('/api/teacher/groups')).json() as { id: number; name: string }[];
    const group = groups.find(item => item.name === 'ИВТ-25')!;
    const { id: studentId } = await (await student.get('/api/me')).json();
    const suffix = Date.now();
    const taskTitle = `Сдача для почтовой проверки ${suffix}`;
    const activityTitle = `Семинар для почтовой проверки ${suffix}`;
    const assignment = await teacher.post('/api/teacher/assignments', {
      headers: teacherHeaders,
      data: { title: taskTitle, description: 'Сдача по ссылке.', groupIds: [group.id], penaltyLimit: 20,
        deadline: new Date(Date.now() + 3600_000).toISOString() },
    });
    expect(assignment.status()).toBe(201);
    const { id: assignmentId } = await assignment.json();
    const assignmentPath = `/assignments/${assignmentId}`;
    await waitForMail(email, 'Скоро дедлайн', taskTitle, assignmentPath);

    expect((await student.post(`/api/student${assignmentPath}/submit`, {
      headers: studentHeaders, multipart: { link: 'https://example.org/work' },
    })).status()).toBe(204);
    expect((await teacher.post(`/api/teacher${assignmentPath}/review`, {
      headers: teacherHeaders, data: { studentIds: [studentId], action: 'ACCEPTED' },
    })).status()).toBe(204);
    const activity = await teacher.post('/api/teacher/activities', {
      headers: teacherHeaders,
      data: { title: activityTitle, description: 'Учебная активность.', groupIds: [group.id], maxPoints: 20,
        kind: 'ACADEMIC', occursAt: new Date(Date.now() + 5000).toISOString() },
    });
    expect(activity.status()).toBe(201);
    const { id: activityId } = await activity.json();
    await Promise.all([
      waitForMail(email, 'Работа принята', taskTitle, assignmentPath),
      waitForMail(email, 'Новая активность', activityTitle, '/activities'),
    ]);
    await expect.poll(async () => {
      const detail = await (await teacher.get(`/api/teacher/activities/${activityId}`)).json();
      return detail.canConfirm;
    }, { timeout: 12_000 }).toBe(true);
    expect((await teacher.post(`/api/teacher/activities/${activityId}/confirm`, {
      headers: teacherHeaders, data: { studentId, participation: 50 },
    })).status()).toBe(204);
    await waitForMail(email, 'Начислены баллы активности', activityTitle, '/profile');
  } finally {
    await Promise.all([teacher.dispose(), student.dispose()]);
  }
});
