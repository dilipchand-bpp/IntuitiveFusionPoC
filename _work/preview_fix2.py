p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\web\src\components\preview\device-preview.tsx'
t = open(p, encoding='utf8', newline='').read()
a = t.index('          <Button asChild variant="ghost">\n            <a href={current()}')
b = t.index('        </span>\n      </div>\n\n      <div ref={stage}')
new = '''          <Button variant="ghost" onClick={() => window.open(current(), '_blank', 'noopener')}>
            <ExternalLink className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Open in a new tab</span>
            <span className="sr-only sm:hidden">Open in a new tab</span>
          </Button>
          <Button variant="secondary" aria-label="Close the preview" onClick={() => router.push(current())}>
            <X className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Close</span>
          </Button>
'''
t = t[:a] + new + t[b:]
t = t.replace("import Link from 'next/link';\n", "import { useRouter } from 'next/navigation';\n")
t = t.replace("  const [device, setDevice] = useState<Device>(initialDevice);", "  const router = useRouter();\n  const [device, setDevice] = useState<Device>(initialDevice);")
open(p, 'w', encoding='utf8', newline='').write(t)

p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\e2e\preview.spec.ts'
t = open(p, encoding='utf8', newline='').read()
a = t.index("    await expect(frame(page).getByRole('heading', { name: /From request to signed contract/ })).toBeVisible(); // wide enough")
b = t.index("\n", a)
t = t[:a] + "    await expect(frame(page).getByRole('heading', { name: 'Sign in' })).toBeVisible();" + t[b:]
t = t.replace("""    expect(await page.getByRole('link', { name: /Open in a new tab/ }).getAttribute('href')).toContain('/app/requests');""",
"""    const popup = page.waitForEvent('popup');
    await page.getByRole('button', { name: /Open in a new tab/ }).click();
    expect((await popup).url()).toContain('/app/requests'); // the page shown in the frame, not where the preview started""")
t = t.replace("await page.getByRole('link', { name: 'Close the preview' }).click();", "await page.getByRole('button', { name: 'Close the preview' }).click();")
open(p, 'w', encoding='utf8', newline='').write(t)
print('ok')
