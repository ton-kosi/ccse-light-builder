ALTER TYPE public.app_role RENAME VALUE 'ceo' TO 'admin';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'estimator';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'stock';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'accounting';