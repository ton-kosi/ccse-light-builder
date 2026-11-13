-- Designer / architect of a job (Work_Request summary "Designer" column). Additive: one nullable column.
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS designer text;
