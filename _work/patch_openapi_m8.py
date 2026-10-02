import re

p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\_work\gen_openapi.py'
t = open(p, encoding='utf8', newline='').read()


def replace_line_starting(prefix, new):
    """Replaces the (possibly multi-line) schema/ep statement that begins with `prefix`."""
    global t
    i = t.index(prefix)
    # statement ends at the first line that ends with '),' (schema) or ')' (ep) followed by newline and a new statement
    m = re.compile(r'\n(?= "|ep\(|[A-Z]+ = |\n)').search(t, i + len(prefix))
    assert m, prefix
    t = t[:i] + new + t[m.start():]


# ---------------------------------------------------------------- schemas
replace_line_starting(' "Tender": obj(', ''' "Tender": obj({"id": UUID, "requestId": UUID, "requestNumber": S, "title": S, "estimatedValue": N, "type": enum("RFT", "RFP", "RFQ", "RFI", "EOI"), "access": enum("OPEN", "CLOSED"),
   "status": enum("DRAFT", "STAGED", "PUBLISHED", "CLOSED", "EVALUATING", "AWARDED"), "opensAt": DT, "closesAt": DT, "version": I, "planStatus": S,
   "fields": arr(ref("TenderField")), "permission": ref("PublishPermission"), "invitations": arr(ref("InvitationState")), "questions": arr(ref("Question")),
   "addenda": arr(ref("Addendum")), "submissions": ref("SubmissionSummary"), "permissions": ref("TenderPermissions")}, ["id", "requestId", "type", "status", "version", "fields"]),
 "TenderSummary": obj({"id": UUID, "requestId": UUID, "requestNumber": S, "title": S, "estimatedValue": N, "type": S, "access": S, "status": S, "closesAt": DT, "permissionGranted": B, "invitations": I, "openQuestions": I, "bids": I, "updatedAt": DT}, ["id", "requestId", "title", "status"]),
 "TenderField": obj({"key": S, "label": S, "value": S, "paragraphs": arr(S), "source": S, "aiDrafted": B, "updatedAt": DT}, ["key", "label", "value"]),
 "TenderPermissions": obj({"canEdit": B, "canGrantPermission": B, "canPublish": B, "canInvite": B, "canAnswer": B, "canIssueAddendum": B}, ["canEdit", "canGrantPermission", "canPublish"]),
 "PublishPermission": obj({"granted": B, "by": S, "at": DT}, ["granted"]),
 "InvitationState": obj({"id": UUID, "email": S, "company": S, "state": enum("INVITED", "REGISTERED", "USED", "EXPIRED"), "expiresAt": DT}, ["id", "email", "company", "state"]),
 "SubmissionSummary": obj({"count": I, "sealed": B, "items": arr(obj({"supplierId": UUID, "company": S, "receipt": S, "submittedAt": DT}))}, ["count", "sealed"]),
 "TenderFieldUpdate": obj({"value": {"type": "string", "maxLength": 10000}, "expectedVersion": I}, ["value", "expectedVersion"]),
 "PermissionRequest": obj({"comment": {"type": "string", "maxLength": 1000}}),
 "PublishRequest": obj({"closesAt": DT}, ["closesAt"]),''')
replace_line_starting(' "TenderCreate": obj(', ''' "TenderCreate": obj({"requestId": UUID, "type": enum("RFT", "RFP", "RFQ", "RFI", "EOI"), "access": enum("OPEN", "CLOSED")}, ["requestId", "type"]),''')
replace_line_starting(' "Invitation": obj(', ''' "InviteRequest": obj({"invitees": {"type": "array", "minItems": 1, "maxItems": 50, "items": obj({"email": {"type": "string", "format": "email"}, "company": S}, ["email", "company"])}}, ["invitees"]),
 "InviteResponse": obj({"invitations": arr(obj({"id": UUID, "email": S, "company": S, "expiresAt": DT, "registerPath": S}, ["id", "email", "company", "registerPath"]))}, ["invitations"]),
 "InvitationInfo": obj({"email": S, "company": S, "organisation": S, "expiresAt": DT}, ["email", "company"]),''')
replace_line_starting(' "Question": obj(', ''' "Question": obj({"id": UUID, "text": S, "answer": S, "status": enum("OPEN", "ANSWERED", "PUBLISHED"), "askedAt": DT}, ["id", "text", "status"]),
 "AnswerRequest": obj({"answer": {"type": "string", "minLength": 2, "maxLength": 4000}}, ["answer"]),''')
replace_line_starting(' "SupplierRegistration": obj(', ''' "SupplierRegistration": obj({"token": S, "name": S, "email": {"type": "string", "format": "email"}, "company": S, "abn": S, "password": {"type": "string", "minLength": 12}}, ["name", "email", "company", "abn", "password"]),
 "RegistrationResult": obj({"registered": B, "supplierId": UUID, "sanctionsStatus": enum("PENDING", "CLEAR", "MATCH")}, ["registered", "supplierId"]),
 "SupplierTenderSummary": obj({"id": UUID, "title": S, "number": S, "type": S, "status": S, "closesAt": DT, "submissionStatus": enum("NOT_STARTED", "DRAFT", "SUBMITTED", "REJECTED_LATE"), "receipt": S}, ["id", "title", "status"]),
 "SupplierTender": obj({"id": UUID, "title": S, "number": S, "type": S, "status": S, "opensAt": DT, "closesAt": DT, "serverTime": DT, "fields": arr(ref("TenderField")), "questions": arr(ref("Question")), "addenda": arr(ref("Addendum")),
   "submission": obj({"status": S, "receipt": S, "submittedAt": DT, "files": arr(ref("BidFile"))}, ["status", "files"]), "canBid": B}, ["id", "title", "status", "fields", "submission", "canBid"]),
 "BidFileUpload": obj({"name": S, "section": enum("TECHNICAL", "COMMERCIAL", "OTHER"), "dataBase64": S}, ["name", "dataBase64"]),
 "BidFile": obj({"id": UUID, "name": S, "sizeBytes": I, "contentType": S, "section": S, "scan": S, "sha256": S, "uploadedAt": DT}, ["id", "name", "sizeBytes", "section"]),
 "BidReceipt": obj({"receipt": S, "submittedAt": DT, "closesAt": DT, "files": arr(obj({"name": S, "sizeBytes": I, "section": S, "sha256": S}))}, ["receipt", "submittedAt", "files"]),''')

# ---------------------------------------------------------------- operations
replace_line_starting('ep("GET", "/tenders", "listTenders"', '''ep("GET", "/tenders", "listTenders", D, "List tenders visible to caller (bid counts only; content stays sealed until close)", ["PROCUREMENT", "DELEGATE", "EVALUATOR", "CHAIR", "LEGAL", "PROBITY", "EXEC", "ADMIN"], None, "TenderSummary", arrayResp=True)''')
replace_line_starting('ep("PUT", "/tenders/{id}/fields/{key}"', '''ep("PUT", "/tenders/{id}/fields/{key}", "updateTenderField", D, "Edit a pack section while the tender is staged", ["PROCUREMENT", "LEGAL"], "TenderFieldUpdate", "Tender", note="409 on stale version; 423 once published")''')
replace_line_starting('ep("POST", "/tenders/{id}/publish-permission"', '''ep("POST", "/tenders/{id}/publish-permission", "grantPublishPermission", D, "ECV-appropriate delegate grants permission to publish", ["DELEGATE"], "PermissionRequest", "Tender", note="403 if value exceeds the delegate's publishing authority")''')
replace_line_starting('ep("POST", "/tenders/{id}/publish"', '''ep("POST", "/tenders/{id}/publish", "publishTender", D, "Publish (needs permission, approved plan, statutory window valid)", ["PROCUREMENT"], "PublishRequest", "Tender", note="409 without permission or approved plan; 422 if statutory window not met")''')
replace_line_starting('ep("POST", "/tenders/{id}/invitations"', '''ep("POST", "/tenders/{id}/invitations", "inviteSuppliers", D, "Invite supplier contacts; returns each one-time registration link (mail is simulated)", ["PROCUREMENT"], "InviteRequest", "InviteResponse", 201, note="409 if already invited")''')
replace_line_starting('ep("GET", "/tenders/{id}/questions"', '''ep("GET", "/tenders/{id}/questions", "listQuestions", D, "Questions (author never returned; suppliers see published ones only)", ["PROCUREMENT", "LEGAL", "SUPPLIER"], None, "Question", arrayResp=True)
ep("POST", "/tenders/{id}/questions/{questionId}/answer", "answerQuestion", D, "Draft the answer to a question (published to everyone via an addendum)", ["PROCUREMENT", "LEGAL"], "AnswerRequest", "Question", note="409 once published")''')
replace_line_starting('ep("POST", "/supplier/register"', '''ep("POST", "/supplier/register", "registerSupplier", SP, "Self-register from an invitation token (or, for open tenders, without one)", None, "SupplierRegistration", "RegistrationResult", 201, note="400 invalid ABN checksum; 404 invalid invitation; 409 generic if already registered")
ep("GET", "/supplier/invitations/{token}", "getInvitation", SP, "Look up an invitation link to pre-fill registration (one generic 404 for unknown, used or expired)", None, None, "InvitationInfo")''')
replace_line_starting('ep("GET", "/supplier/tenders", "listMyTenders"', '''ep("GET", "/supplier/tenders", "listMyTenders", SP, "Tenders caller is invited to (plus open-access tenders)", ["SUPPLIER"], None, "SupplierTenderSummary", arrayResp=True)
ep("GET", "/supplier/tenders/{id}", "getMyTender", SP, "One tender: pack, published Q&A and addenda, own bid", ["SUPPLIER"], None, "SupplierTender", note="404 (and audited) if not invited")''')
replace_line_starting('ep("POST", "/supplier/tenders/{id}/submission/files"', '''ep("POST", "/supplier/tenders/{id}/submission/files", "uploadBidFile", SP, "Upload one file (JSON, base64): allow-list, 10 MB, content check, scan stub, sealed storage", ["SUPPLIER"], "BidFileUpload", "BidFile", 201, note="400 type/name/content; 413 size; 409 BID_CLOSED after close or already submitted")
ep("DELETE", "/supplier/tenders/{id}/submission/files/{fileId}", "deleteBidFile", SP, "Remove a file from an unsubmitted bid", ["SUPPLIER"], None, None, 204, note="409 once submitted (withdraw first) or closed")''')
replace_line_starting('ep("POST", "/supplier/tenders/{id}/submission", "submitBid"', '''ep("POST", "/supplier/tenders/{id}/submission", "submitBid", SP, "Submit; issues a receipt; refused after the closing time", ["SUPPLIER"], None, "BidReceipt", 201, note="409 BID_CLOSED after closesAt (late attempt discarded and notified); 409 SUBMISSION_INCOMPLETE without technical and commercial files")
ep("POST", "/supplier/tenders/{id}/submission/withdraw", "withdrawBid", SP, "Withdraw a submitted bid before close so files can be changed", ["SUPPLIER"], None, "SupplierTender", note="409 after close")''')

open(p, 'w', encoding='utf8', newline='').write(t)
print('patched')
