p='e2e/intake.spec.ts'
t=open(p,encoding='utf8',newline='').read()
a=t.index("  const fakeRecogniser = () => {")
b=t.index("  test('speech is typed")
new='''  // Injected as plain script text: a function would be wrapped by the test compiler with helpers the page does not have.
  const fakeRecogniser = `
    function Fake() { this.onresult = null; this.onerror = null; this.onend = null; }
    Fake.prototype.start = function () {
      var self = this;
      setTimeout(function () {
        var mk = function (text, isFinal) { return { isFinal: isFinal, 0: { transcript: text } }; };
        if (self.onresult) self.onresult({ resultIndex: 0, results: [mk('catering for', false)] });
        if (self.onresult) self.onresult({ resultIndex: 0, results: [mk('catering for twelve months', true)] });
        if (self.onend) self.onend();
      }, 50);
    };
    Fake.prototype.stop = function () { if (this.onend) this.onend(); };
    Fake.prototype.abort = function () {};
    window.webkitSpeechRecognition = Fake;
  `;

'''
t=t[:a]+new+t[b:]
t=t.replace("await page.addInitScript(fakeRecogniser);","await page.addInitScript({ content: fakeRecogniser });")
t=t.replace("""    await page.addInitScript(() => {
      delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
      delete (window as unknown as Record<string, unknown>).SpeechRecognition;
    });""","""    await page.addInitScript({
      content: 'delete window.webkitSpeechRecognition; delete window.SpeechRecognition;',
    });""")
open(p,'w',encoding='utf8',newline='').write(t)
