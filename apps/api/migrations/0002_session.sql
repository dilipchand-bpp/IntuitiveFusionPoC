-- Server-side sessions (hand-written to keep numbering after 0001; Drizzle schema mirrors it and the drift test enforces that).
CREATE TABLE session (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  pool text NOT NULL CHECK (pool IN ('STAFF', 'SUPPLIER')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip text,
  user_agent text
);
--> statement-breakpoint
CREATE INDEX session_user_idx ON session (user_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON session TO app_user;
