p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\_work\gen_openapi.py'
t = open(p, encoding='utf8', newline='').read()


def sub(a, b):
    global t
    assert a in t, a[:80]
    t = t.replace(a, b, 1)


sub(''' "Contract": obj({"id": UUID, "number": S, "tenderId": UUID, "supplierId": UUID, "templateId": S,''',
    ''' "ContractSummary": obj({"id": UUID, "number": S, "status": enum("DRAFT", "LEGAL_REVIEW", "AWAITING_SIGNATURE", "PARTIALLY_SIGNED", "EXECUTED"), "value": N, "supplierId": UUID, "supplierName": S, "title": S, "requestNumber": S, "templateId": S, "startDate": {"type": "string", "format": "date"}, "endDate": {"type": "string", "format": "date"}, "noticeDays": I, "locked": B, "tenderId": UUID, "version": I, "signed": I, "signaturesRequired": I}, ["id", "number", "status"]),
 "ContractDeviation": obj({"clauseId": S, "title": S, "mandatory": B, "templateText": S, "currentText": S}, ["clauseId", "templateText", "currentText"]),
 "ContractSigner": obj({"role": enum("DELEGATE", "EXEC"), "label": S, "signedBy": S, "stamp": S}, ["role", "label"]),
 "ContractPermissions": obj({"canEdit": B, "canEditTerms": B, "canRelease": B, "canSign": B, "signBlocked": S, "canDelete": B}),
 "ContractAward": obj({"evaluationId": UUID, "tenderId": UUID, "requestNumber": S, "title": S, "estimatedValue": N, "recommended": arr(obj({"supplierId": UUID, "company": S, "score": N})), "contractId": UUID, "contractNumber": S}, ["evaluationId", "requestNumber", "recommended"]),
 "ContractTerms": obj({"value": N, "startDate": {"type": "string", "format": "date"}, "endDate": {"type": "string", "format": "date"}, "noticeDays": I}),
 "ContractDelete": obj({"reason": {"type": "string", "minLength": 10, "maxLength": 1000}}, ["reason"]),
 "Contract": obj({"id": UUID, "number": S, "tenderId": UUID, "supplierId": UUID, "templateId": S,''')
sub('"noticeDays": I, "clauses": arr(ref("Clause")), "signatures": arr(ref("Approval")), "parentId": UUID, "locked": B, "version": I}, ["id", "number", "status"]),',
    '"noticeDays": I, "clauses": arr(ref("Clause")), "signatures": arr(ref("Approval")), "parentId": UUID, "locked": B, "version": I,\n   "supplierName": S, "title": S, "requestNumber": S, "signed": I, "signaturesRequired": I, "deviations": arr(ref("ContractDeviation")), "chain": arr(ref("ContractSigner")), "permissions": ref("ContractPermissions")}, ["id", "number", "status"]),')
sub('"ContractCreate": obj({"evaluationId": UUID, "supplierId": UUID}, ["evaluationId", "supplierId"]),',
    '"ContractCreate": obj({"evaluationId": UUID, "supplierId": UUID, "value": N, "startDate": {"type": "string", "format": "date"}, "endDate": {"type": "string", "format": "date"}}, ["evaluationId", "supplierId"]),')
sub('"Contracts visible to caller", ["PROCUREMENT", "LEGAL", "CONTRACT_MGR", "DELEGATE", "EXEC", "FINANCE", "PROBITY"], None, "Contract", arrayResp=True',
    '"Contracts visible to caller", ["PROCUREMENT", "LEGAL", "CONTRACT_MGR", "DELEGATE", "EXEC", "FINANCE", "PROBITY"], None, "ContractSummary", arrayResp=True')
sub('"Draft from approved report: template + clauses + supplier data", ["LEGAL", "PROCUREMENT"], "ContractCreate", "Contract", 201)',
    '"Draft from approved report: template for the tender route + clause library + winning supplier data. Value defaults to the request estimate (bid prices are not captured)", ["LEGAL", "PROCUREMENT"], "ContractCreate", "Contract", 201, note="422 SUPPLIER_NOT_RECOMMENDED unless the supplier is ranked first; 409 CONTRACT_EXISTS")')
sub('"Edit clause (blocked when locked)", ["LEGAL"], "Clause", "Contract", note="423 when executed")',
    '"Edit clause; a change from the template is marked (blocked when locked)", ["LEGAL"], "Clause", "Clause", note="423 CONTRACT_LOCKED when executed; 422 MANDATORY_CLAUSE")')
sub('"Run configured review chain, then signing", ["LEGAL", "PROCUREMENT"], None, "Contract")',
    '"Release the reviewed draft for signing", ["LEGAL", "PROCUREMENT"], None, "Contract", note="422 RELEASE_BLOCKED lists what is missing; procurement can release only after legal review")')
sub('"Mock e-signature by signing delegate (authority checked separately)", ["DELEGATE"], "Decision", "Contract", note="403 SIGNING_AUTHORITY_INSUFFICIENT")',
    '"Mock e-signature with a stamp (name, role, time); signing authority is checked separately from sourcing approval. Above 1M the executive co-signs. REJECT returns the contract to legal", ["DELEGATE", "EXEC"], "Decision", "Contract", note="403 SIGNING_AUTHORITY_INSUFFICIENT; 409 ALREADY_SIGNED; 423 once executed")')
sub('ep("GET", "/contracts/{id}", "getContract"', '''ep("GET", "/contracts/awards", "listContractAwards", C, "Approved evaluations and whom the report recommends, with any contract already drafted", ["LEGAL", "PROCUREMENT"], None, "ContractAward", arrayResp=True)
ep("PATCH", "/contracts/{id}", "updateContractTerms", C, "Change value, dates or notice period of a draft; unedited clauses follow", ["LEGAL", "PROCUREMENT"], "ContractTerms", "Contract", note="423 when executed")
ep("DELETE", "/contracts/{id}", "deleteContract", C, "Logical delete with a reason (the record is kept and audited)", ["LEGAL", "EXEC"], "ContractDelete", None, 204)
ep("GET", "/contracts/{id}", "getContract"''')
open(p, 'w', encoding='utf8', newline='').write(t)
print('ok')
