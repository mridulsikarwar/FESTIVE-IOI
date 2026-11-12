-- FESTIVE IOI 2026 - Multi-Club, Multi-Event & Group Ticketing Migration
-- Supports 7 Clubs, Club Presidents (club-scoped admin), Solo & Team Events, and Per-Event QR Tickets.

-- 1. Clubs Table (7 Official Clubs)
CREATE TABLE IF NOT EXISTS public.clubs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    slug VARCHAR(60) NOT NULL UNIQUE,
    description TEXT,
    logo_url TEXT,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO public.clubs (name, slug, description) VALUES
    ('Tech Club', 'tech-club', 'Hackathons, coding contests, AI/ML & developer workshops.'),
    ('Cultural Club', 'cultural-club', 'Music, dance, drama, art & campus cultural fests.'),
    ('Content Club', 'content-club', 'Media, photography, filmmaking, journalism & creative writing.'),
    ('Business Club', 'business-club', 'Entrepreneurship, case competitions, finance & startup summits.'),
    ('Robotics Club', 'robotics-club', 'Hardware builds, drones, IoT & autonomous robotics.'),
    ('Sports Club', 'sports-club', 'Tournaments, esports, athletics & inter-college leagues.'),
    ('Social Welfare Club', 'social-welfare-club', 'Community drives, volunteering & sustainability initiatives.')
ON CONFLICT (slug) DO NOTHING;

-- 2. Upgrade admin_users with club scoping & roles
CREATE TABLE IF NOT EXISTS public.admin_users (
    email VARCHAR(100) PRIMARY KEY,
    role VARCHAR(30) NOT NULL DEFAULT 'club_president',
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.admin_users
    ADD COLUMN IF NOT EXISTS name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS club_id INTEGER REFERENCES public.clubs(id) ON DELETE SET NULL;

INSERT INTO public.admin_users (email, name, role, club_id)
VALUES ('mridul.sikarwar.sot25@pwioi.com', 'Mridul Sikarwar', 'super_admin', NULL)
ON CONFLICT (email) DO UPDATE
SET role = 'super_admin',
    name = COALESCE(public.admin_users.name, EXCLUDED.name),
    club_id = NULL;

-- 3. Events Table
CREATE TABLE IF NOT EXISTS public.events (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    club_id INTEGER NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL,
    slug VARCHAR(160) NOT NULL UNIQUE,
    description TEXT,
    banner_url TEXT,
    venue VARCHAR(150),
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE,
    participation_type VARCHAR(20) NOT NULL DEFAULT 'solo'
        CHECK (participation_type IN ('solo', 'team', 'both')),
    min_team_size INTEGER NOT NULL DEFAULT 1,
    max_team_size INTEGER NOT NULL DEFAULT 1,
    registration_open BOOLEAN NOT NULL DEFAULT TRUE,
    allow_pw_members BOOLEAN NOT NULL DEFAULT TRUE,
    allow_guests BOOLEAN NOT NULL DEFAULT TRUE,
    pw_fee NUMERIC NOT NULL DEFAULT 0,
    guest_fee NUMERIC NOT NULL DEFAULT 500,
    upi_id VARCHAR(100),
    max_capacity INTEGER,
    status VARCHAR(20) NOT NULL DEFAULT 'published'
        CHECK (status IN ('draft', 'published', 'paused', 'completed')),
    created_by VARCHAR(100) REFERENCES public.admin_users(email) ON DELETE SET NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_events_club_id ON public.events (club_id);
CREATE INDEX IF NOT EXISTS ix_events_start_time ON public.events (start_time);

-- 4. Attendees Table (Reusable student/guest profile across events)
CREATE TABLE IF NOT EXISTS public.attendees (
    email VARCHAR(100) PRIMARY KEY,
    enrollment_id VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    department VARCHAR(100),
    year VARCHAR(20),
    phone VARCHAR(20) NOT NULL UNIQUE,
    user_type VARCHAR(20) NOT NULL DEFAULT 'pw_member',
    company VARCHAR(100),
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Teams Table (For group / team events)
CREATE TABLE IF NOT EXISTS public.teams (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    team_name VARCHAR(100) NOT NULL,
    join_code VARCHAR(20) NOT NULL UNIQUE,
    leader_email VARCHAR(100) NOT NULL REFERENCES public.attendees(email) ON DELETE CASCADE,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (event_id, team_name)
);

CREATE INDEX IF NOT EXISTS ix_teams_event_id ON public.teams (event_id);

-- 6. Registrations Table (Per-event tickets, solo or team)
CREATE TABLE IF NOT EXISTS public.registrations (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
    attendee_email VARCHAR(100) NOT NULL REFERENCES public.attendees(email) ON DELETE CASCADE,
    ticket_token VARCHAR(100) NOT NULL UNIQUE,
    amount_paid NUMERIC NOT NULL DEFAULT 0,
    utr_number VARCHAR(50),
    payment_status VARCHAR(30) NOT NULL DEFAULT 'approved'
        CHECK (payment_status IN ('approved', 'pending_verification', 'rejected')),
    registered_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (event_id, attendee_email)
);

CREATE INDEX IF NOT EXISTS ix_registrations_event_id ON public.registrations (event_id);
CREATE INDEX IF NOT EXISTS ix_registrations_team_id ON public.registrations (team_id);
CREATE UNIQUE INDEX IF NOT EXISTS ix_registrations_utr_number
    ON public.registrations (utr_number)
    WHERE utr_number IS NOT NULL;

-- 7. Replace single-event attendance & students with per-registration attendance
DROP TABLE IF EXISTS public.attendance CASCADE;
DROP TABLE IF EXISTS public.students CASCADE;

CREATE TABLE public.attendance (
    attendance_id SERIAL PRIMARY KEY,
    registration_id UUID NOT NULL UNIQUE REFERENCES public.registrations(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'Present',
    scanned_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    scanned_by VARCHAR(100) DEFAULT 'Admin Scanner'
);

CREATE INDEX IF NOT EXISTS ix_attendance_event_id ON public.attendance (event_id);

-- 8. Security & Club-Scoped Admin Helper Functions
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

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        auth.uid() IS NOT NULL
        AND EXISTS (
            SELECT 1
            FROM public.admin_users a
            WHERE lower(a.email) = lower(trim(auth.jwt() ->> 'email'))
              AND a.role = 'super_admin'
        ),
        FALSE
    );
$$;

CREATE OR REPLACE FUNCTION public.admin_club_id()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT a.club_id
    FROM public.admin_users a
    WHERE auth.uid() IS NOT NULL
      AND lower(a.email) = lower(trim(auth.jwt() ->> 'email'))
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.can_manage_club(target_club_id INTEGER)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.is_super_admin()
        OR (public.is_admin() AND public.admin_club_id() = target_club_id);
$$;

CREATE OR REPLACE FUNCTION public.can_manage_event(target_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.is_super_admin()
        OR (
            public.is_admin()
            AND EXISTS (
                SELECT 1 FROM public.events e
                WHERE e.id = target_event_id
                  AND e.club_id = public.admin_club_id()
            )
        );
$$;

CREATE OR REPLACE FUNCTION public.get_event_registration_counts()
RETURNS TABLE(event_id UUID, registered_count BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT r.event_id, COUNT(*)::BIGINT AS registered_count
    FROM public.registrations r
    WHERE r.payment_status <> 'rejected'
    GROUP BY r.event_id;
$$;

CREATE OR REPLACE FUNCTION public.is_team_member(target_team_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT target_team_id IS NOT NULL
        AND auth.uid() IS NOT NULL
        AND EXISTS (
            SELECT 1
            FROM public.registrations r
            WHERE r.team_id = target_team_id
              AND lower(r.attendee_email) = lower(trim(auth.jwt() ->> 'email'))
        );
$$;

REVOKE ALL ON FUNCTION public.is_admin(), public.is_super_admin(), public.admin_club_id(), public.can_manage_club(INTEGER), public.can_manage_event(UUID), public.get_event_registration_counts(), public.is_team_member(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin(), public.is_super_admin(), public.admin_club_id(), public.can_manage_club(INTEGER), public.can_manage_event(UUID), public.is_team_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_registration_counts() TO anon, authenticated;

-- 9. Server-Side Triggers

-- 9A. Enforce attendee profile rules
CREATE OR REPLACE FUNCTION public.enforce_attendee_upsert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    jwt_email TEXT;
    email_domain TEXT;
    is_pw BOOLEAN;
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

    IF COALESCE(auth.role(), '') IN ('anon', 'authenticated') AND NOT public.is_admin() THEN
        IF auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Authentication required.';
        END IF;

        jwt_email := lower(trim(COALESCE(auth.jwt() ->> 'email', '')));
        IF jwt_email = '' THEN
            RAISE EXCEPTION 'Verified email missing from session.';
        END IF;

        NEW.email := jwt_email;
        email_domain := split_part(jwt_email, '@', 2);
        is_pw := email_domain IN ('pwioi.com', 'pw.live');

        IF is_pw THEN
            NEW.user_type := 'pw_member';
            NEW.company := NULL;
            NEW.enrollment_id := upper(trim(COALESCE(NEW.enrollment_id, '')));
            IF NEW.enrollment_id = '' OR NEW.enrollment_id ~ '^GST-' THEN
                RAISE EXCEPTION 'Valid Enrollment ID is required for PW Community.';
            END IF;
        ELSE
            NEW.user_type := 'guest';
            NEW.department := 'External Guest';
            NEW.year := 'Guest';
            NEW.company := NULLIF(trim(COALESCE(NEW.company, '')), '');
            IF TG_OP = 'INSERT' THEN
                NEW.enrollment_id := 'GST-' || upper(encode(extensions.gen_random_bytes(3), 'hex'));
            ELSE
                NEW.enrollment_id := OLD.enrollment_id;
            END IF;
        END IF;
    ELSE
        NEW.enrollment_id := upper(trim(COALESCE(NEW.enrollment_id, '')));
        IF NEW.enrollment_id = '' THEN
            NEW.enrollment_id := 'GST-' || upper(encode(extensions.gen_random_bytes(3), 'hex'));
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_attendee_upsert ON public.attendees;
CREATE TRIGGER trg_enforce_attendee_upsert
    BEFORE INSERT OR UPDATE ON public.attendees
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_attendee_upsert();

-- 9B. Enforce team creation rules
CREATE OR REPLACE FUNCTION public.enforce_team_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    ev RECORD;
BEGIN
    NEW.team_name := trim(COALESCE(NEW.team_name, ''));
    IF NEW.team_name = '' THEN
        RAISE EXCEPTION 'Team name is required.';
    END IF;

    SELECT * INTO ev FROM public.events WHERE id = NEW.event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event not found.';
    END IF;
    IF ev.participation_type = 'solo' THEN
        RAISE EXCEPTION 'This event does not allow team registrations.';
    END IF;

    IF COALESCE(auth.role(), '') IN ('anon', 'authenticated') AND NOT public.is_admin() THEN
        IF auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Authentication required.';
        END IF;
        IF ev.status <> 'published' OR NOT ev.registration_open THEN
            RAISE EXCEPTION 'Registrations for this event are currently closed.';
        END IF;
        NEW.leader_email := lower(trim(auth.jwt() ->> 'email'));
    ELSE
        NEW.leader_email := lower(trim(NEW.leader_email));
    END IF;

    IF COALESCE(trim(NEW.join_code), '') = '' THEN
        NEW.join_code := 'GRP-' || upper(encode(extensions.gen_random_bytes(3), 'hex'));
    ELSE
        NEW.join_code := upper(trim(NEW.join_code));
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_team_insert ON public.teams;
CREATE TRIGGER trg_enforce_team_insert
    BEFORE INSERT ON public.teams
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_team_insert();

-- 9C. Enforce per-event registration rules, team size limits, fees, and cryptographic tickets
CREATE OR REPLACE FUNCTION public.enforce_registration_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    ev RECORD;
    att RECORD;
    tm RECORD;
    current_total BIGINT;
    current_team_size BIGINT;
    required_fee NUMERIC;
BEGIN
    SELECT * INTO ev FROM public.events WHERE id = NEW.event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event not found.';
    END IF;

    IF COALESCE(auth.role(), '') IN ('anon', 'authenticated') AND NOT public.is_admin() THEN
        IF auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Authentication required.';
        END IF;

        NEW.attendee_email := lower(trim(COALESCE(auth.jwt() ->> 'email', '')));
        SELECT * INTO att FROM public.attendees WHERE lower(email) = NEW.attendee_email;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Please complete your attendee profile first.';
        END IF;

        IF ev.status <> 'published' OR NOT ev.registration_open THEN
            RAISE EXCEPTION 'Registrations for this event are currently closed.';
        END IF;

        IF att.user_type = 'pw_member' AND NOT ev.allow_pw_members THEN
            RAISE EXCEPTION 'This event is restricted to external guests only.';
        END IF;
        IF att.user_type = 'guest' AND NOT ev.allow_guests THEN
            RAISE EXCEPTION 'This event is restricted to PW Community members only.';
        END IF;

        IF ev.max_capacity IS NOT NULL THEN
            SELECT COUNT(*) INTO current_total
            FROM public.registrations r
            WHERE r.event_id = NEW.event_id AND r.payment_status <> 'rejected';
            IF current_total >= ev.max_capacity THEN
                RAISE EXCEPTION 'This event has reached full capacity.';
            END IF;
        END IF;

        IF NEW.team_id IS NOT NULL THEN
            IF ev.participation_type = 'solo' THEN
                RAISE EXCEPTION 'This is a solo-only event.';
            END IF;
            SELECT * INTO tm FROM public.teams WHERE id = NEW.team_id AND event_id = NEW.event_id;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Invalid team for this event.';
            END IF;
            SELECT COUNT(*) INTO current_team_size
            FROM public.registrations r
            WHERE r.team_id = NEW.team_id AND r.payment_status <> 'rejected';
            IF current_team_size >= ev.max_team_size THEN
                RAISE EXCEPTION 'This team is already full (max % members).', ev.max_team_size;
            END IF;
        ELSE
            IF ev.participation_type = 'team' THEN
                RAISE EXCEPTION 'This is a team event. Please create or join a team.';
            END IF;
        END IF;

        required_fee := CASE WHEN att.user_type = 'pw_member' THEN COALESCE(ev.pw_fee, 0) ELSE COALESCE(ev.guest_fee, 500) END;
        IF required_fee > 0 THEN
            NEW.utr_number := trim(COALESCE(NEW.utr_number, ''));
            IF NEW.utr_number !~ '^\d{12}$' THEN
                RAISE EXCEPTION 'A valid 12-digit numeric UPI UTR is required for this paid event.';
            END IF;
            NEW.amount_paid := required_fee;
            NEW.payment_status := 'pending_verification';
        ELSE
            NEW.amount_paid := 0;
            NEW.utr_number := NULL;
            NEW.payment_status := 'approved';
        END IF;

        NEW.ticket_token := 'TKT-' || upper(encode(extensions.gen_random_bytes(8), 'hex'));
        NEW.registered_at := timezone('utc', now());
    ELSE
        NEW.attendee_email := lower(trim(NEW.attendee_email));
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

DROP TRIGGER IF EXISTS trg_enforce_registration_insert ON public.registrations;
CREATE TRIGGER trg_enforce_registration_insert
    BEFORE INSERT ON public.registrations
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_registration_insert();

-- 10. Privileges & RLS Enablement
REVOKE ALL ON TABLE
    public.clubs,
    public.admin_users,
    public.events,
    public.attendees,
    public.teams,
    public.registrations,
    public.attendance,
    public.departments,
    public.system_config
FROM anon, authenticated, PUBLIC;

GRANT SELECT ON TABLE public.clubs, public.events, public.departments, public.system_config TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.clubs, public.events, public.departments, public.system_config TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admin_users, public.attendees, public.teams, public.registrations, public.attendance TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

ALTER TABLE public.clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

-- 11. RLS Policies

-- clubs: public read, super_admin write
DROP POLICY IF EXISTS clubs_public_read ON public.clubs;
CREATE POLICY clubs_public_read ON public.clubs FOR SELECT TO anon, authenticated USING (TRUE);
DROP POLICY IF EXISTS clubs_super_admin_write ON public.clubs;
CREATE POLICY clubs_super_admin_write ON public.clubs FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- admin_users: own row or super_admin
DROP POLICY IF EXISTS admin_users_select_own ON public.admin_users;
CREATE POLICY admin_users_select_own ON public.admin_users FOR SELECT TO authenticated
    USING (auth.uid() IS NOT NULL AND (lower(email) = lower(auth.jwt() ->> 'email') OR public.is_super_admin()));
DROP POLICY IF EXISTS admin_users_super_admin_write ON public.admin_users;
CREATE POLICY admin_users_super_admin_write ON public.admin_users FOR ALL TO authenticated
    USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- events: public sees published events; club admins manage their own club's events
DROP POLICY IF EXISTS events_public_read ON public.events;
CREATE POLICY events_public_read ON public.events FOR SELECT TO anon, authenticated
    USING (status = 'published' OR public.can_manage_club(club_id));
DROP POLICY IF EXISTS events_club_admin_insert ON public.events;
CREATE POLICY events_club_admin_insert ON public.events FOR INSERT TO authenticated
    WITH CHECK (public.can_manage_club(club_id));
DROP POLICY IF EXISTS events_club_admin_update ON public.events;
CREATE POLICY events_club_admin_update ON public.events FOR UPDATE TO authenticated
    USING (public.can_manage_club(club_id)) WITH CHECK (public.can_manage_club(club_id));
DROP POLICY IF EXISTS events_club_admin_delete ON public.events;
CREATE POLICY events_club_admin_delete ON public.events FOR DELETE TO authenticated
    USING (public.can_manage_club(club_id));

-- attendees: own profile or any admin
DROP POLICY IF EXISTS attendees_select_own_or_admin ON public.attendees;
CREATE POLICY attendees_select_own_or_admin ON public.attendees FOR SELECT TO authenticated
    USING (auth.uid() IS NOT NULL AND (lower(email) = lower(auth.jwt() ->> 'email') OR public.is_admin()));
DROP POLICY IF EXISTS attendees_insert_own_or_admin ON public.attendees;
CREATE POLICY attendees_insert_own_or_admin ON public.attendees FOR INSERT TO authenticated
    WITH CHECK (public.is_admin() OR (auth.uid() IS NOT NULL AND lower(email) = lower(auth.jwt() ->> 'email')));
DROP POLICY IF EXISTS attendees_update_own_or_admin ON public.attendees;
CREATE POLICY attendees_update_own_or_admin ON public.attendees FOR UPDATE TO authenticated
    USING (public.is_admin() OR (auth.uid() IS NOT NULL AND lower(email) = lower(auth.jwt() ->> 'email')))
    WITH CHECK (public.is_admin() OR (auth.uid() IS NOT NULL AND lower(email) = lower(auth.jwt() ->> 'email')));

-- teams: authenticated can view teams (to join via join_code) and create teams; club admins manage their event's teams
DROP POLICY IF EXISTS teams_auth_select ON public.teams;
CREATE POLICY teams_auth_select ON public.teams FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS teams_auth_insert ON public.teams;
CREATE POLICY teams_auth_insert ON public.teams FOR INSERT TO authenticated
    WITH CHECK (public.can_manage_event(event_id) OR (auth.uid() IS NOT NULL AND lower(leader_email) = lower(auth.jwt() ->> 'email')));
DROP POLICY IF EXISTS teams_admin_delete ON public.teams;
CREATE POLICY teams_admin_delete ON public.teams FOR DELETE TO authenticated
    USING (public.can_manage_event(event_id));

-- registrations: own ticket, teammate in same team, or club admin managing that event
DROP POLICY IF EXISTS registrations_select ON public.registrations;
CREATE POLICY registrations_select ON public.registrations FOR SELECT TO authenticated
    USING (
        auth.uid() IS NOT NULL AND (
            lower(attendee_email) = lower(auth.jwt() ->> 'email')
            OR public.can_manage_event(event_id)
            OR public.is_team_member(team_id)
        )
    );
DROP POLICY IF EXISTS registrations_insert ON public.registrations;
CREATE POLICY registrations_insert ON public.registrations FOR INSERT TO authenticated
    WITH CHECK (
        public.can_manage_event(event_id)
        OR (auth.uid() IS NOT NULL AND lower(attendee_email) = lower(auth.jwt() ->> 'email'))
    );
DROP POLICY IF EXISTS registrations_admin_update ON public.registrations;
CREATE POLICY registrations_admin_update ON public.registrations FOR UPDATE TO authenticated
    USING (public.can_manage_event(event_id)) WITH CHECK (public.can_manage_event(event_id));
DROP POLICY IF EXISTS registrations_admin_delete ON public.registrations;
CREATE POLICY registrations_admin_delete ON public.registrations FOR DELETE TO authenticated
    USING (public.can_manage_event(event_id));

-- attendance: own registration or club admin managing that event
DROP POLICY IF EXISTS attendance_select ON public.attendance;
CREATE POLICY attendance_select ON public.attendance FOR SELECT TO authenticated
    USING (
        auth.uid() IS NOT NULL AND (
            public.can_manage_event(event_id)
            OR EXISTS (
                SELECT 1 FROM public.registrations r
                WHERE r.id = attendance.registration_id
                  AND lower(r.attendee_email) = lower(auth.jwt() ->> 'email')
            )
        )
    );
DROP POLICY IF EXISTS attendance_admin_insert ON public.attendance;
CREATE POLICY attendance_admin_insert ON public.attendance FOR INSERT TO authenticated
    WITH CHECK (public.can_manage_event(event_id));
DROP POLICY IF EXISTS attendance_admin_update ON public.attendance;
CREATE POLICY attendance_admin_update ON public.attendance FOR UPDATE TO authenticated
    USING (public.can_manage_event(event_id)) WITH CHECK (public.can_manage_event(event_id));
DROP POLICY IF EXISTS attendance_admin_delete ON public.attendance;
CREATE POLICY attendance_admin_delete ON public.attendance FOR DELETE TO authenticated
    USING (public.can_manage_event(event_id));

-- departments & system_config
DROP POLICY IF EXISTS departments_public_read ON public.departments;
CREATE POLICY departments_public_read ON public.departments FOR SELECT TO anon, authenticated USING (TRUE);
DROP POLICY IF EXISTS departments_admin_write ON public.departments;
CREATE POLICY departments_admin_write ON public.departments FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS system_config_public_read ON public.system_config;
CREATE POLICY system_config_public_read ON public.system_config FOR SELECT TO anon, authenticated USING (TRUE);
DROP POLICY IF EXISTS system_config_admin_write ON public.system_config;
CREATE POLICY system_config_admin_write ON public.system_config FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
