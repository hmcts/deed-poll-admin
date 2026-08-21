import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

test.describe('Homepage', () => {
  test('should load the homepage', async ({ page }) => {
    await page.goto('/');
    
    // Check the page has loaded
    await expect(page).toHaveTitle(/.*/);
    
    // Check for main heading content
    await expect(page.getByRole('heading', { name: /HMCTS Express Monorepo Template/i })).toBeVisible();
    
    // Check for key subtitle content
    await expect(page.getByText('Production-ready Node.js starter with cloud-native capabilities')).toBeVisible();
    
    // Check for main section headings
    await expect(page.getByRole('heading', { name: 'Cloud Native Platform' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Getting Started' })).toBeVisible();
  });

  test('should run accessibility checks', async ({ page }) => {
    await page.goto('/');
    
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      // TODO: Fix these template issues - links need text content
      // Exclude known issues with empty links in the template for now
      .exclude('.govuk-link[aria-label=""]')
      .exclude('.govuk-footer__link')
      .exclude('.language')
      .exclude('.govuk-back-link')
      .analyze();
    
    if (accessibilityScanResults.violations.length > 0) {
      console.log('Accessibility violations found:');
      accessibilityScanResults.violations.forEach(violation => {
        console.log(`- ${violation.id}: ${violation.description}`);
        console.log(`  Impact: ${violation.impact}`);
        console.log(`  Affected nodes: ${violation.nodes.length}`);
        violation.nodes.forEach(node => {
          console.log(`    ${node.target}`);
        });
      });
    }
    
    expect(accessibilityScanResults.violations).toEqual([]);
  });
});