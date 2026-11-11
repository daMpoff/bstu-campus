import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

async function headers(request: APIRequestContext) {
  const { headerName, token } = await (await request.get('/api/csrf')).json();
  return { [headerName]: token };
}

async function login(page: Page, account: string) {
  const response = await page.request.post('/api/login', {
    headers: await headers(page.request), form: { email: `${account}@bgtu.test`, password: 'demo2026' },
  });
  expect(response.status()).toBe(204);
}

type FeedEntry = { id: number; eventType: string; details: string; occurredAt: string };

test('лента доставляет события нужной роли и группе в порядке от новых к старым', async ({ browser }) => {
  test.setTimeout(60_000);
  const teacher = await browser.newPage();
  const student = await browser.newPage({ viewport: { width: 320, height: 800 }, colorScheme: 'dark' });
  const outsider = await browser.newPage();
  const suffix = String(Date.now());
  const task = `Отчёт ${suffix}`;
  const activity = `Практика ${suffix}`;
  const poll = `Опрос ${suffix}`;
  try {
    expect((await outsider.request.get('/api/feed')).status()).toBe(401);
    await Promise.all([login(teacher, 'teacher'), login(student, 'student3'), login(outsider, 'student')]);
    const groups = await (await teacher.request.get('/api/teacher/groups')).json() as { id: number; name: string }[];
    const groupIds = [groups.find(group => group.name === 'ИВТ-25')!.id];
    const teacherHeaders = await headers(teacher.request);
    const studentHeaders = await headers(student.request);
    const studentId = (await (await student.request.get('/api/me')).json()).id;
    async function create(path: string, data: object) {
      const response = await teacher.request.post(`/api/teacher/${path}`, { headers: teacherHeaders, data });
      expect(response.status()).toBe(201);
      return (await response.json()).id as number;
    }
    async function entries(page: Page) {
      const response = await page.request.get('/api/feed');
      expect(response.status()).toBe(200);
      return (await response.json()).entries as FeedEntry[];
    }

    const assignment = await create('assignments', { title: task, description: 'Сдайте отчёт.', groupIds,
      deadline: new Date(Date.now() + 20 * 60_000).toISOString(), penaltyLimit: 0 });
    const practice = await create('activities', { title: activity, description: 'Работа в группе.', groupIds,
      occursAt: new Date(Date.now() + 3000).toISOString(), maxPoints: 40, kind: 'ACADEMIC' });
    await create('polls', { title: poll, description: 'Выбор дня.', groupIds, anonymous: true,
      endsAt: new Date(Date.now() + 3000).toISOString(),
      questions: [{ text: 'Какой день?', choiceType: 'SINGLE', options: ['Среда', 'Пятница'] }] });
    await expect.poll(async () => (await entries(student)).filter(entry => entry.details.includes(suffix))
      .map(entry => entry.eventType), { timeout: 12_000 })
      .toEqual(expect.arrayContaining(['ASSIGNMENT_CREATED', 'ASSIGNMENT_DUE', 'ACTIVITY_CREATED', 'POLL_CREATED']));

    const submit = () => student.request.post(`/api/student/assignments/${assignment}/submit`, {
      headers: studentHeaders, multipart: { link: 'https://example.org/report' },
    });
    const review = (action: string) => teacher.request.post(`/api/teacher/assignments/${assignment}/review`, {
      headers: teacherHeaders, data: { studentIds: [studentId], action },
    });
    expect((await submit()).status()).toBe(204);
    expect((await review('RETURNED')).status()).toBe(204);
    expect((await submit()).status()).toBe(204);
    expect((await review('ACCEPTED')).status()).toBe(204);
    await expect.poll(async () => {
      const detail = await teacher.request.get(`/api/teacher/activities/${practice}`);
      expect(detail.ok()).toBeTruthy();
      return (await detail.json()).canConfirm;
    }, { timeout: 12_000 }).toBe(true);
    const confirm = await teacher.request.post(`/api/teacher/activities/${practice}/confirm`, {
      headers: teacherHeaders, data: { studentId, participation: 75 },
    });
    expect(confirm.status()).toBe(204);

    const personal = (await entries(student)).filter(entry => entry.details.includes(suffix));
    expect(personal.map(entry => entry.eventType)).toEqual(expect.arrayContaining(['WORK_ACCEPTED', 'WORK_RETURNED', 'ACTIVITY_AWARDED']));
    expect(personal.filter(entry => entry.eventType === 'ASSIGNMENT_DUE')).toHaveLength(1);
    const timestamps = personal.map(entry => Date.parse(entry.occurredAt));
    expect(timestamps).toEqual([...timestamps].sort((left, right) => right - left));
    await expect.poll(async () => (await entries(teacher)).filter(entry => entry.details === poll)
      .map(entry => entry.eventType), { timeout: 12_000 }).toEqual(['POLL_ENDED']);
    const submissions = (await entries(teacher)).filter(entry => entry.details.includes(task) && entry.eventType === 'WORK_SUBMITTED');
    expect(submissions).toHaveLength(2);
    expect((await entries(outsider)).filter(entry => entry.details.includes(suffix))).toEqual([]);
    const foreignCursor = await outsider.request.get(`/api/feed?beforeId=${personal[0].id}`);
    expect(await foreignCursor.json()).toMatchObject({ entries: [] });

    await student.goto('/feed');
    await expect(student.getByRole('heading', { name: 'Персональная лента' })).toBeVisible();
    const awarded = student.getByRole('listitem').filter({ hasText: activity }).filter({ hasText: '+30 БУА' });
    await expect(awarded.getByRole('link', { name: 'Начислены баллы активности' })).toHaveAttribute('href', '/profile');
    await expect(awarded.locator('time')).toContainText('МСК');
    expect(await student.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  } finally {
    await Promise.all([teacher.close(), student.close(), outsider.close()]);
  }
});
