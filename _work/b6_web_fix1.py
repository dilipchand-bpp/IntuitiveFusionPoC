p = 'apps/web/src/components/collab/ai-panels.tsx'
s = open(p, encoding='utf8', newline='').read()


def rep(old, new):
    global s
    assert old in s, old[:60]
    s = s.replace(old, new, 1)


rep("import { useState } from 'react';", "import { useEffect, useState } from 'react';")
rep("""  const [loaded, setLoaded] = useState(false);
""", "")
rep("""  if (!loaded) {
    setLoaded(true);
    api<Assessment>(base)
      .then(setA)
      .catch((e) => setA(e instanceof ApiError && e.status === 404 ? null : null));
  }
""", """  useEffect(() => {
    api<Assessment>(base)
      .then(setA)
      .catch((e) => setA(e instanceof ApiError ? null : null));
  }, [base]);
""")
rep("""                    <div className="flex flex-wrap gap-4">
                      <Checkbox label={`Applies: ${i.title}`} checked={i.applicable === true} onChange={(e) => void patch(i.key, { applicable: e.target.checked })} />
                      <Checkbox label={`Does not apply: ${i.title}`} checked={i.applicable === false} onChange={(e) => void patch(i.key, { applicable: !e.target.checked ? true : false })} />
                    </div>""", """                    <Field label={`Does "${i.title}" apply?`}>
                      <Select
                        value={i.applicable === null ? '' : i.applicable ? 'yes' : 'no'}
                        onChange={(e) => e.target.value && void patch(i.key, { applicable: e.target.value === 'yes' })}
                        className="w-56"
                      >
                        <option value="">Not decided</option>
                        <option value="yes">It applies</option>
                        <option value="no">It does not apply</option>
                      </Select>
                    </Field>""")
rep("import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, Select, Table, Td, Th } from '@if/ui';", "import { Badge, Button, Card, EmptyState, Field, Input, Select, Table, Td, Th } from '@if/ui';")
open(p, 'w', encoding='utf8', newline='').write(s)

p = 'apps/web/src/components/collab/doc-tools.tsx'
s = open(p, encoding='utf8', newline='').read()
rep("""          <ins key={i} className="bg-success-bg text-success no-underline" style={{ textDecoration: 'underline' }}>""", """          <ins key={i} className="bg-success-bg text-success underline">""")
open(p, 'w', encoding='utf8', newline='').write(s)
print('ok')
