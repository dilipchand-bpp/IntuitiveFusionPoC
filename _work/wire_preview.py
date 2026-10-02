def sub(p, a, b):
    t = open(p, encoding='utf8', newline='').read()
    assert a in t, (p, a[:70])
    open(p, 'w', encoding='utf8', newline='').write(t.replace(a, b, 1))


R = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC'
W = R + r'\apps\web\src'


# staff header
f = W + r'\components\shell\shell-frame.tsx'
sub(f, "import { NavLinks } from './nav-links';", "import { PreviewLink } from '@/components/preview/preview-link';\nimport { NavLinks } from './nav-links';")
sub(f, '<CommandPalette items={items} />', '<CommandPalette items={items} />\n          <PreviewLink />')

# supplier header
f = W + r'\components\supplier\supplier-shell.tsx'
sub(f, "import { NotificationBell }", "import { PreviewLink } from '@/components/preview/preview-link';\nimport { NotificationBell }")
sub(f, '<ThemeToggle />', '<PreviewLink />\n          <ThemeToggle />')

# landing header
f = W + r'\components\landing\site-chrome.tsx'
sub(f, "import { Button, Logo, ThemeToggle } from '@if/ui';", "import { Button, Logo, ThemeToggle } from '@if/ui';\nimport { PreviewLink } from '@/components/preview/preview-link';")
sub(f, '<ThemeToggle />\n          <Button asChild variant="accent">', '<PreviewLink />\n          <ThemeToggle />\n          <Button asChild variant="accent">')

# login page
f = W + r'\app\login\page.tsx'
sub(f, "import { LoginForm } from './login-form';", "import { PreviewLink } from '@/components/preview/preview-link';\nimport { LoginForm } from './login-form';")
sub(f, '          <ThemeToggle />\n        </div>', '          <span className="flex items-center gap-1">\n            <PreviewLink />\n            <ThemeToggle />\n          </span>\n        </div>')
print('ok')
