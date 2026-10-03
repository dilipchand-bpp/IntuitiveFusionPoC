| Method | Path | operationId | Roles | Purpose | Notes |
|---|---|---|---|---|---|
| POST | `/auth/login` | login | public | Mock login; returns session cookie (HttpOnly) and user |  |
| POST | `/auth/logout` | logout | any signed-in | End session |  |
| POST | `/auth/forgot-password` | forgotPassword | public | Request reset; always returns 202 (no account enumeration) |  |
| GET | `/auth/me` | getMe | any signed-in | Current user and role-based home path |  |
| POST | `/auth/access-denied` | reportAccessDenied | any signed-in | Web route guard reports a blocked page visit so it is audited |  |
| GET | `/requests` | listRequests | REQUESTER, PROCUREMENT, DELEGATE, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, EXEC | List requests visible to caller (requesters see their own) |  |
| POST | `/requests` | createRequest | REQUESTER, PROCUREMENT | Create blank request |  |
| GET | `/requests/{id}` | getRequest | REQUESTER, PROCUREMENT, DELEGATE, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, EXEC | Get request |  |
| PATCH | `/requests/{id}` | updateRequest | REQUESTER, PROCUREMENT | Update request fields |  |
| POST | `/requests/{id}/submit` | submitRequest | REQUESTER, PROCUREMENT | Run budget check, complexity score and routing; submits | 409 if mandatory fields missing; 422 if hard-cap budget exceeded |
| POST | `/assistant/conversations` | startConversation | REQUESTER, PROCUREMENT | Start mock-AI conversation (simulated=true) |  |
| GET | `/assistant/conversations/{id}` | getConversation | REQUESTER, PROCUREMENT | Get conversation |  |
| POST | `/assistant/conversations/{id}/messages` | sendMessage | REQUESTER, PROCUREMENT | Send user text; returns assistant reply with proposed field changes |  |
| GET | `/plans` | listPlans | REQUESTER, PROCUREMENT, DELEGATE, LEGAL, PROBITY, EXEC | Plans visible to the caller (requesters see their own) |  |
| GET | `/requests/{id}/plan` | getPlan | REQUESTER, PROCUREMENT, DELEGATE, EVALUATOR, CHAIR, LEGAL, PROBITY, EXEC | Get (or lazily create from intake) the procurement plan |  |
| PUT | `/plans/{id}/fields/{key}` | updatePlanField | PROCUREMENT, REQUESTER | Set a field (or one paragraph); optimistic concurrency via expectedVersion | 409 on stale version; 423 if plan locked |
| POST | `/plans/{id}/instructions` | instructPlan | PROCUREMENT, REQUESTER | Plain-language amend ('change paragraph 3 to …') |  |
| POST | `/plans/{id}/instructions/undo` | undoInstruction | PROCUREMENT, REQUESTER | Undo last instruction by token |  |
| POST | `/plans/{id}/submit-for-approval` | submitPlan | PROCUREMENT | Move to approval; requires COI declarations and risk gates |  |
| POST | `/plans/{id}/decision` | decidePlan | DELEGATE, EXEC, PROBITY | Delegate approves/rejects within their delegation (locks on approval); the independent risk officer signs off the risk gate | 403 if value exceeds delegation; 409 if gates unmet |
| POST | `/plans/{id}/reopen` | reopenPlan | PROCUREMENT | Reopen locked plan with reason (Procurement only) |  |
| POST | `/plans/{id}/coi` | declarePlanCoi | PROCUREMENT, EVALUATOR, CHAIR, LEGAL, DELEGATE | Declare conflict (or none) |  |
| POST | `/coi/{id}/decision` | decideCoi | DELEGATE, EXEC, PROBITY | Delegate/Risk decides disposition |  |
| GET | `/tenders` | listTenders | PROCUREMENT, DELEGATE, EVALUATOR, CHAIR, LEGAL, PROBITY, EXEC, ADMIN | List tenders visible to caller (bid counts only; content stays sealed until close) |  |
| POST | `/tenders` | createTender | PROCUREMENT | Create tender and generate pack from request/plan |  |
| GET | `/tenders/{id}` | getTender | PROCUREMENT, DELEGATE, EVALUATOR, CHAIR, LEGAL, PROBITY, EXEC, ADMIN | Get tender |  |
| PUT | `/tenders/{id}/fields/{key}` | updateTenderField | PROCUREMENT, LEGAL | Edit a pack section while the tender is staged | 409 on stale version; 423 once published |
| POST | `/tenders/{id}/publish-permission` | grantPublishPermission | DELEGATE | ECV-appropriate delegate grants permission to publish | 403 if value exceeds the delegate's publishing authority |
| POST | `/tenders/{id}/publish` | publishTender | PROCUREMENT | Publish (needs permission, approved plan, statutory window valid) | 409 without permission or approved plan; 422 if statutory window not met |
| POST | `/tenders/{id}/invitations` | inviteSuppliers | PROCUREMENT | Invite supplier contacts; returns each one-time registration link (mail is simulated) | 409 if already invited |
| GET | `/tenders/{id}/questions` | listQuestions | PROCUREMENT, LEGAL, SUPPLIER | Questions (author never returned; suppliers see published ones only) |  |
| POST | `/tenders/{id}/questions/{questionId}/answer` | answerQuestion | PROCUREMENT, LEGAL | Draft the answer to a question (published to everyone via an addendum) | 409 once published |
| POST | `/tenders/{id}/addenda` | issueAddendum | PROCUREMENT | Publish answers/changes to all bidders |  |
| POST | `/supplier/register` | registerSupplier | public | Self-register from an invitation token (or, for open tenders, without one) | 400 invalid ABN checksum; 404 invalid invitation; 409 generic if already registered |
| GET | `/supplier/invitations/{token}` | getInvitation | public | Look up an invitation link to pre-fill registration (one generic 404 for unknown, used or expired) |  |
| GET | `/supplier/tenders` | listMyTenders | SUPPLIER | Tenders caller is invited to (plus open-access tenders) |  |
| GET | `/supplier/tenders/{id}` | getMyTender | SUPPLIER | One tender: pack, published Q&A and addenda, own bid | 404 (and audited) if not invited |
| POST | `/supplier/tenders/{id}/questions` | askQuestion | SUPPLIER | Ask anonymised question |  |
| POST | `/supplier/tenders/{id}/submission/files` | uploadBidFile | SUPPLIER | Upload one file (JSON, base64): allow-list, 10 MB, content check, scan stub, sealed storage | 400 type/name/content; 413 size; 409 BID_CLOSED after close or already submitted |
| DELETE | `/supplier/tenders/{id}/submission/files/{fileId}` | deleteBidFile | SUPPLIER | Remove a file from an unsubmitted bid | 409 once submitted (withdraw first) or closed |
| POST | `/supplier/tenders/{id}/submission` | submitBid | SUPPLIER | Submit; issues a receipt; refused after the closing time | 409 BID_CLOSED after closesAt (late attempt discarded and notified); 409 SUBMISSION_INCOMPLETE without technical and commercial files |
| POST | `/supplier/tenders/{id}/submission/withdraw` | withdrawBid | SUPPLIER | Withdraw a submitted bid before close so files can be changed | 409 after close |
| GET | `/suppliers/{id}` | getSupplier | PROCUREMENT, LEGAL, FINANCE, ADMIN | Supplier profile with sanctions/insurance status |  |
| GET | `/evaluations` | listEvaluations | PROCUREMENT, EVALUATOR, CHAIR, DELEGATE, PROBITY, LEGAL, EXEC | Evaluations the caller can see, plus (procurement) closed tenders ready to evaluate |  |
| GET | `/evaluators` | listEvaluators | PROCUREMENT | Users who can sit on a panel |  |
| POST | `/tenders/{id}/evaluation` | openEvaluation | PROCUREMENT | Open the evaluation of a closed tender: one record per submitted bid, scoring sheet from the published criteria, panel chosen by procurement | 409 unless the tender is closed, has bids and is scored for award; 400 if the panel lacks a stream |
| POST | `/evaluations/{id}/panel` | addPanelMember | PROCUREMENT | Add a replacement panel member (before consensus) |  |
| GET | `/evaluations/{id}` | getEvaluation | PROCUREMENT, EVALUATOR, CHAIR, DELEGATE, PROBITY, LEGAL, EXEC | Get the evaluation as the caller may see it: suppliers anonymised and files withheld until a panel member declares no conflict; criteria and files limited to their stream; others' scores hidden until consensus | 404 for anyone not on the panel (and for removed members) |
| POST | `/evaluations/{id}/coi` | declareEvalCoi | EVALUATOR, CHAIR | Mandatory conflict declaration before any access; a conflict suspends the member at once, alerts chair, probity and procurement, and goes to a delegate to decide |  |
| GET | `/evaluations/{id}/scores/mine` | getMyScores | EVALUATOR, CHAIR | Own scores and progress only | 403 COI_REQUIRED until declared |
| PUT | `/evaluations/{id}/scores` | saveScores | EVALUATOR, CHAIR | Save own scores for one supplier (hidden from everyone else) | 404 for a criterion outside the caller's stream; 409 once marked complete |
| POST | `/evaluations/{id}/conflicts/{userId}/decision` | decideEvalConflict | DELEGATE, EXEC | Delegate (or executive) decides a declared conflict: immaterial or manageable reinstates the evaluator, material removes them | 409 if nothing is waiting; 403 for your own conflict |
| POST | `/evaluations/{id}/scores/submit` | submitScores | EVALUATOR, CHAIR | Mark own scoring complete (every supplier on every allowed criterion) | 409 SCORING_INCOMPLETE |
| POST | `/evaluations/{id}/consensus/open` | openConsensus | CHAIR | Chair opens consensus once every member has finished; variance is computed and flagged | 409 SCORING_PENDING |
| PUT | `/evaluations/{id}/consensus/{supplierId}` | setConsensus | CHAIR | Record consensus scores and rationale for one supplier |  |
| POST | `/evaluations/{id}/consensus/reopen` | reopenConsensus | CHAIR | Chair reopens a locked consensus with a recorded reason; any report is invalidated and must be generated again | 409 once the report is approved |
| POST | `/evaluations/{id}/consensus/lock` | lockConsensus | CHAIR | Lock consensus; refused while any flagged score lacks a rationale | 409 FLAGS_UNRESOLVED / CONSENSUS_INCOMPLETE |
| POST | `/evaluations/{id}/report` | generateReport | PROCUREMENT | Generate the evaluation report from the locked consensus |  |
| POST | `/evaluation-reports/{id}/decision` | decideReport | DELEGATE, EXEC | Delegate (within their authority) or executive approves or returns the report | 403 if the award value exceeds the approver's authority |
| GET | `/evaluations/{id}/report/pdf` | exportReportPdf | PROCUREMENT, DELEGATE, EXEC, PROBITY, LEGAL, CHAIR | The evaluation report as a PDF carrying its generation time and version on every page | 404 until a report exists |
| GET | `/evaluations/{id}/suppliers/{supplierId}/files/{fileId}` | downloadBidFile | EVALUATOR, CHAIR, PROCUREMENT, PROBITY, LEGAL | Download one bid file (panel members only after declaring no conflict, and only files of their stream) | 404 for any file the caller may not see |
| POST | `/contracts` | draftContract | LEGAL, PROCUREMENT | Draft from approved report: template for the tender route + clause library + winning supplier data. Value defaults to the request estimate (bid prices are not captured) | 422 SUPPLIER_NOT_RECOMMENDED unless the supplier is ranked first; 409 CONTRACT_EXISTS |
| GET | `/contracts` | listContracts | PROCUREMENT, LEGAL, CONTRACT_MGR, DELEGATE, EXEC, FINANCE, PROBITY | Contracts visible to caller |  |
| GET | `/contracts/awards` | listContractAwards | LEGAL, PROCUREMENT | Approved evaluations and whom the report recommends, with any contract already drafted |  |
| PATCH | `/contracts/{id}` | updateContractTerms | LEGAL, PROCUREMENT | Change value, dates or notice period of a draft; unedited clauses follow | 423 when executed |
| DELETE | `/contracts/{id}` | deleteContract | LEGAL, EXEC | Logical delete with a reason (the record is kept and audited) |  |
| GET | `/contracts/{id}` | getContract | PROCUREMENT, LEGAL, CONTRACT_MGR, DELEGATE, EXEC, FINANCE, PROBITY | Get contract |  |
| PUT | `/contracts/{id}/clauses/{clauseId}` | updateClause | LEGAL | Edit clause; a change from the template is marked (blocked when locked) | 423 CONTRACT_LOCKED when executed; 422 MANDATORY_CLAUSE |
| POST | `/contracts/{id}/release-for-signing` | releaseForSigning | LEGAL, PROCUREMENT | Release the reviewed draft for signing | 422 RELEASE_BLOCKED lists what is missing; procurement can release only after legal review |
| POST | `/contracts/{id}/sign` | signContract | DELEGATE, EXEC | Mock e-signature with a stamp (name, role, time); signing authority is checked separately from sourcing approval. Above 1M the executive co-signs. REJECT returns the contract to legal | 403 SIGNING_AUTHORITY_INSUFFICIENT; 409 ALREADY_SIGNED; 423 once executed |
| GET | `/contracts/{id}/alerts` | listAlerts | CONTRACT_MGR, PROCUREMENT, LEGAL, EXEC | Alerts of the contract with their delivery log (due alerts fire first) |  |
| GET | `/alerts` | listAllAlerts | CONTRACT_MGR, PROCUREMENT, LEGAL, EXEC | All contract alerts, soonest first (due alerts fire first) |  |
| POST | `/contracts/{id}/alerts` | createAlert | CONTRACT_MGR | Create alert from plain-language instruction |  |
| GET | `/dashboard/kpis` | getKpis | REQUESTER, PROCUREMENT, DELEGATE, EVALUATOR, CHAIR, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, ADMIN, EXEC | Role-scoped KPIs (staff only; requesters see their own requests) |  |
| GET | `/reports/expiring-contracts` | expiringContracts | CONTRACT_MGR, PROCUREMENT, EXEC, LEGAL | Executed contracts ending within N days (default 90), soonest first, with the term and optional extensions for the Gantt chart |  |
| GET | `/audit-events` | listAuditEvents | PROBITY, ADMIN, EXEC, PROCUREMENT | Search audit trail |  |
| GET | `/audit-events/export` | exportAudit | PROBITY, ADMIN | Export audit report (CSV); the export is itself audited | text/csv |
| GET | `/reports/spend` | spendReport | EXEC, FINANCE, PROCUREMENT | Spend by category/supplier (seed data) | Stub in POC (returns ComingSoon) |
| GET | `/notifications` | listNotifications | any signed-in | My notifications |  |
| POST | `/notifications/{id}/read` | markRead | any signed-in | Mark read |  |
| GET | `/admin/users` | adminListUsers | ADMIN | List users |  |
| POST | `/admin/users` | adminCreateUser | ADMIN | Create user |  |
| GET | `/admin/delegations` | listDelegations | ADMIN, EXEC | Delegations of authority |  |
| PUT | `/admin/delegations/{id}` | updateDelegation | ADMIN | Change threshold; audited |  |
| GET | `/admin/workflows` | listWorkflows | ADMIN, PROCUREMENT | Workflow library |  |
| GET | `/admin/templates` | listTemplates | ADMIN, PROCUREMENT, LEGAL | Template library (read-only in POC) |  |
| POST | `/migration/uploads` | uploadMigration | ADMIN, CONTRACT_MGR | Validate legacy contract CSV (profiling only in POC) | multipart/form-data |
| GET | `/features/{key}` | getFeatureStatus | any signed-in | Feature availability for Coming-soon screens |  |
