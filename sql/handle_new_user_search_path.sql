-- Applied to production on 2026-10-13 with the owner's approval.
-- Auth runs the on_auth_user_created trigger without "public" on its search_path, so the unqualified
-- "perfis" in handle_new_user() failed and every new login returned "Database error creating new user".
alter function public.handle_new_user() set search_path = public;
