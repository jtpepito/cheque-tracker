-- People who sign in, with a role. The shared password is only accepted while this table has
-- no active owner.
CREATE TABLE users (
  id              text PRIMARY KEY,
  username        text NOT NULL,
  name            text NOT NULL,
  role            text NOT NULL CHECK (role IN ('owner','staff')),
  can_approve     boolean NOT NULL DEFAULT false,
  password_hash   text NOT NULL,
  active          boolean NOT NULL DEFAULT true,
  session_version integer NOT NULL DEFAULT 1,
  created_at      bigint NOT NULL,
  updated_at      bigint NOT NULL
);
CREATE UNIQUE INDEX users_username ON users (lower(username));
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Who did what, as the person's name at the time.
ALTER TABLE balances ADD COLUMN updated_by text;
ALTER TABLE cheques ADD COLUMN company_set_by text;
ALTER TABLE vouchers ADD COLUMN created_by text;
ALTER TABLE vouchers ADD COLUMN updated_by text;
