def sub(p, pairs):
    t = open(p, encoding='utf8', newline='').read()
    for a, b in pairs:
        assert a in t, (p, a[:60])
        t = t.replace(a, b)
    open(p, 'w', encoding='utf8', newline='').write(t)
G="'bg-brand-gradient shadow-md hover:-translate-y-0.5 hover:shadow-lg hover:brightness-110 active:translate-y-0'"
sub('packages/ui/src/components/button.tsx',[
 ("  primary: 'bg-primary text-primary-fg shadow-sm hover:bg-primary-hover',","  primary:\n    "+G+","),
])
W='apps/web/src/'
sub(W+'components/requests/intake-chat.tsx',[("bg-primary px-3 py-2 text-sm text-primary-fg","bg-brand-gradient px-3 py-2 text-sm shadow-sm")])
sub(W+'app/login/page.tsx',[
 ('<div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 pb-16">','<div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 pb-16">\n          <div className="flex flex-col gap-6 rounded-lg border border-border bg-surface p-8 shadow-lg">'),
])
t=open(W+'app/login/page.tsx',encoding='utf8',newline='').read()
t=t.replace("          </Suspense>\n          <p className=","          </Suspense>\n          </div>\n          <p className=")
t=t.replace("<p className=\"text-sm text-text-muted\">\n            This is a demonstration","<p className=\"px-2 text-center text-sm text-text-muted\">\n            This is a demonstration")
open(W+'app/login/page.tsx','w',encoding='utf8',newline='').write(t)
