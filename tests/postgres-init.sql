-- Only the explicitly provisioned disposable integration server.
\set ON_ERROR_STOP on
DO $$ BEGIN
    IF current_database() <> 'aulalista_test' OR session_user <> 'aulalista_test' THEN
        RAISE EXCEPTION 'Refusing configuration outside the disposable test database';
    END IF;
END $$;
COMMENT ON DATABASE aulalista_test IS 'AulaLista disposable integration tests';
-- Constraint DETAIL can contain BYTEA; parameter hiding in the client is insufficient.
ALTER SYSTEM SET log_error_verbosity = 'terse';
ALTER SYSTEM SET log_min_error_statement = 'panic';
ALTER SYSTEM SET log_statement = 'none';
ALTER SYSTEM SET log_min_duration_statement = '-1';
ALTER SYSTEM SET log_min_duration_sample = '-1';
ALTER SYSTEM SET log_parameter_max_length = '0';
ALTER SYSTEM SET log_parameter_max_length_on_error = '0';
SELECT pg_reload_conf();
