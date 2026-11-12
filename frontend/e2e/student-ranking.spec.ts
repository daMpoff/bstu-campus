import { expect, test } from '@playwright/test';

test('студент видит пьедестал, фильтрует рейтинг и открывает профиль участника', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 850 });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Студент', exact: true }).click();
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL('/profile');
  const ratingResponse = await page.request.get('/api/student/ranking?metric=AR');
  await expect(ratingResponse).toBeOK();
  const { viewer } = await ratingResponse.json();
  expect(viewer.place).toBeGreaterThan(0);
  const scale = page.getByRole('meter', { name: 'Академический рейтинг' });
  await expect(scale).toBeVisible();
  await expect(scale).toHaveAttribute('min', '0');
  await expect(scale).toHaveAttribute('max', '1000');
  await expect(scale).toHaveAttribute('value', String(viewer.points));
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const placeLink = page.getByRole('link', { name: `${viewer.place.toLocaleString('ru-RU')}-е место в рейтинге`, exact: true });
  await expect(placeLink).toHaveAttribute('href', '/rating');
  await placeLink.click();
  await expect(page).toHaveURL('/rating');
  await expect(page.getByLabel('Показатель')).toHaveValue('AR');
  const podium = page.getByRole('list', { name: 'Первые три места' });
  await expect(podium.getByRole('listitem')).toHaveCount(3);
  for (const place of [1, 2, 3]) await expect(podium.getByText(`${place}-е место`)).toBeVisible();
  const table = page.getByRole('table', { name: 'Все участники' });
  await expect(table.getByRole('link', { name: 'Даниил Петров' })).toBeVisible();
  await page.getByLabel('Факультет или институт').selectOption({ label: 'Факультет информационных технологий (ФИТ)' });
  await page.getByLabel('Учебная группа').selectOption({ label: 'ИВТ-24' });
  await expect(table.getByRole('link', { name: 'Даниил Петров' })).toHaveCount(0);
  await expect(table.getByRole('link', { name: 'Алексей Смирнов' })).toBeVisible();
  await expect(table.getByRole('link', { name: 'Мария Волкова' })).toBeVisible();

  await page.getByLabel('Показатель').selectOption('BUA');
  await expect(table.getByRole('columnheader', { name: 'БУА' })).toBeVisible();
  await expect(podium.getByRole('listitem').first()).toContainText('БУА');
  await page.getByLabel('Показатель').selectOption('BOA');
  await expect(table.getByRole('columnheader', { name: 'БОА' })).toBeVisible();
  await expect(podium.getByRole('listitem').first()).toContainText('БОА');
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
    const account = await (await student.request.get('/api/me')).json();
    const profilePath = `/api/profiles/${account.id}`;
    const profile = await (await student.request.get(profilePath)).json();
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
