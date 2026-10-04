root = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\web\src'


def edit(rel, pairs):
    p = f'{root}\\{rel}'
    s = open(p, encoding='utf8').read()
    for a, b in pairs:
        assert a in s, (rel, a[:80])
        s = s.replace(a, b, 1)
    open(p, 'w', encoding='utf8').write(s)


edit('components/tender/types.ts', [
    ("  canBid: boolean;\n}\nexport interface SupplierTenderSummary {", "  canBid: boolean;\n  /** The buyer has given this supplier extra time after the closing time (FR-0205). */\n  lateAccess?: boolean;\n  stage?: number;\n}\nexport interface SupplierTenderSummary {"),
])
edit('components/supplier/supplier-tender.tsx', [
    ("import type { BidFile, SupplierTenderView } from '@/components/tender/types';", "import { DeviationsCard } from './deviations-card';\nimport type { BidFile, SupplierTenderView } from '@/components/tender/types';"),
    ("  const open = t.canBid && (left === null || left > 0);", "  // after the closing time a supplier with a late-submission permission can still bid until it runs out (FR-0205)\n  const open = t.canBid && (t.lateAccess === true || left === null || left > 0);"),
    ("    if (t.canBid && left !== null && left <= 0) void reload().then(() => router.refresh());\n  }, [t.canBid, left, reload, router]);", "    if (t.canBid && !t.lateAccess && left !== null && left <= 0) void reload().then(() => router.refresh());\n  }, [t.canBid, t.lateAccess, left, reload, router]);"),
    ("        <Badge tone=\"info\">{TENDER_TYPE_LABEL[t.type] ?? t.type}</Badge>", "        <Badge tone=\"info\">{TENDER_TYPE_LABEL[t.type] ?? t.type}</Badge>\n        {(t.stage ?? 1) > 1 && <Badge tone=\"info\">Stage {t.stage}</Badge>}"),
    ("          {open\n            ? `Open until ${formatDateTime(t.closesAt)}`\n            : 'This tender is closed. Nothing can be uploaded or submitted.'}", "          {open && t.lateAccess\n            ? 'The closing time has passed, but the buyer has given you extra time to submit.'\n            : open\n              ? `Open until ${formatDateTime(t.closesAt)}`\n              : 'This tender is closed. Nothing can be uploaded or submitted.'}"),
    ("        {open && left !== null && (\n          <p className=\"font-mono text-lg font-bold\" data-testid=\"countdown\">", "        {open && !t.lateAccess && left !== null && (\n          <p className=\"font-mono text-lg font-bold\" data-testid=\"countdown\">"),
    ("                <span className=\"text-text-muted\">\n                  · {SECTION_LABEL[f.section]} · {size(f.sizeBytes)}\n                </span>", "                <span className=\"text-text-muted\">\n                  · {SECTION_LABEL[f.section]} · {size(f.sizeBytes)}\n                  {f.carriedForward ? ' · kept from your earlier stage' : ''}\n                </span>"),
    ("              <p className=\"font-semibold\">Q: {q.text}</p>\n              <p>A: {q.answer}</p>", "              <p className=\"font-semibold\">Q: {q.text}</p>\n              <p>\n                A: {q.answer}\n                {q.audience === 'SINGLE' && <span className=\"ml-2 text-xs text-text-muted\">(answered to you only)</span>}\n              </p>"),
    ("      {/* ------------------------------------------------------------ your bid */}", "      {/* ------------------------------------------------------------ proposed contract changes */}\n      <DeviationsCard tenderId={t.id} open={open} csrf={csrf} />\n\n      {/* ------------------------------------------------------------ your bid */}"),
])
edit('components/tender/types.ts', [
    ("export interface BidFile {\n  id: string;", "export interface BidFile {\n  carriedForward?: boolean;\n  id: string;"),
])
print('ok')
