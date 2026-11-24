-- ============================================================================
-- MIGRATION: Create AI Provider Configuration Table
-- File: supabase/migrations/20261122_create_ai_provider_config.sql
-- Description: Configurable AI provider and model names independent of secrets
-- ============================================================================

-- 1. CREATE AI PROVIDER CONFIG TABLE WITH STRICT SINGLETON CONSTRAINT
CREATE TABLE IF NOT EXISTS public.ai_provider_config (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    provider TEXT NOT NULL DEFAULT 'openrouter' CHECK (provider = 'openrouter'),
    primary_model TEXT NOT NULL DEFAULT 'google/gemini-2.0-flash-001' CHECK (length(trim(primary_model)) > 0),
    fallback_model TEXT NOT NULL DEFAULT 'qwen/qwen-2.5-72b-instruct' CHECK (length(trim(fallback_model)) > 0),
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- 2. SEED INITIAL CONFIGURATION (SINGLETON ID = 1)
INSERT INTO public.ai_provider_config (
    id,
    provider,
    primary_model,
    fallback_model,
    enabled
)
VALUES (
    1,
    'openrouter',
    'google/gemini-2.0-flash-001',
    'qwen/qwen-2.5-72b-instruct',
    true
)
ON CONFLICT (id) DO NOTHING;

-- 3. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.ai_provider_config ENABLE ROW LEVEL SECURITY;

-- Deny all direct access to anonymous and unauthenticated users
-- Admins can view and update configuration via the portal
DROP POLICY IF EXISTS "Admins can view AI provider config" ON public.ai_provider_config;
CREATE POLICY "Admins can view AI provider config" 
    ON public.ai_provider_config FOR SELECT 
    USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can update AI provider config" ON public.ai_provider_config;
CREATE POLICY "Admins can update AI provider config" 
    ON public.ai_provider_config FOR UPDATE 
    USING (public.is_admin(auth.uid()))
    WITH CHECK (public.is_admin(auth.uid()));

-- Note: The Edge Function uses SUPABASE_SERVICE_ROLE_KEY which bypasses RLS
-- to read the active configuration securely without exposing it to public clients.

-- 4. HARDENED HELPER FUNCTIONS (FOR ADMIN USE)
-- Explicit search_path avoids search_path hijacking vulnerabilities in SECURITY DEFINER functions.
CREATE OR REPLACE FUNCTION public.update_ai_models(
    p_primary_model TEXT,
    p_fallback_model TEXT,
    p_provider TEXT DEFAULT 'openrouter'
)
RETURNS VOID AS $$
BEGIN
    IF NOT public.is_admin(auth.uid()) THEN
        RAISE EXCEPTION 'Access denied: Only administrators can update AI configuration.';
    END IF;

    -- Strict Parameter Validation
    IF p_provider IS NULL OR trim(p_provider) <> 'openrouter' THEN
        RAISE EXCEPTION 'Invalid provider: Only "openrouter" is currently supported.';
    END IF;

    IF p_primary_model IS NULL OR length(trim(p_primary_model)) = 0 THEN
        RAISE EXCEPTION 'Primary model identifier cannot be empty.';
    END IF;

    IF p_fallback_model IS NULL OR length(trim(p_fallback_model)) = 0 THEN
        RAISE EXCEPTION 'Fallback model identifier cannot be empty.';
    END IF;

    UPDATE public.ai_provider_config
    SET 
        provider = trim(p_provider),
        primary_model = trim(p_primary_model),
        fallback_model = trim(p_fallback_model),
        updated_at = NOW(),
        updated_by = auth.uid()
    WHERE id = 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Revoke default public execute and grant only to authenticated users (admin check is inside)
REVOKE EXECUTE ON FUNCTION public.update_ai_models(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_ai_models(TEXT, TEXT, TEXT) TO authenticated;

-- Helper to enable or pause AI grading
CREATE OR REPLACE FUNCTION public.set_ai_grading_status(p_enabled BOOLEAN)
RETURNS VOID AS $$
BEGIN
    IF NOT public.is_admin(auth.uid()) THEN
        RAISE EXCEPTION 'Access denied: Only administrators can toggle AI grading status.';
    END IF;

    IF p_enabled IS NULL THEN
        RAISE EXCEPTION 'Enabled flag cannot be null.';
    END IF;

    UPDATE public.ai_provider_config
    SET 
        enabled = p_enabled,
        updated_at = NOW(),
        updated_by = auth.uid()
    WHERE id = 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.set_ai_grading_status(BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_ai_grading_status(BOOLEAN) TO authenticated;

-- ============================================================================
-- NON-DESTRUCTIVE ROLLBACK INSTRUCTIONS (IF NEEDED):
-- 
-- 1. To pause AI grading without dropping anything:
--    SELECT public.set_ai_grading_status(false);
-- 
-- 2. To completely remove the helper functions and policies:
--    DROP FUNCTION IF EXISTS public.set_ai_grading_status(BOOLEAN);
--    DROP FUNCTION IF EXISTS public.update_ai_models(TEXT, TEXT, TEXT);
--    DROP POLICY IF EXISTS "Admins can update AI provider config" ON public.ai_provider_config;
--    DROP POLICY IF EXISTS "Admins can view AI provider config" ON public.ai_provider_config;
--    -- Avoid dropping public.ai_provider_config table unless permanently abandoning feature
-- ============================================================================
