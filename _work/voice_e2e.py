p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\e2e\intake.spec.ts'
t = open(p, encoding='utf8', newline='').read()
a = t.index("  test('voice input is visibly")
b = t.index("    await signIn(page, 'requester');", a)
t = t[:a] + """  test('Enter sends, Shift+Enter does not', async ({ page }) => {
""" + t[b:]
t = t.replace("    await expect(page.getByRole('button', { name: 'Voice input (coming soon)' })).toBeDisabled();\n", "")
a = t.index("test.describe('accessibility and layout'")
voice = """test.describe('voice input', () => {
  // A scripted stand-in for the browser's speech recogniser: starting it "hears" one phrase.
  const fakeRecogniser = () => {
    class Fake {
      lang = '';
      continuous = false;
      interimResults = false;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        setTimeout(() => {
          const mk = (t: string, f: boolean) => ({ isFinal: f, 0: { transcript: t } });
          this.onresult?.({ resultIndex: 0, results: [mk('catering for', false)] });
          this.onresult?.({ resultIndex: 0, results: [mk('catering for twelve months', true)] });
          this.onend?.();
        }, 50);
      }
      stop() {
        this.onend?.();
      }
      abort() {}
    }
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = Fake;
  };

  test('speech is typed into the box for review and is not sent automatically', async ({ page }) => {
    await page.addInitScript(fakeRecogniser);
    await signIn(page, 'requester');
    await page.goto('/app/requests/new');
    await expect(page.getByRole('form', { name: 'Message the assistant' })).toHaveAttribute('data-ready', 'true');
    const box = page.getByLabel('Describe what you need or answer the question');
    await box.fill('Please run an RFx:');
    await page.getByRole('button', { name: 'Start voice input' }).click();
    await expect(box).toHaveValue('Please run an RFx: catering for twelve months');
    await expect(page.locator('[data-role="USER"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start voice input' })).toBeVisible();
  });

  test('where the browser has no speech recognition the button says so and typing still works', async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
      delete (window as unknown as Record<string, unknown>).SpeechRecognition;
    });
    await signIn(page, 'requester');
    await page.goto('/app/requests/new');
    await expect(page.getByRole('button', { name: 'Voice input is not available in this browser' })).toBeDisabled();
    await page.getByLabel('Describe what you need or answer the question').fill('hello');
    await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled();
  });
});

"""
t = t[:a] + voice + t[a:]
open(p, 'w', encoding='utf8', newline='').write(t)
print('ok')
