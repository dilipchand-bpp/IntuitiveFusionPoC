p='apps/web/src/components/voice/voice-button.tsx'
t=open(p,encoding='utf8',newline='').read()
t=t.replace("  error,\n}: {\n  state: DictationState;\n  interim: string;\n  error: string | null;\n}) {","  error,\n  className = '',\n}: {\n  state: DictationState;\n  interim: string;\n  error: string | null;\n  className?: string;\n}) {")
t=t.replace("className={`text-sm empty:sr-only ${error ?","className={`text-sm empty:sr-only ${className} ${error ?")
open(p,'w',encoding='utf8',newline='').write(t)
p='apps/web/src/components/requests/intake-chat.tsx'
t=open(p,encoding='utf8',newline='').read()
t=t.replace("<VoiceStatus state={voice.state}","<VoiceStatus className=\"basis-full\" state={voice.state}")
open(p,'w',encoding='utf8',newline='').write(t)
