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
