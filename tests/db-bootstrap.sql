CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.email',true),'') $$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon,service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO authenticated,anon,service_role;
