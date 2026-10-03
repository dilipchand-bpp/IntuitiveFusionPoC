p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\documents\pdf.ts'
t = open(p, encoding='utf8', newline='').read()
a = t.index('/** Characters Helvetica/WinAnsi can print')
b = t.index('export function textWidth')
new = '''/** Replacements for typographic characters Helvetica/WinAnsi cannot print the usual way (by code point, never by literal). */
const SWAP: Record<number, string> = {
  0x2013: '-',
  0x2014: '-',
  0x2212: '-',
  0x2018: "'",
  0x2019: "'",
  0x201c: '"',
  0x201d: '"',
  0x2026: '...',
  0xa0: ' ',
  0x0d: ' ',
  0x09: ' ',
};
/** A few Latin-1 letters and symbols WinAnsi prints directly (middle dot, multiplication, accented letters, pound). */
const KEEP = new Set([0xb7, 0xd7, 0xe9, 0xe8, 0xe0, 0xfc, 0xf6, 0xe4, 0xa3]);

/** Characters the built-in fonts can print; everything else becomes "?" so a stray symbol never corrupts the file. */
function clean(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    out += c === 10 || (c >= 32 && c <= 126) || KEEP.has(c) ? ch : (SWAP[c] ?? '?');
  }
  return out;
}

'''
t = t[:a] + new + t[b:]
open(p, 'w', encoding='utf8', newline='').write(t)
print('ok')
