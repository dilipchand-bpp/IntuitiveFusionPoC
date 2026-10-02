# M7b - Voice dictation, README, CI check (carry-overs from M6/M7)

| Item | Result |
| --- | --- |
| Voice input | Speech-to-text via the browser's own recogniser (`apps/web/src/components/voice/`). Used in the request chat and the plan instruction box. Words are typed into the box for review; nothing is sent automatically. Language en-AU. Where the browser has no recogniser (e.g. Firefox) the button is disabled and says so; typing still works. |
| Privacy | In Chrome/Edge the browser sends audio to its vendor's speech service. The portal never receives or stores audio. Documented in the hook. |
| Unit tests | 5 new (`use-dictation.test.tsx`): unsupported, interim vs final, error messages, stop, joining text. Total 342 pass. |
| Browser tests | 2 new in `intake.spec.ts` (scripted fake recogniser; unsupported browser). Total 130 / 130 pass on the production build. Old "coming soon" assertion removed. |
| Not tested | Real microphone and real speech service (needs a person speaking); plan-instruction box wiring is compiled and type-checked but has no dedicated browser test. |
| README | Updated: M0-M7 status, e2e ports 3100/4100, what to do if sign-in fails. |
| GitHub CI | Repo now public. Runs for `d770c29` (M7), `2e1cb23`, `3a34b28`, and earlier: success. `c0ad9fc`: cancelled (superseded by the next push). |
| Login incident | The API process (tsx watch) had died while the web app stayed up, so sign-in had nowhere to go. Restarted the stack; verified sign-in in the browser. |
