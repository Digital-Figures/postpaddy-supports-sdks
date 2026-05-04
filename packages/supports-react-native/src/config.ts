// Postpaddy Supports backend endpoints.
//
// These values are PUBLIC by design — the same anon key is shipped in every
// browser that loads our web widget. Security is enforced at the backend:
// edge functions gate on `widget_id` + mint scoped `visitor_token`s, and
// Supabase RLS prevents cross-tenant reads.
//
// Bumping/rotating these = ship a new SDK version. Consumers only ever pass
// their `widgetId`.
export const SUPPORTS_SUPABASE_URL = "https://gqglmwoibbmbvuhxsjnf.supabase.co";
export const SUPPORTS_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdxZ2xtd29pYmJtYnZ1aHhzam5mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNzEyNjEsImV4cCI6MjA5Mjc0NzI2MX0.jGluhm47GV5bMZBqJxmWHsf7nDvkIsXWWIhcDaps2aw";
