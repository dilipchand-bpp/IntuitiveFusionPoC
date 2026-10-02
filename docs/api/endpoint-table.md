| Method | Path | operationId | Roles | Purpose | Notes |
|---|---|---|---|---|---|
| POST | `/auth/login` | login | public | Mock login; returns session cookie (HttpOnly) and user |  |
| POST | `/auth/logout` | logout | any signed-in | End session |  |
| POST | `/auth/forgot-password` | forgotPassword | public | Request reset; always returns 202 (no account enumeration) |  |
| GET | `/auth/me` | getMe | any signed-in | Current user and role-based home path |  |
| POST | `/auth/access-denied` | reportAccessDenied | any signed-in | Web route guard reports a blocked page visit so it is audited |  |
| GET | `/requests` | listRequests | any signed-in | List requests visible to caller (scope by role/hierarchy) |  |
| POST | `/requests` | createRequest | REQUESTER, PROCUREMENT | Create blank request |  |
| GET | `/requests/{id}` | getRequest | any signed-in | Get request |  |
| PATCH | `/requests/{id}` | updateRequest | REQUESTER, PROCUREMENT | Update request fields |  |
| POST | `/requests/{id}/submit` | submitRequest | REQUESTER, PROCUREMENT | Run budget check, complexity score and routing; submits | 409 if mandatory fields missing; 422 if hard-cap budget exceeded |
| POST | `/assistant/conversations` | startConversation | any signed-in | Start mock-AI conversation (simulated=true) |  |
| GET | `/assistant/conversations/{id}` | getConversation | any signed-in | Get conversation |  |
| POST | `/assistant/conversations/{id}/messages` | sendMessage | any signed-in | Send user text; returns assistant reply with proposed field changes |  |
| GET | `/requests/{id}/plan` | getPlan | REQUESTER, PROCUREMENT, DELEGATE, EVALUATOR, CHAIR, LEGAL, PROBITY, EXEC, ADMIN | Get (or lazily create from intake) the procurement plan |  |
| PUT | `/plans/{id}/fields/{key}` | updatePlanField | PROCUREMENT, REQUESTER | Set a field (or one paragraph); optimistic concurrency via expectedVersion | 409 on stale version; 423 if plan locked |
| POST | `/plans/{id}/instructions` | instructPlan | PROCUREMENT, REQUESTER | Plain-language amend ('change paragraph 3 to …') |  |
| POST | `/plans/{id}/instructions/undo` | undoInstruction | PROCUREMENT, REQUESTER | Undo last instruction by token |  |
| POST | `/plans/{id}/submit-for-approval` | submitPlan | PROCUREMENT | Move to approval; requires COI declarations and risk gates |  |
| POST | `/plans/{id}/decision` | decidePlan | DELEGATE | Delegate approves/rejects; delegation limit enforced; locks on approval | 403 if value exceeds delegation; 409 if gates unmet |
| POST | `/plans/{id}/reopen` | reopenPlan | PROCUREMENT | Reopen locked plan with reason (Procurement only) |  |
| POST | `/plans/{id}/coi` | declarePlanCoi | PROCUREMENT, EVALUATOR, CHAIR, LEGAL, DELEGATE | Declare conflict (or none) |  |
| POST | `/coi/{id}/decision` | decideCoi | DELEGATE, PROBITY | Delegate/Risk decides disposition |  |
| GET | `/tenders` | listTenders | PROCUREMENT, DELEGATE, EVALUATOR, CHAIR, LEGAL, PROBITY, EXEC, ADMIN | List tenders visible to caller |  |
| POST | `/tenders` | createTender | PROCUREMENT | Create tender and generate pack from request/plan |  |
| GET | `/tenders/{id}` | getTender | PROCUREMENT, DELEGATE, EVALUATOR, CHAIR, LEGAL, PROBITY, EXEC, ADMIN | Get tender |  |
| PUT | `/tenders/{id}/fields/{key}` | updateTenderField | PROCUREMENT, LEGAL | Edit pack field |  |
| POST | `/tenders/{id}/publish-permission` | grantPublishPermission | DELEGATE | ECV-appropriate delegate grants permission to publish |  |
| POST | `/tenders/{id}/publish` | publishTender | PROCUREMENT | Publish (needs permission, statutory window valid) | 409 without permission; 422 if statutory window not met |
| POST | `/tenders/{id}/invitations` | inviteSuppliers | PROCUREMENT | Invite suppliers by email |  |
| GET | `/tenders/{id}/questions` | listQuestions | PROCUREMENT, LEGAL, SUPPLIER | Questions (identity never returned) |  |
| POST | `/tenders/{id}/addenda` | issueAddendum | PROCUREMENT | Publish answers/changes to all bidders |  |
| POST | `/supplier/register` | registerSupplier | public | Self-register from invitation token |  |
| GET | `/supplier/tenders` | listMyTenders | SUPPLIER | Tenders caller is invited to (max one active view) |  |
| POST | `/supplier/tenders/{id}/questions` | askQuestion | SUPPLIER | Ask anonymised question |  |
| POST | `/supplier/tenders/{id}/submission/files` | uploadBidFile | SUPPLIER | Multipart upload (type/size allow-list, malware scan) | multipart/form-data; 415/413 on type/size; 423 after close |
| POST | `/supplier/tenders/{id}/submission` | submitBid | SUPPLIER | Submit; issues receipt; rejected if after close | 423 + REJECTED_LATE after closesAt |
| GET | `/suppliers/{id}` | getSupplier | PROCUREMENT, LEGAL, FINANCE, ADMIN | Supplier profile with sanctions/insurance status |  |
| POST | `/tenders/{id}/evaluation` | openEvaluation | PROCUREMENT | Create evaluation + one record per submitted bidder |  |
| GET | `/evaluations/{id}` | getEvaluation | PROCUREMENT, EVALUATOR, CHAIR, DELEGATE, PROBITY, LEGAL | Get evaluation; suppliers anonymised until COI declared; stream-scoped payload |  |
| POST | `/evaluations/{id}/coi` | declareEvalCoi | EVALUATOR, CHAIR | Mandatory COI before access; conflict revokes access |  |
| GET | `/evaluations/{id}/scores/mine` | getMyScores | EVALUATOR, CHAIR | Own scores only |  |
| PUT | `/evaluations/{id}/scores` | saveScores | EVALUATOR, CHAIR | Save own scores (hidden from others) |  |
| POST | `/evaluations/{id}/consensus/open` | openConsensus | CHAIR | Chair opens consensus (all scoring submitted) |  |
| PUT | `/evaluations/{id}/consensus/{supplierId}` | setConsensus | CHAIR | Record consensus score + rationale |  |
| POST | `/evaluations/{id}/consensus/lock` | lockConsensus | CHAIR | Lock; fails if flagged items lack rationale | 409 CONSENSUS_UNRESOLVED_FLAGS |
| POST | `/evaluations/{id}/report` | generateReport | PROCUREMENT | Generate evaluation report |  |
| POST | `/evaluation-reports/{id}/decision` | decideReport | DELEGATE | Value-tier delegate signs off |  |
| POST | `/contracts` | draftContract | LEGAL, PROCUREMENT | Draft from approved report: template + clauses + supplier data |  |
| GET | `/contracts` | listContracts | PROCUREMENT, LEGAL, CONTRACT_MGR, DELEGATE, EXEC, FINANCE, PROBITY | Contracts visible to caller |  |
| GET | `/contracts/{id}` | getContract | PROCUREMENT, LEGAL, CONTRACT_MGR, DELEGATE, EXEC, FINANCE, PROBITY | Get contract |  |
| PUT | `/contracts/{id}/clauses/{clauseId}` | updateClause | LEGAL | Edit clause (blocked when locked) | 423 when executed |
| POST | `/contracts/{id}/release-for-signing` | releaseForSigning | LEGAL, PROCUREMENT | Run configured review chain, then signing |  |
| POST | `/contracts/{id}/sign` | signContract | DELEGATE | Mock e-signature by signing delegate (authority checked separately) | 403 SIGNING_AUTHORITY_INSUFFICIENT |
| GET | `/contracts/{id}/alerts` | listAlerts | CONTRACT_MGR, PROCUREMENT, LEGAL, EXEC | System + user alerts |  |
| POST | `/contracts/{id}/alerts` | createAlert | CONTRACT_MGR | Create alert from plain-language instruction |  |
| GET | `/dashboard/kpis` | getKpis | any signed-in | Role-scoped KPIs |  |
| GET | `/reports/expiring-contracts` | expiringContracts | CONTRACT_MGR, PROCUREMENT, EXEC, LEGAL | Contracts expiring within N days (default 90) |  |
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
