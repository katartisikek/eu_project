const fs = require('fs');
const path = require('path');
const { db } = require('./src/db');

function escapeSqlVal(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  return "'" + String(val).replace(/'/g, "''") + "'";
}

let sql = `-- ==============================================================================
-- TIHC Dissemination Platform - Supabase PostgreSQL Schema & Seeding Script
-- Technical Schools of the Chamber of Heraklion (TIHC)
-- Piloted on IN-BOUND (Project No: 2025-1-FI01-KA220-VET-000352154)
-- ==============================================================================
-- Instructions:
-- 1. Open your Supabase Project Dashboard (https://supabase.com/dashboard)
-- 2. Go to "SQL Editor" in the left menu.
-- 3. Click "New Query", paste the entire contents of this file, and click "Run".
-- 4. All tables, policies, users, KPIs, and 124 IN-BOUND activities will be created!
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Projects Table
CREATE TABLE IF NOT EXISTS projects (
  id BIGSERIAL PRIMARY KEY,
  acronym TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  project_number TEXT NOT NULL,
  programme_type TEXT DEFAULT 'Erasmus+ KA220-VET',
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  coordinator_name TEXT NOT NULL,
  dissemination_leader TEXT NOT NULL,
  description TEXT,
  categories_json TEXT DEFAULT '[]',
  target_groups_json TEXT DEFAULT '[]',
  countries_json TEXT DEFAULT '[]',
  status TEXT DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Partners Table
CREATE TABLE IF NOT EXISTS partners (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  country TEXT NOT NULL,
  country_code TEXT NOT NULL,
  role TEXT NOT NULL,
  contact_person TEXT,
  contact_email TEXT,
  logo_url TEXT,
  sheet_name TEXT
);

-- 3. Reporting Periods Table
CREATE TABLE IF NOT EXISTS reporting_periods (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  report_type TEXT NOT NULL,
  deadline_date TEXT,
  status TEXT DEFAULT 'ACTIVE'
);

-- 4. Users Table
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  partner_code TEXT,
  project_ids_json TEXT DEFAULT '[1]',
  avatar_color TEXT DEFAULT '#1e40af',
  active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. KPIs Table
CREATE TABLE IF NOT EXISTS kpis (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  reporting_period_id BIGINT REFERENCES reporting_periods(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  category_filter TEXT,
  metric_type TEXT NOT NULL,
  target_value BIGINT NOT NULL,
  manual_current_value BIGINT DEFAULT 0,
  unit TEXT NOT NULL,
  description TEXT
);

-- 6. Activities Table
CREATE TABLE IF NOT EXISTS activities (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  partner_id BIGINT REFERENCES partners(id) ON DELETE CASCADE,
  reporting_period_id BIGINT REFERENCES reporting_periods(id) ON DELETE SET NULL,
  activity_code TEXT NOT NULL,
  excel_row_num INTEGER,
  excel_seq_num TEXT,
  activity_date TEXT NOT NULL,
  end_date TEXT,
  raw_date_string TEXT,
  title TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  activity_type_other TEXT,
  legacy_activity_type TEXT,
  description TEXT NOT NULL,
  target_groups_json TEXT DEFAULT '[]',
  target_group_counts_json TEXT DEFAULT '{}',
  raw_target_groups TEXT,
  stakeholders_reached TEXT,
  reach_levels_json TEXT DEFAULT '[]',
  countries_reached_json TEXT DEFAULT '[]',
  responsible_person TEXT,
  social_platform TEXT,
  measurement_period TEXT,
  analytics_extraction_date TEXT,
  metric_reach BIGINT DEFAULT 0,
  metric_views BIGINT DEFAULT 0,
  metric_impressions BIGINT DEFAULT 0,
  metric_likes BIGINT DEFAULT 0,
  metric_comments BIGINT DEFAULT 0,
  metric_shares BIGINT DEFAULT 0,
  metric_clicks BIGINT DEFAULT 0,
  metric_newsletter_recipients BIGINT DEFAULT 0,
  metric_newsletter_opens BIGINT DEFAULT 0,
  metric_event_participants BIGINT DEFAULT 0,
  metric_orgs_reached BIGINT DEFAULT 0,
  legacy_numbers_reached_raw TEXT,
  evidence_url TEXT,
  publication_media_outlet TEXT,
  event_location TEXT,
  status TEXT DEFAULT 'APPROVED',
  validation_warnings_json TEXT DEFAULT '[]',
  missing_evidence_flag INTEGER DEFAULT 0,
  manager_notes TEXT,
  gdpr_consent_verified INTEGER DEFAULT 1,
  created_by TEXT DEFAULT 'system',
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Evidence Files Table
CREATE TABLE IF NOT EXISTS evidence_files (
  id BIGSERIAL PRIMARY KEY,
  activity_id BIGINT REFERENCES activities(id) ON DELETE CASCADE,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size BIGINT DEFAULT 0,
  version INTEGER DEFAULT 1,
  is_original INTEGER DEFAULT 1,
  version_notes TEXT,
  uploaded_by TEXT DEFAULT 'system',
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Activity Comments Table
CREATE TABLE IF NOT EXISTS activity_comments (
  id BIGSERIAL PRIMARY KEY,
  activity_id BIGINT REFERENCES activities(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  author_role TEXT NOT NULL,
  comment_text TEXT NOT NULL,
  action_type TEXT DEFAULT 'COMMENT',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Audit Logs Table
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  activity_id BIGINT REFERENCES activities(id) ON DELETE SET NULL,
  user_name TEXT NOT NULL,
  user_role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_ref TEXT,
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Email Notifications Table
CREATE TABLE IF NOT EXISTS email_notifications (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  partner_id BIGINT REFERENCES partners(id) ON DELETE SET NULL,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT DEFAULT 'SENT',
  sent_by TEXT DEFAULT 'system',
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_activities_project_partner ON activities(project_id, partner_id);
CREATE INDEX IF NOT EXISTS idx_activities_status ON activities(status);
CREATE INDEX IF NOT EXISTS idx_evidence_activity ON evidence_files(activity_id);
CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_logs(project_id);

-- Enable Row Level Security (RLS) with full access policies for web application
`;

const tableList = [
  'projects', 'partners', 'reporting_periods', 'users', 'kpis',
  'activities', 'evidence_files', 'activity_comments', 'audit_logs', 'email_notifications'
];

for (const t of tableList) {
  sql += `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;\n`;
  sql += `DROP POLICY IF EXISTS "allow_all_${t}" ON ${t};\n`;
  sql += `CREATE POLICY "allow_all_${t}" ON ${t} FOR ALL USING (true) WITH CHECK (true);\n`;
}

sql += `\n-- ==============================================================================
-- SEED DATA INSERTS (Preserves All Original Records from IN-BOUND)
-- ==============================================================================\n\n`;

for (const t of tableList) {
  const rows = db.prepare(`SELECT * FROM ${t} ORDER BY id ASC`).all();
  if (rows.length === 0) continue;
  sql += `-- Table: ${t} (${rows.length} rows)\n`;
  const cols = Object.keys(rows[0]);
  for (const r of rows) {
    const vals = cols.map(c => escapeSqlVal(r[c]));
    sql += `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${vals.join(', ')}) ON CONFLICT DO NOTHING;\n`;
  }
  sql += `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE(MAX(id), 1)) FROM ${t};\n\n`;
}

fs.writeFileSync('supabase_schema.sql', sql, 'utf8');
console.log('SUCCESS: Generated supabase_schema.sql (' + sql.length + ' bytes)');

