def L(h):
    h=h.lstrip('#'); r,g,b=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    f=lambda c: c/12.92 if c<=0.03928 else ((c+0.055)/1.055)**2.4
    return .2126*f(r)+.7152*f(g)+.0722*f(b)
def cr(a,b):
    la,lb=sorted([L(a),L(b)],reverse=True); return (la+.05)/(lb+.05)
pairs=[('Primary text/btn bg #2A303C on white','#FFFFFF','#2A303C'),
('White on primary #2A303C','#2A303C','#FFFFFF'),
('Body text #1B1F27 on page #F6F7FA','#F6F7FA','#1B1F27'),
('Muted text #5A6172 on white','#FFFFFF','#5A6172'),
('Muted text #5A6172 on page #F6F7FA','#F6F7FA','#5A6172'),
('Secondary #717888 on white (non-text/large only)','#FFFFFF','#717888'),
('Accent #4254C5 on white','#FFFFFF','#4254C5'),
('White on accent #4254C5','#4254C5','#FFFFFF'),
('Success #1B7A4B on white','#FFFFFF','#1B7A4B'),
('Warning #9A5200 on white','#FFFFFF','#9A5200'),
('Error #B42318 on white','#FFFFFF','#B42318'),
('Info #1A5FA8 on white','#FFFFFF','#1A5FA8'),
('Success on tint #E6F4EC','#E6F4EC','#1B7A4B'),
('Warning on tint #FDF0DC','#FDF0DC','#9A5200'),
('Error on tint #FCE8E6','#FCE8E6','#B42318'),
('Info on tint #E5F0FB','#E5F0FB','#1A5FA8'),
('DARK: text #E8EAF0 on #14171E','#14171E','#E8EAF0'),
('DARK: muted #A4ABB9 on #14171E','#14171E','#A4ABB9'),
('DARK: muted #A4ABB9 on surface #1D212B','#1D212B','#A4ABB9'),
('DARK: accent #8C9BFF on #14171E','#14171E','#8C9BFF'),
('DARK: primary btn #CED2DF bg w/ #14171E text','#CED2DF','#14171E'),
('DARK: success #4CC38A on #14171E','#14171E','#4CC38A'),
('DARK: error #FF8A80 on #14171E','#14171E','#FF8A80'),
('DARK: warning #F5B04C on #14171E','#14171E','#F5B04C'),
('DARK: info #6CB4FF on #14171E','#14171E','#6CB4FF'),
('Focus ring #4254C5 vs page #F6F7FA (needs 3:1)','#F6F7FA','#4254C5'),
]
if __name__=='__main__':
    for n,b,f in pairs:
        c=cr(b,f); print(f'| {n} | {c:.2f}:1 | {"Pass AA" if c>=4.5 else ("Pass (large/UI 3:1)" if c>=3 else "FAIL")} |')
