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
| POST | `/evaluations/{id}/conflicts/{userId}/decision` | decideEvalConflict | DELEGATE, EXEC, PROBITY | A delegate, the executive or the probity advisor decides a declared conflict: immaterial reinstates the evaluator, minor reinstates them but excludes one supplier, material removes them | 409 if nothing is waiting; 403 for your own conflict |
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
| POST | `/contracts/{id}/deviations/{clauseId}/decision` | decideDeviation | DELEGATE, EXEC, PROBITY | A delegate approves or rejects a deviation; a mandatory or high-risk change must be approved before release | A non-negotiable clause needs General Counsel (executive) or the risk delegate (probity); 403 PROTECTED_CLAUSE otherwise |
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
| GET | `/criteria-library` | getCriteriaLibrary | PROCUREMENT, ADMIN, CHAIR, DELEGATE, PROBITY, EXEC | The pre-populated criteria library an evaluation's criteria are chosen from |  |
| PUT | `/evaluations/{id}/criteria` | setEvaluationCriteria | PROCUREMENT | Set this evaluation's criteria before scoring opens (weights add to 100); each stage can differ | 409 once scoring has opened; 400 unless weights add to 100 |
| POST | `/evaluations/{id}/compliance/run` | runComplianceGate | PROCUREMENT | Run the mandatory pass or fail checks again; each newly failing check sends the supplier a clarification request |  |
| POST | `/evaluations/{id}/compliance/{supplierId}/{key}/waive` | waiveComplianceCheck | PROCUREMENT, DELEGATE | Waive a failed check with a recorded reason; probity is told |  |
| POST | `/evaluations/{id}/clarifications` | requestClarification | PROCUREMENT | Ask a bidder to clarify, with a response deadline; the supplier is told in the app and by email |  |
| GET | `/evaluations/{id}/clarifications` | listClarifications | PROCUREMENT, DELEGATE, LEGAL, PROBITY, EXEC, CHAIR | Clarification requests and answers for this evaluation |  |
| POST | `/clarifications/{id}/close` | closeClarification | PROCUREMENT | Close a clarification request |  |
| GET | `/evaluations/{id}/bafo` | listBafoRounds | PROCUREMENT, DELEGATE, LEGAL, PROBITY, EXEC, CHAIR | Best and final offer rounds; offers stay sealed until a round closes and the original bids are untouched |  |
| POST | `/evaluations/{id}/bafo` | openBafoRound | PROCUREMENT | Open a controlled mini-tender for updated pricing from chosen suppliers |  |
| POST | `/bafo-rounds/{id}/close` | closeBafoRound | PROCUREMENT | Close a round (rounds also close at their time) |  |
| POST | `/bafo-offers/{id}/accept` | acceptBafoOffer | PROCUREMENT | Accept an offer: its total cost replaces the supplier's original for ranking, and the draft report is rebuilt |  |
| GET | `/evaluations/{id}/negotiation-advice` | getNegotiationAdvice | PROCUREMENT, DELEGATE, EXEC | Suggested discounts, clauses and insurance to negotiate, from pricing and terms against the other bids (simulated model) |  |
| POST | `/evaluations/{id}/panel/{userId}/substitute` | substituteEvaluator | PROCUREMENT | Replace an evaluator: their marks stay as read-only history, the replacement declares a conflict and starts with a clean scoring matrix |  |
| POST | `/evaluations/{id}/coi/redeclare` | redeclareEvalCoi | EVALUATOR, CHAIR | Confirm the conflict declaration again once supplier identities are visible; a conflict suspends the member |  |
| GET | `/evaluations/{id}/coi/status` | getCoiStatus | PROCUREMENT, PROBITY, CHAIR, DELEGATE, EXEC | Who has declared, who has confirmed again, and who is outstanding |  |
| POST | `/evaluations/{id}/coi/remind` | remindCoi | PROCUREMENT, CHAIR | Remind members who still owe a declaration (reminders also go out on a schedule) |  |
| POST | `/evaluation-reports/{id}/coi` | declareReportCoi | PROCUREMENT, DELEGATE, EXEC, CHAIR, PROBITY, LEGAL | Declare a conflict of interest at the report stage, as at the plan |  |
| GET | `/evaluation-reports/{id}/coi` | listReportCoi | PROCUREMENT, DELEGATE, EXEC, CHAIR, PROBITY, LEGAL | Conflict declarations made on the report |  |
| POST | `/evaluation-reports/{id}/coi/{coiId}/decision` | decideReportCoi | DELEGATE, EXEC, PROBITY | Decide a conflict declared on the report; a material conflict stops that person approving |  |
| POST | `/evaluations/{id}/scores/plain` | enterPlainScores | EVALUATOR, CHAIR | Scores and commentary in plain language: read back for confirmation, saved only when apply is true |  |
| PUT | `/evaluations/{id}/ranking` | enterRanking | EVALUATOR, CHAIR | Ranking evaluations: order every supplier once, first to last |  |
| POST | `/evaluations/{id}/ranking/plain` | enterPlainRanking | EVALUATOR, CHAIR | Ranking in plain language, for example B first then A then C |  |
| GET | `/tenders/{id}/probity-advisors` | listProbityAdvisors | PROCUREMENT, ADMIN, PROBITY | Probity advisors allocated to this procurement and those available |  |
| POST | `/tenders/{id}/probity-advisors` | allocateProbityAdvisor | PROCUREMENT, ADMIN | Allocate an external probity advisor to this procurement |  |
| DELETE | `/tenders/{id}/probity-advisors/{userId}` | deallocateProbityAdvisor | PROCUREMENT, ADMIN | Remove an advisor's allocation |  |
| GET | `/probity/portal` | getProbityPortal | PROBITY | The advisor's read-only oversight portal: only the procurements they are allocated to |  |
| POST | `/evaluations/{id}/hold` | holdEvaluation | PROBITY | System hold: freeze the evaluation workspace on suspected bias or a process breach |  |
| POST | `/evaluations/{id}/release` | releaseEvaluation | PROBITY | Release a hold |  |
| GET | `/evaluations/{id}/probity` | listProbityDocuments | PROCUREMENT, DELEGATE, LEGAL, PROBITY, EXEC, CHAIR | The probity plan and probity outcomes report |  |
| PUT | `/evaluations/{id}/probity/{kind}` | saveProbityDocument | PROBITY | Author the probity plan (PLAN) or outcomes report (OUTCOMES) in the platform; editing a signed document starts a new version |  |
| POST | `/evaluations/{id}/probity/{kind}/upload` | uploadProbityDocument | PROBITY | Upload the probity plan or outcomes report as a file (base64) |  |
| POST | `/evaluations/{id}/probity/{kind}/sign` | signProbityDocument | PROBITY | Sign off the current version with a profile stamp attributed to the advisor |  |
| GET | `/evaluations/{id}/probity/{kind}/pdf` | exportProbityPdf | PROCUREMENT, DELEGATE, LEGAL, PROBITY, EXEC, CHAIR | The authored document as a PDF with the sign-off stamp (audited) |  |
| GET | `/evaluations/{id}/probity/{kind}/docx` | exportProbityDocx | PROCUREMENT, DELEGATE, LEGAL, PROBITY, EXEC, CHAIR | The authored document as a Word file with the sign-off stamp (audited) |  |
| GET | `/evaluations/{id}/probity/{kind}/file` | downloadProbityFile | PROCUREMENT, DELEGATE, LEGAL, PROBITY, EXEC, CHAIR | The uploaded file (audited) |  |
| GET | `/supplier/clarifications` | listMyClarifications | SUPPLIER | Clarification and compliance requests addressed to this supplier |  |
| POST | `/supplier/clarifications/{id}/response` | answerClarification | SUPPLIER | Answer a request before its deadline |  |
| GET | `/supplier/tenders/{id}/pricing` | getMyPricing | SUPPLIER | The supplier's own bid pricing (total cost of ownership) |  |
| PUT | `/supplier/tenders/{id}/pricing` | setMyPricing | SUPPLIER | Enter price, implementation and running costs so total cost of ownership can be compared |  |
| GET | `/supplier/bafo` | listMyBafoRounds | SUPPLIER | Best and final offer rounds the supplier is invited to, with their own offers |  |
| PUT | `/supplier/bafo/{id}/offer` | submitBafoOffer | SUPPLIER | Submit a new offer revision while the round is open; the original bid is unchanged |  |
| GET | `/contracts/{id}/checks` | getContractChecks | PROCUREMENT, LEGAL, CONTRACT_MGR, DELEGATE, EXEC, FINANCE, PROBITY | The tender cross-check, vendor pre-flight and counterparty re-check results, and whether negotiation has locked signing |  |
| POST | `/contracts/{id}/checks/run` | runContractChecks | LEGAL, PROCUREMENT | Run the tender cross-check and the vendor pre-flight (legal name, tax, banking) now |  |
| POST | `/contracts/{id}/checks/{kind}/{key}/review` | reviewContractCheck | LEGAL, PROCUREMENT | Review a failed or flagged check with a recorded reason so it no longer blocks |  |
| POST | `/contracts/{id}/recheck` | recheckCounterparty | LEGAL, PROCUREMENT | Run sanctions and financial risk checks again; unlocks signing after a long negotiation when they pass |  |
| POST | `/contracts/{id}/endorse` | endorseContract | LEGAL, FINANCE | Endorse before release (legal, finance) where the organisation requires it |  |
| PUT | `/contracts/{id}/signing-mode` | setSigningMode | LEGAL, PROCUREMENT | STANDARD, BLIND (signatories see no one else's signature) or STAGED (signed in sequence), set before release |  |
| GET | `/contracts/{id}/signing` | getSigningProgress | PROCUREMENT, LEGAL, CONTRACT_MGR, DELEGATE, EXEC, FINANCE, PROBITY | Who was invited to sign, who has seen the contract, reminders sent, and who has signed |  |
| POST | `/contracts/{id}/signing/remind` | remindSigners | LEGAL, PROCUREMENT | Remind the signatories who have not signed |  |
| POST | `/contracts/{id}/questions` | askContractQuestion | DELEGATE, EXEC, LEGAL, PROCUREMENT | A signatory or reviewer raises a question before signing |  |
| GET | `/contracts/{id}/questions` | listContractQuestions | PROCUREMENT, LEGAL, CONTRACT_MGR, DELEGATE, EXEC, FINANCE, PROBITY | Questions raised about the contract, from the business and from the supplier, with answers |  |
| POST | `/contract-questions/{id}/answer` | answerContractQuestion | LEGAL | Legal answers a question |  |
| GET | `/contracts/{id}/risk-summary` | getContractRiskSummary | DELEGATE, EXEC, LEGAL, PROCUREMENT | An auto-populated summary of the risks in signing (simulated model); refresh=true regenerates it |  |
| PUT | `/contracts/{id}/risk-summary` | editContractRiskSummary | LEGAL | Legal edits the summary before it goes to the delegate |  |
| POST | `/contracts/{id}/risk-summary/review` | reviewContractRiskSummary | LEGAL | Legal confirms the summary after review |  |
| POST | `/contracts/documents` | createSigningDocument | LEGAL, PROCUREMENT | Create an NDA, confidentiality agreement or master agreement signed the same way as a contract |  |
| GET | `/contracts/{id}/export.pdf` | exportContractPdf | PROCUREMENT, LEGAL, CONTRACT_MGR, DELEGATE, EXEC, FINANCE, PROBITY | The current contract as a PDF with its version and any signatures (audited) |  |
| GET | `/contracts/{id}/export.docx` | exportContractDocx | PROCUREMENT, LEGAL, CONTRACT_MGR, DELEGATE, EXEC, FINANCE, PROBITY | The current contract as a Word document (audited) |  |
| POST | `/contracts/{id}/drafts` | uploadAmendedDraft | LEGAL | Upload an externally amended draft (kept as a numbered version with its hash) |  |
| GET | `/contracts/{id}/drafts` | listAmendedDrafts | PROCUREMENT, LEGAL, CONTRACT_MGR, DELEGATE, EXEC, FINANCE, PROBITY | Amended drafts uploaded for this contract |  |
| GET | `/contracts/{id}/drafts/{fileId}` | downloadAmendedDraft | PROCUREMENT, LEGAL, CONTRACT_MGR, DELEGATE, EXEC, FINANCE, PROBITY | Download an uploaded draft (audited) |  |
| POST | `/contracts/{id}/comments` | commentOnContract | LEGAL, PROCUREMENT, CONTRACT_MGR, FINANCE | Comment on the draft or one clause while it is being worked on |  |
| GET | `/contracts/{id}/comments` | listContractComments | PROCUREMENT, LEGAL, CONTRACT_MGR, DELEGATE, EXEC, FINANCE, PROBITY | Comments on the draft |  |
| GET | `/contracts/{id}/lineage` | getContractLineage | PROCUREMENT, LEGAL, CONTRACT_MGR, DELEGATE, EXEC, FINANCE, PROBITY | The parent contract and its variations, with cumulative value and the latest end date |  |
| POST | `/contracts/{id}/deviations/{clauseId}/explain` | explainDeviation | LEGAL, PROCUREMENT, DELEGATE, EXEC, CONTRACT_MGR, FINANCE | What a deviation means in plain language, with the corporate fallback where one is on file (simulated model) |  |
| POST | `/contracts/{id}/deviations/{clauseId}/risk/plain` | rateDeviationInWords | LEGAL | Legal amends a deviation's risk rating in plain language; read back, saved only when apply is true |  |
| POST | `/contracts/{id}/deviations/{clauseId}/accept-risk` | acceptDeviationRisk | DELEGATE, EXEC, CONTRACT_MGR | The business or a delegate formally accepts the identified risk, with a statement |  |
| GET | `/contracts/{id}/negotiation-strategy` | getNegotiationStrategy | LEGAL, PROCUREMENT, DELEGATE, EXEC | A negotiation strategy: framing, techniques, a graduated set of positions and levers (simulated model) |  |
| GET | `/legal-knowledge` | listLegalKnowledge | LEGAL, PROCUREMENT | Policies, historical advice, corporate fallback positions and mandatory boilerplate the advisers draw on |  |
| POST | `/legal-knowledge` | addLegalKnowledge | LEGAL | Add a policy, advice, fallback position or boilerplate |  |
| DELETE | `/legal-knowledge/{id}` | removeLegalKnowledge | LEGAL | Remove an entry |  |
| GET | `/legal/matters` | listLegalMatters | LEGAL, PROCUREMENT | The legal kanban board with review hours per matter |  |
| POST | `/legal/matters` | createLegalMatter | LEGAL | Open a legal matter, optionally linked to a contract |  |
| PATCH | `/legal/matters/{id}` | updateLegalMatter | LEGAL | Move a matter between lanes or change its assignee, priority or due date |  |
| POST | `/legal/matters/{id}/time` | logReviewHours | LEGAL | Log review hours against a matter |  |
| GET | `/legal/matters/{id}/time` | listReviewHours | LEGAL, PROCUREMENT | Review hours logged against a matter |  |
| POST | `/access-grants` | grantProjectAccess | PROCUREMENT, ADMIN | Give a committee member, auditor or advisor access to one project's documents until a date or an event (for example 30 days after signature) |  |
| GET | `/access-grants` | listProjectAccess | PROCUREMENT, ADMIN, PROBITY | Access grants with whether each is still live; an expired grant is revoked and audited when read |  |
| DELETE | `/access-grants/{id}` | revokeProjectAccess | PROCUREMENT, ADMIN | End a grant now, with a reason |  |
| GET | `/shared/projects` | listSharedProjects | REQUESTER, PROCUREMENT, DELEGATE, EVALUATOR, CHAIR, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, ADMIN, EXEC | The projects the caller has a grant for, and the documents each opens while it is live |  |
| GET | `/shared/projects/{id}/contract.pdf` | downloadSharedContract | REQUESTER, PROCUREMENT, DELEGATE, EVALUATOR, CHAIR, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, ADMIN, EXEC | The project's contract as a PDF, while the caller's grant is live |  |
| GET | `/shared/projects/{id}/report.pdf` | downloadSharedReport | REQUESTER, PROCUREMENT, DELEGATE, EVALUATOR, CHAIR, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, ADMIN, EXEC | The project's evaluation report as a PDF, while the caller's grant is live |  |
| PUT | `/supplier/profile/bank` | setSupplierBank | SUPPLIER | Give banking details, checked against the legal name before signature |  |
| GET | `/supplier/contracts` | listSupplierContracts | SUPPLIER | Contracts out for signature or signed, for this supplier to read |  |
| GET | `/supplier/contracts/{id}` | getSupplierContract | SUPPLIER | The full contract text, and the supplier's own questions with answers |  |
| POST | `/supplier/contracts/{id}/questions` | askSupplierContractQuestion | SUPPLIER | Raise a question before the contract is signed |  |
| GET | `/access-grants/candidates` | listGrantCandidates | PROCUREMENT, ADMIN | The staff and projects a grant can be made for |  |
| GET | `/contracts/{id}/commercial` | getContractCommercial | PROCUREMENT, LEGAL, CONTRACT_MGR, DELEGATE, EXEC, FINANCE, PROBITY | The rate card, price escalation clauses, rebates with their status, the insurance hold and what the caller may edit |  |
| PUT | `/contracts/{id}/rates` | setContractRates | CONTRACT_MGR, LEGAL, PROCUREMENT | Replace the contract rate card used by the three-way match |  |
| PUT | `/contracts/{id}/escalations` | setContractEscalations | CONTRACT_MGR, LEGAL, PROCUREMENT | Replace the price-escalation clauses: scheduled steps, or an index movement up to a cap | 422 ESCALATION_BEFORE_START |
| POST | `/contracts/{id}/rebates` | addContractRebate | CONTRACT_MGR, LEGAL, PROCUREMENT | Record a rebate term: a rate on spend in a period once a threshold is reached |  |
| POST | `/contracts/{id}/rebates/{rebateId}/claim` | claimContractRebate | FINANCE, CONTRACT_MGR | Record an amount claimed from the supplier against a rebate |  |
| POST | `/contracts/{id}/rebates/{rebateId}/follow-up` | followUpContractRebate | FINANCE, CONTRACT_MGR | Record a follow-up of a missed or under-claimed rebate | 409 NOT_FLAGGED |
| POST | `/contracts/{id}/purchase-orders` | createPurchaseOrder | FINANCE, CONTRACT_MGR, PROCUREMENT | Raise a purchase order (the simulated ERP feed). Blocked, and recorded, when it would take commitments above the contract limit; refused while an insurance hold is on | 422 SPEND_CEILING; 409 PURCHASE_ORDER_HELD |
| GET | `/contracts/{id}/purchase-orders` | listPurchaseOrders | PROCUREMENT, LEGAL, CONTRACT_MGR, DELEGATE, EXEC, FINANCE, PROBITY | Purchase orders against the contract, including any that were blocked |  |
| POST | `/contracts/{id}/invoices` | recordInvoice | FINANCE, CONTRACT_MGR | Record an invoice (the simulated ERP feed). It is matched to its purchase order and the rate card with the escalation formula; a price increase not allowed blocks it |  |
| GET | `/contracts/{id}/invoices` | listContractInvoices | PROCUREMENT, LEGAL, CONTRACT_MGR, DELEGATE, EXEC, FINANCE, PROBITY | Invoices against the contract with their match findings |  |
| GET | `/invoices` | listInvoices | FINANCE, CONTRACT_MGR, PROCUREMENT, EXEC | Invoices across contracts; filter by status to see what is blocked |  |
| POST | `/invoices/{id}/override` | overrideBlockedInvoice | FINANCE, EXEC | Release a blocked invoice as a recorded exception, with a reason |  |
| POST | `/invoices/{id}/pay` | payInvoice | FINANCE | Record payment of a matched or excepted invoice | 409 while the invoice is blocked |
| GET | `/contracts/{id}/spend` | getContractSpend | PROCUREMENT, LEGAL, CONTRACT_MGR, DELEGATE, EXEC, FINANCE, PROBITY | Live spend against the contract from invoice and payment data: progress of spend and term, and the notices raised |  |
| GET | `/alerts/rules` | getFixedAlertRules | CONTRACT_MGR, PROCUREMENT, LEGAL, EXEC, DELEGATE, FINANCE | The alerts the platform fixes (expiry countdown, insurance lapse, spend ceiling) that no one can mute or change |  |
| GET | `/me/alert-preferences` | getAlertPreferences | CONTRACT_MGR, PROCUREMENT, LEGAL, EXEC, DELEGATE, FINANCE | The alert kinds the caller has muted, and the fixed ones that cannot be |  |
| PUT | `/me/alert-preferences` | setAlertPreferences | CONTRACT_MGR, PROCUREMENT, LEGAL, EXEC, DELEGATE, FINANCE | Mute alert kinds for the caller; the fixed kinds are refused | 422 ALERT_NOT_MUTABLE |
| POST | `/contracts/{id}/alerts/extract` | extractAlertTriggers | CONTRACT_MGR, PROCUREMENT, LEGAL, EXEC | Propose alerts from notice periods, review cycles and anniversaries in the clause wording (rules-simulated model); nothing is scheduled |  |
| POST | `/contracts/{id}/alerts/extract/apply` | applyAlertTriggers | CONTRACT_MGR, PROCUREMENT, LEGAL, EXEC | Schedule the proposed alerts the caller confirms | 422 PROPOSAL_NOT_FOUND |
| GET | `/contracts/{id}/plans` | getContractPlans | PROCUREMENT, LEGAL, CONTRACT_MGR, DELEGATE, EXEC, FINANCE, PROBITY | The contract management plan and risk management plan, their tier and reasons, and the generated activities |  |
| POST | `/contracts/{id}/plans/generate` | generateContractPlans | CONTRACT_MGR, LEGAL, PROCUREMENT | Generate (or regenerate) both plans and their activities from the contract's size, term and risk, using the customer's template where one is uploaded |  |
| POST | `/contracts/{id}/activities/{activityId}/complete` | completeContractActivity | CONTRACT_MGR, LEGAL, PROCUREMENT | Mark a contract management activity done |  |
| GET | `/contract-plan-templates` | getPlanTemplates | CONTRACT_MGR, LEGAL, ADMIN | The standard plan templates and any the customer uploaded |  |
| PUT | `/contract-plan-templates/{kind}` | uploadPlanTemplate | CONTRACT_MGR, LEGAL, ADMIN | Upload the customer's template for the management plan (CMP) or the risk plan (RMP), as headed text or sections |  |
| DELETE | `/contract-plan-templates/{kind}` | removePlanTemplate | CONTRACT_MGR, LEGAL, ADMIN | Go back to the standard template |  |
| POST | `/contracts/{id}/work-orders` | createWorkOrder | CONTRACT_MGR, LEGAL, PROCUREMENT | Raise a work order under a master agreement, within its value and term | 422 WORK_ORDER_OVER_MASTER; 409 NOT_A_MASTER |
| GET | `/contracts/{id}/work-orders` | listWorkOrders | PROCUREMENT, LEGAL, CONTRACT_MGR, DELEGATE, EXEC, FINANCE, PROBITY | The master agreement's work orders with committed and invoiced amounts, and totals |  |
| PATCH | `/work-orders/{id}` | updateWorkOrder | CONTRACT_MGR, LEGAL, PROCUREMENT | Complete or cancel a work order |  |
| GET | `/reports/master-agreements` | reportMasterAgreements | PROCUREMENT, LEGAL, CONTRACT_MGR, DELEGATE, EXEC, FINANCE, PROBITY | Master agreements and their work orders, reportable at both levels |  |
| POST | `/contracts/{id}/procurements` | linkProcurementToContract | CONTRACT_MGR, LEGAL, PROCUREMENT | Start a new procurement number linked to a contract to renew it, vary it or take up an extension; not a new tender | 422 NO_EXTENSION; 409 EXTENSION_EXERCISED |
| GET | `/contracts/{id}/management` | getContractManagement | PROCUREMENT, LEGAL, CONTRACT_MGR, DELEGATE, EXEC, FINANCE, PROBITY | Variation count, extensions exercised and remaining, cumulative value, historic versions, linked procurements and next-step suggestions |  |
| GET | `/contracts/search` | searchMyContracts | PROCUREMENT, LEGAL, CONTRACT_MGR, DELEGATE, EXEC, FINANCE, PROBITY | Search the contracts that belong to the caller and their team, with a suggested next step near the end date |  |
| GET | `/disclosure-tasks` | listDisclosureTasks | PROCUREMENT, LEGAL, CONTRACT_MGR, EXEC | Public register disclosure tasks raised by contract changes over the statutory threshold |  |
| POST | `/disclosure-tasks/{id}/complete` | completeDisclosureTask | PROCUREMENT, LEGAL | Record the register reference once the disclosure is made |  |
| GET | `/envelopes/candidates` | listEnvelopeCandidates | DELEGATE, EXEC | People who can be nominated to approve commitments from an envelope |  |
| GET | `/envelopes` | listFundingEnvelopes | DELEGATE, EXEC, FINANCE, PROCUREMENT, CONTRACT_MGR, REQUESTER, LEGAL | Funding envelopes the caller holds, is nominated for, or oversees |  |
| GET | `/envelopes/{id}` | getFundingEnvelope | DELEGATE, EXEC, FINANCE, PROCUREMENT, CONTRACT_MGR, REQUESTER, LEGAL | One envelope with its commitments and what is left |  |
| POST | `/envelopes` | createFundingEnvelope | DELEGATE, EXEC | A delegate approves an allocated funding envelope, within their delegated authority, and nominates who can commit against it | 403 DELEGATION_EXCEEDED; 422 INVALID_NOMINEE |
| POST | `/envelopes/{id}/commitments` | commitFromEnvelope | DELEGATE, EXEC, FINANCE, PROCUREMENT, CONTRACT_MGR, REQUESTER, LEGAL | A nominated person approves a commitment against the envelope; warns the holder as it nears exhaustion | 422 ENVELOPE_EXHAUSTED; 403 NOT_NOMINATED |
| POST | `/envelopes/{id}/top-up` | topUpFundingEnvelope | DELEGATE, EXEC | The holder or an executive adds to the envelope, within delegated authority | 403 DELEGATION_EXCEEDED |
| GET | `/reports/schedule` | getProcurementSchedule | PROCUREMENT, EXEC, DELEGATE | A Gantt-style view of phase and status across every active procurement, with the delegate calendar worked out from it |  |
| POST | `/reports/schedule/{requestId}/move` | moveSchedulePhase | PROCUREMENT | Drag a phase earlier or later; every phase after it moves by the same, and the delegate calendar is recalculated and the delegates told | 422 SCHEDULE_CONFLICT |
| GET | `/dashboards` | listDashboards | PROCUREMENT, LEGAL, DELEGATE, EXEC, FINANCE, PROBITY, CONTRACT_MGR, ADMIN | The dashboard views open to the caller by role, and the scope the organisation hierarchy gives them |  |
| GET | `/dashboards/{view}` | getDashboard | PROCUREMENT, LEGAL, DELEGATE, EXEC, FINANCE, PROBITY, CONTRACT_MGR, ADMIN | One dashboard (procurement, legal, delegate, executive, finance, risk, division) scoped by the organisational hierarchy unless the organisation chose broader visibility |  |
| GET | `/reports/performance` | getPerformanceReport | EXEC, FINANCE, PROCUREMENT | Category spend, maverick spend (invoices released outside the contract match and purchases with no contract), captured savings and procurement velocity with the bottleneck phase |  |
| GET | `/reports/supplier-risk` | getSupplierRiskMap | PROCUREMENT, EXEC, FINANCE, PROBITY | Supplier locations with simulated weather, financial-distress and geopolitical signals, and the single points of failure |  |
| PUT | `/suppliers/{id}/location` | setSupplierLocation | PROCUREMENT, ADMIN | Record where a supplier operates from, for the risk map |  |
| PUT | `/requests/{id}/manager` | assignProcurementManager | PROCUREMENT, EXEC | Assign a procurement to a manager in the procurement team | 422 NOT_A_MANAGER |
| GET | `/reports/capacity` | getCapacityReport | PROCUREMENT, EXEC | Active procurements and dollar exposure by assigned manager against capacity, with a rebalancing suggestion |  |
| GET | `/reports/spend-by` | getSpendBy | EXEC, FINANCE, PROCUREMENT | Committed and invoiced spend by supplier, contract, master agreement, project, business unit or division |  |
| GET | `/reports/drill` | drillReport | EXEC, FINANCE, PROCUREMENT, CONTRACT_MGR, DELEGATE, LEGAL, PROBITY | The procurements behind a figure: by phase, category, manager, business unit or status |  |
| GET | `/report-views` | listReportViews | EXEC, FINANCE, PROCUREMENT, CONTRACT_MGR, DELEGATE, LEGAL, PROBITY | The caller's saved views and those shared by others |  |
| POST | `/report-views` | saveReportView | EXEC, FINANCE, PROCUREMENT, CONTRACT_MGR, DELEGATE, LEGAL, PROBITY | Save a custom view of a report, for the caller or shared |  |
| DELETE | `/report-views/{id}` | deleteReportView | EXEC, FINANCE, PROCUREMENT, CONTRACT_MGR, DELEGATE, LEGAL, PROBITY | Delete one of the caller's saved views |  |
| POST | `/reports/ask` | askReport | EXEC, FINANCE, PROCUREMENT, CONTRACT_MGR, DELEGATE, LEGAL, PROBITY | Ask for a report in plain language, such as: all procurement risks in 2026 (rules-simulated interpretation, shown back) | 422 QUESTION_NOT_UNDERSTOOD |
| GET | `/layouts` | listLayouts | ADMIN, PROCUREMENT, LEGAL, DELEGATE, EXEC | The layout of the plan, the tender pack and the evaluation report: the organisation's own, or the system default |  |
| PUT | `/layouts/{kind}` | saveLayout | ADMIN, PROCUREMENT | Design a layout by ordering sections and switching optional ones off; mandatory sections cannot be left out | 422 LAYOUT_INVALID |
| DELETE | `/layouts/{kind}` | resetLayout | ADMIN, PROCUREMENT | Go back to the system default layout |  |
| POST | `/documents/{type}/{id}/presence` | documentPresence | REQUESTER, PROCUREMENT, DELEGATE, LEGAL, EXEC, PROBITY, FINANCE, CONTRACT_MGR | Say you are working on a document (and which section); returns who else is |  |
| GET | `/documents/{type}/{id}/presence` | getDocumentPresence | REQUESTER, PROCUREMENT, DELEGATE, LEGAL, EXEC, PROBITY, FINANCE, CONTRACT_MGR | Who else has been in the document in the last minute, and where |  |
| GET | `/documents/{type}/{id}/changes` | getDocumentChanges | REQUESTER, PROCUREMENT, DELEGATE, LEGAL, EXEC, PROBITY, FINANCE, CONTRACT_MGR | Tracked changes: every change to a section, who made it and when, with a word-by-word comparison |  |
| GET | `/documents/{type}/{id}/summary` | summariseDocumentChanges | REQUESTER, PROCUREMENT, DELEGATE, LEGAL, EXEC, PROBITY, FINANCE, CONTRACT_MGR | A digest of what changed since the caller last looked (rules-simulated); markSeen=true records the look |  |
| POST | `/documents/{type}/{id}/versions` | saveDocumentVersion | REQUESTER, PROCUREMENT, DELEGATE, LEGAL, EXEC, PROBITY, FINANCE, CONTRACT_MGR | Keep a named version of the document as it stands |  |
| GET | `/documents/{type}/{id}/versions` | listDocumentVersions | REQUESTER, PROCUREMENT, DELEGATE, LEGAL, EXEC, PROBITY, FINANCE, CONTRACT_MGR | The saved versions of a document |  |
| GET | `/documents/{type}/{id}/versions/{number}` | getDocumentVersion | REQUESTER, PROCUREMENT, DELEGATE, LEGAL, EXEC, PROBITY, FINANCE, CONTRACT_MGR | One saved version, section by section |  |
| GET | `/documents/{type}/{id}/compare` | compareDocumentVersions | REQUESTER, PROCUREMENT, DELEGATE, LEGAL, EXEC, PROBITY, FINANCE, CONTRACT_MGR | Compare two saved versions, or a version with the current text, highlighting what changed |  |
| POST | `/requests/{id}/risk-assessment/generate` | generateRiskAssessment | REQUESTER, PROCUREMENT | Draft a risk assessment for the procurement: candidate risks to mark applicable or not (rules-simulated) | 409 ASSESSMENT_EXISTS |
| GET | `/requests/{id}/risk-assessment` | getRiskAssessment | REQUESTER, PROCUREMENT, DELEGATE, EXEC, PROBITY, LEGAL | The risk assessment, with what still needs a decision, a rating or a treatment |  |
| PATCH | `/requests/{id}/risk-assessment/items/{key}` | updateRiskItem | REQUESTER, PROCUREMENT | Mark a risk applicable or not, rate its likelihood and impact, and choose or write a treatment |  |
| POST | `/requests/{id}/risk-assessment/complete` | completeRiskAssessment | REQUESTER, PROCUREMENT | Complete the assessment once every risk has a decision, a rating where it applies, and a treatment for the medium and high ones | 422 ASSESSMENT_INCOMPLETE |
| GET | `/tenders/{id}/response-summaries` | summariseResponses | PROCUREMENT, LEGAL, CHAIR, EVALUATOR | A summary of each supplier response after close: pricing, dates, changes proposed to the tender, pros and cons (rules-simulated); anonymous for panel members | 409 TENDER_SEALED |
| GET | `/reference-content` | listReferenceContent | ADMIN, PROCUREMENT, LEGAL, REQUESTER | The in-house corpus of best-practice content (for example role descriptions); renewed by itself when older than the refresh period |  |
| POST | `/reference-content/refresh` | refreshReferenceContent | ADMIN, PROCUREMENT | Regenerate the corpus now as a new generation, entirely inside the platform |  |
| POST | `/requests/{id}/advance` | advanceProcurement | PROCUREMENT, EXEC, REQUESTER | Move a procurement to a later phase from a plain-language instruction, only if the phases before it are finished | 409 PHASE_NOT_COMPLETE |
| POST | `/requests/{id}/phase/sync` | syncProcurementPhase | PROCUREMENT, EXEC, REQUESTER | Detect that a phase is complete from the records and move the tracker on |  |
| POST | `/requests/phase-sync` | syncAllProcurementPhases | PROCUREMENT, EXEC | Catch every procurement's tracker up with its records |  |
| POST | `/tenders/{id}/template-change` | changeTenderTemplate | PROCUREMENT | Change a staged tender to another template in plain language and fill it in again, keeping sections a person wrote |  |
| POST | `/evaluations/{id}/committee/instruct` | instructCommittee | PROCUREMENT | Add or remove an evaluation committee member from an instruction or a name, with a picker where several people match | status AMBIGUOUS lists candidates; 409 HAS_SCORES |
| POST | `/assistant/chat` | assistantChat | REQUESTER, PROCUREMENT, DELEGATE, EVALUATOR, CHAIR, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, ADMIN, EXEC, SUPPLIER | Ask the assistant about the workflow, roles and approvals, what needs attention or what to fix, or give a simple instruction (rules-simulated) |  |
| GET | `/tenders/{id}/response-schedule` | getResponseSchedule | PROCUREMENT, LEGAL, DELEGATE, EXEC, PROBITY, EVALUATOR, CHAIR | The structured response schedule: the questions a supplier answers instead of attaching documents |  |
| PUT | `/tenders/{id}/response-schedule` | setResponseSchedule | PROCUREMENT | Define the response schedule (staged tender only) | 409 once published; 422 duplicate key or a choice with under two options |
| PUT | `/tenders/{id}/requirements` | setTenderRequirements | PROCUREMENT | Set the insurance cover a bid must hold and whether opening needs two witnesses (staged tender only) |  |
| GET | `/tenders/{id}/response-answers` | getResponseAnswers | PROCUREMENT, LEGAL, DELEGATE, EXEC, PROBITY, EVALUATOR, CHAIR | Every submitted answer side by side, after the tender closes (and opens, for a dual-witness tender) | 409 TENDER_SEALED before close; 409 BIDS_SEALED before witnesses open it |
| GET | `/tenders/{id}/opening` | getOpening | PROBITY, LEGAL, DELEGATE, EXEC, PROCUREMENT | Where the dual-witness opening stands: who has witnessed and until when |  |
| POST | `/tenders/{id}/opening/witness` | witnessOpening | PROBITY, LEGAL, DELEGATE, EXEC, PROCUREMENT | Confirm, by password, that you witness the opening; the second different person within the window opens the bids | 401 password not confirmed; 403 not independent; 409 already witnessed, already opened or not required |
| GET | `/supplier/tenders/{id}/response` | getSupplierResponse | SUPPLIER | The response schedule with the supplier's answers, what is missing and whether their cover meets the tender |  |
| PUT | `/supplier/tenders/{id}/response` | saveSupplierResponse | SUPPLIER | Save answers to the response schedule; each is checked against its question | 422 with a message per answer; 409 once submitted or closed |
| PUT | `/supplier/profile/insurance-certificate` | uploadInsuranceCertificate | SUPPLIER | Upload an insurance certificate; the limit and expiry are read from it (rules-simulated reading) | 422 for a rejected or infected file; readable=false asks for the details by hand |
| GET | `/supplier/profile/esg` | getSupplierEsg | SUPPLIER | ESG data the supplier has declared |  |
| PUT | `/supplier/profile/esg` | updateSupplierEsg | SUPPLIER | Declare carbon data, renewable share, diversity ownership and a modern slavery statement |  |
| GET | `/supplier/ratings` | getSupplierRatings | SUPPLIER | Contracts the supplier can rate, and ratings received if the organisation shows them |  |
| POST | `/supplier/ratings` | rateEnterprise | SUPPLIER | The supplier rates the enterprise on a signed contract | 409 already rated; 422 wrong dimensions |
| POST | `/suppliers/{id}/ratings` | rateSupplier | CONTRACT_MGR, PROCUREMENT, EXEC | The enterprise rates a supplier on a signed contract | 409 already rated or contract not signed; 422 wrong dimensions |
| GET | `/suppliers/{id}/ratings` | getSupplierRatingsStaff | PROCUREMENT, LEGAL, FINANCE, EXEC, ADMIN, CONTRACT_MGR | Ratings of a supplier; what suppliers said is shown only if the organisation allows it |  |
| GET | `/suppliers/duplicates` | listDuplicateSuppliers | PROCUREMENT, LEGAL, FINANCE, EXEC, ADMIN | Pairs of suppliers that look like the same business (same ABN or bank account, similar name) |  |
| POST | `/suppliers/duplicates/dismiss` | dismissDuplicate | PROCUREMENT, LEGAL | Say two suppliers are not the same business |  |
| GET | `/suppliers/{id}/risk` | getSupplierRisk | PROCUREMENT, LEGAL, FINANCE, EXEC, PROBITY | Risk, resilience and ESG score with its factors, recommendations and alternative suppliers (rules-simulated) |  |
| POST | `/suppliers/{id}/modern-slavery-check` | checkModernSlavery | PROCUREMENT, LEGAL | Run the modern slavery screen for a supplier and record the result |  |
| GET | `/reports/supplier-scores` | getSupplierScores | PROCUREMENT, EXEC, FINANCE, PROBITY | Every supplier's score, lowest first |  |
| GET | `/reports/diversity` | getDiversityReport | PROCUREMENT, EXEC, FINANCE | Committed spend by diversity ownership, and carbon data reported |  |
| GET | `/requests/{id}/lessons` | listLessons | PROCUREMENT, REQUESTER, LEGAL, CONTRACT_MGR, DELEGATE, EXEC, FINANCE, PROBITY, EVALUATOR, CHAIR | Lessons learned on a procurement |  |
| POST | `/requests/{id}/lessons` | addLesson | PROCUREMENT, REQUESTER, LEGAL, CONTRACT_MGR, DELEGATE, EXEC, FINANCE, PROBITY, EVALUATOR, CHAIR | Capture a lesson learned |  |
| GET | `/requests/{id}/lessons/recall` | recallLessons | PROCUREMENT, REQUESTER, LEGAL, CONTRACT_MGR, DELEGATE, EXEC, FINANCE, PROBITY, EVALUATOR, CHAIR | Lessons from comparable procurements, by category, size and wording, with why each was chosen (rules-simulated) |  |
| POST | `/requests/{id}/close` | closeRequest | PROCUREMENT, EXEC | Close or cancel a procurement; a lesson learned (or a reason for none) is needed | 409 LESSONS_REQUIRED; 409 if not yet in contract management (cancel instead) |
| POST | `/contracts/{id}/legal-edit` | legalEdit | LEGAL | Redact a clause, propose a redline or insert a clause at a nominated place, in plain language | apply=false previews; 409 once released for signature |
| GET | `/contracts/{id}/redlines` | listRedlines | LEGAL, PROCUREMENT, DELEGATE, EXEC | Proposed changes to clauses, from Legal, the legal platform, outside counsel or the supplier |  |
| POST | `/contracts/{id}/redlines/{redlineId}/decision` | decideRedline | LEGAL | Accept (applies the wording) or reject a proposed change | 409 already decided or the wording is final |
| POST | `/contracts/{id}/counsel-links` | createCounselLink | LEGAL | Issue a one-time link for an outside law firm or the supplier's legal team to mark up this contract |  |
| GET | `/contracts/{id}/counsel-links` | listCounselLinks | LEGAL | Links issued for this contract (never the link itself) |  |
| DELETE | `/contracts/{id}/counsel-links/{linkId}` | revokeCounselLink | LEGAL | Withdraw a counsel link |  |
| GET | `/counsel/{token}` | getCounselPage | public | The clauses an outside party may mark up, with their own redlines; read-only once the version is final |  |
| POST | `/counsel/{token}/redlines` | proposeCounselRedline | public | An outside party proposes new wording for a clause | 423 once the version is final |
| GET | `/contracts/deleted` | listDeletedContracts | LEGAL, EXEC, PROBITY | Contracts that were logically deleted, with the reason |  |
| POST | `/contracts/{id}/restore` | restoreContract | LEGAL, EXEC | Bring a logically deleted contract back, with a reason |  |
| GET | `/integration-events` | listIntegrationEvents | ADMIN, PROCUREMENT, LEGAL | Events sent to other systems and whether they were delivered |  |
| POST | `/integration-events/retry` | retryIntegrationEvents | ADMIN, PROCUREMENT, LEGAL | Try again every event that has not been delivered |  |
| POST | `/integrations/legal/webhook` | legalPlatformWebhook | public | The customer's legal platform reports a matter stage and redlines; signed with the shared secret, safe to send twice | 401 for a bad signature or unknown matter; duplicate=true when seen before |
| GET | `/approval-links/{token}` | getApprovalLink | public | The summary checklist behind a one-time approval link (commercial information withheld by default) |  |
| POST | `/approval-links/{token}/decision` | decideViaApprovalLink | public | Approve or reject from the link without a full sign-in; the same limits and checks apply | 403 above the approver's authority; step-up code required if the organisation asks for one |
| GET | `/fx/rates` | listFxRates | REQUESTER, PROCUREMENT, DELEGATE, EVALUATOR, CHAIR, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, ADMIN, EXEC | Exchange rates in force today and the history, by annual or live setting |  |
| PUT | `/fx/rates` | saveFxRates | ADMIN, FINANCE | Set the annual rates for a financial year | 422 unsupported currency or a rate that is not positive |
| POST | `/fx/refresh` | refreshFxRates | ADMIN, FINANCE | Pull the latest simulated live rates |  |
| GET | `/fx/convert` | convertAmount | REQUESTER, PROCUREMENT, DELEGATE, EVALUATOR, CHAIR, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, ADMIN, EXEC | Convert an amount to AUD at the rate in force on a date |  |
| GET | `/me/dashboard` | getMyDashboard | REQUESTER, PROCUREMENT, DELEGATE, EVALUATOR, CHAIR, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, ADMIN, EXEC | My own dashboard: the widgets I chose, or the default for my role, and the catalogue I may choose from |  |
| PUT | `/me/dashboard` | saveMyDashboard | REQUESTER, PROCUREMENT, DELEGATE, EVALUATOR, CHAIR, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, ADMIN, EXEC | Choose, order, size and style my widgets | 422 for a widget my role cannot use or a style it cannot take |
| DELETE | `/me/dashboard` | resetMyDashboard | REQUESTER, PROCUREMENT, DELEGATE, EVALUATOR, CHAIR, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, ADMIN, EXEC | Go back to the default dashboard for my role |  |
| GET | `/analytics/status` | getAnalyticsStatus | EXEC, FINANCE, PROCUREMENT, CONTRACT_MGR, ADMIN | When the separate analytics store was last refreshed from the main database |  |
| POST | `/analytics/refresh` | refreshAnalytics | EXEC, FINANCE, PROCUREMENT, ADMIN | Refresh the analytics store now |  |
| GET | `/reports/future-commitment` | getFutureCommitment | EXEC, FINANCE, PROCUREMENT, CONTRACT_MGR | What the enterprise is committed to pay in future: fixed amounts, ceilings, ranges, unknowns and extensions |  |
| GET | `/reports/optimisation` | getOptimisation | EXEC, FINANCE, PROCUREMENT, CONTRACT_MGR | Where spend can be reduced: consolidation, duplicate contracts, rate card gaps and price variance |  |
| GET | `/notes/targets` | listNoteTargets | PROCUREMENT, LEGAL, FINANCE, EXEC, CONTRACT_MGR, PROBITY, DELEGATE, EVALUATOR, CHAIR | The suppliers the caller may take review notes about |  |
| POST | `/notes` | createNote | PROCUREMENT, LEGAL, FINANCE, EXEC, CONTRACT_MGR, PROBITY, DELEGATE, EVALUATOR, CHAIR | Take a note about a supplier, private or shared with the team |  |
| GET | `/notes` | listNotes | PROCUREMENT, LEGAL, FINANCE, EXEC, CONTRACT_MGR, PROBITY, DELEGATE, EVALUATOR, CHAIR | My notes, and the ones others shared, about a supplier |  |
| DELETE | `/notes/{id}` | deleteNote | PROCUREMENT, LEGAL, FINANCE, EXEC, CONTRACT_MGR, PROBITY, DELEGATE, EVALUATOR, CHAIR | Delete one of my own notes |  |
| GET | `/grc/items` | listGrcItems | PROBITY, EXEC, LEGAL, FINANCE, PROCUREMENT, CONTRACT_MGR, DELEGATE | Risks, audit findings and obligations in the register |  |
| POST | `/grc/items` | createGrcItem | PROBITY, EXEC, LEGAL, PROCUREMENT, FINANCE | Add a risk, an audit finding or an obligation | 422 a risk needs likelihood and impact |
| PATCH | `/grc/items/{id}` | updateGrcItem | PROBITY, EXEC, LEGAL, PROCUREMENT, FINANCE | Change the rating, owner, dates or status | 422 accepting needs a treatment of at least ten characters |
| POST | `/grc/items/{id}/actions` | addGrcAction | PROBITY, EXEC, LEGAL, PROCUREMENT, FINANCE | Assign an action; the owner is notified |  |
| POST | `/grc/items/{id}/actions/{actionId}/complete` | completeGrcAction | PROBITY, EXEC, LEGAL, PROCUREMENT, FINANCE | Mark an action done |  |
| GET | `/grc/summary` | getGrcSummary | PROBITY, EXEC, LEGAL, FINANCE, PROCUREMENT, CONTRACT_MGR, DELEGATE | Counts by kind and status and the likelihood and impact heat map |  |
| POST | `/grc/sync` | syncGrc | PROBITY, EXEC | Pull in what the platform already knows (sanctions, expired insurance and the like), once each |  |
| GET | `/branding` | getBranding | public | The product name, tagline, palette and support address (shown on the sign-in page) |  |
| GET | `/requests/{id}/progress` | getRequestProgress | REQUESTER, PROCUREMENT, DELEGATE, EVALUATOR, CHAIR, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, ADMIN, EXEC | How far a procurement has come, by milestone | 404 for a request the caller cannot see; 403 for suppliers |
| GET | `/layouts/{kind}/applied` | getAppliedLayout | REQUESTER, PROCUREMENT, DELEGATE, EVALUATOR, CHAIR, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, ADMIN, EXEC | What a page shows and in what order, for anyone who can open the page |  |
| GET | `/catalogue` | listCatalogue | REQUESTER, PROCUREMENT, DELEGATE, EVALUATOR, CHAIR, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, EXEC | The approved catalogue, with suppliers that cannot be ordered from marked |  |
| POST | `/catalogue` | addCatalogueItem | PROCUREMENT | Add a catalogue item |  |
| PATCH | `/catalogue/{id}` | updateCatalogueItem | PROCUREMENT | Change the price, lead time or whether it is offered |  |
| POST | `/buying/orders` | orderFromCatalogue | REQUESTER, PROCUREMENT | Draft a request from chosen catalogue lines |  |
| POST | `/buying/auto-source` | autoSource | REQUESTER, PROCUREMENT | Describe a need: the platform shortlists, scores and recommends (rules-simulated-v1) |  |
| GET | `/buying/proposals` | listProposals | REQUESTER, PROCUREMENT | My sourcing proposals (procurement sees all) |  |
| POST | `/buying/proposals/{id}/decision` | decideProposal | REQUESTER, PROCUREMENT | A person approves or rejects a recommendation; approving drafts a request | 409 OVER_LIMIT above the limit; SUPPLIER_NOT_APPROVED |
| GET | `/artefacts/{kind}/{id}/state` | getArtefactState | PROCUREMENT, DELEGATE, EXEC, PROBITY, CHAIR, LEGAL, CONTRACT_MGR | Whether an evaluation report or contract plans are out of date, and when they will be refreshed |  |
| POST | `/artefacts/{kind}/{id}/refresh` | refreshArtefact | PROCUREMENT, CONTRACT_MGR, LEGAL | Bring an artefact up to date now | 409 for an approved report |
| POST | `/search` | search | REQUESTER, PROCUREMENT, DELEGATE, EVALUATOR, CHAIR, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, EXEC | Search my records, and an outside source when the organisation allows it (identifiers withheld) |  |
| GET | `/search/external-log` | listExternalSearchLog | ADMIN, PROBITY, EXEC | Every question sent to an outside source and what was withheld |  |
| GET | `/action-items` | listActionItems | REQUESTER, PROCUREMENT, DELEGATE, EVALUATOR, CHAIR, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, ADMIN, EXEC | What needs my attention now, with a link to the screen where each is dealt with |  |
| GET | `/connectors` | listConnectors | ADMIN, PROCUREMENT, FINANCE, LEGAL, EXEC | The catalogue of supported providers by kind (all simulated) and this tenant's connectors with their health and circuit breaker |  |
| PUT | `/connectors/{kind}` | updateConnector | ADMIN | Choose the provider, switch on or off, set the demonstration mode UP or DOWN and the non-secret configuration | 422 for a provider not in the catalogue; 400 when the configuration holds something that looks like a secret |
| POST | `/connectors/{kind}/test` | testConnector | ADMIN, PROCUREMENT | Run a health check through the resilient layer and show the circuit breaker state (CLOSED, OPEN, HALF_OPEN) |  |
| POST | `/connectors/{kind}/sync` | syncConnector | ADMIN, PROCUREMENT, FINANCE | Send records outward through the connector, signed; safe to repeat because each record has a key. A failure is kept to retry and queues a manual task |  |
| POST | `/connectors/{kind}/reconcile` | reconcileConnector | ADMIN, PROCUREMENT | Compare what was sent with what the other side acknowledged and send what is missing again under the same key; a second run changes nothing |  |
| GET | `/connectors/sync-runs` | listSyncRuns | ADMIN, PROCUREMENT, FINANCE, LEGAL, EXEC | Reconciliation runs: how many were expected, received, missing and repaired |  |
| GET | `/connectors/{kind}/security` | getConnectorSecurity | ADMIN, PROCUREMENT, PROBITY, EXEC | Evidence for the middleware leg: algorithm, replay window, secret fingerprint and the count of rejected attempts |  |
| POST | `/integration-events/{id}/requeue` | requeueIntegrationEvent | ADMIN, PROCUREMENT, LEGAL | Put a dead-lettered delivery back in the queue with fresh attempts and try it now | 409 unless the event is a dead letter |
| POST | `/integrations/{kind}/webhook` | inboundWebhook | public | Signed inbound message from the middleware (X-IF-Signature and X-IF-Timestamp, HMAC-SHA256, five-minute window); an event id is accepted once | 401 for a bad signature, wrong secret, stale timestamp or unknown organisation; 409 REPLAYED for an event id already received |
| POST | `/suppliers/{id}/verification` | verifySupplier | ADMIN, PROCUREMENT | Screen a supplier against the sanctions list and verify insurance through the resilient layer; UNVERIFIED (provider unavailable) when a provider is down, never CLEAR |  |
| GET | `/manual-tasks` | listManualTasks | ADMIN, PROCUREMENT, FINANCE, LEGAL, EXEC | Work to do by hand while a connected system is down, with instructions |  |
| POST | `/manual-tasks/{id}/complete` | completeManualTask | ADMIN, PROCUREMENT, FINANCE, LEGAL | Mark a manual task done with the reference the person typed; the queued delivery is then closed | 409 when the task is already done or was superseded |
| GET | `/secrets` | listSecrets | ADMIN | Names, versions, fingerprints and last rotation of stored secrets; values are never returned |  |
| PUT | `/secrets/{name}` | setSecret | ADMIN | Set or rotate a secret: a new version is written and the previous one retired; audited without the value |  |
| GET | `/erp/overview` | getErpOverview | ADMIN, FINANCE, PROCUREMENT, EXEC | Imported cost centres with budget, actuals and what is available, organisation units, budget lines, the last run and the ERP connector's provider and health (SIMULATED) |  |
| POST | `/erp/sync` | runErpSync | ADMIN, FINANCE | Pull cost centres, organisation units, budgets and the ledger from the ERP connector's provider (SAP, Oracle or Dynamics), map them and upsert by external id. A second run changes nothing; changes at the source are reported as added, changed and removed. dryRun shows the counts without writing | 200 with status FAILED and a manual task when the ERP connector is DOWN; 422 for a provider that is not an ERP feed |
| GET | `/erp/ledger` | listErpLedger | ADMIN, FINANCE, PROCUREMENT, EXEC | Imported ledger postings, newest first |  |
| GET | `/erp/history` | listErpSyncs | ADMIN, FINANCE, PROCUREMENT, EXEC | Recent ERP imports with the counts of what was added, changed, removed and left alone |  |
| GET | `/erp/cost-centres` | listErpCostCentres | ADMIN, REQUESTER, PROCUREMENT, FINANCE, EXEC, DELEGATE, CONTRACT_MGR | Active imported cost centres, for choosing a cost centre |  |
| POST | `/erp/budget-check` | checkErpBudget | REQUESTER, PROCUREMENT, FINANCE, EXEC | The budget check for a business unit or cost centre. An imported ERP budget line is used when there is one, otherwise the tenant settings; the answer names its source | 422 without a business unit or cost centre |
| POST | `/integrations/legal/events` | legalInboundEvent | public | Signed inbound event from the legal system: MATTER_STAGE_CHANGED, DOCUMENT_ATTACHED or MATTER_CLOSED (X-IF-Signature and X-IF-Timestamp, HMAC-SHA256, five-minute window). Applied to the matter and the contract page; an event id is applied once; a failure is kept and retried, then dead-lettered | 401 for a bad or stale signature or an unknown organisation; 202 when the event could not be applied yet (kept as FAILED or DEAD_LETTER) |
| POST | `/integrations/legal/simulate` | simulateLegalEvent | ADMIN, LEGAL | Build a correctly signed inbound legal event for a matter and run it through the same receiver an outside caller uses (SIMULATED); options show a repeat, a bad signature and an unknown matter | 409 when the matter has no reference in the legal system or the legal connector is off |
| POST | `/integrations/legal/events/{id}/reprocess` | reprocessLegalEvent | ADMIN, LEGAL | Apply an inbound legal event that failed or was dead-lettered, now | 409 when the event was already applied |
| POST | `/legal-matters/{id}/sync-status` | sendLegalMatterStatus | ADMIN, LEGAL, PROCUREMENT | Send this matter's status to the legal system as a signed outbound event through the connector; safe to repeat, a failure is kept and a manual task is queued |  |
| GET | `/contracts/{id}/legal-sync` | getContractLegalSync | ADMIN, LEGAL, PROCUREMENT, DELEGATE, EXEC, CONTRACT_MGR | The contract's legal matters as the legal system reports them: stage, documents attached, closed, and the event history with retries and dead letters |  |
| GET | `/hr-feed/overview` | getHrFeedOverview | ADMIN | HR feed batches, every event with its outcome, exceptions that need a person, time-bound delegations and the work listed for reassignment |  |
| POST | `/hr-feed/run` | runHrFeed | ADMIN | Preview (dryRun) or apply the next batch of the simulated HR feed: starters, leavers, role changes and delegate changes. Each event id is applied once; ADMIN is never granted by the feed; a delegation is capped at the delegator's own limit | 200 with ok false and a manual task when the HR connector is off or DOWN; 409 when there is no later batch |
| POST | `/hr-feed/sync-delegations` | syncHrDelegations | ADMIN | Start delegations whose start date has come and end those whose end date has passed |  |
| POST | `/hr-feed/reassignments/{id}/done` | completeHrReassignment | ADMIN | Record that a leaver's open item was given to a new owner | 409 when already done |
| POST | `/invoices/{id}/payments` | proposePayment | FINANCE | Propose a payment for a matched invoice (full or part). Repeating the same idempotency key returns the same payment and creates nothing | 409 INVOICE_NOT_PAYABLE for an invoice that is not matched (blocked, exception, paid); 409 PAYMENT_EXCEEDS_INVOICE above what is still unpaid |
| POST | `/payments/{id}/approve` | approvePayment | FINANCE, EXEC | A different person approves the payment and the order is sent to the finance system through the PAYMENTS connector; if the system is down it waits with a manual task | 403 ROLE_SOD_VIOLATION for the person who proposed it; 409 unless the payment is proposed |
| POST | `/payments/{id}/retry` | retryPayment | FINANCE, EXEC | Send a failed payment again, or try a waiting payment now | 409 for a payment that is neither failed nor waiting |
| POST | `/payments/{id}/cancel` | cancelPayment | FINANCE, EXEC | Cancel a proposed or failed payment | 409 once the order has been sent |
| POST | `/payments/settle` | settlePayments | FINANCE, EXEC | Bring up to date the payments whose order was delivered after a wait or paid by hand |  |
| GET | `/payments` | listPayments | FINANCE, EXEC, PROCUREMENT, CONTRACT_MGR | Payments with their status trail, and the PAYMENTS connector's state |  |
| GET | `/payments/{id}` | getPayment | FINANCE, EXEC, PROCUREMENT, CONTRACT_MGR | One payment with its status trail |  |
| POST | `/integrations/payments/confirmation` | paymentConfirmation | public | The finance system's signed confirmation or failure callback; applied once per event id | 401 for a bad or stale signature; 409 unless the payment was sent |
| GET | `/contracts/{id}/envelope` | getContractEnvelope | ADMIN, PROCUREMENT, LEGAL, CONTRACT_MGR, DELEGATE, EXEC, FINANCE, PROBITY | The e-signature envelope for a contract: provider, status for each signatory and the event history (a signatory in blind signing sees only their own line) |  |
| POST | `/contracts/{id}/envelope` | createContractEnvelope | ADMIN, LEGAL, PROCUREMENT | Create (or try again to create) the envelope for a contract that is out for signature, with the signatories pre-filled from the signature chain; closes the manual task if one was raised | 409 NO_ENVELOPE when the e-signature connector is not DocuSign or Adobe or the contract is not out for signature; 200 with result MANUAL_TASK when the provider is down |
| POST | `/contracts/{id}/envelope/signing-link` | issueEnvelopeSigningLink | DELEGATE, EXEC | A fresh signing link for the signed-in signatory (the earlier link stops working) | 403 NOT_A_SIGNATORY |
| POST | `/contracts/{id}/envelope/simulate-event` | simulateEnvelopeEvent | ADMIN, LEGAL, PROCUREMENT | Demonstration: make the simulated provider call back (sent, delivered, viewed, signed, declined, voided, expired) with a correctly signed message through the inbound webhook | a repeated eventId is refused as a replay; a signed callback reaches the chain only through the normal sign decision and may be REFUSED by signing authority or order |
| GET | `/esign/{token}` | getEsignCeremony | DELEGATE, EXEC | The simulated signing ceremony: a summary of the document for the signatory the link was issued to; opening it is reported to the provider as delivered and viewed | 404 for a link that is not yours, expired or replaced |
| POST | `/esign/{token}/confirm` | confirmEsign | DELEGATE, EXEC | The signatory's own confirmation: signs or declines through the contract's normal sign decision, so signing authority, order and checks still apply | 403 SIGNING_AUTHORITY_INSUFFICIENT; 409 SIGNING_ORDER, ENVELOPE_CLOSED or ALREADY_DONE; 400 a decline needs a reason |
| GET | `/repository/projects` | listRepositoryProjects | REQUESTER, PROCUREMENT, DELEGATE, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, EXEC | The project sites in the simulated repository that the caller may open (the same procurements the caller can see in reports) | 409 REPOSITORY_OFF when the connector is off; 503 REPOSITORY_UNAVAILABLE when it is down |
| GET | `/repository/projects/{requestId}/files` | listRepositoryFiles | REQUESTER, PROCUREMENT, DELEGATE, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, EXEC | Folders and the newest version of each file in a project site | 404 for a project the caller cannot see |
| GET | `/repository/projects/{requestId}/files/{folder}/{name}` | readRepositoryFile | REQUESTER, PROCUREMENT, DELEGATE, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, EXEC | Read a file (newest version, or ?version=); the ETag is the version to send back in If-Match |  |
| GET | `/repository/projects/{requestId}/files/{folder}/{name}/download` | downloadRepositoryFile | REQUESTER, PROCUREMENT, DELEGATE, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, EXEC | Download a file as it was stored | the file's own content type |
| GET | `/repository/projects/{requestId}/files/{folder}/{name}/versions` | listRepositoryVersions | REQUESTER, PROCUREMENT, DELEGATE, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, EXEC | Every version of a file, newest first |  |
| PUT | `/repository/projects/{requestId}/files/{folder}/{name}` | writeRepositoryFile | REQUESTER, PROCUREMENT, LEGAL, CONTRACT_MGR | Write the next version of a file (never an overwrite): If-Match must carry the version last read; omit it only for a new file | 428 PRECONDITION_REQUIRED without If-Match for an existing file; 412 PRECONDITION_FAILED for a stale version; 400 unsafe file; 413 over 2 MB; 422 FILE_INFECTED; 202 MANUAL_TASK when the repository is down |
| GET | `/repository/projects/{requestId}/sources` | listRepositorySources | REQUESTER, PROCUREMENT, DELEGATE, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, EXEC | Platform documents of this project that can be filed: the tender pack, the evaluation report and contracts |  |
| POST | `/repository/projects/{requestId}/publish` | publishToRepository | PROCUREMENT, LEGAL, CONTRACT_MGR | File a platform document (contract, evaluation report, tender pack) in the project folder as the next version; an unchanged document adds no version | 200 UNCHANGED; 202 MANUAL_TASK when the repository is down; the document is fetched with the caller's own rights |
| POST | `/repository/projects/{requestId}/import` | importFromRepository | LEGAL | Bring a repository file into a contract's negotiation drafts | 404 for a contract of another project; 423 for a locked contract |
| GET | `/continuity/options` | getContinuityOptions | PROCUREMENT, CONTRACT_MGR, EXEC | What can be picked when raising an event: kinds, severities, affected suppliers and contracts, recipient groups and people to escalate to |  |
| POST | `/continuity/events` | raiseContinuityEvent | PROCUREMENT, CONTRACT_MGR, EXEC | Raise a continuity event and send an SMS and an email to each recipient through the simulated gateway; returns the tracker and, once, each recipient's one-time response link | 422 SMS_NOT_PLAIN when the text message note carries a supplier name, a number or an identifier; NO_RECIPIENTS; AFFECTED_REQUIRED |
| GET | `/continuity/events` | listContinuityEvents | PROCUREMENT, CONTRACT_MGR, EXEC, LEGAL | Continuity events, newest first, with how many have answered |  |
| GET | `/continuity/events/{id}` | getContinuityTracker | PROCUREMENT, CONTRACT_MGR, EXEC, LEGAL | The tracker: who has been reached, by which channel, and who has not answered; reading it also records delivery receipts and escalates when due |  |
| POST | `/continuity/events/{id}/resend` | resendContinuityEvent | PROCUREMENT, CONTRACT_MGR, EXEC | Message the people who have not answered again, each with a new one-time link | 409 EVENT_CLOSED |
| POST | `/continuity/events/{id}/responses/{responseId}` | recordContinuityAnswer | PROCUREMENT, CONTRACT_MGR, EXEC | Record an answer taken by phone on someone's behalf | 409 EVENT_CLOSED |
| POST | `/continuity/events/{id}/close` | closeContinuityEvent | PROCUREMENT, CONTRACT_MGR, EXEC | Close the event with a summary of who answered what and how many messages got through | 409 when already closed |
| GET | `/respond-links/{token}` | getRespondLink | public | The one-time response page for one recipient (no sign-in) | 404 unknown link; 410 LINK_EXPIRED |
| POST | `/respond-links/{token}` | answerRespondLink | public | Say I am safe, I am affected or I need help; one answer per person, changeable until the event is closed | 410 LINK_EXPIRED; 409 EVENT_CLOSED |
| GET | `/ai/models` | listAiModels | ADMIN, PROCUREMENT, PROBITY, EXEC | The AI models the platform can use, each with its approval state for this tenant and its data-handling profile (SEC-TP07) |  |
| POST | `/ai/models/{key}/request-approval` | requestAiModelApproval | ADMIN, PROCUREMENT | Ask for a third-party AI model to be approved for this tenant | 409 for the built-in model, an approved model or one with a request already waiting; 404 unknown model |
| POST | `/ai/approvals/{id}/decision` | decideAiApproval | PROBITY, EXEC | Approve or reject a request; never the person who made it | 403 SELF_APPROVAL when the caller made the request; 409 when already decided |
| POST | `/ai/models/{key}/revoke` | revokeAiModel | ADMIN, PROBITY, EXEC | Withdraw an approval; the tenant falls back to rules-simulated-v1 at once and the change is audited | 409 unless the model is approved |
| GET | `/ai/active-model` | getActiveAiModel | REQUESTER, PROCUREMENT, DELEGATE, EVALUATOR, CHAIR, LEGAL, CONTRACT_MGR, PROBITY, FINANCE, ADMIN, EXEC | The model answering for this tenant now, and any per-task choices |  |
| PUT | `/ai/active-model` | setActiveAiModel | ADMIN | Switch the active model (and optional per-task models) by configuration; takes effect at once and is audited with old and new value | 409 MODEL_NOT_APPROVED for a third-party model that is not approved; 422 unknown model |
| GET | `/admin/config/inventory` | getConfigInventory | ADMIN | Every settings section: fields, defaults, current value, who changed it last and the screen that edits it (NFR-M05) |  |
| GET | `/admin/config/export` | exportConfig | ADMIN | All tenant configuration as a JSON file; secrets are left empty and no user data is included | application/json attachment |
| POST | `/admin/config/import` | importConfig | ADMIN | Validate a configuration file with the same schemas and show the difference; applies only when dryRun is false | dryRun defaults to true; 422 when applying an invalid file |
| POST | `/auth/client-check` | reportClientCheck | any signed-in | A signed-in browser reports its user agent and feature support; the server judges it against the published baseline and counts it | Stores browser family, major version and the verdict only |
| GET | `/admin/client-baseline` | getClientBaseline | ADMIN | Counts of sign-ins by browser and whether the baseline was met, with the published baseline |  |
| GET | `/admin/performance/budget-check` | getBudgetCheckPerformance | ADMIN | Count, p50, p95 and max of the measured budget check against the configured target (NFR-P04) |  |
