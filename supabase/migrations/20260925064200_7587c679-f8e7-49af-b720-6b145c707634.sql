REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.has_any_role(uuid, public.app_role[]) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.can_see_money(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.claim_ceo() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid, public.app_role[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_see_money(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_ceo() TO authenticated, service_role;