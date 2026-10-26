-- Apply the pending 0022_install_starts_status8 migration unchanged in journal order.
-- Reassert its function restriction without creating the installation-start trigger twice.
REVOKE ALL ON FUNCTION public.work_order_install_started() FROM PUBLIC, anon, authenticated;
