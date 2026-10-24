-- Deleting a project (admin) also removes its files from storage. job-files already
-- allows admin delete; payment slips and billing PDFs had no delete policy at all.
-- (Lovable's probe tables from 0011 are already gone, so nothing else is needed here.)
CREATE POLICY "payment slips admin delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'payment-slips' AND private.has_role(auth.uid(), 'admin'));
