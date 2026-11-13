import { expect, type Page, test } from '@playwright/test';

const library = (page: Page) => page.getByRole('list', { name: 'Uploaded documents' });

/**
 * The document library: upload (including duplicate and unsupported files),
 * background ingestion reaching "ready", and delete. Uses its own small
 * files so it doesn't depend on, or disturb, the sample documents.
 */
test.describe('document library', () => {
  const markdown = {
    name: 'e2e-office-guide.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      '# Office Guide\n\n## Opening hours\n\nThe Leeds office opens at 07:30 on weekdays.\n',
    ),
  };

  test('uploads a file, which the worker processes until it is ready', async ({ page }) => {
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles(markdown);

    const item = library(page).getByRole('listitem').filter({ hasText: markdown.name });
    await expect(item).toBeVisible();
    // The worker has chunked and embedded it: the summary line shows the chunk count.
    await expect(item).toContainText(/Markdown · \d+ chunks? ·/, { timeout: 60_000 });
  });

  test('uploading the same file again is deduplicated', async ({ page }) => {
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles(markdown);

    await expect(page.getByText(`${markdown.name} is already in your library.`)).toBeVisible();
    await expect(
      library(page).getByRole('listitem').filter({ hasText: markdown.name }),
    ).toHaveCount(1);
  });

  test('rejects an unsupported file type with a clear message', async ({ page }) => {
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles({
      name: 'photo.png',
      mimeType: 'image/png',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });

    await expect(page.getByText(/photo\.png: Only PDF, Markdown/)).toBeVisible();
    await expect(library(page).getByRole('listitem').filter({ hasText: 'photo.png' })).toHaveCount(
      0,
    );
  });

  test('deletes a document after confirmation', async ({ page }) => {
    await page.goto('/');
    const item = library(page).getByRole('listitem').filter({ hasText: markdown.name });
    await expect(item).toBeVisible();

    await item.getByRole('button', { name: `Delete ${markdown.name}` }).click();
    await item.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(item).toHaveCount(0);
    await page.reload();
    await expect(
      library(page).getByRole('listitem').filter({ hasText: markdown.name }),
    ).toHaveCount(0);
  });
});
