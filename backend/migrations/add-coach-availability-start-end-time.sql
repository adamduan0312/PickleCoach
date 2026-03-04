-- Add time-of-day fields for recurring weekly availability (e.g. "Mondays 9am-5pm").
-- Preferred: run migrations with   npm run db:migrate   (uses 20260303200000-add-coach-availability-start-end-time.cjs).
-- Or run this SQL manually (MySQL):
ALTER TABLE coach_availabilities
  ADD COLUMN start_time VARCHAR(8) NULL,
  ADD COLUMN end_time VARCHAR(8) NULL;
