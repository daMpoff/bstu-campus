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

test('анонимный опрос поддерживает оба типа вопросов и показывает итоги только после ответа', async ({ browser }) => {
  const teacher = await browser.newPage();
  const student = await browser.newPage();
  const outsider = await browser.newPage();
  const title = `Формат занятий ${Date.now()}`;
  try {
    await Promise.all([login(teacher, 'teacher'), login(student, 'student'), login(outsider, 'student3')]);
    await teacher.goto('/polls');
    await teacher.getByRole('link', { name: 'Новый опрос' }).click();
    await teacher.getByLabel('Название').fill(title);
    await teacher.getByLabel('Описание').fill('Выбор формата и тем следующего занятия.');
    await teacher.getByRole('checkbox', { name: 'ИВТ-24', exact: true }).check();
    await teacher.getByLabel('Дата окончания').fill(new Date(Date.now() + 48 * 60 * 60_000).toISOString().slice(0, 10));
    await teacher.getByLabel('Анонимный опрос').check();
    const first = teacher.getByRole('group', { name: 'Вопрос 1', exact: true });
    await first.getByLabel('Текст вопроса').fill('Какой формат удобнее?');
    await first.getByLabel('Вариант 1', { exact: true }).fill('Очный');
    await first.getByLabel('Вариант 2', { exact: true }).fill('Онлайн');
    await teacher.getByRole('button', { name: 'Добавить вопрос' }).click();
    const second = teacher.getByRole('group', { name: 'Вопрос 2', exact: true });
    await second.getByLabel('Текст вопроса').fill('Какие темы обсудим?');
    await second.getByLabel('Тип ответа').selectOption('MULTIPLE');
    await second.getByLabel('Вариант 1', { exact: true }).fill('Академический рейтинг');
    await second.getByLabel('Вариант 2', { exact: true }).fill('Активности группы');
    await second.getByRole('button', { name: 'Добавить вариант' }).click();
    await second.getByLabel('Вариант 3', { exact: true }).fill('Обратная связь');
    await teacher.getByRole('button', { name: 'Создать опрос' }).click();
    await expect(teacher.getByRole('heading', { name: title })).toBeVisible();
    const path = new URL(teacher.url()).pathname;
    await student.goto('/polls');
    await student.getByRole('link', { name: title }).click();
    await expect(student.getByRole('heading', { name: title })).toBeVisible();
    await expect(student.getByRole('region', { name: 'Результаты опроса' })).toHaveCount(0);
    expect((await outsider.request.get(`/api/student${path}`)).status()).toBe(404);
    expect((await student.request.get(`/api/teacher${path}`)).status()).toBe(403);
    const initial = await (await student.request.get(`/api/student${path}`)).json();
    expect(initial).toMatchObject({ poll: { responseCount: null, voted: false }, results: null });
    const [firstQuestion, secondQuestion] = initial.questions;
    const forged = await student.request.post(`/api/student${path}/vote`, {
      headers: await headers(student.request), data: { answers: [
        { questionId: firstQuestion.id, optionIds: [firstQuestion.options[0].id, firstQuestion.options[1].id] },
        { questionId: secondQuestion.id, optionIds: [secondQuestion.options[0].id] },
      ] },
    });
    expect(forged.status()).toBe(400);

    await student.getByRole('radio', { name: 'Очный' }).check();
    await student.getByRole('checkbox', { name: 'Академический рейтинг' }).check();
    await student.getByRole('checkbox', { name: 'Активности группы' }).check();
    await expect(student.getByRole('status').filter({ hasText: 'Ответов 2 из 2' })).toBeVisible();
    await student.getByRole('button', { name: 'Ответить', exact: true }).click();
    const results = student.getByRole('region', { name: 'Результаты опроса' });
    await expect(results.getByText('Участников 1')).toBeVisible();
    await expect(results.getByRole('listitem').filter({ hasText: 'Очный' })).toContainText('100%');
    await expect(results.getByRole('listitem').filter({ hasText: 'Активности группы' })).toContainText('100%');
    const teacherDetail = await (await teacher.request.get(`/api/teacher${path}`)).json();
    expect(teacherDetail).toMatchObject({ poll: { responseCount: 1, anonymous: true }, results: { respondents: null } });
    const repeat = await student.request.post(`/api/student${path}/vote`, {
      headers: await headers(student.request), data: { answers: [] },
    });
    expect(repeat.status()).toBe(409);
    await student.setViewportSize({ width: 320, height: 800 });
    expect(await student.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  } finally {
    await Promise.all([teacher.close(), student.close(), outsider.close()]);
  }
});

test('в именном опросе видны ответы по участникам, повторные и просроченные голоса отклоняются', async ({ browser }) => {
  const teacher = await browser.newPage();
  const student = await browser.newPage();
  try {
    await Promise.all([login(teacher, 'teacher'), login(student, 'student2')]);
    const groups = await (await teacher.request.get('/api/teacher/groups')).json() as { id: number; name: string }[];
    const group = groups.find(item => item.name === 'ИВТ-24')!;
    const teacherHeaders = await headers(teacher.request);
    const studentHeaders = await headers(student.request);
    const create = async (endsAt: string) => {
      const response = await teacher.request.post('/api/teacher/polls', { headers: teacherHeaders, data: {
        title: `Расписание консультаций ${Date.now()}`, description: 'Выбор дня.', endsAt, anonymous: false,
        groupIds: [group.id], questions: [{ text: 'Какой день?', choiceType: 'SINGLE', options: ['Понедельник', 'Среда'] }],
      } });
      expect(response.status()).toBe(201);
      return (await response.json()).id as number;
    };
    const open = await create(new Date(Date.now() + 60 * 60_000).toISOString());
    const read = async (id: number) => (await student.request.get(`/api/student/polls/${id}`)).json();
    const answer = async (id: number) => {
      const question = (await read(id)).questions[0];
      return { answers: [{ questionId: question.id, optionIds: [question.options[0].id] }] };
    };
    const valid = await answer(open);
    const submit = (id: number, data: unknown) => student.request.post(`/api/student/polls/${id}/vote`, { headers: studentHeaders, data });
    const votes = await Promise.all([submit(open, valid), submit(open, valid)]);
    expect(votes.map(vote => vote.status()).sort()).toEqual([204, 409]);
    const named = await (await teacher.request.get(`/api/teacher/polls/${open}`)).json();
    expect(named).toMatchObject({ poll: { responseCount: 1 }, results: { respondents: [
      { studentName: 'Мария Волкова', optionIds: valid.answers[0].optionIds },
    ] } });
    expect(await read(open)).toMatchObject({ results: { respondents: null } });

    const closing = await create(new Date(Date.now() + 2500).toISOString());
    const late = await answer(closing);
    await expect.poll(async () => (await read(closing)).poll.closed).toBe(true);
    expect((await submit(closing, late)).status()).toBe(409);
    expect(await read(closing)).toMatchObject({ poll: { voted: false }, results: null });
  } finally {
    await Promise.all([teacher.close(), student.close()]);
  }
});
