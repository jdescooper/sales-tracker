-- RLS policies call these helper functions when loading protected lead rows.
-- Authenticated users need EXECUTE on the helpers, but anon/public do not.

revoke execute on function public.crm_user_is_active(uuid) from public, anon;
revoke execute on function public.crm_can_manage_team(uuid) from public, anon;
revoke execute on function public.crm_can_access_lead(uuid, uuid) from public, anon;

grant execute on function public.crm_user_is_active(uuid) to authenticated;
grant execute on function public.crm_can_manage_team(uuid) to authenticated;
grant execute on function public.crm_can_access_lead(uuid, uuid) to authenticated;
