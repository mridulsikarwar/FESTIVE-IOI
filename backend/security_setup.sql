-- FESTIVE IOI 2026 - Supabase PostgreSQL Security Lockdown
-- Enables RLS, revokes anonymous write/read access to sensitive tables,
-- adds admin_users authorization, and enforces server-side registration rules.

-- 1. Authorized Admin Users Table
CREATE TABLE IF NOT EXISTS public.admin_users (
    email VARCHAR(100) PRIMARY KEY,
    role VARCHAR(30) NOT NULL DEFAULT 'admin',
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO public.admin_users (email, role)
VALUES ('mridul.sikarwar.sot25@pwioi.com', 'admin')
ON CONFLICT (email) DO NOTHING;

-- Prevent duplicate UTR numbers across guest registrations
CREATE UNIQUE INDEX IF NOT EXISTS ix_students_utr_number
    ON public.students (utr_number)
    WHERE utr_number IS NOT NULL;

-- 2. Helper function: verify authenticated admin user from Supabase Auth JWT
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        auth.uid() IS NOT NULL
        AND (auth.jwt() ->> 'email') IS NOT NULL
        AND length(trim(auth.jwt() ->> 'email')) > 0
        AND EXISTS (
            SELECT 1
            FROM public.admin_users a
            WHERE lower(a.email) = lower(trim(auth.jwt() ->> 'email'))
        ),
        FALSE
    );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;

-- 3. Server-side BEFORE INSERT trigger on students
-- Ensures client requests cannot spoof email, user_type, payment_status, amount_paid,
-- ticket_token, or bypass paused registration gates.
CREATE OR REPLACE FUNCTION public.enforce_student_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    jwt_email TEXT;
    email_domain TEXT;
    is_pw BOOLEAN;
    pw_open TEXT;
    guest_open TEXT;
BEGIN
    NEW.name := trim(COALESCE(NEW.name, ''));
    NEW.phone := trim(COALESCE(NEW.phone, ''));
    NEW.email := lower(trim(COALESCE(NEW.email, '')));

    IF NEW.name = '' THEN
        RAISE EXCEPTION 'Name is required.';
    END IF;
    IF NEW.phone = '' THEN
        RAISE EXCEPTION 'Phone number is required.';
    END IF;

    -- Enforce strict rules for browser/API inserts by non-admin users
    IF COALESCE(auth.role(), '') IN ('anon', 'authenticated') AND NOT public.is_admin() THEN
        IF auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Authentication required to register.';
        END IF;

        jwt_email := lower(trim(COALESCE(auth.jwt() ->> 'email', '')));
        IF jwt_email = '' OR position('@' in jwt_email) = 0 THEN
            RAISE EXCEPTION 'Verified email missing from authentication session.';
        END IF;

        -- Force email from verified Supabase Auth JWT
        NEW.email := jwt_email;
        email_domain := split_part(jwt_email, '@', 2);
        is_pw := email_domain IN ('pwioi.com', 'pw.live');

        IF is_pw THEN
            SELECT value INTO pw_open FROM public.system_config WHERE key = 'pw_registration_open';
            IF COALESCE(pw_open, 'true') = 'false' THEN
                RAISE EXCEPTION 'Registrations for PW Community are currently closed by administrators.';
            END IF;

            NEW.enrollment_id := upper(trim(COALESCE(NEW.enrollment_id, '')));
            IF NEW.enrollment_id = '' OR NEW.enrollment_id ~ '^GST-' THEN
                RAISE EXCEPTION 'Valid Enrollment ID is required for PW Community registration.';
            END IF;

            NEW.user_type := 'pw_member';
            NEW.company := NULL;
            NEW.amount_paid := 0;
            NEW.utr_number := NULL;
            NEW.payment_status := 'approved';
        ELSE
            SELECT value INTO guest_open FROM public.system_config WHERE key = 'guest_registration_open';
            IF COALESCE(guest_open, 'true') = 'false' THEN
                RAISE EXCEPTION 'Registrations for external guests are currently closed by administrators.';
            END IF;

            NEW.utr_number := trim(COALESCE(NEW.utr_number, ''));
            IF NEW.utr_number !~ '^\d{12}$' THEN
                RAISE EXCEPTION 'A valid 12-digit numeric UTR is required for guest registration.';
            END IF;

            NEW.enrollment_id := 'GST-' || upper(encode(extensions.gen_random_bytes(3), 'hex'));
            NEW.user_type := 'guest';
            NEW.department := 'External Guest';
            NEW.year := 'Guest';
            NEW.company := NULLIF(trim(COALESCE(NEW.company, '')), '');
            NEW.amount_paid := 500;
            NEW.payment_status := 'pending_verification';
        END IF;

        -- Always generate ticket token & timestamp server-side
        NEW.ticket_token := 'TKT-' || upper(encode(extensions.gen_random_bytes(8), 'hex'));
        NEW.registered_at := timezone('utc', now());
    ELSE
        -- Admin or direct backend (postgres) insert
        NEW.enrollment_id := upper(trim(COALESCE(NEW.enrollment_id, '')));
        IF NEW.enrollment_id = '' THEN
            NEW.enrollment_id := 'GST-' || upper(encode(extensions.gen_random_bytes(3), 'hex'));
        END IF;
        IF COALESCE(trim(NEW.ticket_token), '') = '' THEN
            NEW.ticket_token := 'TKT-' || upper(encode(extensions.gen_random_bytes(8), 'hex'));
        ELSE
            NEW.ticket_token := upper(trim(NEW.ticket_token));
        END IF;
        IF NEW.registered_at IS NULL THEN
            NEW.registered_at := timezone('utc', now());
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_student_insert ON public.students;
CREATE TRIGGER trg_enforce_student_insert
    BEFORE INSERT ON public.students
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_student_insert();

-- 4. Revoke excessive privileges from anon, authenticated, and PUBLIC
REVOKE ALL ON TABLE
    public.students,
    public.attendance,
    public.departments,
    public.system_config,
    public.admin_users
FROM anon, authenticated, PUBLIC;

-- Grant minimal required table privileges (RLS enforces row-level access)
GRANT SELECT ON TABLE public.departments, public.system_config TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.departments, public.system_config TO authenticated;

GRANT SELECT ON TABLE public.admin_users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.students TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.attendance TO authenticated;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- 5. Enable Row Level Security on all public tables
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- 6. Recreate clean RLS Policies

-- admin_users: authenticated users can only check their own row (or admins can view all)
DROP POLICY IF EXISTS admin_users_select_own ON public.admin_users;
CREATE POLICY admin_users_select_own
    ON public.admin_users
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() IS NOT NULL
        AND (lower(email) = lower(auth.jwt() ->> 'email') OR public.is_admin())
    );

-- departments: public read, admin write
DROP POLICY IF EXISTS departments_public_read ON public.departments;
CREATE POLICY departments_public_read
    ON public.departments
    FOR SELECT
    TO anon, authenticated
    USING (TRUE);

DROP POLICY IF EXISTS departments_admin_write ON public.departments;
CREATE POLICY departments_admin_write
    ON public.departments
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- system_config: public read, admin write
DROP POLICY IF EXISTS system_config_public_read ON public.system_config;
CREATE POLICY system_config_public_read
    ON public.system_config
    FOR SELECT
    TO anon, authenticated
    USING (TRUE);

DROP POLICY IF EXISTS system_config_admin_write ON public.system_config;
CREATE POLICY system_config_admin_write
    ON public.system_config
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- students: no anon access; users see/insert only their own email; admins have full access
DROP POLICY IF EXISTS students_select_own_or_admin ON public.students;
CREATE POLICY students_select_own_or_admin
    ON public.students
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() IS NOT NULL
        AND (
            lower(email) = lower(auth.jwt() ->> 'email')
            OR public.is_admin()
        )
    );

DROP POLICY IF EXISTS students_insert_self_or_admin ON public.students;
CREATE POLICY students_insert_self_or_admin
    ON public.students
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_admin()
        OR (
            auth.uid() IS NOT NULL
            AND (auth.jwt() ->> 'email') IS NOT NULL
            AND lower(email) = lower(auth.jwt() ->> 'email')
        )
    );

DROP POLICY IF EXISTS students_update_admin_only ON public.students;
CREATE POLICY students_update_admin_only
    ON public.students
    FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS students_delete_admin_only ON public.students;
CREATE POLICY students_delete_admin_only
    ON public.students
    FOR DELETE
    TO authenticated
    USING (public.is_admin());

-- attendance: students can read their own check-in; only admins can insert/update/delete
DROP POLICY IF EXISTS attendance_select_own_or_admin ON public.attendance;
CREATE POLICY attendance_select_own_or_admin
    ON public.attendance
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() IS NOT NULL
        AND (
            public.is_admin()
            OR EXISTS (
                SELECT 1
                FROM public.students s
                WHERE s.enrollment_id = attendance.enrollment_id
                  AND lower(s.email) = lower(auth.jwt() ->> 'email')
            )
        )
    );

DROP POLICY IF EXISTS attendance_admin_insert ON public.attendance;
CREATE POLICY attendance_admin_insert
    ON public.attendance
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS attendance_admin_update ON public.attendance;
CREATE POLICY attendance_admin_update
    ON public.attendance
    FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS attendance_admin_delete ON public.attendance;
CREATE POLICY attendance_admin_delete
    ON public.attendance
    FOR DELETE
    TO authenticated
    USING (public.is_admin());
