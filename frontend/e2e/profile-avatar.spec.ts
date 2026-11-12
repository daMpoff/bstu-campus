import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Locator } from '@playwright/test';
import { csrf, verifyEmail } from './helpers/confirmation';

const password = 'profile-avatar-2026';
const name = 'Анна Тестовая';
const initials = 'АТ';
const png = [
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAUElEQVR42u3PQQkAAAgEsMtkJ7NZ0wi+hcEKLF3zWgQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQErsACKezhHkDKAsAAAAAASUVORK5CYII=',
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAUElEQVR42u3PQQkAAAgEsMtiOUNZ1gi+hcEKLDX9WgQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQErsACrbNBD1NPyjEAAAAASUVORK5CYII=',
];

async function login(request: APIRequestContext, email: string, password: string) {
  const response = await request.post('/api/login', {
    headers: await csrf(request), form: { email, password },
  });
  expect(response.status()).toBe(204);
}

async function registerStudent(request: APIRequestContext) {
  const response = await request.get('/api/registration/catalog');
  await expect(response).toBeOK();
  const { groups } = await response.json() as { groups: { id: number; facultyId: number | null }[] };
  const group = groups.find(({ facultyId }) => facultyId != null)!;
  const email = `avatar-${randomUUID()}@bgtu.test`;
  const registration = await request.post('/api/registration', {
    headers: await csrf(request),
    data: { email, password, fullName: name, role: 'STUDENT', facultyId: group.facultyId, groupId: group.id },
  });
  expect(registration.status()).toBe(204);
  await verifyEmail(request, email);
  await login(request, email, password);
  const account = await request.get('/api/me');
  await expect(account).toBeOK();
  return (await account.json() as { id: number }).id;
}

async function expectLoadedAvatar(avatar: Locator, url: string | RegExp) {
  const image = avatar.locator('img');
  await expect(image).toHaveAttribute('src', url);
  await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  return (await image.getAttribute('src'))!;
}

test('фото сохраняется, заменяется и удаляется в карточке и боковом меню', async ({ page, browser, request }) => {
  const studentId = await registerStudent(page.request);
  await page.goto('/profile');
  const menu = page.getByRole('navigation', { name: 'Кабинет' });
  const sidebar = page.locator('[data-cabinet-sidebar] [data-cabinet-avatar]');
  const profile = page.locator('[data-cabinet-header] [data-cabinet-avatar]');
  const settings = page.getByRole('region', { name: 'Фото профиля', exact: true });
  const input = settings.getByLabel('Выбрать фото');
  const save = settings.getByRole('button', { name: 'Сохранить фото', exact: true });
  const remove = settings.getByRole('button', { name: 'Удалить фото', exact: true });
  const profileLink = menu.getByRole('link', { name: 'Профиль', exact: true });
  const settingsLink = menu.getByRole('link', { name: 'Настройки профиля', exact: true });
  const avatarUrl = new RegExp(`^/api/avatars/${studentId}\\?v=`);
  const selectPhoto = (index: number) => input.setInputFiles({
    name: `avatar-${index}.png`, mimeType: 'image/png', buffer: Buffer.from(png[index], 'base64'),
  });

  await expect(profile).toHaveText(initials);
  await expect(sidebar).toHaveText(initials);
  await settingsLink.click();
  let cleanup = true;
  try {
    await selectPhoto(0);
    await expect(sidebar).toHaveText(initials);
    await save.click();
    const first = await expectLoadedAvatar(sidebar, avatarUrl);
    const firstPhoto = await page.request.get(first);
    await expect(firstPhoto).toBeOK();
    await profileLink.click();
    await expectLoadedAvatar(profile, first);
    await page.reload();
    await expectLoadedAvatar(sidebar, first);
    await expectLoadedAvatar(profile, first);

    await settingsLink.click();
    await selectPhoto(1);
    await save.click();
    await expect(sidebar.locator('img')).not.toHaveAttribute('src', first);
    const second = await expectLoadedAvatar(sidebar, avatarUrl);
    const rejected = await page.request.put('/api/me/avatar', {
      headers: await csrf(page.request),
      multipart: { file: { name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('Это не изображение') } },
    });
    expect(rejected.status()).toBe(400);
    const secondPhoto = await page.request.get(second);
    await expect(secondPhoto).toBeOK();
    expect((await secondPhoto.body()).equals(await firstPhoto.body())).toBe(false);
    expect((await request.get(second)).status()).toBe(401);

    const viewer = await browser.newPage();
    try {
      await login(viewer.request, 'student@bgtu.test', 'demo2026');
      await viewer.goto(`/profiles/${studentId}`);
      await expectLoadedAvatar(viewer.locator('[data-cabinet-header] [data-cabinet-avatar]'), second);
    } finally {
      await viewer.close();
    }

    await remove.click();
    await expect(sidebar).toHaveText(initials);
    await expect(sidebar.locator('img')).toHaveCount(0);
    await profileLink.click();
    await expect(profile).toHaveText(initials);
    await expect(profile.locator('img')).toHaveCount(0);
    expect((await page.request.get(second)).status()).toBe(404);
    cleanup = false;
  } finally {
    if (cleanup) await page.request.delete('/api/me/avatar', { headers: await csrf(page.request) });
  }
});
