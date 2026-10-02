import zipfile,re,json,html
z=zipfile.ZipFile('Requirements_Register_IntuitiveFusion_v0.2.xlsx')
ss=[html.unescape(re.sub(r'<[^>]+>','',si)) for si in re.findall(r'<si>(.*?)</si>',z.read('xl/sharedStrings.xml').decode('utf8'),re.S)]
names=['Instructions','AI','Technical','Functional','NonFunctional','Security','Stakeholders','RTM','ChangeLog']
out={}
for i,nm in enumerate(names,1):
    x=z.read(f'xl/worksheets/sheet{i}.xml').decode('utf8')
    rows=[]
    for row in re.findall(r'<row[^>]*>(.*?)</row>',x,re.S):
        d={}
        for m in re.finditer(r'<c r="([A-Z]+)\d+"([^>]*?)(?:/>|>(.*?)</c>)',row,re.S):
            col,attr,inner=m.groups()
            if not inner: continue
            v=re.search(r'<v>(.*?)</v>',inner,re.S)
            if v: val=ss[int(v.group(1))] if 't="s"' in attr else v.group(1)
            else:
                t=re.search(r'<t[^>]*>(.*?)</t>',inner,re.S); val=html.unescape(t.group(1)) if t else ''
            d[col]=val
        if d: rows.append(d)
    out[nm]=rows
json.dump(out,open('_work/register.json','w',encoding='utf8'),ensure_ascii=False)
for k,v in out.items(): print(k,len(v))
