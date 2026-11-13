import { expect, type Page, test } from '@playwright/test';
import { SAMPLE_DOCS, uploadAndWaitUntilReady } from './helpers';

/**
 * Asking questions, end to end: embedding the question, hybrid search in
 * Postgres, the relevance gate, streaming the result over SSE, and the UI
 * showing sources, the inspector and scoping.
 *
 * The stack runs without an API key, so the model is never called. That
 * still exercises everything up to the model, and the "answers are turned
 * off" path, without spending money or depending on a model's wording.
 */
test.describe('chat', () => {
  test.beforeAll(async ({ request }) => {
    await uploadAndWaitUntilReady(request, SAMPLE_DOCS);
  });

  async function ask(page: Page, question: string) {
    const composer = page.getByLabel('Ask a question');
    await composer.fill(question);
    await composer.press('Enter');
  }

  test('retrieves sources for an on-topic question and explains answers are off', async ({
    page,
  }) => {
    await page.goto('/');
    await ask(page, 'How much annual leave do I get?');

    await expect(page.getByText('Answers are turned off')).toBeVisible();
    const sources = page.getByRole('list', { name: 'Sources' });
    await expect(
      sources.getByRole('button', { name: /employee-handbook\.md/ }).first(),
    ).toBeVisible();
  });

  test('opens a source in the inspector and closes it with Escape', async ({ page }) => {
    await page.goto('/');
    await ask(page, 'How much annual leave do I get?');

    await page
      .getByRole('list', { name: 'Sources' })
      .getByRole('button', { name: /employee-handbook\.md/ })
      .first()
      .click();
    const inspector = page.getByRole('complementary', { name: 'Source inspector' });
    await expect(inspector).toBeVisible();
    await expect(inspector.getByText('Why this was retrieved')).toBeVisible();
    await expect(inspector.getByText('Relevance gate')).toBeVisible();
    // The question's words are highlighted in the passage.
    await expect(inspector.locator('mark').first()).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(inspector).toBeHidden();
  });

  test('blocks an off-topic question before it reaches the model', async ({ page }) => {
    await page.goto('/');
    await ask(page, 'What is the capital of France?');

    await expect(
      page.getByText("I couldn't find anything about that in your documents"),
    ).toBeVisible();
    await expect(page.getByText('no model call')).toBeVisible();
    // The gate stopped it, so there is no "answers are turned off" notice.
    await expect(page.getByText('Answers are turned off')).toBeHidden();
  });

  test('limits the search to the ticked document', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('checkbox', { name: 'Limit chat to incident-runbook.pdf' }).check();
    await expect(page.getByText('Searching only incident-runbook.pdf')).toBeVisible();

    await ask(page, 'What is a SEV1 incident?');

    const sources = page.getByRole('list', { name: 'Sources' });
    await expect(sources).toBeVisible();
    const labels = await sources.getByRole('button').allTextContents();
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(label).toContain('incident-runbook.pdf');

    await page.getByRole('button', { name: 'Search all documents' }).click();
    await expect(page.getByText('Searching only incident-runbook.pdf')).toBeHidden();
  });
});
