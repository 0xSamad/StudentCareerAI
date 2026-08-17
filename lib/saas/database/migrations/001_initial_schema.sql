-- ============================================================================
-- 001_initial_schema.sql — StudentCareer AI Production PostgreSQL Relational Schema
-- Supports all 21 normalized entities with indexes, foreign keys, constraints & soft delete.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── 1. TENANTS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    plan VARCHAR(50) NOT NULL DEFAULT 'starter',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE NULL
);
CREATE INDEX IF NOT EXISTS idx_tenants_plan ON tenants(plan) WHERE deleted_at IS NULL;

-- ── 2. USERS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'student',
    password_hash VARCHAR(255) NOT NULL,
    password_salt VARCHAR(128) NOT NULL,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    email_verified_at TIMESTAMP WITH TIME ZONE NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE NULL,
    CONSTRAINT chk_users_role CHECK (role IN ('student', 'admin', 'reviewer', 'recruiter')),
    CONSTRAINT uq_users_tenant_email UNIQUE (tenant_id, email)
);
CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ── 3. PROFILES ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    phone VARCHAR(50) NULL,
    linkedin_url TEXT NULL,
    github_url TEXT NULL,
    portfolio_url TEXT NULL,
    city VARCHAR(100) NULL,
    country VARCHAR(100) NULL,
    search_mode VARCHAR(50) NOT NULL DEFAULT 'internships',
    target_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
    preferred_locations JSONB NOT NULL DEFAULT '[]'::jsonb,
    remote_ok BOOLEAN NOT NULL DEFAULT TRUE,
    work_authorization VARCHAR(100) NOT NULL DEFAULT 'Citizen',
    needs_sponsorship BOOLEAN NOT NULL DEFAULT FALSE,
    min_match_score NUMERIC(3, 1) NOT NULL DEFAULT 3.5,
    max_applications_per_day INT NOT NULL DEFAULT 10,
    auto_submit BOOLEAN NOT NULL DEFAULT FALSE,
    raw_cv_text TEXT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE NULL,
    CONSTRAINT chk_profiles_search_mode CHECK (search_mode IN ('internships', 'jobs', 'both')),
    CONSTRAINT chk_profiles_min_match_score CHECK (min_match_score >= 1.0 AND min_match_score <= 5.0),
    CONSTRAINT chk_profiles_daily_limit CHECK (max_applications_per_day >= 1 AND max_applications_per_day <= 50),
    CONSTRAINT uq_profiles_user UNIQUE (tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_profiles_user ON profiles(tenant_id, user_id);

-- ── 4. EDUCATION ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS educations (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile_id VARCHAR(64) NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    university VARCHAR(255) NOT NULL,
    degree VARCHAR(100) NOT NULL,
    major VARCHAR(150) NOT NULL,
    minor VARCHAR(150) NULL,
    current_year INT NULL,
    graduation_date VARCHAR(20) NOT NULL,
    gpa NUMERIC(3, 2) NULL,
    gpa_scale NUMERIC(3, 2) NOT NULL DEFAULT 4.0,
    coursework JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE NULL,
    CONSTRAINT chk_educations_gpa CHECK (gpa IS NULL OR (gpa >= 0.0 AND gpa <= gpa_scale))
);
CREATE INDEX IF NOT EXISTS idx_educations_user ON educations(tenant_id, user_id);

-- ── 5. EXPERIENCES ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS experiences (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile_id VARCHAR(64) NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    company VARCHAR(255) NOT NULL,
    role VARCHAR(255) NOT NULL,
    experience_type VARCHAR(50) NOT NULL DEFAULT 'internship',
    start_date VARCHAR(20) NOT NULL,
    end_date VARCHAR(20) NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT FALSE,
    description TEXT NULL,
    bullets JSONB NOT NULL DEFAULT '[]'::jsonb,
    technologies JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE NULL,
    CONSTRAINT chk_experiences_type CHECK (experience_type IN ('internship', 'full_time', 'part_time', 'research', 'contract'))
);
CREATE INDEX IF NOT EXISTS idx_experiences_user ON experiences(tenant_id, user_id);

-- ── 6. PROJECTS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile_id VARCHAR(64) NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    tagline VARCHAR(255) NULL,
    description TEXT NULL,
    technologies JSONB NOT NULL DEFAULT '[]'::jsonb,
    bullets JSONB NOT NULL DEFAULT '[]'::jsonb,
    repo_url TEXT NULL,
    live_url TEXT NULL,
    featured BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(tenant_id, user_id);

-- ── 7. SKILLS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skills (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile_id VARCHAR(64) NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    category VARCHAR(100) NOT NULL,
    name VARCHAR(150) NOT NULL,
    proficiency VARCHAR(50) NOT NULL DEFAULT 'intermediate',
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE NULL,
    CONSTRAINT chk_skills_proficiency CHECK (proficiency IN ('beginner', 'intermediate', 'advanced', 'expert'))
);
CREATE INDEX IF NOT EXISTS idx_skills_user ON skills(tenant_id, user_id);

-- ── 8. CVS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cvs (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    version INT NOT NULL DEFAULT 1,
    storage_path TEXT NOT NULL,
    raw_text TEXT NULL,
    is_master BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE NULL
);
CREATE INDEX IF NOT EXISTS idx_cvs_user ON cvs(tenant_id, user_id);

-- ── 9. COMPANIES ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companies (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255) NULL,
    careers_url TEXT NULL,
    ats_provider VARCHAR(100) NULL,
    location VARCHAR(255) NULL,
    verified BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE NULL
);
CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(name);

-- ── 10. JOB SOURCES ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_sources (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    adapter_type VARCHAR(50) NOT NULL,
    base_endpoint TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ── 11. OPPORTUNITIES ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS opportunities (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL DEFAULT 'global',
    company_id VARCHAR(64) NULL REFERENCES companies(id) ON DELETE SET NULL,
    company_name VARCHAR(255) NOT NULL,
    job_source_id VARCHAR(64) NULL REFERENCES job_sources(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    opportunity_type VARCHAR(50) NOT NULL DEFAULT 'INTERNSHIP',
    location VARCHAR(255) NULL,
    is_remote BOOLEAN NOT NULL DEFAULT FALSE,
    url TEXT NOT NULL,
    description TEXT NOT NULL,
    requirements JSONB NOT NULL DEFAULT '{}'::jsonb,
    posted_date DATE NULL,
    deadline DATE NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE NULL,
    CONSTRAINT chk_opps_type CHECK (opportunity_type IN ('INTERNSHIP', 'JOB', 'CO_OP', 'FELLOWSHIP')),
    CONSTRAINT uq_opps_url UNIQUE (url)
);
CREATE INDEX IF NOT EXISTS idx_opps_company ON opportunities(company_name);
CREATE INDEX IF NOT EXISTS idx_opps_type ON opportunities(opportunity_type);
CREATE INDEX IF NOT EXISTS idx_opps_posted ON opportunities(posted_date DESC);

-- ── 12. ELIGIBILITY RESULTS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS eligibility_results (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    opportunity_id VARCHAR(64) NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    overall_verdict VARCHAR(50) NOT NULL,
    checks JSONB NOT NULL DEFAULT '{}'::jsonb,
    blocking_failures JSONB NOT NULL DEFAULT '[]'::jsonb,
    evaluated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_eligibility_verdict CHECK (overall_verdict IN ('ELIGIBLE', 'NOT_ELIGIBLE', 'REQUIRES_REVIEW'))
);
CREATE INDEX IF NOT EXISTS idx_eligibility_user ON eligibility_results(tenant_id, user_id, opportunity_id);

-- ── 13. MATCH RESULTS ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS match_results (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    opportunity_id VARCHAR(64) NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    match_score NUMERIC(5, 2) NOT NULL,
    dimension_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
    strengths JSONB NOT NULL DEFAULT '[]'::jsonb,
    missing_skills JSONB NOT NULL DEFAULT '[]'::jsonb,
    evaluated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_match_score CHECK (match_score >= 0.0 AND match_score <= 100.0)
);
CREATE INDEX IF NOT EXISTS idx_match_user ON match_results(tenant_id, user_id, opportunity_id);

-- ── 14. TAILORED CVS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tailored_cvs (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    opportunity_id VARCHAR(64) NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    storage_key TEXT NOT NULL,
    summary TEXT NOT NULL,
    competencies JSONB NOT NULL DEFAULT '[]'::jsonb,
    experience JSONB NOT NULL DEFAULT '[]'::jsonb,
    projects JSONB NOT NULL DEFAULT '[]'::jsonb,
    tailoring_notes TEXT NULL,
    validation_status VARCHAR(50) NOT NULL DEFAULT 'PASSED',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE NULL,
    CONSTRAINT chk_tailored_validation CHECK (validation_status IN ('PASSED', 'WARNING', 'REJECTED'))
);
CREATE INDEX IF NOT EXISTS idx_tailored_cvs_user ON tailored_cvs(tenant_id, user_id, opportunity_id);

-- ── 15. COVER LETTERS ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cover_letters (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    opportunity_id VARCHAR(64) NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    subject_line VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    storage_key TEXT NULL,
    word_count INT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE NULL
);
CREATE INDEX IF NOT EXISTS idx_cover_letters_user ON cover_letters(tenant_id, user_id);

-- ── 16. APPLICATIONS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS applications (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    opportunity_id VARCHAR(64) NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    company VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    state VARCHAR(50) NOT NULL DEFAULT 'DISCOVERED',
    match_score NUMERIC(5, 2) NULL,
    eligibility_status VARCHAR(50) NOT NULL DEFAULT 'ELIGIBLE',
    submission_mode VARCHAR(50) NOT NULL DEFAULT 'SAFE_DRY_RUN',
    applied_at TIMESTAMP WITH TIME ZONE NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE NULL,
    CONSTRAINT chk_app_state CHECK (state IN ('DISCOVERED', 'ELIGIBLE', 'MATCHED', 'CV_GENERATED', 'APPLICATION_READY', 'DRY_RUN_COMPLETED', 'APPLIED', 'INTERVIEWING', 'OFFER', 'REJECTED', 'PAUSED', 'ERROR')),
    CONSTRAINT chk_app_submission_mode CHECK (submission_mode IN ('SAFE_DRY_RUN', 'LIVE', 'MANUAL')),
    -- Hard invariant: concurrent workers cannot create duplicate applications for the same user and opportunity
    CONSTRAINT uq_applications_tenant_user_opp UNIQUE (tenant_id, user_id, opportunity_id)
);
CREATE INDEX IF NOT EXISTS idx_applications_tenant_user ON applications(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_applications_state ON applications(tenant_id, user_id, state);
CREATE INDEX IF NOT EXISTS idx_applications_created ON applications(created_at DESC);

-- ── 17. APPLICATION ANSWERS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS application_answers (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    application_id VARCHAR(64) NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    field_type VARCHAR(50) NOT NULL DEFAULT 'text',
    confidence NUMERIC(3, 2) NOT NULL DEFAULT 1.0,
    is_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
    requires_user_input BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_answer_confidence CHECK (confidence >= 0.0 AND confidence <= 1.0)
);
CREATE INDEX IF NOT EXISTS idx_answers_app ON application_answers(application_id);

-- ── 18. AGENTS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agents (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL DEFAULT 'StudentCareer Agent',
    state VARCHAR(50) NOT NULL DEFAULT 'STOPPED',
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_run_at TIMESTAMP WITH TIME ZONE NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE NULL,
    CONSTRAINT chk_agent_state CHECK (state IN ('RUNNING', 'PAUSED', 'STOPPED', 'ERROR'))
);
CREATE INDEX IF NOT EXISTS idx_agents_user ON agents(tenant_id, user_id);

-- ── 19. AGENT RUNS ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_runs (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id VARCHAR(64) NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE NULL,
    opportunities_found INT NOT NULL DEFAULT 0,
    eligible_count INT NOT NULL DEFAULT 0,
    rejected_count INT NOT NULL DEFAULT 0,
    applications_prepared INT NOT NULL DEFAULT 0,
    applications_submitted INT NOT NULL DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'COMPLETED',
    error_message TEXT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent ON agent_runs(agent_id, started_at DESC);

-- ── 20. APPLICATION EVENTS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS application_events (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    application_id VARCHAR(64) NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    action VARCHAR(100) NOT NULL,
    from_state VARCHAR(50) NULL,
    to_state VARCHAR(50) NOT NULL,
    reason TEXT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_app_events ON application_events(application_id, created_at DESC);

-- ── 21. USAGE & DAILY APPLICATION QUOTAS ────────────────────────────────────
CREATE TABLE IF NOT EXISTS usages (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
    applications_count INT NOT NULL DEFAULT 0,
    ai_tokens_used INT NOT NULL DEFAULT 0,
    ai_requests_count INT NOT NULL DEFAULT 0,
    browser_sessions_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_usages_tenant_user_date UNIQUE (tenant_id, user_id, usage_date)
);
CREATE INDEX IF NOT EXISTS idx_usages_user_date ON usages(tenant_id, user_id, usage_date);

-- ── 22. SUBSCRIPTIONS ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan VARCHAR(50) NOT NULL DEFAULT 'free_tier',
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    daily_application_limit INT NOT NULL DEFAULT 10,
    current_period_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    current_period_end TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE NULL,
    CONSTRAINT chk_sub_plan CHECK (plan IN ('free_tier', 'student_pro', 'university_cohort', 'enterprise'))
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(tenant_id, user_id);
