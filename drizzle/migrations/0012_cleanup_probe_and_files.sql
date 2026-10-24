-- 1. Lovable's test tables from 0011_probe_double_exec: empty, no RLS, not used by the app.
--    Dropped with the owner's approval (24/10/2026).
DROP TABLE IF EXISTS public.__probe_dup;
DROP TABLE IF EXISTS public.__probe_dup2;

-- 2. Deleting a project (admin) also removes its files from storage. job-files already
--    allows admin delete; payment slips and billing PDFs had no delete policy at all.
CREATE POLICY "payment slips admin delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'payment-slips' AND private.has_role(auth.uid(), 'admin'));
