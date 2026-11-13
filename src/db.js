const fs = require('node:fs');
const path = require('node:path');
const { hashPassword } = require('./auth');
const { db } = require('./db_adapter');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'dissemination_platform.sqlite');
const EXTRACTED_JSON_PATH = path.join(__dirname, '..', 'seed', 'inbound_raw_extracted.json');
const UPLOADS_INBOUND_DIR = path.join(__dirname, '..', 'uploads', 'inbound');

const DEFAULT_CATEGORIES = [
  'Official project social media',
  'Organisation website / social media',
  'Newsletter / Email Campaign',
  'Press Release',
  'Article Publication',
  'Leaflet / Brochure Distribution',
  'Face-to-face or Online Workshop / Event / Meeting',
  'Conference Presentation',
  'Stakeholder Meeting',
  'Project Website / Platform Promotion',
  'Other Dissemination Activity'
];

const DEFAULT_TARGET_GROUPS = [
  'VET Schools / Higher Education Institutions',
  'Training Centres',
  'Companies / SMEs',
  'Job Centres',
  'Vocational Guidance Centres',
  'Policymakers',
  'Trade Organisations',
  'Students / Young People',
  'Educators / Trainers',
  'Media',
  'General Public',
  'Other'
];

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      acronym TEXT NOT NULL,
      title TEXT NOT NULL,
      project_number TEXT NOT NULL,
      programme_type TEXT DEFAULT 'Erasmus+ KA220-VET',
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      coordinator_name TEXT NOT NULL,
      dissemination_leader TEXT NOT NULL,
      description TEXT,
      categories_json TEXT NOT NULL,
      target_groups_json TEXT NOT NULL,
      countries_json TEXT NOT NULL,
      status TEXT DEFAULT 'Active',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      full_name TEXT,
      country TEXT NOT NULL,
      country_code TEXT NOT NULL,
      role TEXT DEFAULT 'Partner',
      contact_person TEXT,
      contact_email TEXT,
      logo_url TEXT,
      sheet_name TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reporting_periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      report_type TEXT DEFAULT 'Interim',
      deadline_date TEXT,
      status TEXT DEFAULT 'Open',
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL, -- SUPER_ADMIN, DISSEMINATION_MANAGER, PARTNER_EDITOR, REVIEWER
      partner_code TEXT,
      project_ids_json TEXT NOT NULL,
      avatar_color TEXT DEFAULT '#1e40af',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS kpis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      reporting_period_id INTEGER,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      category_filter TEXT,
      metric_type TEXT NOT NULL,
      target_value INTEGER NOT NULL,
      manual_current_value INTEGER,
      unit TEXT NOT NULL,
      description TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      partner_id INTEGER NOT NULL,
      reporting_period_id INTEGER,
      activity_code TEXT NOT NULL,
      excel_row_num INTEGER,
      excel_seq_num TEXT,
      activity_date TEXT,
      end_date TEXT,
      raw_date_string TEXT,
      title TEXT NOT NULL,
      activity_type TEXT NOT NULL,
      activity_type_other TEXT,
      legacy_activity_type TEXT,
      description TEXT NOT NULL,
      target_groups_json TEXT NOT NULL,
      target_group_counts_json TEXT NOT NULL,
      raw_target_groups TEXT,
      stakeholders_reached TEXT,
      reach_levels_json TEXT NOT NULL,
      countries_reached_json TEXT NOT NULL,
      responsible_person TEXT,
      social_platform TEXT,
      measurement_period TEXT,
      analytics_extraction_date TEXT,
      metric_reach INTEGER DEFAULT 0,
      metric_views INTEGER DEFAULT 0,
      metric_impressions INTEGER DEFAULT 0,
      metric_likes INTEGER DEFAULT 0,
      metric_comments INTEGER DEFAULT 0,
      metric_shares INTEGER DEFAULT 0,
      metric_clicks INTEGER DEFAULT 0,
      metric_newsletter_recipients INTEGER DEFAULT 0,
      metric_newsletter_opens INTEGER DEFAULT 0,
      metric_event_participants INTEGER DEFAULT 0,
      metric_orgs_reached INTEGER DEFAULT 0,
      legacy_numbers_reached_raw TEXT,
      evidence_url TEXT,
      publication_media_outlet TEXT,
      event_location TEXT,
      status TEXT DEFAULT 'Submitted',
      validation_warnings_json TEXT DEFAULT '[]',
      missing_evidence_flag INTEGER DEFAULT 0,
      manager_notes TEXT,
      gdpr_consent_verified INTEGER DEFAULT 1,
      created_by TEXT,
      updated_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS evidence_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      file_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      version INTEGER DEFAULT 1,
      is_original INTEGER DEFAULT 1,
      version_notes TEXT,
      uploaded_by TEXT,
      uploaded_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS activity_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id INTEGER NOT NULL,
      author_name TEXT NOT NULL,
      author_role TEXT NOT NULL,
      comment_text TEXT NOT NULL,
      action_type TEXT DEFAULT 'comment',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      activity_id INTEGER,
      user_name TEXT NOT NULL,
      user_role TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_ref TEXT,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS email_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      partner_id INTEGER,
      recipient_email TEXT NOT NULL,
      recipient_name TEXT NOT NULL,
      notification_type TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT DEFAULT 'Sent (Logged)',
      sent_by TEXT NOT NULL,
      sent_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function normalizeCategory(rawCat, desc = '') {
  const c = String(rawCat || '').trim().toLowerCase();
  const d = String(desc || '').trim().toLowerCase();
  if (c === 'org social media' || c.includes('official project social')) {
    return { type: 'Official project social media', other: '' };
  }
  if (c.includes("organisation's website/social media") || c.includes('organisation website')) {
    return { type: 'Organisation website / social media', other: '' };
  }
  if (c.includes('leaflet')) {
    return { type: 'Leaflet / Brochure Distribution', other: '' };
  }
  if (c.includes('article publication')) {
    if (d.includes('press release')) {
      return { type: 'Press Release', other: '' };
    }
    return { type: 'Article Publication', other: '' };
  }
  if (c.includes('conference')) {
    return { type: 'Conference Presentation', other: '' };
  }
  if (c.includes('face-to-face') || c.includes('workshop') || c.includes('event/meeting')) {
    return { type: 'Face-to-face or Online Workshop / Event / Meeting', other: '' };
  }
  if (c.includes('newsletter')) {
    return { type: 'Newsletter / Email Campaign', other: '' };
  }
  if (c === 'other' || c.includes('other')) {
    if (d.includes('1st newsletter') || d.includes('newsletter')) {
      return { type: 'Newsletter / Email Campaign', other: '1st Project Newsletter Campaign (mapped from Other)' };
    }
    return { type: 'Other Dissemination Activity', other: desc ? desc.substring(0, 90) : 'Other dissemination action' };
  }
  return { type: 'Other Dissemination Activity', other: rawCat || 'Unspecified' };
}

function detectSocialPlatform(desc = '', url = '', targetRaw = '') {
  const combined = `${desc} ${url} ${targetRaw}`.toLowerCase();
  if (combined.includes('instagram') || combined.includes('ig ') || combined.includes('ig users') || combined.includes('instegram')) return 'Instagram';
  if (combined.includes('facebook') || combined.includes('fb')) return 'Facebook';
  if (combined.includes('linkedin') || combined.includes('lnkd.in')) return 'LinkedIn';
  if (combined.includes('youtube') || combined.includes('youtu.be')) return 'YouTube';
  if (combined.includes('epale')) return 'EPALE Platform';
  if (combined.includes('mindshift.pt') || combined.includes('fbo.bg') || combined.includes('iot.tampere.fi') || combined.includes('website')) return 'Organisation Website';
  return '';
}

function parseExcelDate(rawB) {
  const warnings = [];
  if (!rawB) {
    return { startDate: '', endDate: '', warnings: ['Missing activity date'] };
  }
  const str = String(rawB).trim();

  if (/^\d{5}(\.\d+)?$/.test(str)) {
    const serial = Math.floor(parseFloat(str));
    const utcDays = serial - 25569;
    const d = new Date(utcDays * 86400 * 1000);
    const iso = d.toISOString().slice(0, 10);
    if (iso > '2026-11-30') {
      warnings.push(`Excel serial date (${serial} -> ${iso}): verify day/month order from original Excel cell formatting`);
    }
    return { startDate: iso, endDate: '', warnings };
  }

  const fullRangeMatch = str.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})\s*[-–]\s*(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/);
  if (fullRangeMatch) {
    const [, d1, m1, y1, d2, m2, y2] = fullRangeMatch;
    return {
      startDate: `${y1}-${m1.padStart(2, '0')}-${d1.padStart(2, '0')}`,
      endDate: `${y2}-${m2.padStart(2, '0')}-${d2.padStart(2, '0')}`,
      warnings
    };
  }

  const dayRangeMatch = str.match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/);
  if (dayRangeMatch) {
    const [, d1, d2, m, y] = dayRangeMatch;
    return {
      startDate: `${y}-${m.padStart(2, '0')}-${d1.padStart(2, '0')}`,
      endDate: `${y}-${m.padStart(2, '0')}-${d2.padStart(2, '0')}`,
      warnings
    };
  }

  const annotatedMatch = str.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})\s*\((.+)\)$/);
  if (annotatedMatch) {
    const [, d1, m1, y1, note] = annotatedMatch;
    const sDate = `${y1}-${m1.padStart(2, '0')}-${d1.padStart(2, '0')}`;
    if (m1 === '12' && note.toLowerCase().includes('november')) {
      warnings.push(`Date discrepancy in Excel cell: "${str}" (numeric date is December, text says November)`);
    }
    return { startDate: sDate, endDate: '', warnings };
  }

  const stdMatch = str.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})$/);
  if (stdMatch) {
    const [, d, m, y] = stdMatch;
    if (y.length !== 4 || parseInt(y, 10) < 2020) {
      warnings.push(`Invalid year in Excel date "${str}" — flagged for manual verification (likely 2026)`);
      return { startDate: `2026-${m.padStart(2, '0')}-${d.padStart(2, '0')}`, endDate: '', warnings };
    }
    return { startDate: `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`, endDate: '', warnings };
  }

  warnings.push(`Unrecognized date format "${str}"`);
  return { startDate: '2026-01-01', endDate: '', warnings };
}

function mapTargetGroups(rawE = '') {
  const s = String(rawE || '').toLowerCase();
  const groups = new Set();
  if (s.includes('vet') || s.includes('school') || s.includes('principals')) {
    groups.add('VET Schools / Higher Education Institutions');
  }
  if (s.includes('teacher') || s.includes('trainer') || s.includes('educator') || s.includes('adult education')) {
    groups.add('Educators / Trainers');
  }
  if (s.includes('counsellor') || s.includes('guidance')) {
    groups.add('Vocational Guidance Centres');
  }
  if (s.includes('student') || s.includes('young')) {
    groups.add('Students / Young People');
  }
  if (s.includes('hr') || s.includes('producer') || s.includes('entrepreneur') || s.includes('industry') || s.includes('market expert')) {
    groups.add('Companies / SMEs');
  }
  if (s.includes('stakeholder')) {
    groups.add('Policymakers');
    groups.add('Trade Organisations');
  }
  if (s.includes('general') || s.includes('ig ') || s.includes('instagram') || s.includes('instegram') || s.includes('facebook') || s.includes('youtube') || s.includes('epale')) {
    groups.add('General Public');
  }
  if (groups.size === 0) {
    groups.add('General Public');
  }
  return Array.from(groups);
}

function parseMetrics(rawNumStr, normCat, rawDesc = '', rawK = '') {
  const metrics = {
    reach: 0,
    views: 0,
    impressions: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    clicks: 0,
    newsletter_recipients: 0,
    newsletter_opens: 0,
    event_participants: 0,
    orgs_reached: 0
  };
  const warnings = [];
  const raw = String(rawNumStr || '').trim();

  if (!raw) {
    warnings.push('Missing numeric metric (Numbers reached is empty in Excel)');
    return { metrics, warnings };
  }

  if (/^\d+(\.\d+)?$/.test(raw)) {
    const val = Math.round(parseFloat(raw));
    if (val === 0) {
      warnings.push('Metric value recorded as 0 in Excel — please update with actual analytics');
    }
    if (normCat === 'Newsletter / Email Campaign') {
      metrics.newsletter_recipients = val;
    } else if (
      normCat === 'Face-to-face or Online Workshop / Event / Meeting' ||
      normCat === 'Conference Presentation' ||
      normCat === 'Stakeholder Meeting'
    ) {
      metrics.event_participants = val;
    } else if (normCat === 'Official project social media' || normCat === 'Organisation website / social media') {
      const dLow = rawDesc.toLowerCase();
      if (dLow.includes('story') || dLow.includes('vid') || dLow.includes('video') || dLow.includes('youtube')) {
        metrics.views = val;
      } else {
        metrics.reach = val;
      }
      if (rawK && rawK.includes('1,058 viewers')) {
        metrics.views = val;
        metrics.reach = 1058;
        metrics.clicks = 564;
      }
    } else if (normCat === 'Article Publication' || normCat === 'Press Release') {
      metrics.views = val;
    } else if (normCat === 'Leaflet / Brochure Distribution') {
      metrics.views = val;
    } else {
      if (rawDesc.toLowerCase().includes('principals') || rawDesc.toLowerCase().includes('mural') || rawDesc.toLowerCase().includes('meeting')) {
        metrics.event_participants = val;
      } else {
        metrics.views = val;
      }
    }
    return { metrics, warnings };
  }

  const impOnly = raw.match(/^(\d+)\s*impressions$/i);
  if (impOnly) {
    metrics.impressions = parseInt(impOnly[1], 10);
    return { metrics, warnings };
  }

  if (raw.toLowerCase().includes('views') && raw.toLowerCase().includes('reactions')) {
    const vM = raw.match(/(\d+)\s*views/i);
    const lM = raw.match(/(\d+)\s*reactions/i);
    const sM = raw.match(/(\d+)\s*reposts/i);
    if (vM) metrics.views = parseInt(vM[1], 10);
    if (lM) metrics.likes = parseInt(lM[1], 10);
    if (sM) metrics.shares = parseInt(sM[1], 10);
    warnings.push(`Separated composite Excel string ("${raw}") into Views (${metrics.views}), Reactions (${metrics.likes}), and Reposts (${metrics.shares})`);
    return { metrics, warnings };
  }

  if (raw.includes('1400 target demographic')) {
    metrics.event_participants = 1400;
    metrics.reach = 15000;
    warnings.push(`Mixed event & general attendance in Excel ("${raw}"): separated 1,400 target participants from 15,000 general fair visitors`);
    return { metrics, warnings };
  }

  if (raw.includes('44000 visitors')) {
    metrics.views = 0;
    warnings.push(`Ambiguous metric in Excel ("${raw}"): represents annual website traffic rather than specific project page views — flagged for revision`);
    return { metrics, warnings };
  }

  warnings.push(`Non-numeric value in Excel ("${raw}") — analytics numbers missing from third-party page`);
  return { metrics, warnings };
}

function resetAndSeedDatabase() {
  initSchema();

  db.exec('DELETE FROM activities; DELETE FROM evidence_files; DELETE FROM activity_comments; DELETE FROM kpis; DELETE FROM reporting_periods; DELETE FROM partners; DELETE FROM projects; DELETE FROM users; DELETE FROM audit_logs; DELETE FROM email_notifications; DELETE FROM sqlite_sequence;');

  console.log('Seeding SQLite database with English as primary...');

  const insertProject = db.prepare(`
    INSERT INTO projects (
      acronym, title, project_number, programme_type, start_date, end_date,
      coordinator_name, dissemination_leader, description,
      categories_json, target_groups_json, countries_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const inboundRes = insertProject.run(
    'IN-BOUND',
    'IN-BOUND — Shaping the Industry of the Future (Industry 5.0 Career Guidance & VET Competency Framework)',
    '2025-1-FI01-KA220-VET-000352154',
    'Erasmus+ KA220-VET (Cooperation Partnerships in Vocational Education and Training)',
    '2025-11-01',
    '2027-10-31',
    'TAMPEREEN KAUPUNKI (City of Tampere, FI)',
    'TIHC — Technical Schools of the Chamber of Heraklion (GR)',
    'European Strategic Partnership KA220-VET for shaping Industry 5.0 competencies, career guidance, and future job profiles in the Process Industry.',
    JSON.stringify(DEFAULT_CATEGORIES),
    JSON.stringify(DEFAULT_TARGET_GROUPS),
    JSON.stringify(['Finland', 'Portugal', 'Greece', 'Türkiye', 'Bulgaria', 'EU-wide']),
    'Active'
  );
  const inboundProjectId = Number(inboundRes.lastInsertRowid);

  const secondProjRes = insertProject.run(
    'NO-ONE-BEHIND',
    'NO ONE BEHIND! — Inclusive Vocational Training & Digital Skills for Vulnerable Groups',
    '2024-1-EL01-KA220-VET-000198412',
    'Erasmus+ KA220-VET',
    '2024-09-01',
    '2026-08-31',
    'TIHC — Technical Schools of the Chamber of Heraklion (GR)',
    'TIHC — Technical Schools of the Chamber of Heraklion (GR)',
    'European VET project for labour market inclusion of vulnerable groups through digital and green skills.',
    JSON.stringify(DEFAULT_CATEGORIES),
    JSON.stringify(DEFAULT_TARGET_GROUPS),
    JSON.stringify(['Greece', 'Italy', 'Spain', 'Cyprus', 'EU-wide']),
    'Active'
  );
  const secondProjectId = Number(secondProjRes.lastInsertRowid);

  const insertRP = db.prepare(`
    INSERT INTO reporting_periods (project_id, name, code, start_date, end_date, report_type, deadline_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const rp1Res = insertRP.run(
    inboundProjectId,
    'Reporting Period 1 — Interim Dissemination Report (M1–M12)',
    'RP1-INTERIM',
    '2025-11-01',
    '2026-10-31',
    'Interim',
    '2026-11-30',
    'Open'
  );
  const rp1Id = Number(rp1Res.lastInsertRowid);

  insertRP.run(
    inboundProjectId,
    'Reporting Period 2 — Final Dissemination Report (M13–M24)',
    'RP2-FINAL',
    '2026-11-01',
    '2027-10-31',
    'Final',
    '2027-11-30',
    'Upcoming'
  );

  const rpSecondProj = insertRP.run(
    secondProjectId,
    'Final Reporting Period (M1–M24)',
    'RP-FINAL',
    '2024-09-01',
    '2026-08-31',
    'Final',
    '2026-09-30',
    'Open'
  );

  const partnerConfigs = [
    {
      code: 'INBOUND-ALL',
      name: 'In-Bound Platform (Official Channels)',
      full_name: 'IN-BOUND Official Consortium Social Media & YouTube Channels',
      country: 'EU Consortium',
      country_code: 'EU',
      role: 'Official Project Channels',
      contact_person: 'Consortium Dissemination Team (TIHC & BFE)',
      contact_email: 'inbound-channels@tihc.gr',
      logo_url: '/uploads/inbound/image1.png',
      sheet_name: 'In-Bound Platform'
    },
    {
      code: 'TAMPERE',
      name: 'TAMPEREEN KAUPUNKI',
      full_name: 'City of Tampere — Employment and Growth Services / Tredu',
      country: 'Finland',
      country_code: 'FI',
      role: 'Project Coordinator',
      contact_person: 'Robert Karhi',
      contact_email: 'robert.karhi@tampere.fi',
      logo_url: '/uploads/inbound/image22.png',
      sheet_name: 'TAMPEREEN KAUPUNKI'
    },
    {
      code: 'MINDSHIFT',
      name: 'Mindshift',
      full_name: 'Mindshift Talent Advisory Lda',
      country: 'Portugal',
      country_code: 'PT',
      role: 'Partner',
      contact_person: 'Catarina Silva',
      contact_email: 'projects@mindshift.pt',
      logo_url: '/uploads/inbound/image15.jpg',
      sheet_name: 'Mindshift'
    },
    {
      code: 'TIHC',
      name: 'TIHC',
      full_name: 'Technical Schools of the Chamber of Heraklion (KEK TIHC)',
      country: 'Greece',
      country_code: 'GR',
      role: 'Dissemination Leader',
      contact_person: 'TIHC European Programmes Dept.',
      contact_email: 'euprojects@katartisi.gr',
      logo_url: '/uploads/inbound/image25.png',
      sheet_name: 'TIHC'
    },
    {
      code: 'PENDIK',
      name: 'PENDIK',
      full_name: 'Pendik Mesleki ve Teknik Anadolu Lisesi (PENDIK VET High School)',
      country: 'Türkiye',
      country_code: 'TR',
      role: 'Partner',
      contact_person: 'Pendik Erasmus+ Team',
      contact_email: 'erasmus@pendikmtal.meb.k12.tr',
      logo_url: '/uploads/inbound/image67.jpg',
      sheet_name: 'PENDIK'
    },
    {
      code: 'BFE',
      name: 'BFE',
      full_name: 'Business Foundation for Education (Фондация на бизнеса за образованието)',
      country: 'Bulgaria',
      country_code: 'BG',
      role: 'Partner',
      contact_person: 'BFE Dissemination Team',
      contact_email: 'office@fbo.bg',
      logo_url: '/uploads/inbound/image90.jpg',
      sheet_name: 'BFE'
    }
  ];

  const insertPartner = db.prepare(`
    INSERT INTO partners (project_id, code, name, full_name, country, country_code, role, contact_person, contact_email, logo_url, sheet_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const partnerMapBySheet = {};
  for (const pc of partnerConfigs) {
    const res = insertPartner.run(
      inboundProjectId, pc.code, pc.name, pc.full_name, pc.country, pc.country_code,
      pc.role, pc.contact_person, pc.contact_email, pc.logo_url, pc.sheet_name
    );
    const pid = Number(res.lastInsertRowid);
    partnerMapBySheet[pc.sheet_name] = { id: pid, ...pc };
  }

  const p2Res = insertPartner.run(
    secondProjectId, 'TIHC', 'TIHC', 'Technical Schools of the Chamber of Heraklion', 'Greece', 'GR',
    'Coordinator & Dissemination Leader', 'TIHC European Programmes Dept.', 'euprojects@katartisi.gr', '/uploads/inbound/image25.png', 'TIHC'
  );
  const p2PartnerId = Number(p2Res.lastInsertRowid);

  // 4. Insert Users with Secure Scrypt Password Hashes
  const insertUser = db.prepare(`
    INSERT INTO users (username, password_hash, full_name, email, role, partner_code, project_ids_json, avatar_color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertUser.run('superadmin', hashPassword('AdminTIHC2026!'), 'TIHC Super Administrator', 'admin@katartisi.gr', 'SUPER_ADMIN', 'TIHC', JSON.stringify(['*']), '#0f172a');
  insertUser.run('manager_tihc', hashPassword('ManagerTIHC2026!'), 'TIHC Dissemination Manager', 'dissemination@katartisi.gr', 'DISSEMINATION_MANAGER', 'TIHC', JSON.stringify([inboundProjectId, secondProjectId]), '#1d4ed8');
  insertUser.run('editor_tihc', hashPassword('Tihc2026!'), 'TIHC Partner Editor (Greece)', 'euprojects@katartisi.gr', 'PARTNER_EDITOR', 'TIHC', JSON.stringify([inboundProjectId, secondProjectId]), '#0284c7');
  insertUser.run('editor_bfe', hashPassword('Bfe2026!'), 'BFE Partner Editor (Bulgaria)', 'office@fbo.bg', 'PARTNER_EDITOR', 'BFE', JSON.stringify([inboundProjectId]), '#059669');
  insertUser.run('editor_mindshift', hashPassword('Mindshift2026!'), 'Mindshift Partner Editor (Portugal)', 'projects@mindshift.pt', 'PARTNER_EDITOR', 'MINDSHIFT', JSON.stringify([inboundProjectId]), '#7c3aed');
  insertUser.run('editor_tampere', hashPassword('Tampere2026!'), 'Tampere Partner Editor (Finland)', 'robert.karhi@tampere.fi', 'PARTNER_EDITOR', 'TAMPERE', JSON.stringify([inboundProjectId]), '#d97706');
  insertUser.run('editor_pendik', hashPassword('Pendik2026!'), 'PENDIK Partner Editor (Türkiye)', 'erasmus@pendikmtal.meb.k12.tr', 'PARTNER_EDITOR', 'PENDIK', JSON.stringify([inboundProjectId]), '#dc2626');
  insertUser.run('reviewer_eu', hashPassword('Reviewer2026!'), 'Quality Reviewer / Evaluator', 'quality@inbound-project.eu', 'REVIEWER', null, JSON.stringify([inboundProjectId]), '#475569');

  // 5. Insert KPIs for IN-BOUND
  const insertKpi = db.prepare(`
    INSERT INTO kpis (project_id, reporting_period_id, code, title, category_filter, metric_type, target_value, manual_current_value, unit, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertKpi.run(inboundProjectId, rp1Id, 'KPI-1', 'Total Dissemination Activities (All Partners)', null, 'activity_count', 120, null, 'Activities', 'Total recorded dissemination activities across all consortium partners');
  insertKpi.run(inboundProjectId, rp1Id, 'KPI-2', 'Social Media Reach & Views (Official & Partner Channels)', null, 'social_reach_views_sum', 75000, null, 'Reach / Views', 'Combined unique reach and video/post views across Instagram, Facebook, LinkedIn, and YouTube');
  insertKpi.run(inboundProjectId, rp1Id, 'KPI-3', 'Published Articles & Press Releases (EPALE / Media)', 'Article Publication,Press Release', 'articles_count', 6, null, 'Publications', 'Articles and press releases on European and national platforms (e.g., EPALE)');
  insertKpi.run(inboundProjectId, rp1Id, 'KPI-4', 'Workshops, Events & Conference Presentations', 'Face-to-face or Online Workshop / Event / Meeting,Conference Presentation', 'events_count', 10, null, 'Events', 'Project presentations at conferences, fairs, VET schools, and stakeholder meetings');
  insertKpi.run(inboundProjectId, rp1Id, 'KPI-5', 'Event, Conference & Workshop Participants', null, 'participants_sum', 2500, null, 'Participants', 'Total participants reached in face-to-face or online events and presentations');
  insertKpi.run(inboundProjectId, rp1Id, 'KPI-6', 'Newsletter Campaigns & Total Recipients', 'Newsletter / Email Campaign', 'newsletter_sum', 10000, null, 'Recipients', 'Total recipients of periodic project newsletters across partner mailing lists');

  const insertActivity = db.prepare(`
    INSERT INTO activities (
      project_id, partner_id, reporting_period_id, activity_code, excel_row_num, excel_seq_num,
      activity_date, end_date, raw_date_string, title, activity_type, activity_type_other, legacy_activity_type,
      description, target_groups_json, target_group_counts_json, raw_target_groups, stakeholders_reached,
      reach_levels_json, countries_reached_json, responsible_person, social_platform, measurement_period,
      analytics_extraction_date, metric_reach, metric_views, metric_impressions, metric_likes, metric_comments,
      metric_shares, metric_clicks, metric_newsletter_recipients, metric_newsletter_opens,
      metric_event_participants, metric_orgs_reached, legacy_numbers_reached_raw, evidence_url,
      publication_media_outlet, event_location, status, validation_warnings_json, missing_evidence_flag,
      manager_notes, gdpr_consent_verified, created_by, updated_by
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?
    )
  `);

  const insertEvidence = db.prepare(`
    INSERT INTO evidence_files (
      activity_id, project_id, file_name, original_name, file_type, mime_type,
      file_path, file_size, version, is_original, version_notes, uploaded_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertComment = db.prepare(`
    INSERT INTO activity_comments (activity_id, author_name, author_role, comment_text, action_type)
    VALUES (?, ?, ?, ?, ?)
  `);

  if (fs.existsSync(EXTRACTED_JSON_PATH)) {
    const rawSheets = JSON.parse(fs.readFileSync(EXTRACTED_JSON_PATH, 'utf8').replace(/^\uFEFF/, ''));
    for (const sheet of rawSheets) {
      const partner = partnerMapBySheet[sheet.sheetName];
      if (!partner) continue;

      const isSheet1 = sheet.sheetName === 'In-Bound Platform';
      let seqCounter = 1;

      for (const rowObj of sheet.rows) {
        const c = rowObj.cells || {};
        const mediaFiles = Array.isArray(rowObj.media) ? rowObj.media : [];
        const activityCode = `INB-${partner.code === 'INBOUND-ALL' ? 'ALL' : partner.code}-${String(seqCounter).padStart(3, '0')}`;
        seqCounter++;

        const rawSeq = c.A || '';
        const rawDate = c.B || '';
        const rawCat = c.C || '';
        const rawDesc = c.D || '';
        const rawTarget = c.E || '';

        const stakeholdersReached = isSheet1 ? (c.F || '') : '';
        const euFlag = isSheet1 ? (c.G || '') : (c.F || '');
        const natFlag = isSheet1 ? (c.H || '') : (c.G || '');
        const locFlag = isSheet1 ? (c.I || '') : (c.H || '');
        const rawNumbers = isSheet1 ? (c.J || '') : (c.I || '');
        const rawLinkText = isSheet1 ? (c.K || '') : (c.J || '');
        const rawLinkHref = isSheet1 ? (c.K_href || '') : (c.J_href || '');
        const rawExtraK = isSheet1 ? (c.K || '') : '';

        const { startDate, endDate, warnings: dateWarnings } = parseExcelDate(rawDate);
        const { type: normCat, other: catOther } = normalizeCategory(rawCat, rawDesc);
        const { metrics, warnings: metricWarnings } = parseMetrics(rawNumbers, normCat, rawDesc, rawExtraK);

        let evidenceUrl = '';
        if (rawLinkHref && rawLinkHref.startsWith('http')) {
          evidenceUrl = rawLinkHref;
        } else if (rawLinkText) {
          const urlMatch = rawLinkText.match(/https?:\/\/[^\s]+/i);
          if (urlMatch) {
            evidenceUrl = urlMatch[0];
          } else if (rawLinkText.startsWith('www.') || rawLinkText.includes('.pt/') || rawLinkText.includes('.fi') || rawLinkText.includes('.bg')) {
            evidenceUrl = 'https://' + rawLinkText.replace(/^https?:\/\//, '');
          }
        }

        const hasValidUrl = evidenceUrl.length > 5;
        const hasScreenshots = mediaFiles.length > 0;
        const evidenceWarnings = [];
        let missingEvidenceFlag = 0;

        if (!hasValidUrl && !hasScreenshots) {
          missingEvidenceFlag = 1;
          evidenceWarnings.push('Missing both Evidence Link (URL) and Analytics Screenshot / Photo');
        } else if (!hasScreenshots && (normCat.includes('social media') || normCat.includes('Newsletter'))) {
          missingEvidenceFlag = 1;
          evidenceWarnings.push('Missing Analytics Screenshot (required to verify reach/views metrics)');
        } else if (!hasValidUrl && normCat.includes('social media') && !rawDesc.toLowerCase().includes('story') && !rawDesc.toLowerCase().includes('analytics')) {
          evidenceWarnings.push('Public URL link not provided (only screenshot attached)');
        }

        const allWarnings = [...dateWarnings, ...metricWarnings, ...evidenceWarnings];

        const reachLevels = [];
        if (String(euFlag).toLowerCase().includes('x')) reachLevels.push('European');
        if (String(natFlag).toLowerCase().includes('x')) reachLevels.push('National');
        if (String(locFlag).toLowerCase().includes('x')) reachLevels.push('Local');
        if (reachLevels.length === 0) reachLevels.push('National');

        const countriesReached = [partner.country === 'EU Consortium' ? 'EU-wide' : partner.country];
        if (reachLevels.includes('European') && !countriesReached.includes('EU-wide')) {
          countriesReached.push('EU-wide');
        }

        const mappedGroups = mapTargetGroups(rawTarget);
        const targetGroupCounts = {};
        if (metrics.event_participants > 0 && mappedGroups.length > 0) {
          targetGroupCounts[mappedGroups[0]] = metrics.event_participants;
        }

        const cleanDesc = rawDesc || `${normCat} (${partner.name})`;
        const shortTitle = cleanDesc.length > 72 ? cleanDesc.substring(0, 69) + '...' : cleanDesc;
        const socialPlatform = detectSocialPlatform(rawDesc, evidenceUrl || rawLinkText, rawTarget);
        const measurementPeriod = rawDesc.toLowerCase().includes('90 days') ? 'Last 90 days' : (endDate ? `${startDate} to ${endDate}` : 'Lifetime / Post Period');

        let status = 'Approved';
        let managerNotes = 'Verified by Dissemination Leader (TIHC) during IN-BOUND Dissemination Log import.';
        if (missingEvidenceFlag === 1 && allWarnings.length >= 2) {
          status = 'Needs Revision';
          managerNotes = 'Pending evidence upload (Analytics Screenshot / URL) and numeric metrics verification from partner.';
        } else if (missingEvidenceFlag === 1 || allWarnings.some(w => w.includes('Invalid year') || w.includes('Non-numeric') || w.includes('Ambiguous metric') || w.includes('recorded as 0'))) {
          status = 'Needs Revision';
          managerNotes = 'Action required: ' + allWarnings[0];
        } else if (allWarnings.length > 0) {
          status = 'Submitted';
          managerNotes = 'Submitted — pending review by Dissemination Manager.';
        }

        const actRes = insertActivity.run(
          inboundProjectId,
          partner.id,
          rp1Id,
          activityCode,
          rowObj.excelRow,
          String(rawSeq).replace(/\.0$/, ''),
          startDate,
          endDate,
          rawDate,
          shortTitle,
          normCat,
          catOther,
          rawCat,
          cleanDesc,
          JSON.stringify(mappedGroups),
          JSON.stringify(targetGroupCounts),
          rawTarget,
          stakeholdersReached,
          JSON.stringify(reachLevels),
          JSON.stringify(countriesReached),
          partner.contact_person,
          socialPlatform,
          measurementPeriod,
          '2026-09-01',
          metrics.reach,
          metrics.views,
          metrics.impressions,
          metrics.likes,
          metrics.comments,
          metrics.shares,
          metrics.clicks,
          metrics.newsletter_recipients,
          metrics.newsletter_opens,
          metrics.event_participants,
          metrics.orgs_reached,
          rawNumbers,
          evidenceUrl,
          evidenceUrl.includes('epale') ? 'EPALE European Platform' : (evidenceUrl.includes('fbo.bg') ? 'fbo.bg Portal' : ''),
          cleanDesc.toLowerCase().includes('sofia') ? 'Sofia, Bulgaria' : (cleanDesc.toLowerCase().includes('lisbon') ? 'Lisbon, Portugal' : (cleanDesc.toLowerCase().includes('tampere') ? 'Tampere, Finland' : (partner.country))),
          status,
          JSON.stringify(allWarnings),
          missingEvidenceFlag,
          managerNotes,
          1,
          partner.contact_person,
          'TIHC Dissemination Manager'
        );

        const activityId = Number(actRes.lastInsertRowid);

        for (const mFile of mediaFiles) {
          const fullDiskPath = path.join(UPLOADS_INBOUND_DIR, mFile);
          let fSize = 0;
          if (fs.existsSync(fullDiskPath)) {
            fSize = fs.statSync(fullDiskPath).size;
          }
          const ext = path.extname(mFile).toLowerCase();
          const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
          insertEvidence.run(
            activityId,
            inboundProjectId,
            mFile,
            `${activityCode}_Excel_Evidence_${mFile}`,
            normCat.includes('Event') || normCat.includes('Conference') ? 'photo' : 'screenshot',
            mime,
            `/uploads/inbound/${mFile}`,
            fSize,
            1,
            1,
            'Original evidence file (v1) extracted from Dissemination Log IN-BOUND.xlsx',
            partner.contact_person
          );
        }

        if (status === 'Needs Revision') {
          insertComment.run(
            activityId,
            'TIHC Dissemination Manager',
            'DISSEMINATION_MANAGER',
            managerNotes,
            'revision_request'
          );
        }
      }
    }
  }

  insertActivity.run(
    secondProjectId, p2PartnerId, Number(rpSecondProj.lastInsertRowid),
    'NOB-TIHC-001', 1, '1', '2026-05-14', '', '14/05/2026',
    'Multiplier Event in Heraklion — Inclusive VET & Industry Synergies',
    'Face-to-face or Online Workshop / Event / Meeting', '', 'Multiplier Event',
    'Multiplier event presenting NO ONE BEHIND! outcomes at the Chamber of Heraklion with synergies with IN-BOUND.',
    JSON.stringify(['Students / Young People', 'Educators / Trainers', 'Vocational Guidance Centres']),
    JSON.stringify({ 'Students / Young People': 15, 'Educators / Trainers': 11 }),
    'Students, Educators, Stakeholders', 'Chamber of Heraklion',
    JSON.stringify(['Local', 'National']), JSON.stringify(['Greece']),
    'TIHC European Programmes Dept.', '', '14/05/2026', '2026-05-15',
    0, 0, 0, 0, 0, 0, 0, 0, 0, 26, 8, '26',
    'https://www.facebook.com/KekTechnikesScholes/', '', 'Heraklion, Crete, Greece',
    'Approved', '[]', 0, 'Approved.', 1, 'TIHC Partner Editor', 'TIHC Dissemination Manager'
  );

  const insertAudit = db.prepare(`
    INSERT INTO audit_logs (project_id, activity_id, user_name, user_role, action, entity_type, entity_ref, details)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertAudit.run(
    inboundProjectId, null,
    'TIHC Super Administrator', 'SUPER_ADMIN',
    'PROJECT_CREATED', 'project', 'IN-BOUND',
    'Created project IN-BOUND (2025-1-FI01-KA220-VET-000352154) with 6 partners and TIHC as Dissemination Leader.'
  );
  insertAudit.run(
    inboundProjectId, null,
    'TIHC Dissemination Manager', 'DISSEMINATION_MANAGER',
    'EXCEL_IMPORT', 'project', 'Dissemination Log IN-BOUND.xlsx',
    'Imported 124 dissemination activities and 109 evidence files from Dissemination Log IN-BOUND.xlsx with automated validation.'
  );

  console.log('Database reset & English seeding completed successfully!');
}

module.exports = {
  db,
  DB_PATH,
  DEFAULT_CATEGORIES,
  DEFAULT_TARGET_GROUPS,
  parseExcelDate,
  normalizeCategory,
  parseMetrics,
  mapTargetGroups,
  detectSocialPlatform,
  resetAndSeedDatabase,
  initSchema
};
