p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\_work\gen_openapi.py'
t = open(p, encoding='utf8', newline='').read()


def sub(a, b):
    global t
    assert a in t, a[:80]
    t = t.replace(a, b, 1)


sub(' "AdminUser": obj({"id": UUID, "name": S, "email": S, "roles": arr(enum(*ROLES)), "orgUnit": S, "active": B}, ["id", "name", "email", "roles"]),',
    ' "AdminUser": obj({"id": UUID, "name": S, "email": S, "roles": arr(enum(*ROLES)), "orgUnit": S, "orgUnitId": UUID, "active": B, "awaitingActivation": B}, ["id", "name", "email", "roles"]),\n'
    ' "AdminUserUpdate": obj({"name": S, "roles": arr(enum(*ROLES)), "active": B, "orgUnitId": UUID}),\n'
    ' "AdminUserCreated": obj({"user": ref("AdminUser"), "activationPath": S, "expiresAt": DT}, ["user", "activationPath"]),\n'
    ' "ActivationLink": obj({"activationPath": S, "expiresAt": DT}, ["activationPath"]),\n'
    ' "OrgUnit": obj({"id": UUID, "name": S}, ["id", "name"]),\n'
    ' "WorkflowUpdate": obj({"name": S, "steps": arr(obj({"label": {"type": "string", "minLength": 1, "maxLength": 60}, "mandatory": B}, ["label", "mandatory"]))}, ["steps"]),')
sub(' "AdminUserCreate": obj({"name": S, "email": {"type": "string", "format": "email"}, "role": enum(*ROLES), "orgUnit": S}, ["name", "email", "role"]),',
    ' "AdminUserCreate": obj({"name": S, "email": {"type": "string", "format": "email"}, "roles": arr(enum(*ROLES)), "orgUnitId": UUID}, ["name", "email", "roles"]),')
sub(' "Template": obj({"id": S, "type": S, "name": S, "version": S, "status": S}, ["id", "type", "name"]),',
    ' "Template": obj({"id": S, "type": S, "name": S, "version": S, "status": S, "appliesTo": arr(S), "clauses": arr(obj({"id": S, "title": S, "mandatory": B}))}, ["id", "type", "name"]),')
sub('ep("POST", "/admin/users", "adminCreateUser", AD, "Create user", ["ADMIN"], "AdminUserCreate", "AdminUser", 201)',
    'ep("POST", "/admin/users", "adminCreateUser", AD, "Create a staff user with roles; the person sets their own password through a one-time link (shown once). ADMIN cannot be combined with another role", ["ADMIN"], "AdminUserCreate", "AdminUserCreated", 201, note="409 EMAIL_IN_USE; 422 ROLE_COMBINATION")\n'
    'ep("PUT", "/admin/users/{id}", "adminUpdateUser", AD, "Change name, roles, organisation unit or active state; a role change or switch-off ends their sessions; not for yourself", ["ADMIN"], "AdminUserUpdate", "AdminUser", note="403 for yourself; 422 ROLE_COMBINATION")\n'
    'ep("POST", "/admin/users/{id}/activation-link", "adminActivationLink", AD, "Issue a new one-time activation link (earlier ones stop working)", ["ADMIN"], None, "ActivationLink", 201)\n'
    'ep("GET", "/admin/org-units", "adminListOrgUnits", AD, "Organisation units", ["ADMIN"], None, "OrgUnit", arrayResp=True)')
sub('ep("GET", "/admin/workflows", "listWorkflows"', 'ep("PUT", "/admin/workflows/{id}", "updateWorkflow", AD, "Edit the simple workflow (steps, order, optional); a mandatory approval checkpoint must stay. Other workflows answer 409 NOT_EDITABLE (coming soon)", ["ADMIN"], "WorkflowUpdate", "Workflow", note="422 CHECKPOINT_REQUIRED, DUPLICATE_STEP")\nep("GET", "/admin/workflows", "listWorkflows"')
open(p, 'w', encoding='utf8', newline='').write(t)
print('ok')
