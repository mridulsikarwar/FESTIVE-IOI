// Supabase Client Configuration
const SUPABASE_URL = "https://nodwynlqtqtmzqjhvnns.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5vZHd5bmxxdHF0bXpxamh2bm5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMzk1NDksImV4cCI6MjEwNzcxNTU0OX0.0zARYGuUfXhOSj9JPEMNPWy3vGciJeCFTUh0u6eehJg";

// Global App Configuration
const APP_CONFIG = {
  allowedDomains: ["pwioi.com", "pw.live"],
  allowedDomain: "pwioi.com",
  adminPasscode: "admin123",
  googleClientId: "163420756626-dbadvu3ab0mmpps3sk4mtnpjp4c2vh4p.apps.googleusercontent.com"
};

// Initialize Supabase Client
const supabase = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
}) : null;
