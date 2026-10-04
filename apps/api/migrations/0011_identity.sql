-- B1: identity. Authenticator-app MFA (TOTP), how a session was established, and time-bound role grants.
CREATE TABLE user_mfa (
  user_id uuid PRIMARY KEY REFERENCES app_user(id),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  secret text NOT NULL,
  confirmed boolean NOT NULL DEFAULT false,
  last_step bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE session
  ADD COLUMN mfa_state text NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (mfa_state IN ('NOT_REQUIRED', 'VERIFIED', 'ENROLMENT_REQUIRED')),
  ADD COLUMN auth_method text NOT NULL DEFAULT 'PASSWORD' CHECK (auth_method IN ('PASSWORD', 'SSO'));
--> statement-breakpoint
ALTER TABLE role_assignment
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN granted_by uuid REFERENCES app_user(id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON user_mfa TO app_user;
