import re

p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\web\src\components\preview\device-preview.tsx'
t = open(p, encoding='utf8', newline='').read()
a = t.index('/** Only same-site paths may be framed')
b = t.index('/**\n * Shows the app inside')
t = t[:a] + t[b:]
t = t.replace("import { Button, cn } from '@if/ui';", "import { Button, cn } from '@if/ui';\nimport { safePath } from './safe-path';")
open(p, 'w', encoding='utf8', newline='').write(t)

p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\web\src\app\preview\page.tsx'
t = open(p, encoding='utf8', newline='').read()
t = t.replace("import { DevicePreview, safePath, type Device } from '@/components/preview/device-preview';",
              "import { DevicePreview, type Device } from '@/components/preview/device-preview';\nimport { safePath } from '@/components/preview/safe-path';")
open(p, 'w', encoding='utf8', newline='').write(t)
print('ok')
