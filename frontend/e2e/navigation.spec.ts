import { expect, test, type Locator, type Page } from '@playwright/test';

async function navigate(page: Page, start: string, steps: (() => Locator)[], target: () => Locator) {
  expect(steps.length).toBeLessThanOrEqual(3);
  await page.goto(start);
  for (const step of steps) await step().click();
  await expect(target()).toBeVisible();
}

async function login(page: Page, role: string, landing: string) {
  await page.goto('/login');
  await page.getByRole('button', { name: role, exact: true }).click();
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(landing);
}

test('аккаунт, тема и выход доступны в боковом меню, а ФИО остаётся в карточке профиля', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1440, height: 880 });
  await login(page, 'Преподаватель', '/assignments');

  const sidebar = page.locator('[data-cabinet-sidebar]');
  const main = page.getByRole('main');
  const avatar = sidebar.locator('[data-cabinet-avatar]');
  const darkTheme = sidebar.getByRole('button', { name: 'Тёмная тема', exact: true });
  const lightTheme = sidebar.getByRole('button', { name: 'Светлая тема', exact: true });
  const logout = sidebar.getByRole('button', { name: 'Выйти', exact: true });
  await expect(sidebar.getByText('Елена Крылова', { exact: true })).toBeVisible();
  await expect(sidebar.locator('[data-cabinet-account]').getByText('Преподаватель', { exact: true })).toHaveCount(0);
  await expect(avatar).toBeVisible();
  const centers = await Promise.all([avatar, darkTheme, logout].map(control => control.evaluate(element => {
    const { top, height } = element.getBoundingClientRect();
    return top + height / 2;
  })));
  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(2);
  await expect(main.getByRole('heading', { name: 'Задания', exact: true, level: 1 })).toBeVisible();
  await expect(main).toHaveCSS('padding-top', '24px');
  await expect(main.getByText('Елена Крылова', { exact: true })).toHaveCount(0);
  await expect(main.getByRole('button', { name: /^(Светлая|Тёмная) тема$/ })).toHaveCount(0);
  await darkTheme.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(lightTheme).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.setViewportSize({ width: 375, height: 850 });
  const menuButton = page.getByRole('button', { name: 'Меню', exact: true });
  const drawer = page.getByRole('dialog', { name: 'Меню кабинета', exact: true });
  const mobileNav = drawer.getByRole('navigation', { name: 'Кабинет', exact: true });
  const mobileLogout = drawer.getByRole('button', { name: 'Выйти', exact: true });
  await expect(sidebar).toBeHidden();
  await expect(drawer).toBeHidden();
  await menuButton.click();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('Елена Крылова', { exact: true })).toBeVisible();
  await expect(mobileNav.getByRole('link', { name: 'Задания', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(mobileNav.getByRole('link', { name: 'Профиль', exact: true })).toHaveCount(0);
  await mobileNav.getByRole('link', { name: 'Проверка работ', exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL('/review');
  await page.getByRole('region', { name: 'На проверке', exact: true }).getByRole('button')
    .filter({ hasText: 'Алексей Смирнов' }).filter({ hasText: 'Лабораторная работа № 2. Запросы к базе данных' }).click();
  await expect(page.getByRole('region', { name: 'Выбранная работа', exact: true })
    .getByRole('button', { name: 'Принять', exact: true })).toBeVisible();
  await menuButton.click();
  await mobileNav.getByRole('link', { name: 'Настройки профиля', exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(main.getByRole('heading', { name: 'Настройки профиля', exact: true })).toBeVisible();
  await expect(main).toHaveCSS('padding-top', '16px');
  await menuButton.click();
  await mobileLogout.click();
  await expect(page).toHaveURL('/');

  await page.setViewportSize({ width: 320, height: 850 });
  await login(page, 'Студент', '/profile');
  await expect(main.getByRole('region', { name: 'Алексей Смирнов', exact: true })
    .getByRole('heading', { name: 'Алексей Смирнов', exact: true })).toBeVisible();
  await expect(main).toHaveCSS('padding-top', '16px');
  await expect(main.getByRole('button', { name: /^(Светлая|Тёмная) тема$/ })).toHaveCount(0);
  await menuButton.click();
  await expect(drawer.getByText('Алексей Смирнов', { exact: true })).toBeVisible();
  await expect(drawer.getByText('ИВТ-24', { exact: true })).toBeVisible();
  await expect(drawer.getByText(/Студент/)).toHaveCount(0);
  await expect(mobileNav.getByRole('link', { name: 'Профиль', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(mobileNav.getByRole('link', { name: 'Проверка работ', exact: true })).toHaveCount(0);
  await expect(mobileLogout).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await drawer.getByRole('button', { name: 'Светлая тема', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await drawer.getByRole('button', { name: 'Закрыть меню', exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(menuButton).toBeFocused();

  await menuButton.press('Enter');
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(menuButton).toBeFocused();

  await menuButton.click();
  await expect(drawer).toBeVisible();
  await page.mouse.click(318, 400);
  await expect(drawer).toBeHidden();

  await menuButton.click();
  await expect(drawer).toBeVisible();
  await page.setViewportSize({ width: 860, height: 850 });
  await expect(drawer).toBeHidden();
  await expect(menuButton).toBeHidden();
  await expect(sidebar).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 880 });
  await expect(main).toHaveCSS('padding-top', '24px');
  await sidebar.getByRole('link', { name: 'Настройки профиля', exact: true }).click();
  await expect(main.getByRole('heading', { name: 'Настройки профиля', exact: true })).toBeVisible();
  await expect(main).toHaveCSS('padding-top', '24px');
});

test('гость и студент доходят до целевых разделов кабинета максимум за три перехода', async ({ page }) => {
  test.setTimeout(60_000);
  const link = (name: string) => () => page.getByRole('link', { name, exact: true });
  const button = (name: string) => () => page.getByRole('button', { name, exact: true });
  const menu = (name: string) => () => page.getByRole('navigation', { name: 'Кабинет' }).getByRole('link', { name, exact: true });
  const heading = (name: string) => () => page.getByRole('heading', { name, exact: true });
  await navigate(page, '/', [() => page.getByRole('banner').getByRole('link', { name: 'Войти' }),
    link('Зарегистрироваться')], heading('Регистрация'));
  await login(page, 'Студент', '/profile');
  await navigate(page, '/profile', [], () => page.getByRole('region', { name: 'История баллов' }));
  await navigate(page, '/profile', [
    () => page.getByRole('region', { name: 'Сдача работ' }).getByRole('link', { name: 'Открыть задание' }),
  ], button('Сдать работу'));
  await navigate(page, '/profile', [menu('Задания'),
    () => page.getByRole('link', { name: /Практическая работа № 3. Индексы и EXPLAIN/ })], button('Сдать работу'));
  await navigate(page, '/profile', [
    () => page.getByRole('region', { name: 'Ближайшие события' }).getByRole('link', { name: /Тема следующей консультации/ }),
  ], button('Ответить'));
  await navigate(page, '/profile', [menu('Активности')], heading('Активности'));
  await navigate(page, '/profile', [menu('Мои события')], heading('Персональная лента'));
  await navigate(page, '/profile', [menu('Лента наград')], heading('Лента наград'));
  await navigate(page, '/profile', [menu('Рейтинг')], heading('Рейтинг студентов'));
  await navigate(page, '/profile', [menu('Настройки профиля')], heading('Уведомления в Telegram'));
  await navigate(page, '/profile', [button('Помощник')], () => page.getByLabel('Сообщение помощнику'));
});

test('преподаватель и администратор доходят до действий максимум за три перехода', async ({ page }) => {
  test.setTimeout(70_000);
  const link = (name: string) => () => page.getByRole('link', { name, exact: true });
  const button = (name: string) => () => page.getByRole('button', { name, exact: true });
  const menu = (name: string) => () => page.getByRole('navigation', { name: 'Кабинет' }).getByRole('link', { name, exact: true });
  const heading = (name: string) => () => page.getByRole('heading', { name, exact: true });
  await login(page, 'Преподаватель', '/assignments');
  await navigate(page, '/assignments', [link('Новое задание')], button('Назначить задание'));
  const reviewDetails = page.getByRole('region', { name: 'Выбранная работа', exact: true });
  const reviewChoice = page.getByRole('region', { name: 'На проверке', exact: true }).getByRole('button')
    .filter({ hasText: 'Алексей Смирнов' }).filter({ hasText: 'Лабораторная работа № 2. Запросы к базе данных' });
  await navigate(page, '/assignments', [menu('Проверка работ'), () => reviewChoice], () => reviewDetails.locator('pre'));
  await expect(reviewChoice).toHaveAttribute('aria-pressed', 'true');
  await expect(reviewDetails).toContainText('Запросы к каталогу.txt');
  await expect(reviewDetails.getByRole('button', { name: 'Принять', exact: true })).toBeVisible();
  await navigate(page, '/assignments', [() => page.getByRole('region', { name: 'Задания', exact: true })
    .getByRole('link', { name: 'Лабораторная работа № 2. Запросы к базе данных', exact: true })],
    button('Принять выбранные'));
  await navigate(page, '/assignments', [menu('Активности'), link('Новая активность')], button('Создать активность'));
  await navigate(page, '/assignments', [menu('Активности'), link('Разбор SQL-запросов')], heading('Участники'));
  await navigate(page, '/assignments', [menu('Опросы'), link('Новый опрос')], button('Создать опрос'));
  await navigate(page, '/assignments', [menu('Опросы'), link('Тема следующей консультации по базам данных')],
    heading('Результаты опроса'));
  await navigate(page, '/assignments', [menu('Рейтинг студентов')], heading('Рейтинг студентов'));
  await navigate(page, '/assignments', [menu('Рейтинг студентов'), link('Алексей Смирнов')], heading('Алексей Смирнов'));
  await navigate(page, '/assignments', [menu('Аналитика')], heading('Аналитика группы'));
  await navigate(page, '/assignments', [menu('Подтверждение группы')], heading('Подтверждение группы'));
  await navigate(page, '/assignments', [menu('Мои события')], heading('Персональная лента'));
  await navigate(page, '/assignments', [menu('Лента наград')], heading('Лента наград'));
  await navigate(page, '/assignments', [button('Помощник'), button('Назначить задание')],
    () => page.getByLabel('Кому отправить?'));
  await page.keyboard.press('Escape');
  await button('Выйти')().click();
  await expect(page).toHaveURL('/');
  await login(page, 'Администратор', '/admin');
  await navigate(page, '/admin', [button('Добавить запись')], heading('Новая запись'));
  await navigate(page, '/admin', [button('Импорт CSV')], button('Импортировать'));
  await navigate(page, '/admin', [button('Настройки')], button('Сохранить настройки'));
  await navigate(page, '/admin?tab=settings', [], button('Сохранить настройки'));
  await navigate(page, '/admin', [menu('Подтверждение группы')], heading('Подтверждение группы'));
  await navigate(page, '/admin', [menu('Лента наград')], heading('Лента наград'));
});
