-- User accounts (owner, 27/10/2026): admin creates users with a User ID + temporary password,
-- users change their password and add their own email; roles change only through the admin
-- tools on the server, which ask for the admin's password again.
-- Additive: two columns, one index, one check, one trigger; the two direct admin write policies
-- on user_roles are replaced by the server tools (service role).

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_key ON public.profiles (lower(username))
  WHERE username IS NOT NULL;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_username_format
  CHECK (username IS NULL OR username ~ '^[a-z0-9._-]{3,30}$');

-- A user may edit their own name and clear "must change password", but not their User ID
-- (admin sets it through the server tools, which run without a signed-in user).
CREATE OR REPLACE FUNCTION public.profile_username_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      NEW.username := NULL;
    ELSIF NEW.username IS DISTINCT FROM OLD.username THEN
      NEW.username := OLD.username;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.profile_username_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_profiles_username_guard BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profile_username_guard();

-- Roles are granted / removed only by the admin tools (they re-check the admin's password).
DROP POLICY IF EXISTS "ceo manages roles insert" ON public.user_roles;
DROP POLICY IF EXISTS "ceo manages roles delete" ON public.user_roles;
