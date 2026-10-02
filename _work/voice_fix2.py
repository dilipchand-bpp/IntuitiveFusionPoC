import re
p='e2e/intake.spec.ts'
t=open(p,encoding='utf8',newline='').read()
a=t.index("  const fakeRecogniser = () => {")
b=t.index("  test('speech is typed")
new='''  const fakeRecogniser = () => {
    // Plain constructor function: this runs inside the page, so it must not rely on compiler helpers.
    function Fake(this: Record<string, unknown>) {
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
    }
    Fake.prototype.start = function (this: Record<string, ((e?: unknown) => void) | null>) {
      setTimeout(() => {
        const mk = (text: string, isFinal: boolean) => ({ isFinal, 0: { transcript: text } });
        this.onresult?.({ resultIndex: 0, results: [mk('catering for', false)] });
        this.onresult?.({ resultIndex: 0, results: [mk('catering for twelve months', true)] });
        this.onend?.();
      }, 50);
    };
    Fake.prototype.stop = function (this: Record<string, (() => void) | null>) {
      this.onend?.();
    };
    Fake.prototype.abort = function () {};
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = Fake;
  };

'''
t=t[:a]+new+t[b:]
open(p,'w',encoding='utf8',newline='').write(t)

p='apps/web/src/components/voice/voice-button.tsx'
t=open(p,encoding='utf8',newline='').read()
t=t.replace("className={`text-sm ${error ?","className={`text-sm empty:sr-only ${error ?")
open(p,'w',encoding='utf8',newline='').write(t)

p='apps/web/src/components/requests/intake-chat.tsx'
t=open(p,encoding='utf8',newline='').read()
t=re.sub(r'<div className="basis-full empty:hidden">\s*(<VoiceStatus[^>]*/>)\s*</div>',r'\1',t)
open(p,'w',encoding='utf8',newline='').write(t)
