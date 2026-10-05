DO $$ DECLARE d text; BEGIN
  SELECT pg_get_functiondef('public.purchase_request_rules()'::regprocedure) INTO d;
  EXECUTE replace(d, 'ใbขอซื้อ', 'ใบขอซื้อ');
END $$;