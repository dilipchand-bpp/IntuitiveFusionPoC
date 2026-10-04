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
| GET | `/tenders/{id}/pack/pdf` | exportTenderPackPdf | PROCUREMENT, DELEGATE, LEGAL, PROBITY, EXEC | The tender pack as a PDF with status, version and timestamp (US-TND-05) | application/pdf |
| GET | `/tenders/{id}/pack/docx` | exportTenderPackDocx | PROCUREMENT, DELEGATE, LEGAL, PROBITY, EXEC | The tender pack as a Word document | Word .docx |
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
| GET | `/suppliers` | listSuppliers | PROCUREMENT, LEGAL, FINANCE, ADMIN | Supplier directory with sanctions and insurance status |  |
| GET | `/suppliers/{id}` | getSupplier | PROCUREMENT, LEGAL, FINANCE, ADMIN | Supplier profile: status, contacts, tenders bid on, contracts held |  |
| POST | `/suppliers/{id}/contacts` | addSupplierContact | PROCUREMENT | A buyer adds a contact to an existing supplier; returns a one-time activation link (no email is sent in the proof of concept) | 409 EMAIL_IN_USE |
| GET | `/supplier/activate/{token}` | getActivation | public | Look up an activation link (one generic 404 for unknown, used or expired) |  |
| POST | `/supplier/activate` | activateContact | public | Set a password with a one-time activation link |  |
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
| PUT | `/evaluations/{id}/variance-limit` | setVarianceLimit | CHAIR | Chair sets the variance limit (5 to 60 percent) before consensus opens | 409 once consensus has opened |
| POST | `/evaluations/{id}/probity-signoff` | probitySignoff | PROBITY | Probity advisor records that the process was followed (after the lock); a record, not a gate on the award | 409 before the lock or if already signed off |
| GET | `/evaluations/{id}/report/docx` | exportReportDocx | PROCUREMENT, DELEGATE, EXEC, PROBITY, LEGAL, CHAIR | The evaluation report as a Word document (same content as the PDF) | 404 until a report exists |
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
| PUT | `/contracts/{id}/milestones` | setContractMilestones | CONTRACT_MGR, LEGAL, PROCUREMENT | Replace the milestones of an executed contract (within its term); scheduled reminders follow | 422 MILESTONE_OUTSIDE_TERM |
| PUT | `/contracts/{id}/extensions` | setContractExtensions | CONTRACT_MGR, LEGAL, PROCUREMENT | Replace the optional extensions (months) of an executed contract |  |
| PUT | `/contracts/{id}/owner` | setContractOwner | CONTRACT_MGR, LEGAL, PROCUREMENT | Change the contract owner to a contract manager | 422 NOT_A_CONTRACT_MANAGER |
| POST | `/contracts/{id}/variations` | createVariation | LEGAL, PROCUREMENT | Create a variation of an executed contract: a child contract with cumulative value tracking, drafted, reviewed and signed like any contract | 409 VARIATION_OPEN; 422 EMPTY_VARIATION; signing authority is judged on the cumulative value |
| PUT | `/contracts/{id}/deviations/{clauseId}/risk` | setDeviationRisk | LEGAL | Legal amends the proposed risk rating of a deviation |  |
| POST | `/contracts/{id}/deviations/{clauseId}/decision` | decideDeviation | DELEGATE, EXEC | A delegate approves or rejects a deviation; a mandatory or high-risk change must be approved before release |  |
| PUT | `/contracts/{id}/clauses/{clauseId}` | updateClause | LEGAL | Edit clause; a change from the template is marked (blocked when locked) | 423 CONTRACT_LOCKED when executed; 422 MANDATORY_CLAUSE |
| POST | `/contracts/{id}/release-for-signing` | releaseForSigning | LEGAL, PROCUREMENT | Release the reviewed draft for signing | 422 RELEASE_BLOCKED lists what is missing; procurement can release only after legal review |
| POST | `/contracts/{id}/sign` | signContract | DELEGATE, EXEC | Mock e-signature with a stamp (name, role, time); signing authority is checked separately from sourcing approval. Above 1M the executive co-signs. REJECT returns the contract to legal | 403 SIGNING_AUTHORITY_INSUFFICIENT; 409 ALREADY_SIGNED; 423 once executed |
| GET | `/contracts/{id}/alerts` | listAlerts | CONTRACT_MGR, PROCUREMENT, LEGAL, EXEC | Alerts of the contract with their delivery log (due alerts fire first) |  |
| GET | `/alerts` | listAllAlerts | CONTRACT_MGR, PROCUREMENT, LEGAL, EXEC | All contract alerts, soonest first (due alerts fire first) |  |
| POST | `/contracts/{id}/alerts` | createAlert | CONTRACT_MGR, PROCUREMENT, LEGAL, EXEC | Create a custom alert from a plain-language instruction such as: alert me 1 year before expiry and include whoever is my manager then. The recipients are resolved when it fires | 422 ALERT_NOT_UNDERSTOOD explains what to type |
| GET | `/dashboard/kpis` | getKpis | REQUESTER, PROCUREMENT, DELEGATE, EVALUATOR, CHAIR, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, ADMIN, EXEC | Role-scoped KPIs (staff only; requesters see their own requests) |  |
| GET | `/reports/expiring-contracts` | expiringContracts | CONTRACT_MGR, PROCUREMENT, EXEC, LEGAL | Executed contracts ending within N days (default 90), soonest first, with the term and optional extensions for the Gantt chart |  |
| GET | `/audit-events` | listAuditEvents | PROBITY, ADMIN, EXEC, PROCUREMENT | Search the audit trail (newest first, with field-level before and after). requestId returns the whole trail of one procurement: its plan, tender, evaluation, report and contract |  |
| GET | `/audit-events/export` | exportAudit | PROBITY, ADMIN | Export the audit report as CSV with the same filters (no paging); the export is itself audited and not part of its own file | text/csv; 422 above 20,000 rows |
| GET | `/reports/workload` | workloadReport | PROCUREMENT, EXEC | Procurements and value per owner, and a timeline of each active procurement |  |
| GET | `/reports/spend` | spendReport | EXEC, FINANCE, PROCUREMENT | Spend by category (with drill-down) and by supplier; pipeline (active requests), committed (executed contracts and variations) and off-contract spend |  |
| GET | `/reports/procurements` | procurementTable | REQUESTER, PROCUREMENT, DELEGATE, EVALUATOR, CHAIR, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, ADMIN, EXEC | Procurement table with completion indicators, scoped to the caller (portfolio, panel or own) |  |
| GET | `/notifications` | listNotifications | any signed-in | My notifications |  |
| POST | `/notifications/{id}/read` | markRead | any signed-in | Mark read |  |
| GET | `/admin/users` | adminListUsers | ADMIN | List staff users with their roles (read only; suppliers are not listed) |  |
| POST | `/admin/users` | adminCreateUser | ADMIN | Create a staff user with roles; the person sets their own password through a one-time link (shown once). ADMIN cannot be combined with another role | 409 EMAIL_IN_USE; 422 ROLE_COMBINATION |
| PUT | `/admin/users/{id}` | adminUpdateUser | ADMIN | Change name, roles, organisation unit or active state; a role change or switch-off ends their sessions; not for yourself | 403 for yourself; 422 ROLE_COMBINATION |
| POST | `/admin/users/{id}/activation-link` | adminActivationLink | ADMIN | Issue a new one-time activation link (earlier ones stop working) |  |
| GET | `/admin/org-units` | adminListOrgUnits | ADMIN | Organisation units |  |
| GET | `/admin/delegations` | listDelegations | ADMIN, EXEC | Delegations of authority |  |
| POST | `/admin/delegations` | createDelegation | ADMIN | Grant a limit to a person (or role); audited; applies to the next approval or signature | 409 DELEGATION_EXISTS; 403 for oneself |
| PUT | `/admin/delegations/{id}` | updateDelegation | ADMIN | Change a threshold or switch it off; audited; effective immediately; the person is notified |  |
| GET | `/admin/alert-settings` | getAlertSettings | ADMIN | Contract alert lead times in days |  |
| PUT | `/admin/alert-settings` | setAlertSettings | ADMIN | Change the lead times; scheduled alerts of executed contracts move at once; audited |  |
| PUT | `/admin/workflows/{id}` | updateWorkflow | ADMIN | Edit the simple workflow (steps, order, optional); a mandatory approval checkpoint must stay. Other workflows answer 409 NOT_EDITABLE (coming soon) | 422 CHECKPOINT_REQUIRED, DUPLICATE_STEP |
| GET | `/admin/workflows` | listWorkflows | ADMIN, PROCUREMENT | Workflow library |  |
| GET | `/admin/templates` | listTemplates | ADMIN, PROCUREMENT, LEGAL | Template library (read-only in POC) |  |
| GET | `/features/{key}` | getFeatureStatus | any signed-in | Feature availability for Coming-soon screens |  |
| GET | `/admin/settings` | getSettings | ADMIN | All tenant settings: numbering, labels, custom fields, checkpoints, intake rules, notification rules, workflow routing |  |
| PUT | `/admin/settings` | updateSettings | ADMIN | Replace one or more settings sections; every change is audited with the old and new values |  |
| GET | `/settings` | getPublicSettings | any signed-in | The settings every screen needs: field labels, custom fields and the caller's layout |  |
| POST | `/admin/notifications/run-escalations` | runEscalations | ADMIN | Escalate approvals that have waited longer than the configured period (also runs on a schedule) |  |
| GET | `/admin/notification-log` | listNotificationLog | ADMIN | Recent notification deliveries by channel (simulated in the proof of concept) |  |
| POST | `/admin/erp-mapping/preview` | previewErpMapping | ADMIN | Try the ERP field-name mapping on a sample record, inbound or outbound |  |
| POST | `/requests/{id}/taxonomy` | confirmTaxonomy | REQUESTER, PROCUREMENT | Confirm (or replace with your own) the preliminary classification code |  |
| GET | `/requests/{id}/suggested-suppliers` | listSuggestedSuppliers | REQUESTER, PROCUREMENT, DELEGATE, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, EXEC | Suppliers from the in-house directory that fit the request's category, with contacts |  |
| PUT | `/requests/{id}/suggested-suppliers` | amendSuggestedSuppliers | REQUESTER, PROCUREMENT | Choose which of the suggested suppliers to keep |  |
| GET | `/requests/{id}/ecv` | getEcv | REQUESTER, PROCUREMENT, DELEGATE, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, EXEC | Estimated contract value calculator: the saved inputs, or the request value as a start |  |
| PUT | `/requests/{id}/ecv` | calculateEcv | REQUESTER, PROCUREMENT | Calculate the estimated contract value; with apply=true it becomes the request value and drives routing |  |
| GET | `/requests/{id}/artefacts` | listArtefacts | REQUESTER, PROCUREMENT, DELEGATE, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, EXEC | What the request has filled in downstream: plan, tender, scoring sheet, report, contract |  |
| GET | `/requests/{id}/delegates` | listStageDelegates | REQUESTER, PROCUREMENT, DELEGATE, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, EXEC | The delegate for each approval stage, by value, and who actually signed |  |
| PUT | `/requests/{id}/delegates/{stage}` | redirectStageDelegate | PROCUREMENT | Procurement redirects a stage to another person who holds enough authority; history is not rewritten |  |
| GET | `/requests/{id}/process-variations` | listProcessVariations | REQUESTER, PROCUREMENT, DELEGATE, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, EXEC | Changes to this procurement's workflow steps and their approval |  |
| POST | `/requests/{id}/process-variations` | requestProcessVariation | REQUESTER, PROCUREMENT | Ask to add or remove a workflow step for this procurement only; a delegate must approve |  |
| POST | `/requests/{id}/process-variations/{variationId}/decision` | decideProcessVariation | DELEGATE, EXEC | A delegate approves or rejects a change to the process; the approval basis is recorded |  |
| GET | `/plans/{id}/esg` | getPlanEsg | REQUESTER, PROCUREMENT, DELEGATE, LEGAL, PROBITY, EXEC | ESG and social objectives set on the plan |  |
| PUT | `/plans/{id}/esg` | setPlanEsg | PROCUREMENT, REQUESTER | Set carbon, local labour, diversity and socio-economic objectives; they carry into the tender pack | 423 if the plan is locked |
| POST | `/migration/uploads` | uploadMigration | ADMIN, CONTRACT_MGR | Upload a legacy contract extract (CSV text); it is profiled for missing fields, unparseable dates and values and duplicates |  |
| GET | `/migration/batches` | listMigrationBatches | ADMIN, CONTRACT_MGR | Migration batches and their counts |  |
| GET | `/migration/batches/{id}` | getMigrationBatch | ADMIN, CONTRACT_MGR | One batch with every record, its issues and what the contract text yielded |  |
| GET | `/migration/batches/{id}/exceptions.csv` | exportMigrationExceptions | ADMIN, CONTRACT_MGR | The exceptions report as CSV (audited) |  |
| PUT | `/migration/records/{id}` | fixMigrationRecord | ADMIN, CONTRACT_MGR | Correct a record; it is checked again |  |
| POST | `/migration/records/{id}/skip` | skipMigrationRecord | ADMIN, CONTRACT_MGR | Set a record aside with a reason |  |
| POST | `/migration/batches/{id}/cutover` | cutoverMigrationBatch | ADMIN | Load the batch; refused while any exception is unreviewed |  |
| GET | `/auth/mfa` | getMfaStatus | any signed-in | Is an authenticator app set up for this account |  |
| POST | `/auth/mfa/enroll` | enrollMfa | any signed-in | Start setting up an authenticator app; the secret is shown once |  |
| POST | `/auth/mfa/confirm` | confirmMfa | any signed-in | Finish set-up with a code from the app |  |
| DELETE | `/auth/mfa` | removeMfa | any signed-in | Remove the authenticator app (refused when the organisation requires it) |  |
| POST | `/auth/mfa/verify` | verifyMfa | public | Complete a password sign-in with the one-time code |  |
| GET | `/auth/sso/config` | getSsoConfig | public | Whether single sign-on is available and whether it is the only way in |  |
| POST | `/auth/sso/simulate` | simulateSso | public | Simulated identity provider: issues an ID token for a demo person (not available in production) |  |
| POST | `/auth/sso/callback` | ssoCallback | public | Complete single sign-on from an ID token; checks signature, issuer, audience, expiry and nonce |  |
| PUT | `/admin/users/{id}/role-expiry` | setRoleExpiry | ADMIN | Make a role time-bound: access ends on the date (or clear the date) |  |
| POST | `/admin/grants/sweep` | sweepGrants | ADMIN | Remove ended grants, end their sessions and tell the people involved (also runs on a schedule) |  |
| POST | `/suppliers/{id}/contacts/{userId}/deprovision` | deprovisionContact | PROCUREMENT | Switch a departed contact off: no sign-in, open links void, sessions ended |  |
| POST | `/suppliers/{id}/contacts/{userId}/reassign` | reassignContact | PROCUREMENT | Replace a contact with someone else; the old access ends and the new person gets a one-time link |  |
| POST | `/tenders/{id}/late-permissions` | grantLatePermission | PROCUREMENT | Let one supplier submit after the closing time, with a reason and a short expiry; audited and told by email |  |
| GET | `/tenders/{id}/late-permissions` | listLatePermissions | PROCUREMENT, DELEGATE, LEGAL, PROBITY, EXEC | Late-submission permissions granted on this tender |  |
| DELETE | `/tenders/{id}/late-permissions/{permissionId}` | revokeLatePermission | PROCUREMENT | Withdraw a late-submission permission |  |
| GET | `/tenders/{id}/stages` | listTenderStages | PROCUREMENT, LEGAL, DELEGATE, EXEC, PROBITY | The stages of this procurement and where each stands |  |
| POST | `/tenders/{id}/shortlist` | shortlistSuppliers | PROCUREMENT | Shortlist suppliers after evaluation: creates the next stage's own pack, invites the shortlisted, tells the unsuccessful |  |
| GET | `/tenders/{id}/deviations` | getDeviationRegister | LEGAL, PROCUREMENT | Contract changes suppliers proposed (sealed until the tender closes) |  |
| PUT | `/tender-deviations/{id}` | assessDeviation | LEGAL | Legal rates the risk, comments and sets the status of a proposed change |  |
| GET | `/tenders/{id}/deviations/export.xlsx` | exportDeviationsXlsx | LEGAL, PROCUREMENT | The deviation register as an Excel workbook (audited) |  |
| GET | `/tenders/{id}/deviations/export.docx` | exportDeviationsDocx | LEGAL, PROCUREMENT | The deviation register as a Word document (audited) |  |
| GET | `/tenders/{id}/notices` | listPublicNotices | PROCUREMENT, LEGAL, DELEGATE, EXEC, PROBITY | Notices routed to public registers (simulated) |  |
| POST | `/suppliers/{id}/sanctions-review` | reviewSanctionsMatch | PROCUREMENT, LEGAL | Release or confirm a screening match; a held supplier cannot see tender documents until released |  |
| GET | `/admin/email-log` | listEmailLog | ADMIN, PROCUREMENT | Email that would have been sent (simulated) |  |
| POST | `/supplier/tenders/{id}/deviations` | proposeDeviation | SUPPLIER | Propose a change to a contract clause as part of the response |  |
| GET | `/supplier/tenders/{id}/deviations` | listMyDeviations | SUPPLIER | The changes this supplier proposed |  |
| DELETE | `/supplier/tenders/{id}/deviations/{deviationId}` | withdrawDeviation | SUPPLIER | Withdraw a proposed change while the tender is open |  |
| GET | `/supplier/onboarding-questions` | listOnboardingQuestions | public | The organisation's own registration questions |  |
| GET | `/supplier/profile` | getSupplierProfile | SUPPLIER | The supplier's own profile: screening and insurance status, privacy choices, contacts |  |
| PUT | `/supplier/profile/privacy` | setSupplierPrivacy | SUPPLIER | Change the supplier's privacy choices |  |
| PUT | `/supplier/profile/insurance` | setSupplierInsurance | SUPPLIER | Record the current insurance certificate |  |
| POST | `/supplier/contacts` | addSupplierContact | SUPPLIER | Add a colleague; they receive a one-time link through the person who added them |  |
| POST | `/supplier/contacts/{userId}/deprovision` | removeSupplierContact | SUPPLIER | End a colleague's access; sessions end and they are told |  |
