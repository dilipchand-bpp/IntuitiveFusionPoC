import json, re, subprocess, sys

root = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api'
out = subprocess.run('npx eslint src/modules/evaluation -f json', shell=True, cwd=root, capture_output=True, text=True).stdout
data = json.loads(out)
for f in data:
    path = f['filePath']
    msgs = [m for m in f['messages'] if m['ruleId'] == '@typescript-eslint/no-unused-vars']
    if not msgs:
        continue
    s = open(path, encoding='utf8').read()
    for m in msgs:
        name = m['message'].split("'")[1]
        # import specifier lines such as "  name," or "name," inside braces, or a whole `import { name } from`
        s2 = re.sub(r"(\n\s*)%s,(?=\n)" % re.escape(name), '', s, count=1)
        if s2 == s:
            s2 = re.sub(r"\b%s, " % re.escape(name), '', s, count=1)
        if s2 == s:
            s2 = re.sub(r", %s\b" % re.escape(name), '', s, count=1)
        if s2 == s:
            s2 = re.sub(r"import \{ %s \} from '[^']+';\n" % re.escape(name), '', s, count=1)
        if s2 == s:
            s2 = re.sub(r"\nconst %s = [^\n]*;\n" % re.escape(name), '\n', s, count=1)
        if s2 == s:
            print('could not remove', name, path)
        s = s2
    open(path, 'w', encoding='utf8').write(s)
print('done')
