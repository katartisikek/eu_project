const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const {
  db,
  DB_PATH,
  DEFAULT_CATEGORIES,
  DEFAULT_TARGET_GROUPS,
  parseExcelDate,
  normalizeCategory,
  parseMetrics
} = require('./src/db');
const {
  createZipBuffer,
  createXlsxBuffer,
  parseUploadedXlsxBuffer
} = require('./src/zip_xlsx_utils');
const { verifyPassword, createSession, getSession } = require('./src/auth');

const PORT = Number(process.env.PORT) || 3080;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const CUSTOM_UPLOADS_DIR = path.join(UPLOADS_DIR, 'custom');

if (!fs.existsSync(CUSTOM_UPLOADS_DIR)) {
  fs.mkdirSync(CUSTOM_UPLOADS_DIR, { recursive: true });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
  '.sqlite': 'application/x-sqlite3'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalLen = 0;
    req.on('data', chunk => {
      totalLen += chunk.length;
      if (totalLen > 35 * 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function logAudit(projectId, activityId, user, action, entityType, entityRef, details) {
  db.prepare(`
    INSERT INTO audit_logs (project_id, activity_id, user_name, user_role, action, entity_type, entity_ref, details)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    projectId || null,
    activityId || null,
    user ? user.full_name : 'System',
    user ? user.role : 'SYSTEM',
    action,
    entityType,
    entityRef || '',
    details || ''
  );
}

function getCurrentUser(reqUrl, reqHeaders) {
  const uid = reqUrl.searchParams.get('userId') || reqHeaders['x-user-id'] || '2';
  let user = db.prepare('SELECT id, username, full_name, email, role, partner_code, project_ids_json, avatar_color FROM users WHERE id = ? OR username = ?').get(uid, uid);
  if (!user) {
    user = db.prepare('SELECT id, username, full_name, email, role, partner_code, project_ids_json, avatar_color FROM users ORDER BY id ASC LIMIT 1').get();
  }
  return {
    ...user,
    project_ids: JSON.parse(user.project_ids_json || '["*"]')
  };
}

function canUserAccessProject(user, projectId) {
  if (user.role === 'SUPER_ADMIN') return true;
  if (user.project_ids.includes('*')) return true;
  return user.project_ids.map(Number).includes(Number(projectId));
}

function computeKpiProgress(projectId) {
  const kpis = db.prepare('SELECT * FROM kpis WHERE project_id = ? ORDER BY id ASC').all(projectId);
  const activities = db.prepare('SELECT * FROM activities WHERE project_id = ?').all(projectId);

  return kpis.map(k => {
    let filtered = activities;
    if (k.reporting_period_id) {
      filtered = filtered.filter(a => a.reporting_period_id === k.reporting_period_id || !a.reporting_period_id);
    }
    if (k.category_filter) {
      const allowedCats = k.category_filter.split(',').map(s => s.trim().toLowerCase());
      filtered = filtered.filter(a => allowedCats.includes(String(a.activity_type).toLowerCase()));
    }

    const calcForList = list => {
      switch (k.metric_type) {
        case 'activity_count':
        case 'articles_count':
        case 'events_count':
          return list.length;
        case 'social_reach_views_sum':
          return list.reduce((sum, a) => sum + (Number(a.metric_reach) || 0) + (Number(a.metric_views) || 0), 0);
        case 'reach_sum':
          return list.reduce((sum, a) => sum + (Number(a.metric_reach) || 0), 0);
        case 'views_sum':
          return list.reduce((sum, a) => sum + (Number(a.metric_views) || 0), 0);
        case 'participants_sum':
          return list.reduce((sum, a) => sum + (Number(a.metric_event_participants) || 0), 0);
        case 'newsletter_sum':
          return list.reduce((sum, a) => sum + (Number(a.metric_newsletter_recipients) || 0), 0);
        default:
          return k.manual_current_value || list.length;
      }
    };

    const recordedValue = k.manual_current_value !== null && k.manual_current_value !== undefined
      ? Number(k.manual_current_value)
      : calcForList(filtered);

    const approvedValue = calcForList(filtered.filter(a => a.status === 'Approved'));
    const pct = k.target_value > 0 ? Math.min(999, Math.round((recordedValue / k.target_value) * 100)) : 100;
    const approvedPct = k.target_value > 0 ? Math.min(999, Math.round((approvedValue / k.target_value) * 100)) : 100;

    return {
      ...k,
      recorded_value: recordedValue,
      approved_value: approvedValue,
      percentage: pct,
      approved_percentage: approvedPct
    };
  });
}

function buildBootstrapData(projectId, user) {
  const allUsers = db.prepare('SELECT id, username, full_name, email, role, partner_code, project_ids_json, avatar_color FROM users ORDER BY id ASC').all().map(u => ({
    ...u,
    project_ids: JSON.parse(u.project_ids_json || '["*"]')
  }));

  const allProjects = db.prepare('SELECT * FROM projects ORDER BY id ASC').all()
    .filter(p => canUserAccessProject(user, p.id))
    .map(p => ({
      ...p,
      categories: JSON.parse(p.categories_json || '[]'),
      target_groups: JSON.parse(p.target_groups_json || '[]'),
      countries: JSON.parse(p.countries_json || '[]')
    }));

  const activeProject = allProjects.find(p => p.id === Number(projectId)) || allProjects[0];
  if (!activeProject) {
    return { user, users: allUsers, projects: [], activeProject: null };
  }

  const pid = activeProject.id;
  const partners = db.prepare('SELECT * FROM partners WHERE project_id = ? ORDER BY id ASC').all(pid);
  const reportingPeriods = db.prepare('SELECT * FROM reporting_periods WHERE project_id = ? ORDER BY id ASC').all(pid);
  const kpis = computeKpiProgress(pid);

  const rawActivities = db.prepare(`
    SELECT a.*, p.name as partner_name, p.code as partner_code, p.country as partner_country, p.country_code as partner_country_code, p.logo_url as partner_logo
    FROM activities a
    JOIN partners p ON a.partner_id = p.id
    WHERE a.project_id = ?
    ORDER BY a.partner_id ASC, a.excel_row_num ASC, a.id DESC
  `).all(pid);

  const allEvidence = db.prepare('SELECT * FROM evidence_files WHERE project_id = ? ORDER BY version DESC, id ASC').all(pid);
  const evidenceByAct = {};
  for (const ev of allEvidence) {
    if (!evidenceByAct[ev.activity_id]) evidenceByAct[ev.activity_id] = [];
    evidenceByAct[ev.activity_id].push(ev);
  }

  const allComments = db.prepare(`
    SELECT c.* FROM activity_comments c
    JOIN activities a ON c.activity_id = a.id
    WHERE a.project_id = ?
    ORDER BY c.id ASC
  `).all(pid);
  const commentsByAct = {};
  for (const cm of allComments) {
    if (!commentsByAct[cm.activity_id]) commentsByAct[cm.activity_id] = [];
    commentsByAct[cm.activity_id].push(cm);
  }

  const activities = rawActivities.map(a => {
    const warnings = JSON.parse(a.validation_warnings_json || '[]');
    const evList = evidenceByAct[a.id] || [];
    const hasEvidence = (a.evidence_url && a.evidence_url.length > 5) || evList.length > 0;
    return {
      ...a,
      target_groups: JSON.parse(a.target_groups_json || '[]'),
      target_group_counts: JSON.parse(a.target_group_counts_json || '{}'),
      reach_levels: JSON.parse(a.reach_levels_json || '[]'),
      countries_reached: JSON.parse(a.countries_reached_json || '[]'),
      validation_warnings: warnings,
      evidence_files: evList,
      comments: commentsByAct[a.id] || [],
      has_sufficient_evidence: !a.missing_evidence_flag && hasEvidence
    };
  });

  const partnerPendingMatrix = partners.map(p => {
    const pActs = activities.filter(a => a.partner_id === p.id);
    const approvedCount = pActs.filter(a => a.status === 'Approved').length;
    const missingEvidenceCount = pActs.filter(a => a.missing_evidence_flag === 1 || (!a.evidence_url && a.evidence_files.length === 0)).length;
    const needsRevisionCount = pActs.filter(a => a.status === 'Needs Revision').length;
    const needsReviewCount = pActs.filter(a => a.status === 'Submitted').length;
    const draftCount = pActs.filter(a => a.status === 'Draft').length;
    const warningsCount = pActs.filter(a => a.validation_warnings.length > 0).length;

    return {
      partner_id: p.id,
      partner_code: p.code,
      partner_name: p.name,
      full_name: p.full_name,
      country: p.country,
      country_code: p.country_code,
      role: p.role,
      contact_person: p.contact_person,
      contact_email: p.contact_email,
      logo_url: p.logo_url,
      total_activities: pActs.length,
      approved_count: approvedCount,
      missing_evidence_count: missingEvidenceCount,
      needs_revision_count: needsRevisionCount,
      needs_review_count: needsReviewCount,
      draft_count: draftCount,
      warnings_count: warningsCount,
      total_reach: pActs.reduce((s, a) => s + (Number(a.metric_reach) || 0), 0),
      total_views: pActs.reduce((s, a) => s + (Number(a.metric_views) || 0), 0),
      total_impressions: pActs.reduce((s, a) => s + (Number(a.metric_impressions) || 0), 0),
      total_participants: pActs.reduce((s, a) => s + (Number(a.metric_event_participants) || 0), 0),
      total_newsletter: pActs.reduce((s, a) => s + (Number(a.metric_newsletter_recipients) || 0), 0),
      health_status: (missingEvidenceCount === 0 && needsRevisionCount === 0)
        ? 'Complete'
        : (missingEvidenceCount > 5 || needsRevisionCount > 3 ? 'Action Required' : 'Pending Items')
    };
  });

  const auditLogs = db.prepare('SELECT * FROM audit_logs WHERE project_id = ? OR project_id IS NULL ORDER BY id DESC LIMIT 100').all(pid);
  const notifications = db.prepare('SELECT * FROM email_notifications WHERE project_id = ? ORDER BY id DESC LIMIT 50').all(pid);

  return {
    user,
    users: allUsers,
    projects: allProjects,
    activeProject,
    partners,
    reportingPeriods,
    kpis,
    activities,
    partnerPendingMatrix,
    auditLogs,
    notifications
  };
}

function validateAndComputeFlags(actData, existingEvidenceCount = 0) {
  const warnings = [];
  let missingEvidenceFlag = 0;

  const hasUrl = actData.evidence_url && String(actData.evidence_url).trim().length > 5;
  const hasFiles = existingEvidenceCount > 0;
  const cat = String(actData.activity_type || '');

  if (!hasUrl && !hasFiles) {
    missingEvidenceFlag = 1;
    warnings.push('Missing evidence: neither public URL nor Screenshot/Photo/PDF file has been uploaded.');
  } else if ((cat.includes('social media') || cat.includes('Newsletter')) && !hasFiles) {
    missingEvidenceFlag = 1;
    warnings.push('Social Media / Newsletter activities require an uploaded Analytics Screenshot.');
  }

  const totalNumericMetrics =
    (Number(actData.metric_reach) || 0) +
    (Number(actData.metric_views) || 0) +
    (Number(actData.metric_impressions) || 0) +
    (Number(actData.metric_likes) || 0) +
    (Number(actData.metric_newsletter_recipients) || 0) +
    (Number(actData.metric_event_participants) || 0) +
    (Number(actData.metric_orgs_reached) || 0);

  if (totalNumericMetrics === 0) {
    warnings.push('No numeric reach/views/participants metrics entered (Section E).');
  }

  if (cat === 'Other Dissemination Activity' && !String(actData.activity_type_other || '').trim()) {
    warnings.push('Selected "Other Dissemination Activity" without specifying the custom activity type.');
  }

  return { warnings, missingEvidenceFlag };
}

async function requestHandler(req, res) {
  try {
    const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(reqUrl.pathname);

    // Health Check for Cloud / Docker Deployment
    if (pathname === '/api/health' && req.method === 'GET') {
      return sendJson(res, 200, { status: 'ok', service: 'TIHC Dissemination Monitoring Platform', timestamp: new Date().toISOString() });
    }

    // Personal User Authentication Endpoint (Section 3 & 12)
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const identifier = String(body.username || '').trim();
      const pass = String(body.password || '').trim();
      const found = await db.prepare('SELECT * FROM users WHERE (username = ? OR email = ?) AND active = 1').get(identifier, identifier);
      const isPassValid = found && (found.password_hash ? verifyPassword(pass, found.password_hash) : (found.password === pass));
      if (!found || !isPassValid) {
        return sendJson(res, 401, { error: 'Invalid username/email or password.' });
      }
      const token = createSession(found);
      logAudit(null, null, found, 'USER_LOGIN', 'user', found.username, `User ${found.full_name} (${found.role}) signed in.`);
      return sendJson(res, 200, {
        ok: true,
        token,
        user: {
          id: found.id,
          username: found.username,
          full_name: found.full_name,
          email: found.email,
          role: found.role,
          partner_code: found.partner_code
        }
      });
    }

    // Database Backup Download Endpoint (Section 12: Daily Backups)
    if (pathname === '/api/admin/backup-sqlite' && req.method === 'GET') {
      const user = getCurrentUser(reqUrl, req.headers);
      if (user.role !== 'SUPER_ADMIN' && user.role !== 'DISSEMINATION_MANAGER') {
        return sendJson(res, 403, { error: 'Only Super Admin or Dissemination Manager can download database backups.' });
      }
      logAudit(1, null, user, 'DATABASE_BACKUP_DOWNLOADED', 'system', 'dissemination_platform.sqlite', 'Downloaded full SQLite database backup.');
      const dateTag = new Date().toISOString().slice(0, 10);
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/x-sqlite3',
        'Content-Disposition': `attachment; filename="TIHC_Dissemination_DB_Backup_${dateTag}.sqlite"`
      });
      fs.createReadStream(DB_PATH).pipe(res);
      return;
    }

    // 1. Serve Uploaded Evidence Files
    if (pathname.startsWith('/uploads/')) {
      const relPath = pathname.replace(/^\/uploads\//, '');
      const safePath = path.normalize(path.join(UPLOADS_DIR, relPath));
      if (!safePath.startsWith(UPLOADS_DIR) || !fs.existsSync(safePath) || fs.statSync(safePath).isDirectory()) {
        res.writeHead(404);
        res.end('File not found');
        return;
      }
      const ext = path.extname(safePath).toLowerCase();
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream'
      });
      fs.createReadStream(safePath).pipe(res);
      return;
    }

    // 2. API Bootstrap
    if (pathname === '/api/bootstrap' && req.method === 'GET') {
      const user = getCurrentUser(reqUrl, req.headers);
      const projectId = reqUrl.searchParams.get('projectId') || 1;
      const data = buildBootstrapData(projectId, user);
      return sendJson(res, 200, data);
    }

    // Create new Project (from scratch or Template - Section 2)
    if (pathname === '/api/projects' && req.method === 'POST') {
      const user = getCurrentUser(reqUrl, req.headers);
      if (user.role !== 'SUPER_ADMIN' && user.role !== 'DISSEMINATION_MANAGER') {
        return sendJson(res, 403, { error: 'Only Super Administrator can create new projects.' });
      }
      const body = await readJsonBody(req);
      const r = db.prepare(`
        INSERT INTO projects (
          acronym, title, project_number, programme_type, start_date, end_date,
          coordinator_name, dissemination_leader, description,
          categories_json, target_groups_json, countries_json, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active')
      `).run(
        body.acronym || 'NEW-EU-PROJ',
        body.title || 'New European Project',
        body.project_number || '2026-1-EL01-KA220-VET-000000001',
        body.programme_type || 'Erasmus+ KA220-VET',
        body.start_date || '2026-11-01',
        body.end_date || '2028-10-31',
        body.coordinator_name || 'TIHC',
        body.dissemination_leader || 'TIHC — Technical Schools of the Chamber of Heraklion',
        body.description || '',
        JSON.stringify(DEFAULT_CATEGORIES),
        JSON.stringify(DEFAULT_TARGET_GROUPS),
        JSON.stringify(body.countries || ['Greece', 'Finland', 'Portugal', 'Bulgaria', 'EU-wide'])
      );
      const newProjId = Number(r.lastInsertRowid);

      const rp1 = db.prepare(`
        INSERT INTO reporting_periods (project_id, name, code, start_date, end_date, report_type, deadline_date, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'Open')
      `).run(newProjId, '1st Reporting Period — Interim Report (M1-M12)', 'RP1-INTERIM', body.start_date || '2026-11-01', '2027-10-31', 'Interim', '2027-11-30');

      db.prepare(`
        INSERT INTO reporting_periods (project_id, name, code, start_date, end_date, report_type, deadline_date, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'Upcoming')
      `).run(newProjId, '2nd Reporting Period — Final Report (M13-M24)', 'RP2-FINAL', '2027-11-01', body.end_date || '2028-10-31', 'Final', '2028-11-30');

      const partnersToCreate = Array.isArray(body.partners) && body.partners.length > 0
        ? body.partners
        : [
            { code: 'TIHC', name: 'TIHC', full_name: 'Technical Schools of the Chamber of Heraklion', country: 'Greece', country_code: 'GR', role: 'Dissemination Leader', contact_person: 'TIHC European Programmes Dept.', contact_email: 'euprojects@katartisi.gr' }
          ];

      const insP = db.prepare(`
        INSERT INTO partners (project_id, code, name, full_name, country, country_code, role, contact_person, contact_email, logo_url, sheet_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const pt of partnersToCreate) {
        insP.run(newProjId, pt.code, pt.name, pt.full_name || pt.name, pt.country || 'Greece', pt.country_code || 'GR', pt.role || 'Partner', pt.contact_person || '', pt.contact_email || '', '/uploads/inbound/image25.png', pt.name);
      }

      if (body.use_template !== false) {
        const insK = db.prepare(`
          INSERT INTO kpis (project_id, reporting_period_id, code, title, category_filter, metric_type, target_value, unit, description)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        insK.run(newProjId, Number(rp1.lastInsertRowid), 'KPI-1', 'Total Dissemination Activities', null, 'activity_count', 100, 'Activities', 'Total recorded activities across all partners');
        insK.run(newProjId, Number(rp1.lastInsertRowid), 'KPI-2', 'Social Media Reach & Views', null, 'social_reach_views_sum', 50000, 'Reach / Views', 'Combined social media reach and views');
        insK.run(newProjId, Number(rp1.lastInsertRowid), 'KPI-3', 'Published Articles / Press Releases', 'Article Publication,Press Release', 'articles_count', 6, 'Publications', 'Publications on EPALE and media');
        insK.run(newProjId, Number(rp1.lastInsertRowid), 'KPI-4', 'Workshops / Events / Conferences', 'Face-to-face or Online Workshop / Event / Meeting,Conference Presentation', 'events_count', 8, 'Events', 'Organization or participation in events');
        insK.run(newProjId, Number(rp1.lastInsertRowid), 'KPI-5', 'Event Participants', null, 'participants_sum', 500, 'Participants', 'Participants in workshops & multiplier events');
      }

      const mgr = db.prepare("SELECT * FROM users WHERE username = 'manager_tihc'").get();
      if (mgr) {
        const pIds = JSON.parse(mgr.project_ids_json || '[]');
        pIds.push(newProjId);
        db.prepare('UPDATE users SET project_ids_json = ? WHERE id = ?').run(JSON.stringify(pIds), mgr.id);
      }

      logAudit(newProjId, null, user, 'PROJECT_CREATED_FROM_TEMPLATE', 'project', body.acronym, `Created new project ${body.acronym} (${body.project_number}) from Template.`);
      return sendJson(res, 201, { ok: true, projectId: newProjId });
    }

    // Manage Categories for Project (Section 4B)
    if (pathname.match(/^\/api\/projects\/\d+\/categories$/) && req.method === 'PUT') {
      const user = getCurrentUser(reqUrl, req.headers);
      const projId = Number(pathname.split('/')[3]);
      const body = await readJsonBody(req);
      if (Array.isArray(body.categories)) {
        db.prepare('UPDATE projects SET categories_json = ? WHERE id = ?').run(JSON.stringify(body.categories), projId);
        logAudit(projId, null, user, 'CATEGORIES_UPDATED', 'project', String(projId), `Updated activity categories list (${body.categories.length} categories)`);
      }
      return sendJson(res, 200, { ok: true });
    }

    // Create / Delete KPI (Section 7)
    if (pathname === '/api/kpis' && req.method === 'POST') {
      const user = getCurrentUser(reqUrl, req.headers);
      if (user.role !== 'SUPER_ADMIN' && user.role !== 'DISSEMINATION_MANAGER') {
        return sendJson(res, 403, { error: 'Only Dissemination Manager can manage KPIs.' });
      }
      const body = await readJsonBody(req);
      db.prepare(`
        INSERT INTO kpis (project_id, reporting_period_id, code, title, category_filter, metric_type, target_value, manual_current_value, unit, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        body.project_id,
        body.reporting_period_id || null,
        body.code || 'KPI-NEW',
        body.title,
        body.category_filter || null,
        body.metric_type || 'activity_count',
        Number(body.target_value) || 10,
        body.manual_current_value !== undefined && body.manual_current_value !== '' ? Number(body.manual_current_value) : null,
        body.unit || 'Activities',
        body.description || ''
      );
      logAudit(body.project_id, null, user, 'KPI_CREATED', 'kpi', body.code, `Created KPI ${body.code}: ${body.title} (Target: ${body.target_value})`);
      return sendJson(res, 201, { ok: true });
    }

    if (pathname.match(/^\/api\/kpis\/\d+$/) && req.method === 'DELETE') {
      const user = getCurrentUser(reqUrl, req.headers);
      const kpiId = Number(pathname.split('/')[3]);
      const kpi = db.prepare('SELECT * FROM kpis WHERE id = ?').get(kpiId);
      if (kpi) {
        db.prepare('DELETE FROM kpis WHERE id = ?').run(kpiId);
        logAudit(kpi.project_id, null, user, 'KPI_DELETED', 'kpi', kpi.code, `Deleted KPI ${kpi.code}`);
      }
      return sendJson(res, 200, { ok: true });
    }

    // Create Activity (Section 4 & 5)
    if (pathname === '/api/activities' && req.method === 'POST') {
      const user = getCurrentUser(reqUrl, req.headers);
      if (user.role === 'REVIEWER' && !reqUrl.searchParams.get('reregister')) {
        return sendJson(res, 403, { error: 'Reviewer role has view-only permissions (or delete & re-register).' });
      }
      const body = await readJsonBody(req);
      const partner = db.prepare('SELECT * FROM partners WHERE id = ?').get(body.partner_id);
      if (!partner) {
        return sendJson(res, 400, { error: 'Invalid partner organisation.' });
      }
      if (user.role === 'PARTNER_EDITOR' && user.partner_code && partner.code !== user.partner_code) {
        return sendJson(res, 403, { error: `As Partner Editor (${user.partner_code}), you can only register activities for your own organisation.` });
      }

      const countRow = db.prepare('SELECT COUNT(*) as cnt FROM activities WHERE partner_id = ?').get(partner.id);
      const nextNum = (countRow ? countRow.cnt : 0) + 1;
      const proj = db.prepare('SELECT acronym FROM projects WHERE id = ?').get(body.project_id);
      const prefix = proj ? proj.acronym.substring(0, 3).toUpperCase() : 'PRJ';
      const activityCode = `${prefix}-${partner.code === 'INBOUND-ALL' ? 'ALL' : partner.code}-${String(nextNum).padStart(3, '0')}`;

      const uploadedFiles = Array.isArray(body.uploaded_files) ? body.uploaded_files : [];
      const { warnings, missingEvidenceFlag } = validateAndComputeFlags(body, uploadedFiles.length);

      const resAct = db.prepare(`
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
      `).run(
        body.project_id,
        partner.id,
        body.reporting_period_id || null,
        activityCode,
        nextNum,
        String(nextNum),
        body.activity_date || new Date().toISOString().slice(0, 10),
        body.end_date || '',
        body.activity_date || '',
        body.title || 'New Dissemination Activity',
        body.activity_type || 'Official project social media',
        body.activity_type_other || '',
        body.activity_type || '',
        body.description || '',
        JSON.stringify(body.target_groups || ['General Public']),
        JSON.stringify(body.target_group_counts || {}),
        (body.target_groups || []).join(', '),
        body.stakeholders_reached || '',
        JSON.stringify(body.reach_levels || ['National']),
        JSON.stringify(body.countries_reached || [partner.country]),
        body.responsible_person || user.full_name,
        body.social_platform || '',
        body.measurement_period || '',
        body.analytics_extraction_date || new Date().toISOString().slice(0, 10),
        Number(body.metric_reach) || 0,
        Number(body.metric_views) || 0,
        Number(body.metric_impressions) || 0,
        Number(body.metric_likes) || 0,
        Number(body.metric_comments) || 0,
        Number(body.metric_shares) || 0,
        Number(body.metric_clicks) || 0,
        Number(body.metric_newsletter_recipients) || 0,
        Number(body.metric_newsletter_opens) || 0,
        Number(body.metric_event_participants) || 0,
        Number(body.metric_orgs_reached) || 0,
        String(
          (Number(body.metric_reach) || 0) ||
          (Number(body.metric_views) || 0) ||
          (Number(body.metric_event_participants) || 0) ||
          (Number(body.metric_newsletter_recipients) || 0)
        ),
        body.evidence_url || '',
        body.publication_media_outlet || '',
        body.event_location || partner.country,
        body.status || 'Submitted',
        JSON.stringify(warnings),
        missingEvidenceFlag,
        body.manager_notes || '',
        body.gdpr_consent_verified ? 1 : 0,
        user.full_name,
        user.full_name
      );

      const newActId = Number(resAct.lastInsertRowid);

      for (const uf of uploadedFiles) {
        if (!uf.dataUrl) continue;
        const m = uf.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (!m) continue;
        const mime = m[1];
        const buf = Buffer.from(m[2], 'base64');
        const safeOriginal = String(uf.name || 'evidence.png').replace(/[^a-zA-Z0-9._-]/g, '_');
        const diskName = `${activityCode}_v1_${Date.now()}_${safeOriginal}`;
        const fullPath = path.join(CUSTOM_UPLOADS_DIR, diskName);
        fs.writeFileSync(fullPath, buf);

        db.prepare(`
          INSERT INTO evidence_files (
            activity_id, project_id, file_name, original_name, file_type, mime_type,
            file_path, file_size, version, is_original, version_notes, uploaded_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
        `).run(
          newActId,
          body.project_id,
          diskName,
          uf.name || safeOriginal,
          uf.fileType || (mime.includes('pdf') ? 'pdf' : 'screenshot'),
          mime,
          `/uploads/custom/${diskName}`,
          buf.length,
          uf.versionNotes || 'Original evidence upload (v1)',
          user.full_name
        );
      }

      logAudit(body.project_id, newActId, user, 'ACTIVITY_CREATED', 'activity', activityCode, `Created activity "${body.title}" (${body.activity_type}) with status ${body.status || 'Submitted'}.`);
      return sendJson(res, 201, { ok: true, activityId: newActId, activityCode });
    }

    // Update Activity
    if (pathname.match(/^\/api\/activities\/\d+$/) && req.method === 'PUT') {
      const user = getCurrentUser(reqUrl, req.headers);
      if (user.role === 'REVIEWER') {
        return sendJson(res, 403, { error: 'Reviewer role cannot directly modify entries (only delete and re-register).' });
      }
      const actId = Number(pathname.split('/')[3]);
      const existing = db.prepare(`
        SELECT a.*, p.code as partner_code FROM activities a JOIN partners p ON a.partner_id = p.id WHERE a.id = ?
      `).get(actId);
      if (!existing) return sendJson(res, 404, { error: 'Activity not found.' });

      if (user.role === 'PARTNER_EDITOR' && user.partner_code && existing.partner_code !== user.partner_code) {
        return sendJson(res, 403, { error: 'You cannot edit an activity belonging to another partner.' });
      }

      const body = await readJsonBody(req);
      const evCountRow = db.prepare('SELECT COUNT(*) as cnt FROM evidence_files WHERE activity_id = ?').get(actId);
      const uploadedFiles = Array.isArray(body.uploaded_files) ? body.uploaded_files : [];
      const totalEvCount = (evCountRow ? evCountRow.cnt : 0) + uploadedFiles.length;
      const { warnings, missingEvidenceFlag } = validateAndComputeFlags(body, totalEvCount);

      db.prepare(`
        UPDATE activities SET
          partner_id = ?,
          reporting_period_id = ?,
          activity_date = ?,
          end_date = ?,
          title = ?,
          activity_type = ?,
          activity_type_other = ?,
          description = ?,
          target_groups_json = ?,
          target_group_counts_json = ?,
          stakeholders_reached = ?,
          reach_levels_json = ?,
          countries_reached_json = ?,
          responsible_person = ?,
          social_platform = ?,
          measurement_period = ?,
          analytics_extraction_date = ?,
          metric_reach = ?,
          metric_views = ?,
          metric_impressions = ?,
          metric_likes = ?,
          metric_comments = ?,
          metric_shares = ?,
          metric_clicks = ?,
          metric_newsletter_recipients = ?,
          metric_newsletter_opens = ?,
          metric_event_participants = ?,
          metric_orgs_reached = ?,
          evidence_url = ?,
          publication_media_outlet = ?,
          event_location = ?,
          status = ?,
          validation_warnings_json = ?,
          missing_evidence_flag = ?,
          manager_notes = ?,
          gdpr_consent_verified = ?,
          updated_by = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        body.partner_id || existing.partner_id,
        body.reporting_period_id || existing.reporting_period_id,
        body.activity_date || existing.activity_date,
        body.end_date !== undefined ? body.end_date : existing.end_date,
        body.title || existing.title,
        body.activity_type || existing.activity_type,
        body.activity_type_other !== undefined ? body.activity_type_other : existing.activity_type_other,
        body.description || existing.description,
        JSON.stringify(body.target_groups || JSON.parse(existing.target_groups_json || '[]')),
        JSON.stringify(body.target_group_counts || JSON.parse(existing.target_group_counts_json || '{}')),
        body.stakeholders_reached !== undefined ? body.stakeholders_reached : existing.stakeholders_reached,
        JSON.stringify(body.reach_levels || JSON.parse(existing.reach_levels_json || '[]')),
        JSON.stringify(body.countries_reached || JSON.parse(existing.countries_reached_json || '[]')),
        body.responsible_person || existing.responsible_person,
        body.social_platform !== undefined ? body.social_platform : existing.social_platform,
        body.measurement_period !== undefined ? body.measurement_period : existing.measurement_period,
        body.analytics_extraction_date !== undefined ? body.analytics_extraction_date : existing.analytics_extraction_date,
        Number(body.metric_reach) || 0,
        Number(body.metric_views) || 0,
        Number(body.metric_impressions) || 0,
        Number(body.metric_likes) || 0,
        Number(body.metric_comments) || 0,
        Number(body.metric_shares) || 0,
        Number(body.metric_clicks) || 0,
        Number(body.metric_newsletter_recipients) || 0,
        Number(body.metric_newsletter_opens) || 0,
        Number(body.metric_event_participants) || 0,
        Number(body.metric_orgs_reached) || 0,
        body.evidence_url !== undefined ? body.evidence_url : existing.evidence_url,
        body.publication_media_outlet !== undefined ? body.publication_media_outlet : existing.publication_media_outlet,
        body.event_location !== undefined ? body.event_location : existing.event_location,
        body.status || existing.status,
        JSON.stringify(warnings),
        missingEvidenceFlag,
        body.manager_notes !== undefined ? body.manager_notes : existing.manager_notes,
        body.gdpr_consent_verified !== undefined ? (body.gdpr_consent_verified ? 1 : 0) : existing.gdpr_consent_verified,
        user.full_name,
        actId
      );

      if (uploadedFiles.length > 0) {
        const maxVerRow = db.prepare('SELECT MAX(version) as maxV FROM evidence_files WHERE activity_id = ?').get(actId);
        const nextVersion = ((maxVerRow && maxVerRow.maxV) ? maxVerRow.maxV : 0) + 1;
        const isOrig = nextVersion === 1 ? 1 : 0;

        for (const uf of uploadedFiles) {
          if (!uf.dataUrl) continue;
          const m = uf.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (!m) continue;
          const mime = m[1];
          const buf = Buffer.from(m[2], 'base64');
          const safeOriginal = String(uf.name || 'evidence.png').replace(/[^a-zA-Z0-9._-]/g, '_');
          const diskName = `${existing.activity_code}_v${nextVersion}_${Date.now()}_${safeOriginal}`;
          const fullPath = path.join(CUSTOM_UPLOADS_DIR, diskName);
          fs.writeFileSync(fullPath, buf);

          db.prepare(`
            INSERT INTO evidence_files (
              activity_id, project_id, file_name, original_name, file_type, mime_type,
              file_path, file_size, version, is_original, version_notes, uploaded_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            actId,
            existing.project_id,
            diskName,
            uf.name || safeOriginal,
            uf.fileType || (mime.includes('pdf') ? 'pdf' : 'screenshot'),
            mime,
            `/uploads/custom/${diskName}`,
            buf.length,
            nextVersion,
            isOrig,
            uf.versionNotes || (isOrig ? 'Original evidence (v1)' : `Updated evidence version (v${nextVersion}) — original files preserved`),
            user.full_name
          );
        }
      }

      logAudit(existing.project_id, actId, user, 'ACTIVITY_UPDATED', 'activity', existing.activity_code, `Updated activity ${existing.activity_code} ("${body.title || existing.title}")`);
      return sendJson(res, 200, { ok: true });
    }

    // Delete Activity
    if (pathname.match(/^\/api\/activities\/\d+$/) && req.method === 'DELETE') {
      const user = getCurrentUser(reqUrl, req.headers);
      const actId = Number(pathname.split('/')[3]);
      const existing = db.prepare(`
        SELECT a.*, p.code as partner_code FROM activities a JOIN partners p ON a.partner_id = p.id WHERE a.id = ?
      `).get(actId);
      if (!existing) return sendJson(res, 404, { error: 'Not found' });

      if (user.role === 'PARTNER_EDITOR' && user.partner_code && existing.partner_code !== user.partner_code) {
        return sendJson(res, 403, { error: 'You cannot delete another partner\'s activity.' });
      }
      db.prepare('DELETE FROM activities WHERE id = ?').run(actId);
      logAudit(existing.project_id, actId, user, 'ACTIVITY_DELETED', 'activity', existing.activity_code, `Deleted activity ${existing.activity_code} ("${existing.title}")`);
      return sendJson(res, 200, { ok: true });
    }

    // Review / Status Change Workflow (Section 8)
    if (pathname.match(/^\/api\/activities\/\d+\/status$/) && req.method === 'POST') {
      const user = getCurrentUser(reqUrl, req.headers);
      const actId = Number(pathname.split('/')[3]);
      const body = await readJsonBody(req);
      const existing = db.prepare(`
        SELECT a.*, p.name as partner_name, p.contact_email, p.contact_person
        FROM activities a JOIN partners p ON a.partner_id = p.id
        WHERE a.id = ?
      `).get(actId);
      if (!existing) return sendJson(res, 404, { error: 'Activity not found' });

      if ((body.status === 'Approved' || body.status === 'Needs Revision') && user.role !== 'SUPER_ADMIN' && user.role !== 'DISSEMINATION_MANAGER') {
        return sendJson(res, 403, { error: 'Only Dissemination Manager can approve or return activities for revision.' });
      }

      db.prepare(`
        UPDATE activities SET status = ?, manager_notes = ?, updated_by = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(body.status, body.comment || existing.manager_notes, user.full_name, actId);

      if (body.comment) {
        db.prepare(`
          INSERT INTO activity_comments (activity_id, author_name, author_role, comment_text, action_type)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          actId,
          user.full_name,
          user.role,
          body.comment,
          body.status === 'Approved' ? 'approval' : (body.status === 'Needs Revision' ? 'revision_request' : 'status_change')
        );
      }

      if (body.status === 'Needs Revision') {
        db.prepare(`
          INSERT INTO email_notifications (project_id, partner_id, recipient_email, recipient_name, notification_type, subject, body, sent_by)
          VALUES (?, ?, ?, ?, 'revision_request', ?, ?, ?)
        `).run(
          existing.project_id,
          existing.partner_id,
          existing.contact_email || 'partner@inbound.eu',
          existing.partner_name,
          `[IN-BOUND Dissemination] Revision Requested for Activity ${existing.activity_code}`,
          `Dear Partner (${existing.partner_name}),\n\nYour activity "${existing.title}" (${existing.activity_code}) has been marked as "Needs Revision".\nDissemination Manager Note (TIHC): ${body.comment || 'Please upload the missing analytics screenshot / URL and verify the metrics.'}`,
          user.full_name
        );
      }

      logAudit(existing.project_id, actId, user, `STATUS_${body.status.toUpperCase().replace(/\s+/g, '_')}`, 'activity', existing.activity_code, `Changed status from "${existing.status}" to "${body.status}". Note: ${body.comment || '-'}`);
      return sendJson(res, 200, { ok: true });
    }

    // Add Comment to Activity
    if (pathname.match(/^\/api\/activities\/\d+\/comments$/) && req.method === 'POST') {
      const user = getCurrentUser(reqUrl, req.headers);
      const actId = Number(pathname.split('/')[3]);
      const body = await readJsonBody(req);
      const existing = db.prepare('SELECT * FROM activities WHERE id = ?').get(actId);
      if (!existing) return sendJson(res, 404, { error: 'Not found' });

      db.prepare(`
        INSERT INTO activity_comments (activity_id, author_name, author_role, comment_text, action_type)
        VALUES (?, ?, ?, ?, 'comment')
      `).run(actId, user.full_name, user.role, body.comment_text || '');

      logAudit(existing.project_id, actId, user, 'COMMENT_ADDED', 'activity', existing.activity_code, `Added comment: "${body.comment_text}"`);
      return sendJson(res, 201, { ok: true });
    }

    // Send Automated / Manual Reminder Email (Section 10)
    if (pathname === '/api/notifications/send' && req.method === 'POST') {
      const user = getCurrentUser(reqUrl, req.headers);
      const body = await readJsonBody(req);
      db.prepare(`
        INSERT INTO email_notifications (project_id, partner_id, recipient_email, recipient_name, notification_type, subject, body, sent_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        body.project_id || 1,
        body.partner_id || null,
        body.recipient_email || 'all-partners@inbound-project.eu',
        body.recipient_name || 'Consortium Partners',
        body.notification_type || 'missing_evidence',
        body.subject || '[TIHC Dissemination Platform] Dissemination Pending Items Reminder',
        body.body || '',
        user.full_name
      );
      logAudit(body.project_id || 1, null, user, 'EMAIL_REMINDER_SENT', 'notification', body.recipient_name, `Sent notification (${body.notification_type}) to ${body.recipient_name} <${body.recipient_email}>`);
      return sendJson(res, 201, { ok: true });
    }

    // Excel Import & Validation Engine (Section 11)
    if (pathname === '/api/import/validate' && req.method === 'POST') {
      const user = getCurrentUser(reqUrl, req.headers);
      const body = await readJsonBody(req);
      let buf;
      if (body.useWorkspaceInboundFile) {
        const wsExcel = path.join(__dirname, 'Dissemination Log IN-BOUND.xlsx');
        if (!fs.existsSync(wsExcel)) {
          return sendJson(res, 404, { error: 'Dissemination Log IN-BOUND.xlsx not found in workspace.' });
        }
        buf = fs.readFileSync(wsExcel);
      } else if (body.dataUrl) {
        const m = body.dataUrl.match(/^data:[^;]+;base64,(.+)$/);
        if (!m) return sendJson(res, 400, { error: 'Invalid Excel file.' });
        buf = Buffer.from(m[1], 'base64');
      } else {
        return sendJson(res, 400, { error: 'No Excel file provided.' });
      }

      const sheets = parseUploadedXlsxBuffer(buf);
      const validationReport = [];
      let totalRowsFound = 0;
      let validRowsCount = 0;
      let flaggedRowsCount = 0;

      for (const sh of sheets) {
        const isSheet1 = sh.sheetName === 'In-Bound Platform';
        const sheetRowsReport = [];
        for (const r of sh.rows) {
          if (r.excelRow <= 4) continue;
          const c = r.cells || {};
          const hasData = c.B || c.C || c.D || c.E;
          if (!hasData) continue;

          totalRowsFound++;
          const rawDate = c.B || '';
          const rawCat = c.C || '';
          const rawDesc = c.D || '';
          const rawNumbers = isSheet1 ? (c.J || '') : (c.I || '');
          const rawLink = isSheet1 ? (c.K || '') : (c.J || '');

          const { startDate, endDate, warnings: dWarn } = parseExcelDate(rawDate);
          const { type: normCat } = normalizeCategory(rawCat, rawDesc);
          const { metrics, warnings: mWarn } = parseMetrics(rawNumbers, normCat, rawDesc);
          const rowWarnings = [...dWarn, ...mWarn];
          if (!rawLink || rawLink === '-') {
            rowWarnings.push('Missing or placeholder ("-") Evidence URL in Excel');
          }

          if (rowWarnings.length > 0) {
            flaggedRowsCount++;
          } else {
            validRowsCount++;
          }

          sheetRowsReport.push({
            sheetName: sh.sheetName,
            excelRow: r.excelRow,
            rawDate,
            parsedDate: startDate,
            endDate,
            rawCategory: rawCat,
            mappedCategory: normCat,
            description: rawDesc,
            rawNumbers,
            parsedMetrics: metrics,
            rawLink,
            status: rowWarnings.length === 0 ? 'VALID' : 'FLAGGED_FOR_REVIEW',
            warnings: rowWarnings
          });
        }
        validationReport.push({
          sheetName: sh.sheetName,
          totalRows: sheetRowsReport.length,
          validRows: sheetRowsReport.filter(x => x.status === 'VALID').length,
          flaggedRows: sheetRowsReport.filter(x => x.status === 'FLAGGED_FOR_REVIEW').length,
          rows: sheetRowsReport
        });
      }

      logAudit(body.project_id || 1, null, user, 'EXCEL_IMPORT_VALIDATED', 'import', body.fileName || 'Dissemination Log IN-BOUND.xlsx', `Excel validation run: ${totalRowsFound} rows (${validRowsCount} valid, ${flaggedRowsCount} flagged for manual review).`);

      return sendJson(res, 200, {
        ok: true,
        summary: {
          totalSheets: validationReport.length,
          totalRowsFound,
          validRowsCount,
          flaggedRowsCount
        },
        sheets: validationReport
      });
    }

    // 3. Export Excel (.xlsx) (Section 9)
    if (pathname === '/api/export/excel' && req.method === 'GET') {
      const user = getCurrentUser(reqUrl, req.headers);
      const projectId = Number(reqUrl.searchParams.get('projectId') || 1);
      const partnerIdFilter = reqUrl.searchParams.get('partnerId') || '';
      const categoryFilter = reqUrl.searchParams.get('category') || '';
      const statusFilter = reqUrl.searchParams.get('status') || '';

      const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
      const partners = db.prepare('SELECT * FROM partners WHERE project_id = ? ORDER BY id ASC').all(projectId);
      let acts = db.prepare(`
        SELECT a.*, p.name as partner_name, p.code as partner_code, p.country as partner_country
        FROM activities a
        JOIN partners p ON a.partner_id = p.id
        WHERE a.project_id = ?
        ORDER BY a.partner_id ASC, a.excel_row_num ASC, a.id ASC
      `).all(projectId);

      if (partnerIdFilter) acts = acts.filter(a => String(a.partner_id) === String(partnerIdFilter));
      if (categoryFilter) acts = acts.filter(a => a.activity_type === categoryFilter);
      if (statusFilter) acts = acts.filter(a => a.status === statusFilter);

      const evCounts = {};
      for (const r of db.prepare('SELECT activity_id, COUNT(*) as c FROM evidence_files WHERE project_id = ? GROUP BY activity_id').all(projectId)) {
        evCounts[r.activity_id] = r.c;
      }

      const buildSheetRows = (titleText, list) => {
        const rows = [
          [titleText],
          [`Project Number: ${project.project_number} | Dissemination Leader: ${project.dissemination_leader} | Exported: ${new Date().toISOString().slice(0, 10)}`],
          [],
          [
            'Activity ID',
            'Partner',
            'Date of Activity',
            'Type of Activity',
            'Description',
            'Target Group(s)',
            'Stakeholders Reached',
            'EU Level',
            'National Level',
            'Local Level',
            'Reach (Unique)',
            'Views',
            'Impressions',
            'Likes / Reactions',
            'Comments',
            'Shares / Reposts',
            'Newsletter Recipients',
            'Event Participants',
            'Organisations Reached',
            'Legacy Numbers Reached',
            'Evidence Link (URL)',
            'Attached Evidence Files',
            'Review Status',
            'Validation / Manager Notes'
          ]
        ];
        for (const a of list) {
          const rLevels = JSON.parse(a.reach_levels_json || '[]');
          const tGroups = JSON.parse(a.target_groups_json || '[]');
          rows.push([
            a.activity_code,
            a.partner_name,
            a.end_date ? `${a.activity_date} - ${a.end_date}` : a.activity_date,
            a.activity_type === 'Other Dissemination Activity' && a.activity_type_other ? `Other (${a.activity_type_other})` : a.activity_type,
            a.description,
            a.raw_target_groups || tGroups.join(', '),
            a.stakeholders_reached || '',
            rLevels.includes('European') ? 'X' : '',
            rLevels.includes('National') ? 'X' : '',
            rLevels.includes('Local') ? 'X' : '',
            Number(a.metric_reach) || 0,
            Number(a.metric_views) || 0,
            Number(a.metric_impressions) || 0,
            Number(a.metric_likes) || 0,
            Number(a.metric_comments) || 0,
            Number(a.metric_shares) || 0,
            Number(a.metric_newsletter_recipients) || 0,
            Number(a.metric_event_participants) || 0,
            Number(a.metric_orgs_reached) || 0,
            a.legacy_numbers_reached_raw || '',
            a.evidence_url || '',
            `${evCounts[a.id] || 0} file(s)`,
            a.status,
            a.manager_notes || ''
          ]);
        }
        return rows;
      };

      const xlsxSheets = [
        {
          name: 'All Consolidated Activities',
          rows: buildSheetRows(`${project.acronym} — Consolidated Dissemination Log (All Partners)`, acts)
        }
      ];

      if (!partnerIdFilter) {
        for (const p of partners) {
          const pActs = acts.filter(a => a.partner_id === p.id);
          xlsxSheets.push({
            name: p.sheet_name || p.code,
            rows: buildSheetRows(`${project.acronym} — ${p.name} (${p.country}) Dissemination Log`, pActs)
          });
        }
      }

      const kpis = computeKpiProgress(projectId);
      const kpiRows = [
        [`${project.acronym} — KPI Achievement Summary`],
        [`Project Number: ${project.project_number}`],
        [],
        ['KPI Code', 'KPI Indicator Title', 'Target Value', 'Recorded Performance', 'Approved Performance', 'Completion (%)', 'Unit', 'Description']
      ];
      for (const k of kpis) {
        kpiRows.push([k.code, k.title, k.target_value, k.recorded_value, k.approved_value, `${k.percentage}%`, k.unit, k.description]);
      }
      xlsxSheets.push({ name: 'KPI Summary', rows: kpiRows });

      const xlsxBuf = createXlsxBuffer(xlsxSheets);
      logAudit(projectId, null, user, 'EXPORT_EXCEL', 'export', `${project.acronym}_Dissemination_Log.xlsx`, `Exported Excel workbook with ${acts.length} activities.`);

      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${project.acronym}_Dissemination_Log_Export.xlsx"`
      });
      res.end(xlsxBuf);
      return;
    }

    // 4. Export Evidence Package (.zip) (Section 9)
    if (pathname === '/api/export/evidence-zip' && req.method === 'GET') {
      const user = getCurrentUser(reqUrl, req.headers);
      const projectId = Number(reqUrl.searchParams.get('projectId') || 1);
      const partnerIdFilter = reqUrl.searchParams.get('partnerId') || '';

      const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
      let acts = db.prepare(`
        SELECT a.*, p.code as partner_code, p.name as partner_name
        FROM activities a
        JOIN partners p ON a.partner_id = p.id
        WHERE a.project_id = ?
        ORDER BY a.partner_id ASC, a.id ASC
      `).all(projectId);

      if (partnerIdFilter) {
        acts = acts.filter(a => String(a.partner_id) === String(partnerIdFilter));
      }

      const zipEntries = [];
      const csvLines = [
        'Activity_Code,Partner,Date,Category,Title,Status,Evidence_URL,Attached_Files_In_ZIP'
      ];

      for (const a of acts) {
        const evFiles = db.prepare('SELECT * FROM evidence_files WHERE activity_id = ? ORDER BY version ASC').all(a.id);
        const zipFilePaths = [];
        for (const ev of evFiles) {
          const relDisk = ev.file_path.replace(/^\/uploads\//, '');
          const diskFull = path.join(UPLOADS_DIR, relDisk);
          if (fs.existsSync(diskFull)) {
            const folderName = `${a.partner_code}/${a.activity_code}`;
            const entryName = `${folderName}/v${ev.version}_${ev.file_name}`;
            zipEntries.push({
              name: entryName,
              data: fs.readFileSync(diskFull)
            });
            zipFilePaths.push(entryName);
          }
        }
        csvLines.push(
          [
            a.activity_code,
            `"${a.partner_name.replace(/"/g, '""')}"`,
            a.activity_date,
            `"${a.activity_type.replace(/"/g, '""')}"`,
            `"${a.title.replace(/"/g, '""')}"`,
            a.status,
            `"${(a.evidence_url || '').replace(/"/g, '""')}"`,
            `"${zipFilePaths.join('; ')}"`
          ].join(',')
        );
      }

      zipEntries.push({
        name: 'MANIFEST_Activities_and_Evidence.csv',
        data: '\uFEFF' + csvLines.join('\r\n')
      });

      zipEntries.push({
        name: 'README_Evidence_Package.txt',
        data: `======================================================================\r\n` +
              `EVIDENCE PACKAGE — ${project.acronym} (${project.project_number})\r\n` +
              `Dissemination Leader: ${project.dissemination_leader}\r\n` +
              `Generated At: ${new Date().toISOString()}\r\n` +
              `======================================================================\r\n\r\n` +
              `Structure:\r\n` +
              `- Organized by Partner Code -> Activity Code -> Versioned Evidence Files (v1, v2...)\r\n` +
              `- MANIFEST_Activities_and_Evidence.csv contains the full index of activities, URLs, and file paths.\r\n`
      });

      const zipBuf = createZipBuffer(zipEntries);
      logAudit(projectId, null, user, 'EXPORT_EVIDENCE_ZIP', 'export', `${project.acronym}_Evidence_Package.zip`, `Exported ZIP Evidence Package (${zipEntries.length - 2} evidence files).`);

      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${project.acronym}_Evidence_Package.zip"`
      });
      res.end(zipBuf);
      return;
    }

    // 5. Printable / PDF Official Report View (Bilingual: EN default, EL optional)
    if (pathname === '/api/export/report-pdf-view' && req.method === 'GET') {
      const user = getCurrentUser(reqUrl, req.headers);
      const projectId = Number(reqUrl.searchParams.get('projectId') || 1);
      const partnerIdFilter = reqUrl.searchParams.get('partnerId') || '';
      const statusFilter = reqUrl.searchParams.get('status') || '';
      const lang = reqUrl.searchParams.get('lang') === 'el' ? 'el' : 'en';
      const isEl = lang === 'el';

      const data = buildBootstrapData(projectId, user);
      const p = data.activeProject;
      let acts = data.activities;
      if (partnerIdFilter) acts = acts.filter(a => String(a.partner_id) === String(partnerIdFilter));
      if (statusFilter) acts = acts.filter(a => a.status === statusFilter);

      logAudit(projectId, null, user, 'EXPORT_PDF_REPORT', 'export', `${p.acronym}_Official_Dissemination_Report.pdf`, `Generated official PDF report view (${acts.length} activities, lang=${lang}).`);

      const totalReach = acts.reduce((s, a) => s + (Number(a.metric_reach) || 0), 0);
      const totalViews = acts.reduce((s, a) => s + (Number(a.metric_views) || 0), 0);
      const totalImpressions = acts.reduce((s, a) => s + (Number(a.metric_impressions) || 0), 0);
      const totalParticipants = acts.reduce((s, a) => s + (Number(a.metric_event_participants) || 0), 0);
      const totalNewsletter = acts.reduce((s, a) => s + (Number(a.metric_newsletter_recipients) || 0), 0);

      const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <title>${p.acronym} — Official Dissemination Monitoring Report</title>
  <style>
    * { box-sizing: border-box; font-family: 'Segoe UI', Roboto, Arial, sans-serif; }
    body { margin: 0; padding: 28px; color: #0f172a; background: #f8fafc; font-size: 12px; }
    .report-container { max-width: 1050px; margin: 0 auto; background: #fff; padding: 36px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
    .no-print-bar { display: flex; justify-content: space-between; align-items: center; background: #1e3a8a; color: #fff; padding: 14px 24px; border-radius: 8px; margin-bottom: 24px; }
    .btn-print { background: #ffffff; color: #1e3a8a; border: none; padding: 10px 18px; border-radius: 6px; font-weight: 700; cursor: pointer; font-size: 13px; }
    .report-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #1e3a8a; padding-bottom: 18px; margin-bottom: 24px; }
    .report-header img { max-height: 58px; object-fit: contain; }
    h1 { font-size: 20px; color: #1e3a8a; margin: 0 0 6px 0; }
    h2 { font-size: 15px; color: #1e3a8a; border-bottom: 1px solid #cbd5e1; padding-bottom: 6px; margin-top: 26px; }
    .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; background: #f1f5f9; padding: 14px; border-radius: 8px; margin-bottom: 20px; }
    .meta-item strong { display: block; font-size: 10px; text-transform: uppercase; color: #64748b; }
    .meta-item span { font-size: 13px; font-weight: 600; color: #0f172a; }
    .metrics-banner { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin-bottom: 24px; }
    .metric-box { border: 1px solid #e2e8f0; border-top: 3px solid #2563eb; border-radius: 8px; padding: 10px; text-align: center; }
    .metric-box .val { font-size: 18px; font-weight: 800; color: #1e3a8a; }
    .metric-box .lbl { font-size: 10px; color: #475569; margin-top: 3px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px; }
    th, td { border: 1px solid #cbd5e1; padding: 7px 9px; text-align: left; vertical-align: top; }
    th { background: #1e3a8a; color: #fff; font-weight: 600; }
    tr:nth-child(even) { background: #f8fafc; }
    .badge { display: inline-block; padding: 2px 7px; border-radius: 99px; font-size: 10px; font-weight: 700; }
    .badge-Approved { background: #dcfce7; color: #166534; }
    .badge-Submitted { background: #dbeafe; color: #1e40af; }
    .badge-Revision { background: #fef3c7; color: #92400e; }
    .ev-thumbs { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
    .ev-thumbs img { width: 56px; height: 56px; object-fit: cover; border: 1px solid #94a3b8; border-radius: 4px; }
    @media print {
      body { background: #fff; padding: 0; }
      .report-container { box-shadow: none; max-width: 100%; padding: 10px; }
      .no-print-bar { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="report-container">
    <div class="no-print-bar">
      <div>
        <strong>${isEl ? 'Επίσημη Αναφορά Διάχυσης (PDF / Print Mode)' : 'Official Dissemination Monitoring Report (PDF / Print Mode)'}</strong>
      </div>
      <button class="btn-print" onclick="window.print()">🖨️ ${isEl ? 'Εκτύπωση / Αποθήκευση ως PDF' : 'Print / Save as PDF'}</button>
    </div>

    <div class="report-header">
      <div>
        <h1>${p.acronym} — Dissemination Monitoring & KPI Report</h1>
        <div style="color:#475569; font-weight:600;">${p.title}</div>
        <div style="color:#64748b; margin-top:4px;">Project No: <strong>${p.project_number}</strong> | Dissemination Leader: <strong>${p.dissemination_leader}</strong></div>
      </div>
      <div style="display:flex; gap:14px; align-items:center;">
        <img src="/uploads/inbound/image25.png" alt="TIHC">
        <img src="/uploads/inbound/image104.jpg" alt="Co-funded by the EU">
      </div>
    </div>

    <div class="meta-grid">
      <div class="meta-item"><strong>${isEl ? 'Πρόγραμμα' : 'Programme'}</strong><span>${p.programme_type}</span></div>
      <div class="meta-item"><strong>${isEl ? 'Διάρκεια Έργου' : 'Project Duration'}</strong><span>${p.start_date} — ${p.end_date}</span></div>
      <div class="meta-item"><strong>${isEl ? 'Συντονιστής Έργου' : 'Project Coordinator'}</strong><span>${p.coordinator_name}</span></div>
      <div class="meta-item"><strong>${isEl ? 'Περίοδος Αναφοράς' : 'Reporting Period'}</strong><span>${data.reportingPeriods[0]?.name || 'Interim Report'}</span></div>
      <div class="meta-item"><strong>${isEl ? 'Σύνολο Καταχωρίσεων' : 'Total Activities Included'}</strong><span>${acts.length}</span></div>
      <div class="meta-item"><strong>${isEl ? 'Ημερομηνία Εξαγωγής' : 'Generated On'}</strong><span>${new Date().toISOString().slice(0, 10)}</span></div>
    </div>

    <h2>1. ${isEl ? 'Συγκεντρωτικές Διαχωρισμένες Μετρικές' : 'Separated Dissemination Metrics Overview'}</h2>
    <div class="metrics-banner">
      <div class="metric-box"><div class="val">${acts.length.toLocaleString()}</div><div class="lbl">${isEl ? 'Σύνολο Δράσεων' : 'Total Activities'}</div></div>
      <div class="metric-box"><div class="val">${totalReach.toLocaleString()}</div><div class="lbl">Social Media Reach (Unique)</div></div>
      <div class="metric-box"><div class="val">${totalViews.toLocaleString()}</div><div class="lbl">Views (Video / Stories / Web)</div></div>
      <div class="metric-box"><div class="val">${totalImpressions.toLocaleString()}</div><div class="lbl">Impressions</div></div>
      <div class="metric-box"><div class="val">${totalParticipants.toLocaleString()}</div><div class="lbl">${isEl ? 'Συμμετέχοντες Εκδηλώσεων' : 'Event Participants'}</div></div>
      <div class="metric-box"><div class="val">${totalNewsletter.toLocaleString()}</div><div class="lbl">${isEl ? 'Παραλήπτες Newsletters' : 'Newsletter Recipients'}</div></div>
    </div>

    <h2>2. ${isEl ? 'Στατιστικά και Κατάσταση ανά Εταίρο' : 'Partner Performance & Pending Evidence Breakdown'}</h2>
    <table>
      <thead>
        <tr>
          <th>Partner</th>
          <th>${isEl ? 'Χώρα' : 'Country'}</th>
          <th>${isEl ? 'Ρόλος' : 'Role'}</th>
          <th>${isEl ? 'Σύνολο Δράσεων' : 'Total Activities'}</th>
          <th>Approved</th>
          <th>Missing Evidence</th>
          <th>Needs Revision</th>
          <th>Reach</th>
          <th>Views</th>
          <th>${isEl ? 'Συμμετέχοντες' : 'Participants'}</th>
        </tr>
      </thead>
      <tbody>
        ${data.partnerPendingMatrix.map(pm => `
          <tr>
            <td><strong>${pm.partner_name}</strong></td>
            <td>${pm.country} (${pm.country_code})</td>
            <td>${pm.role}</td>
            <td><strong>${pm.total_activities}</strong></td>
            <td>${pm.approved_count}</td>
            <td style="color:${pm.missing_evidence_count > 0 ? '#dc2626' : '#16a34a'}; font-weight:700;">${pm.missing_evidence_count}</td>
            <td style="color:${pm.needs_revision_count > 0 ? '#d97706' : '#16a34a'}; font-weight:700;">${pm.needs_revision_count}</td>
            <td>${pm.total_reach.toLocaleString()}</td>
            <td>${pm.total_views.toLocaleString()}</td>
            <td>${pm.total_participants.toLocaleString()}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <h2>3. ${isEl ? 'Επίτευξη Στόχων & Δεικτών Διάχυσης (Project KPIs)' : 'Project KPIs Achievement Table'}</h2>
    <table>
      <thead>
        <tr>
          <th>Code</th>
          <th>KPI Indicator</th>
          <th>Target</th>
          <th>Recorded Performance</th>
          <th>Approved Performance</th>
          <th>Completion (%)</th>
        </tr>
      </thead>
      <tbody>
        ${data.kpis.map(k => `
          <tr>
            <td><strong>${k.code}</strong></td>
            <td>${k.title}<br><small style="color:#64748b">${k.description || ''}</small></td>
            <td><strong>${k.target_value.toLocaleString()}</strong> ${k.unit}</td>
            <td><strong>${k.recorded_value.toLocaleString()}</strong> ${k.unit}</td>
            <td>${k.approved_value.toLocaleString()} ${k.unit}</td>
            <td><strong>${k.percentage}%</strong></td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <h2>4. ${isEl ? 'Αναλυτικός Πίνακας Δραστηριοτήτων & Αποδεικτικού Υλικού' : 'Detailed Dissemination Activities & Evidence Log'} (${acts.length})</h2>
    <table>
      <thead>
        <tr>
          <th style="width:75px;">ID</th>
          <th style="width:95px;">Partner / Date</th>
          <th style="width:130px;">Type & Reach</th>
          <th>Activity Description & Target Groups</th>
          <th style="width:120px;">Metrics</th>
          <th style="width:185px;">Evidence (URL & Screenshots)</th>
          <th style="width:75px;">Status</th>
        </tr>
      </thead>
      <tbody>
        ${acts.map(a => `
          <tr>
            <td><strong>${a.activity_code}</strong></td>
            <td><strong>${a.partner_name}</strong><br>${a.activity_date}${a.end_date ? '<br>to ' + a.end_date : ''}</td>
            <td><strong>${a.activity_type}</strong><br><small>Reach: ${a.reach_levels.join(', ')}</small></td>
            <td>
              <strong>${a.title}</strong><br>
              <span>${a.description}</span><br>
              <small style="color:#475569;"><strong>Target:</strong> ${a.raw_target_groups || a.target_groups.join(', ')}</small>
            </td>
            <td>
              ${a.metric_reach ? `<div>Reach: <strong>${a.metric_reach.toLocaleString()}</strong></div>` : ''}
              ${a.metric_views ? `<div>Views: <strong>${a.metric_views.toLocaleString()}</strong></div>` : ''}
              ${a.metric_impressions ? `<div>Impr.: <strong>${a.metric_impressions.toLocaleString()}</strong></div>` : ''}
              ${a.metric_likes ? `<div>Likes: <strong>${a.metric_likes.toLocaleString()}</strong></div>` : ''}
              ${a.metric_event_participants ? `<div>Partic.: <strong>${a.metric_event_participants.toLocaleString()}</strong></div>` : ''}
              ${a.metric_newsletter_recipients ? `<div>Newslet.: <strong>${a.metric_newsletter_recipients.toLocaleString()}</strong></div>` : ''}
              ${(!a.metric_reach && !a.metric_views && !a.metric_impressions && !a.metric_event_participants && !a.metric_newsletter_recipients) ? `<span style="color:#dc2626">${a.legacy_numbers_reached_raw || 'Pending'}</span>` : ''}
            </td>
            <td>
              ${a.evidence_url ? `<div style="word-break:break-all; margin-bottom:4px;"><a href="${a.evidence_url}" target="_blank">${a.evidence_url.substring(0, 55)}...</a></div>` : '<div style="color:#94a3b8;">No URL</div>'}
              ${a.evidence_files.length > 0 ? `<div class="ev-thumbs">${a.evidence_files.slice(0, 3).map(ev => `<img src="${ev.file_path}" title="${ev.original_name}">`).join('')}</div>` : '<div style="color:#dc2626; font-size:10px;">Missing Screenshot</div>'}
            </td>
            <td>
              <span class="badge badge-${a.status === 'Needs Revision' ? 'Revision' : a.status}">${a.status}</span>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
</body>
</html>`;

      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'text/html; charset=utf-8'
      });
      res.end(html);
      return;
    }

    // 6. Serve Static Frontend Assets
    const staticFile = pathname === '/' ? '/index.html' : pathname;
    const fullStaticPath = path.normalize(path.join(PUBLIC_DIR, staticFile));
    if (fullStaticPath.startsWith(PUBLIC_DIR) && fs.existsSync(fullStaticPath) && !fs.statSync(fullStaticPath).isDirectory()) {
      const ext = path.extname(fullStaticPath).toLowerCase();
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
      });
      fs.createReadStream(fullStaticPath).pipe(res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  } catch (err) {
    console.error('Server error:', err);
    sendJson(res, 500, { error: err.message || 'Internal Server Error' });
  }
}

const server = http.createServer(requestHandler);

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`TIHC Dissemination Monitoring & Reporting Platform listening on http://${HOST}:${PORT}`);
  });
}

module.exports = requestHandler;
