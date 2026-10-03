p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\docs\M9-Evidence.md'
t = open(p, encoding='utf8', newline='').read()
marker = '## Not done / caveats'
section = '''## M9 follow-ups (requested after the first review)
| Item | Result |
| --- | --- |
| Blank areas on the evaluation page | Every stage now has a "where this is and what comes next" card (conflicts waiting, scores in, flagged scores, report awaiting approval). Read-only roles (procurement, delegates, executive) get the suppliers and their documents in the main column as a two-column grid; people who score keep them beside the scoring sheet. File links show the name on its own line with stream and size underneath instead of wrapping awkwardly. |
| Bid documents would not download | **Cause:** the seeded bid files were database rows with made-up storage keys and nothing on disk. **Fix:** the seed now writes a real PDF (technical response) and a real Excel workbook (pricing schedule) per bidder into the sealed store; a stored file that is genuinely missing is a clean 404 ("This file is not available"), never a server error. Existing dev databases need `npm run db:reset` to get the files. |
| PDF export of the report | `GET /evaluations/{id}/report/pdf` (procurement, delegate, executive, probity, legal, chair; audited). A dependency-free PDF writer (`apps/api/src/documents/pdf.ts`): A4, wrapped text, headings, bullets, a ranking table, and a footer on every page with the report name, "Page x of y", generation time and the evaluation record version. Status is printed ("Awaiting approval", "Approved" with the stamp, or "Needs regenerating"). "Download PDF" button on the report. |
| Reopening consensus after the lock | `POST /evaluations/{id}/consensus/reopen` (chair only, reason of 10+ characters). Agreed values and rationales are kept, individual scores stay frozen (also at the database), the earlier report is invalidated ("Needs regenerating") and must be regenerated after the chair locks again; refused before the lock and once the report is approved (the approver must return it first). Audited with the reason; procurement, delegates, executive and probity are told. |
| Delegate review of a declared conflict | Declaring a conflict now **suspends** access immediately (404 for that person) and sends the decision to a delegate (executive if none). Immaterial or manageable reinstates the evaluator (they continue; scoring cannot start and consensus cannot open while any conflict is undecided); material removes them for good (a replacement can be added). `POST /evaluations/{id}/conflicts/{userId}/decision` (delegate or executive); chair, probity and procurement are alerted at the declaration and at the outcome; the declarant is told the outcome; the declared conflicts are shown to those who must act and to oversight, never to other evaluators. The report records members whose conflict was reviewed and allowed. |
| Contract | OpenAPI now 84 operations (3 new: report PDF, reopen consensus, conflict decision; the declare-conflict outcome is now "suspended"). |

### Verification of the follow-ups
| Check | Result |
| --- | --- |
| `npm run ci` | exit 0, **446 tests** (new: 6 document-writer tests, 10 new evaluation API tests) |
| Independent file check | The generated PDF opens in Mozilla PDF.js (pages, title and text extracted correctly); the generated workbook passes Python's zip integrity check and holds the parts Excel needs |
| Browser tests | **165 pass**, including: real downloads of the seeded PDF and Excel file; a conflict declared on screen, the evaluator redirected with a notice and shut out, a delegate reinstating them, scoring, report generation and PDF download, the chair reopening with a reason, re-lock, regeneration, approval, and no reopen after approval; a material conflict removing someone for good |
| `npm audit --audit-level=high` | clean |

'''
t = t.replace(marker, section + marker, 1)
# the caveats that are now done
for gone in [
    "- Re-opening consensus after lock, unlocking, or changing the variance limit per evaluation are not built.\n",
    "- The report is a text report on screen; PDF/Word export (US-TND-05 family) is not built.\n",
    "- Conflict declarations by evaluators are decided automatically (any conflict removes the member); there is no delegate review of a declared conflict for evaluators yet (plan conflicts do have one).\n",
]:
    t = t.replace(gone, '')
t = t.replace('## Not done / caveats\n', '## Not done / caveats\n- Word export of the report is not built (PDF only). Changing the variance limit per evaluation is not built.\n- The PDF writer uses the built-in Helvetica fonts: text outside Western European characters prints as "?".\n- The seeded documents are synthetic and short; real supplier uploads are whatever the supplier sent.\n', 1)
open(p, 'w', encoding='utf8', newline='').write(t)

r = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\README.md'
s = open(r, encoding='utf8', newline='').read()
s = s.replace('Technical evaluators never see pricing; nobody sees another evaluator\'s scores until the chair opens consensus.',
              "Technical evaluators never see pricing; nobody sees another evaluator's scores until the chair opens consensus. A declared conflict goes to a delegate to decide; the chair can reopen a locked consensus with a reason; the report downloads as a PDF. Seeded bid documents are real files (PDF and Excel): run `npm run db:reset` once to get them in an existing dev database.", 1)
open(r, 'w', encoding='utf8', newline='').write(s)
print('ok')
