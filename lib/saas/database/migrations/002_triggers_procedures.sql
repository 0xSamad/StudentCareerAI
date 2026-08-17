-- ============================================================================
-- 002_triggers_procedures.sql — Automatic Timestamps & Concurrency Quota Controls
-- ============================================================================

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger across all active tables
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN 
        SELECT table_name 
        FROM information_schema.columns 
        WHERE column_name = 'updated_at' 
          AND table_schema = 'public'
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON %I;', t);
        EXECUTE format('CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();', t);
    END LOOP;
END;
$$;

-- Function: Transactionally check and increment daily application quota
CREATE OR REPLACE FUNCTION record_daily_application_quota(
    p_tenant_id VARCHAR(64),
    p_user_id VARCHAR(64),
    p_max_limit INT
)
RETURNS BOOLEAN AS $$
DECLARE
    v_current_count INT;
BEGIN
    -- Upsert usage record with row-level lock
    INSERT INTO usages (id, tenant_id, user_id, usage_date, applications_count, created_at, updated_at)
    VALUES (
        'use_' || encode(gen_random_bytes(16), 'hex'),
        p_tenant_id,
        p_user_id,
        CURRENT_DATE,
        0,
        NOW(),
        NOW()
    )
    ON CONFLICT (tenant_id, user_id, usage_date) DO NOTHING;

    -- Lock row FOR UPDATE to prevent race conditions across parallel worker threads
    SELECT applications_count INTO v_current_count
    FROM usages
    WHERE tenant_id = p_tenant_id 
      AND user_id = p_user_id 
      AND usage_date = CURRENT_DATE
    FOR UPDATE;

    IF v_current_count >= p_max_limit THEN
        RETURN FALSE; -- Daily limit exceeded
    END IF;

    -- Increment atomically within transaction
    UPDATE usages
    SET applications_count = applications_count + 1,
        updated_at = NOW()
    WHERE tenant_id = p_tenant_id 
      AND user_id = p_user_id 
      AND usage_date = CURRENT_DATE;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;
