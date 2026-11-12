import { expect, test, type Page } from '@playwright/test';

type Metric = 'AR' | 'BUA' | 'BOA';
type RankingEntry = { fullName: string; place: number | null; points: number };
type RankingResult = {
  viewer: RankingEntry | null;
  leaders: { student: RankingEntry; tiedStudents: number; displayStudents: RankingEntry[] }[];
};

const units = { AR: 'АР', BUA: 'БУА', BOA: 'БОА' };
const formatPoints = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format;

async function expectLeaderComparison(page: Page, ranking: RankingResult, metric: Metric) {
  const { viewer, leaders: [leader] } = ranking;
  if (!viewer || !leader) throw new Error('В тестовой выборке должны быть студент и лидер.');

  const personal = page.getByRole('region', { name: 'Ваш результат', exact: true });
  const comparison = page.getByRole('region', { name: 'Сравнение с лидерами', exact: true });
  if (viewer.place !== null) await expect(personal.getByText(`${formatPoints(viewer.place)}-е место`, { exact: true })).toBeVisible();
  await expect(personal).toContainText(formatPoints(viewer.points));

  const max = metric === 'AR' ? 1000 : leader.student.points;
  for (const [name, points] of [['Ваш результат', viewer.points], ['Первое место', leader.student.points]] as const) {
    const meter = comparison.getByRole('meter', { name, exact: true });
    await expect(meter).toBeVisible();
    await expect(meter).toHaveJSProperty('min', 0);
    await expect(meter).toHaveJSProperty('max', max);
    await expect(meter).toHaveJSProperty('value', points);
  }
  const difference = leader.student.points - viewer.points;
  if (difference > 0) await expect(comparison).toContainText(`Разница ${formatPoints(difference)} ${units[metric]}`);
  else if (leader.tiedStudents > 1) await expect(comparison).toContainText('Вы делите первое место');
}

test('студент сравнивает результат с лидерами, фильтрует рейтинг и открывает профиль участника', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 850 });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Студент', exact: true }).click();
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL('/profile');
  const ratingResponse = await page.request.get('/api/student/ranking?metric=AR');
  await expect(ratingResponse).toBeOK();
  const rating: RankingResult = await ratingResponse.json();
  const { viewer } = rating;
  if (!viewer?.place) throw new Error('Студент из демо-данных должен иметь место в рейтинге.');
  const scale = page.getByRole('meter', { name: 'Академический рейтинг' });
  await expect(scale).toBeVisible();
  await expect(scale).toHaveAttribute('min', '0');
  await expect(scale).toHaveAttribute('max', '1000');
  await expect(scale).toHaveAttribute('value', String(viewer.points));
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const placeLink = page.getByRole('link', { name: `${viewer.place.toLocaleString('ru-RU')}-е место в рейтинге`, exact: true });
  await expect(placeLink).toHaveAttribute('href', '/rating');
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  await page.getByRole('navigation', { name: 'Кабинет' }).getByRole('link', { name: 'Задания', exact: true }).click();
  await expect(page).toHaveURL('/assignments');
  await expect(scale).toHaveAttribute('value', String(viewer.points));
  const assignmentResponse = await page.request.get('/api/student/assignments');
  await expect(assignmentResponse).toBeOK();
  const assignments: { id: number; title: string; status: string }[] = await assignmentResponse.json();
  for (const [section, accepted] of [['Активные', false], ['Завершённые', true]] as const) {
    const expected = assignments.filter(item => (item.status === 'ACCEPTED') === accepted);
    const group = page.getByRole('region', { name: section, exact: true });
    await expect(group).toHaveCount(expected.length ? 1 : 0);
    if (expected.length) await expect(group.getByRole('link')).toHaveCount(expected.length);
    for (const item of expected) {
      await expect(group.getByRole('link', { name: item.title, exact: true })).toHaveAttribute('href', `/assignments/${item.id}`);
    }
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await placeLink.click();
  await expect(page).toHaveURL('/rating');
  await expect(page.getByLabel('Показатель')).toHaveValue('AR');
  await expectLeaderComparison(page, rating, 'AR');
  const podium = page.getByRole('list', { name: 'Первые три места' });
  await expect(podium.getByRole('listitem')).toHaveCount(3);
  for (const place of [1, 2, 3]) await expect(podium.getByText(`${place}-е место`)).toBeVisible();
  const firstPlace = podium.getByRole('listitem').first();
  const leader = rating.leaders[0];
  expect(leader.displayStudents).toHaveLength(Math.min(2, leader.tiedStudents));
  for (const peer of leader.displayStudents) await expect(firstPlace.getByText(peer.fullName, { exact: true })).toBeVisible();
  const table = page.getByRole('table', { name: 'Все участники' });
  await expect(table.getByRole('link', { name: 'Даниил Петров' })).toBeVisible();
  await page.getByLabel('Факультет или институт').selectOption({ label: 'Факультет информационных технологий (ФИТ)' });
  const group = page.getByLabel('Учебная группа');
  await group.selectOption({ label: 'ИВТ-25' });
  await expect(table.getByRole('link', { name: 'Даниил Петров' })).toBeVisible();
  await expect(table.getByRole('link', { name: 'Алексей Смирнов' })).toHaveCount(0);
  await expect(page.getByRole('meter')).toHaveCount(0);

  await group.selectOption({ label: 'ИВТ-24' });
  await expect(table.getByRole('link', { name: 'Даниил Петров' })).toHaveCount(0);
  await expect(table.getByRole('link', { name: 'Алексей Смирнов' })).toBeVisible();
  await expect(table.getByRole('link', { name: 'Мария Волкова' })).toBeVisible();

  for (const metric of ['BUA', 'BOA'] as const) {
    const [response] = await Promise.all([
      page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === '/api/student/ranking' && url.searchParams.get('metric') === metric;
      }),
      page.getByLabel('Показатель').selectOption(metric),
    ]);
    expect(response.ok()).toBe(true);
    await expectLeaderComparison(page, await response.json(), metric);
    await expect(table.getByRole('columnheader', { name: units[metric] })).toBeVisible();
    await expect(podium.getByRole('listitem').first()).toContainText(units[metric]);
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  await table.getByRole('link', { name: 'Мария Волкова' }).click();
  await expect(page.getByRole('heading', { name: 'Мария Волкова' })).toBeVisible();
  await expect(page.getByRole('link', { name: /-е место в рейтинге$/ })).toHaveCount(0);
  await page.goBack();
  await expect(page.getByLabel('Показатель')).toHaveValue('BOA');
  await expect(table.getByRole('link', { name: 'Даниил Петров' })).toHaveCount(0);
  await expect(table.getByRole('link', { name: 'Мария Волкова' })).toBeVisible();
});

test('API рейтинга требует студенческую сессию и использует текущие балансы профиля', async ({ browser, request }) => {
  expect((await request.get('/api/student/ranking')).status()).toBe(401);
  expect((await request.get('/api/student/ranking/summary')).status()).toBe(401);
  const teacher = await browser.newPage();
  const student = await browser.newPage();
  try {
    for (const [page, role, path] of [[teacher, 'Преподаватель', '/assignments'], [student, 'Студент', '/profile']] as const) {
      await page.goto('/login');
      await page.getByRole('button', { name: role, exact: true }).click();
      await page.getByRole('button', { name: 'Войти', exact: true }).click();
      await expect(page).toHaveURL(path);
    }
    expect((await teacher.request.get('/api/student/ranking')).status()).toBe(403);
    expect((await teacher.request.get('/api/student/ranking/summary')).status()).toBe(403);
    const account = await (await student.request.get('/api/me')).json();
    const profilePath = `/api/profiles/${account.id}`;
    const profile = await (await student.request.get(profilePath)).json();
    const summary = await student.request.get('/api/student/ranking/summary');
    await expect(summary).toBeOK();
    expect(await summary.json()).toEqual({ rating: profile.student.rating, arPlace: profile.student.arPlace });
    const teacherProfileResponse = await teacher.request.get(profilePath);
    await expect(teacherProfileResponse).toBeOK();
    expect((await teacherProfileResponse.json()).student.arPlace).toBeNull();
    for (const [metric, profileField] of [['AR', 'rating'], ['BUA', 'academicActivityPoints'], ['BOA', 'publicActivityPoints']]) {
      const response = await student.request.get(`/api/student/ranking?metric=${metric}`);
      expect(response.status()).toBe(200);
      const ranking = await response.json();
      expect(ranking.viewer).toMatchObject({ studentId: account.id, points: profile.student[profileField] });
      if (metric === 'AR') {
        expect(ranking.viewer.place).toBeGreaterThan(0);
        expect(profile.student.arPlace).toBe(ranking.viewer.place);
        const otherStudent = ranking.entries.find((entry: { studentId: number }) => entry.studentId !== account.id);
        const otherProfileResponse = await student.request.get(`/api/profiles/${otherStudent.studentId}`);
        await expect(otherProfileResponse).toBeOK();
        expect((await otherProfileResponse.json()).student.arPlace).toBeNull();
      }
      const points: number[] = ranking.entries.map((entry: { points: number }) => entry.points);
      expect(points).toEqual([...points].sort((a, b) => b - a));
      const equalPlaceEntries = ranking.entries.filter((entry: { points: number }) => entry.points === points[0]);
      expect(new Set(equalPlaceEntries.map((entry: { place: number | null }) => entry.place)).size).toBe(1);
      expect(ranking.viewer.email).toBeUndefined();
    }
  } finally {
    await teacher.close();
    await student.close();
  }
});
