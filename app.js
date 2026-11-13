const state = {
  currentLang: localStorage.getItem('tihc_lang') || 'en', // Primary language: English ('en') with 'el' toggle
  currentUserId: 2, // Default: TIHC Dissemination Manager
  authToken: localStorage.getItem('tihc_auth_token') || '',
  authenticatedUser: null,
  currentProjectId: 1, // Default: IN-BOUND
  activeTab: 'dashboard', // dashboard | pending_matrix | activities | form | kpis | exports | import | admin
  editingActivityId: null,
  bootstrap: null,
  filters: {
    partnerId: '',
    category: '',
    status: '',
    reachLevel: '',
    missingOnly: false,
    search: '',
    dateFrom: '',
    dateTo: ''
  },
  importValidationResult: null,
  pendingFormFiles: []
};

function getRoleLabel(role) {
  const isEl = state.currentLang === 'el';
  switch (role) {
    case 'SUPER_ADMIN':
      return isEl ? 'Α. Κεντρικός Διαχειριστής (Super Admin)' : 'A. Super Administrator (TIHC Central Admin)';
    case 'DISSEMINATION_MANAGER':
      return isEl ? 'Β. Dissemination Manager (TIHC)' : 'B. Dissemination Manager (TIHC)';
    case 'PARTNER_EDITOR':
      return isEl ? 'Γ. Partner Editor (Εταίρος)' : 'C. Partner Editor (Organisation)';
    case 'REVIEWER':
      return isEl ? 'Δ. Reviewer / Viewer (Ελεγκτής)' : 'D. Reviewer / Viewer (Auditor)';
    default:
      return role;
  }
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(msg) {
  const root = document.getElementById('toastRoot');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 4000);
}

function setLanguage(lang) {
  state.currentLang = lang === 'el' ? 'el' : 'en';
  localStorage.setItem('tihc_lang', state.currentLang);

  const btnEn = document.getElementById('btnLangEn');
  const btnEl = document.getElementById('btnLangEl');
  if (btnEn && btnEl) {
    if (state.currentLang === 'en') {
      btnEn.style.background = '#ffffff';
      btnEn.style.color = '#1e3a8a';
      btnEl.style.background = 'rgba(255,255,255,0.15)';
      btnEl.style.color = '#ffffff';
    } else {
      btnEl.style.background = '#ffffff';
      btnEl.style.color = '#1e3a8a';
      btnEn.style.background = 'rgba(255,255,255,0.15)';
      btnEn.style.color = '#ffffff';
    }
  }

  // Header localized labels
  const hMain = document.getElementById('headerMainTitle');
  const hSub = document.getElementById('headerSubTitle');
  const lblProj = document.getElementById('lblProjectSelector');
  const lblUser = document.getElementById('lblUserRoleSelector');
  if (hMain) hMain.textContent = t('platformTitle');
  if (hSub) hSub.textContent = t('platformSubtitle');
  if (lblProj) lblProj.textContent = t('activeProject');
  if (lblUser) lblUser.textContent = t('activeRole');

  renderHeaderAndNav();
  renderMainView();
}

async function apiFetch(url, options = {}) {
  const headers = {
    ...(options.headers || {}),
    'x-user-id': String(state.currentUserId),
    'x-auth-token': state.authToken || ''
  };
  if (options.body && typeof options.body === 'object') {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  const res = await fetch(url, { ...options, headers });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Server error / Σφάλμα διακομιστή');
  }
  return data;
}

async function loadBootstrap() {
  try {
    const data = await apiFetch(`/api/bootstrap?projectId=${state.currentProjectId}&userId=${state.currentUserId}`);
    state.bootstrap = data;
    if (data.activeProject) {
      state.currentProjectId = data.activeProject.id;
    }
    renderHeaderAndNav();
    renderMainView();
  } catch (err) {
    showToast(err.message);
  }
}

function renderHeaderAndNav() {
  if (!state.bootstrap) return;
  const { user, users, projects, activeProject, activities, partnerPendingMatrix } = state.bootstrap;

  // Project Selector
  const projSel = document.getElementById('projectSelector');
  if (projSel) {
    projSel.innerHTML = projects.map(p =>
      `<option value="${p.id}" ${p.id === state.currentProjectId ? 'selected' : ''}>${escapeHtml(p.acronym)} — ${escapeHtml(p.project_number)}</option>`
    ).join('');
    projSel.onchange = e => {
      state.currentProjectId = Number(e.target.value);
      state.filters.partnerId = '';
      loadBootstrap();
    };
  }

  // User Role Selector
  const userSel = document.getElementById('userRoleSelector');
  if (userSel) {
    userSel.innerHTML = users.map(u =>
      `<option value="${u.id}" ${u.id === user.id ? 'selected' : ''}>${escapeHtml(u.full_name)} [${u.role}]</option>`
    ).join('');
    userSel.onchange = e => {
      state.currentUserId = Number(e.target.value);
      loadBootstrap();
      showToast(`${t('currentSession')}: ${userSel.options[userSel.selectedIndex].text}`);
    };
  }

  // Auth Button
  const authBtn = document.getElementById('authBtn');
  if (authBtn) {
    authBtn.innerHTML = state.authToken ? `🚪 ${t('logout')}` : `🔐 ${t('login')}`;
  }

  // Active Role Badge
  const roleBadge = document.getElementById('activeRoleBadge');
  if (roleBadge) {
    roleBadge.innerHTML = `🛡️ ${escapeHtml(getRoleLabel(user.role))}${user.partner_code ? ` • ${escapeHtml(user.partner_code)}` : ''}`;
  }

  // Project Context Bar
  const ctxBar = document.getElementById('projectContextBar');
  if (ctxBar) {
    if (!activeProject) {
      ctxBar.innerHTML = `<div class="project-context-inner">No active project found for current user.</div>`;
      return;
    }

    ctxBar.innerHTML = `
      <div class="project-context-inner">
        <div class="proj-meta-items">
          <span class="proj-badge">${escapeHtml(activeProject.acronym)}</span>
          <span><strong>${t('projectCode')}:</strong> ${escapeHtml(activeProject.project_number)}</span>
          <span><strong>${t('coordinator')}:</strong> ${escapeHtml(activeProject.coordinator_name)}</span>
          <span><strong>${t('disseminationLeader')}:</strong> ${escapeHtml(activeProject.dissemination_leader)}</span>
          <span><strong>${t('duration')}:</strong> ${escapeHtml(activeProject.start_date)} ${t('to')} ${escapeHtml(activeProject.end_date)}</span>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          ${(user.role === 'SUPER_ADMIN' || user.role === 'DISSEMINATION_MANAGER') ? `
            <button class="btn btn-sm btn-outline" onclick="openNewProjectModal()">${t('newProjectFromTemplate')}</button>
          ` : ''}
          <button class="btn btn-sm btn-primary" onclick="startNewActivity()">${t('newActivityBtn')}</button>
        </div>
      </div>
    `;
  }

  // Navigation Tabs with dynamic localized titles
  const totalMissingEv = partnerPendingMatrix.reduce((s, p) => s + p.missing_evidence_count, 0);
  const totalNeedsRev = partnerPendingMatrix.reduce((s, p) => s + p.needs_revision_count, 0);

  const tabs = [
    { id: 'dashboard', label: t('tabDashboard'), badge: activities.length, badgeClass: '' },
    { id: 'pending_matrix', label: t('tabPendingMatrix'), badge: totalMissingEv + totalNeedsRev, badgeClass: 'danger' },
    { id: 'activities', label: t('tabActivities'), badge: activities.length, badgeClass: '' },
    { id: 'form', label: state.editingActivityId ? t('tabFormEdit') : t('tabForm'), badge: null, badgeClass: '' },
    { id: 'kpis', label: t('tabKpis'), badge: state.bootstrap.kpis.length, badgeClass: '' },
    { id: 'exports', label: t('tabExports'), badge: null, badgeClass: '' },
    { id: 'import', label: t('tabImport'), badge: null, badgeClass: '' },
    { id: 'admin', label: t('tabAdmin'), badge: state.bootstrap.auditLogs.length, badgeClass: '' }
  ];

  const navContainer = document.getElementById('mainNavTabs');
  if (navContainer) {
    navContainer.innerHTML = tabs.map(tItem => `
      <button class="nav-tab ${state.activeTab === tItem.id ? 'active' : ''}" onclick="switchTab('${tItem.id}')">
        <span>${tItem.label}</span>
        ${tItem.badge !== null ? `<span class="nav-badge ${tItem.badgeClass}">${tItem.badge}</span>` : ''}
      </button>
    `).join('');
  }
}

function switchTab(tabId) {
  if (tabId !== 'form') {
    state.editingActivityId = null;
  }
  state.activeTab = tabId;
  renderHeaderAndNav();
  renderMainView();
}

function startNewActivity() {
  state.editingActivityId = null;
  state.pendingFormFiles = [];
  state.activeTab = 'form';
  renderHeaderAndNav();
  renderMainView();
}

function getFilteredActivities() {
  if (!state.bootstrap) return [];
  const { activities } = state.bootstrap;
  const f = state.filters;

  return activities.filter(a => {
    if (f.partnerId && String(a.partner_id) !== String(f.partnerId)) return false;
    if (f.category && a.activity_type !== f.category) return false;
    if (f.status && a.status !== f.status) return false;
    if (f.reachLevel && !a.reach_levels.includes(f.reachLevel)) return false;
    if (f.missingOnly && a.missing_evidence_flag !== 1 && a.status !== 'Needs Revision') return false;
    if (f.dateFrom && a.activity_date < f.dateFrom) return false;
    if (f.dateTo && a.activity_date > f.dateTo) return false;
    if (f.search) {
      const q = f.search.toLowerCase();
      const hay = `${a.activity_code} ${a.title} ${a.description} ${a.partner_name} ${a.raw_target_groups} ${a.evidence_url}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderFilterBarHTML(showSearch = true) {
  const { partners, activeProject } = state.bootstrap;
  const f = state.filters;
  return `
    <div class="filter-bar">
      ${showSearch ? `
        <div class="filter-item" style="min-width:210px;">
          <label>${t('searchPlaceholder')}</label>
          <input type="text" class="form-control" placeholder="${t('searchPlaceholder')}" value="${escapeHtml(f.search)}" oninput="updateFilter('search', this.value)">
        </div>
      ` : ''}
      <div class="filter-item">
        <label>${t('partnerCol')}</label>
        <select class="form-select" onchange="updateFilter('partnerId', this.value)">
          <option value="">${t('allPartners')} (${partners.length})</option>
          ${partners.map(p => `<option value="${p.id}" ${String(f.partnerId) === String(p.id) ? 'selected' : ''}>${escapeHtml(p.name)} (${escapeHtml(p.country_code)})</option>`).join('')}
        </select>
      </div>
      <div class="filter-item">
        <label>${t('fieldType')}</label>
        <select class="form-select" onchange="updateFilter('category', this.value)">
          <option value="">${t('allCategories')}</option>
          ${activeProject.categories.map(c => `<option value="${escapeHtml(c)}" ${f.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
        </select>
      </div>
      <div class="filter-item">
        <label>${t('colStatus')}</label>
        <select class="form-select" onchange="updateFilter('status', this.value)">
          <option value="">${t('allStatuses')}</option>
          <option value="Approved" ${f.status === 'Approved' ? 'selected' : ''}>${t('statusApproved')}</option>
          <option value="Submitted" ${f.status === 'Submitted' ? 'selected' : ''}>${t('statusSubmitted')}</option>
          <option value="Needs Revision" ${f.status === 'Needs Revision' ? 'selected' : ''}>${t('statusNeedsRevision')}</option>
          <option value="Draft" ${f.status === 'Draft' ? 'selected' : ''}>${t('statusDraft')}</option>
        </select>
      </div>
      <div class="filter-item">
        <label>${t('reachLevelLabel')}</label>
        <select class="form-select" onchange="updateFilter('reachLevel', this.value)">
          <option value="">${t('allLevels')}</option>
          <option value="European" ${f.reachLevel === 'European' ? 'selected' : ''}>${t('levelEuropean')}</option>
          <option value="National" ${f.reachLevel === 'National' ? 'selected' : ''}>${t('levelNational')}</option>
          <option value="Local" ${f.reachLevel === 'Local' ? 'selected' : ''}>${t('levelLocal')}</option>
        </select>
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        <label style="display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:600; cursor:pointer; padding:7px 10px; background:#fff; border:1px solid var(--border-strong); border-radius:6px;">
          <input type="checkbox" ${f.missingOnly ? 'checked' : ''} onchange="updateFilter('missingOnly', this.checked)">
          <span>${t('missingEvidenceOnly')}</span>
        </label>
        <button class="btn btn-outline btn-sm" onclick="resetFilters()">${t('clearFilters')}</button>
      </div>
    </div>
  `;
}

function updateFilter(key, val) {
  state.filters[key] = val;
  renderMainView();
}

function resetFilters() {
  state.filters = {
    partnerId: '',
    category: '',
    status: '',
    reachLevel: '',
    missingOnly: false,
    search: '',
    dateFrom: '',
    dateTo: ''
  };
  renderMainView();
}

function jumpToPartnerActivities(partnerId, statusFilter = '', missingOnly = false) {
  state.filters.partnerId = String(partnerId || '');
  state.filters.status = statusFilter;
  state.filters.missingOnly = missingOnly;
  state.activeTab = 'activities';
  renderHeaderAndNav();
  renderMainView();
}

function renderMainView() {
  const container = document.getElementById('mainViewContainer');
  if (!state.bootstrap || !state.bootstrap.activeProject) {
    container.innerHTML = `<div class="card">No project data available.</div>`;
    return;
  }

  switch (state.activeTab) {
    case 'dashboard':
      container.innerHTML = renderDashboardView();
      break;
    case 'pending_matrix':
      container.innerHTML = renderPendingMatrixView();
      break;
    case 'activities':
      container.innerHTML = renderActivitiesLogView();
      break;
    case 'form':
      container.innerHTML = renderActivityFormView();
      const catEl = document.getElementById('f_activity_type');
      if (catEl) handleAdaptiveCategoryChange(catEl.value);
      break;
    case 'kpis':
      container.innerHTML = renderKpisView();
      break;
    case 'exports':
      container.innerHTML = renderExportsView();
      break;
    case 'import':
      container.innerHTML = renderImportView();
      break;
    case 'admin':
      container.innerHTML = renderAdminView();
      break;
    default:
      container.innerHTML = renderDashboardView();
  }
}

/* ============================================================================
   1. DASHBOARD VIEW (Section 6)
   ============================================================================ */
function renderDashboardView() {
  const acts = getFilteredActivities();
  const { partnerPendingMatrix, kpis } = state.bootstrap;

  const approvedCount = acts.filter(a => a.status === 'Approved').length;
  const missingEvCount = acts.filter(a => a.missing_evidence_flag === 1).length;
  const needsRevCount = acts.filter(a => a.status === 'Needs Revision').length;

  const totalReach = acts.reduce((s, a) => s + (Number(a.metric_reach) || 0), 0);
  const totalViews = acts.reduce((s, a) => s + (Number(a.metric_views) || 0), 0);
  const totalImpressions = acts.reduce((s, a) => s + (Number(a.metric_impressions) || 0), 0);
  const totalLikes = acts.reduce((s, a) => s + (Number(a.metric_likes) || 0) + (Number(a.metric_comments) || 0) + (Number(a.metric_shares) || 0), 0);
  const totalParticipants = acts.reduce((s, a) => s + (Number(a.metric_event_participants) || 0), 0);
  const totalNewsletter = acts.reduce((s, a) => s + (Number(a.metric_newsletter_recipients) || 0), 0);

  const catCounts = {};
  for (const a of acts) {
    catCounts[a.activity_type] = (catCounts[a.activity_type] || 0) + 1;
  }
  const sortedCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);

  const monthCounts = {};
  for (const a of acts) {
    const ym = (a.activity_date || '').slice(0, 7) || 'Unknown';
    monthCounts[ym] = (monthCounts[ym] || 0) + 1;
  }
  const sortedMonths = Object.entries(monthCounts).sort((a, b) => a[0].localeCompare(b[0]));

  return `
    ${renderFilterBarHTML(false)}

    <div class="alert-banner alert-info">
      <div>ℹ️</div>
      <div>
        <strong>${t('separatedMetricsNotice')}</strong>
      </div>
    </div>

    <!-- Separated Metric Cards -->
    <div class="stats-grid">
      <div class="stat-card clickable" onclick="switchTab('activities')">
        <div class="stat-label">${t('totalActivities')}</div>
        <div class="stat-value">${acts.length}</div>
        <div class="stat-meta">✅ <strong>${approvedCount}</strong> ${t('approved')} • 🔄 <strong>${acts.length - approvedCount}</strong> ${t('pendingReview')}</div>
      </div>

      <div class="stat-card accent">
        <div class="stat-label">${t('socialReach')}</div>
        <div class="stat-value">${totalReach.toLocaleString()}</div>
        <div class="stat-meta">${t('socialReachSub')}</div>
      </div>

      <div class="stat-card purple">
        <div class="stat-label">${t('viewsMetrics')}</div>
        <div class="stat-value">${totalViews.toLocaleString()}</div>
        <div class="stat-meta">+ <strong>${totalImpressions.toLocaleString()}</strong> Impressions • <strong>${totalLikes.toLocaleString()}</strong> Interactions</div>
      </div>

      <div class="stat-card success">
        <div class="stat-label">${t('eventParticipants')}</div>
        <div class="stat-value">${totalParticipants.toLocaleString()}</div>
        <div class="stat-meta">${t('eventParticipantsSub')}</div>
      </div>

      <div class="stat-card warning">
        <div class="stat-label">${t('newsletterRecipients')}</div>
        <div class="stat-value">${totalNewsletter.toLocaleString()}</div>
        <div class="stat-meta">${t('newsletterRecipientsSub')}</div>
      </div>

      <div class="stat-card danger clickable" onclick="jumpToPartnerActivities('', '', true)">
        <div class="stat-label">${t('activitiesWithMissingEvidence')}</div>
        <div class="stat-value" style="color:var(--danger);">${missingEvCount}</div>
        <div class="stat-meta">⚠️ <strong>${needsRevCount}</strong> ${t('needsRevisionCount')}</div>
      </div>
    </div>

    <!-- Quick Partner Pending Widget -->
    <div class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">${t('pendingMatrixTitle')}</h2>
          <p class="card-subtitle">${t('pendingMatrixSubtitle')}</p>
        </div>
        <button class="btn btn-primary btn-sm" onclick="switchTab('pending_matrix')">${t('fullPendingScreenBtn')}</button>
      </div>

      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>${t('partnerCol')}</th>
              <th>${t('countryRoleCol')}</th>
              <th>${t('activitiesCol')}</th>
              <th>${t('approvedCol')}</th>
              <th>${t('missingEvidenceCol')}</th>
              <th>${t('needsReviewRevCol')}</th>
              <th>${t('partnerStatusCol')}</th>
              <th>${t('quickActionCol')}</th>
            </tr>
          </thead>
          <tbody>
            ${partnerPendingMatrix.map(pm => `
              <tr>
                <td>
                  <div style="display:flex; align-items:center; gap:10px;">
                    ${pm.logo_url ? `<img src="${pm.logo_url}" style="width:32px; height:32px; object-fit:contain; border-radius:4px; border:1px solid #e2e8f0; background:#fff; padding:2px;">` : ''}
                    <div>
                      <strong>${escapeHtml(pm.partner_name)}</strong>
                      <div style="font-size:11px; color:var(--text-light);">${escapeHtml(pm.full_name || '')}</div>
                    </div>
                  </div>
                </td>
                <td><strong>${escapeHtml(pm.country)}</strong> (${escapeHtml(pm.country_code)})<br><small style="color:var(--text-light);">${escapeHtml(pm.role)}</small></td>
                <td><span class="num-pill info" onclick="jumpToPartnerActivities(${pm.partner_id})">${pm.total_activities}</span></td>
                <td><span class="num-pill zero" onclick="jumpToPartnerActivities(${pm.partner_id}, 'Approved')">${pm.approved_count}</span></td>
                <td>
                  <span class="num-pill ${pm.missing_evidence_count > 0 ? 'alert' : 'zero'}" onclick="jumpToPartnerActivities(${pm.partner_id}, '', true)">
                    ${pm.missing_evidence_count}
                  </span>
                </td>
                <td>
                  <span class="num-pill ${(pm.needs_revision_count + pm.needs_review_count) > 0 ? 'warn' : 'zero'}" onclick="jumpToPartnerActivities(${pm.partner_id}, 'Needs Revision')">
                    ${pm.needs_revision_count + pm.needs_review_count}
                  </span>
                </td>
                <td>
                  ${pm.missing_evidence_count === 0 && pm.needs_revision_count === 0
                    ? `<span class="status-badge status-Approved">${t('statusComplete')}</span>`
                    : `<span class="status-badge status-NeedsRevision">${t('statusPendingItems')} (${pm.missing_evidence_count})</span>`
                  }
                </td>
                <td>
                  <div style="display:flex; gap:6px;">
                    <button class="btn btn-sm btn-outline" onclick="jumpToPartnerActivities(${pm.partner_id})">${t('viewActivitiesBtn')}</button>
                    ${pm.missing_evidence_count > 0 || pm.needs_revision_count > 0 ? `
                      <button class="btn btn-sm btn-warning" onclick="openReminderModal(${pm.partner_id})">${t('sendReminderBtn')}</button>
                    ` : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Charts Grid -->
    <div class="dashboard-charts-grid">
      <div class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">${t('chartPartnerDistribution')}</h3>
            <p class="card-subtitle">${t('chartPartnerSub')}</p>
          </div>
        </div>
        ${partnerPendingMatrix.map(pm => {
          const maxTotal = Math.max(...partnerPendingMatrix.map(x => x.total_activities), 1);
          const okPct = Math.round((pm.approved_count / maxTotal) * 100);
          const pendPct = Math.round(((pm.total_activities - pm.approved_count) / maxTotal) * 100);
          return `
            <div class="bar-row">
              <div class="bar-row-label">
                <span>${escapeHtml(pm.partner_name)} (${escapeHtml(pm.country_code)})</span>
                <span><strong>${pm.total_activities}</strong> (${pm.approved_count} app. / ${pm.missing_evidence_count} missing)</span>
              </div>
              <div class="bar-track">
                <div class="bar-fill-success" style="width:${okPct}%" title="Approved: ${pm.approved_count}"></div>
                <div class="bar-fill-warning" style="width:${pendPct}%" title="Pending: ${pm.total_activities - pm.approved_count}"></div>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">${t('chartCategoryDistribution')}</h3>
            <p class="card-subtitle">${t('chartCategorySub')}</p>
          </div>
        </div>
        ${sortedCats.map(([catName, count]) => {
          const pct = acts.length > 0 ? Math.round((count / acts.length) * 100) : 0;
          return `
            <div class="bar-row">
              <div class="bar-row-label">
                <span>${escapeHtml(catName)}</span>
                <span><strong>${count}</strong> (${pct}%)</span>
              </div>
              <div class="bar-track">
                <div class="bar-fill-primary" style="width:${pct}%"></div>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">${t('chartMonthlyTimeline')}</h3>
            <p class="card-subtitle">${t('chartMonthlySub')}</p>
          </div>
        </div>
        ${sortedMonths.slice(0, 12).map(([ym, count]) => {
          const maxM = Math.max(...sortedMonths.map(x => x[1]), 1);
          const pct = Math.round((count / maxM) * 100);
          return `
            <div class="bar-row">
              <div class="bar-row-label">
                <span><strong>${escapeHtml(ym)}</strong></span>
                <span><strong>${count}</strong> activities</span>
              </div>
              <div class="bar-track">
                <div class="bar-fill-primary" style="width:${pct}%; background:#0284c7;"></div>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">${t('chartKpiOverview')}</h3>
            <p class="card-subtitle">${t('chartKpiSub')}</p>
          </div>
          <button class="btn btn-sm btn-outline" onclick="switchTab('kpis')">${t('viewAllKpis')}</button>
        </div>
        ${kpis.map(k => `
          <div class="bar-row">
            <div class="bar-row-label">
              <span><strong>${escapeHtml(k.code)}:</strong> ${escapeHtml(k.title)}</span>
              <span><strong>${k.recorded_value.toLocaleString()}</strong> / ${k.target_value.toLocaleString()} (${k.percentage}%)</span>
            </div>
            <div class="bar-track">
              <div class="${k.percentage >= 100 ? 'bar-fill-success' : 'bar-fill-primary'}" style="width:${Math.min(100, k.percentage)}%"></div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

/* ============================================================================
   2. PARTNER PENDING MATRIX VIEW (Section 4 Addendum)
   ============================================================================ */
function renderPendingMatrixView() {
  const { partnerPendingMatrix, activities } = state.bootstrap;

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">${t('pendingMatrixTitle')}</h2>
          <p class="card-subtitle">${t('pendingMatrixSubtitle')}</p>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-warning" onclick="openReminderModal(null)">${t('massReminderBtn')}</button>
        </div>
      </div>

      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>${t('partnerCol')}</th>
              <th>${t('countryRoleCol')}</th>
              <th>${t('activitiesCol')}</th>
              <th>${t('missingEvidenceCol')}</th>
              <th>${t('needsReviewRevCol')}</th>
              <th>${t('approvedCol')}</th>
              <th>Total Reach / Views / Partic.</th>
              <th>${t('quickActionCol')}</th>
            </tr>
          </thead>
          <tbody>
            ${partnerPendingMatrix.map(pm => `
              <tr>
                <td>
                  <div style="display:flex; align-items:center; gap:10px;">
                    ${pm.logo_url ? `<img src="${pm.logo_url}" style="width:36px; height:36px; object-fit:contain; border-radius:6px; border:1px solid #cbd5e1; padding:2px;">` : ''}
                    <div>
                      <strong style="font-size:14px;">${escapeHtml(pm.partner_name)}</strong>
                      <div style="font-size:11.5px; color:var(--text-muted);">${escapeHtml(pm.contact_person)} • ${escapeHtml(pm.contact_email)}</div>
                    </div>
                  </div>
                </td>
                <td><strong>${escapeHtml(pm.country)}</strong> (${escapeHtml(pm.country_code)})</td>
                <td><span class="num-pill info" onclick="jumpToPartnerActivities(${pm.partner_id})">${pm.total_activities}</span></td>
                <td>
                  <span class="num-pill ${pm.missing_evidence_count > 0 ? 'alert' : 'zero'}" onclick="jumpToPartnerActivities(${pm.partner_id}, '', true)">
                    ${pm.missing_evidence_count}
                  </span>
                </td>
                <td>
                  <span class="num-pill ${(pm.needs_revision_count + pm.needs_review_count) > 0 ? 'warn' : 'zero'}" onclick="jumpToPartnerActivities(${pm.partner_id}, 'Needs Revision')">
                    ${pm.needs_revision_count + pm.needs_review_count}
                  </span>
                </td>
                <td>
                  <span class="num-pill zero" onclick="jumpToPartnerActivities(${pm.partner_id}, 'Approved')">
                    ${pm.approved_count}
                  </span>
                </td>
                <td>
                  <div style="font-size:12px;">
                    Reach: <strong>${pm.total_reach.toLocaleString()}</strong> |
                    Views: <strong>${pm.total_views.toLocaleString()}</strong> |
                    Partic.: <strong>${pm.total_participants.toLocaleString()}</strong>
                  </div>
                </td>
                <td>
                  <div style="display:flex; gap:6px; flex-wrap:wrap;">
                    <button class="btn btn-sm btn-outline" onclick="jumpToPartnerActivities(${pm.partner_id}, '', true)">🔍 View Missing</button>
                    <button class="btn btn-sm btn-warning" onclick="openReminderModal(${pm.partner_id})">${t('sendReminderBtn')}</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">${t('detailedPendingBreakdownTitle')}</h3>
          <p class="card-subtitle">${t('detailedPendingBreakdownSubtitle')}</p>
        </div>
      </div>

      ${partnerPendingMatrix.filter(pm => pm.missing_evidence_count > 0 || pm.needs_revision_count > 0 || pm.warnings_count > 0).map(pm => {
        const problematicActs = activities.filter(a => a.partner_id === pm.partner_id && (a.missing_evidence_flag === 1 || a.status === 'Needs Revision' || a.validation_warnings.length > 0));
        return `
          <div style="border:1px solid var(--border-strong); border-radius:8px; padding:14px; margin-bottom:16px; background:#f8fafc;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <div>
                <strong style="font-size:14.5px; color:var(--primary);">${escapeHtml(pm.partner_name)} (${escapeHtml(pm.country)})</strong>
                <span style="margin-left:10px; font-size:12.5px; color:var(--danger); font-weight:700;">
                  ⚠️ ${problematicActs.length} activities with pending items
                </span>
              </div>
              <button class="btn btn-sm btn-warning" onclick="openReminderModal(${pm.partner_id})">✉️ Send Reminder to ${escapeHtml(pm.partner_name)}</button>
            </div>
            <div class="table-responsive">
              <table class="data-table" style="background:#fff;">
                <thead>
                  <tr>
                    <th style="width:95px;">Activity ID</th>
                    <th style="width:110px;">Date (Excel)</th>
                    <th style="width:170px;">Type</th>
                    <th>Title & Description</th>
                    <th>Identified Missing Items / Warnings</th>
                    <th style="width:110px;">Status</th>
                    <th style="width:95px;">Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${problematicActs.slice(0, 12).map(a => `
                    <tr>
                      <td><strong>${escapeHtml(a.activity_code)}</strong><br><small style="color:#64748b">Row ${a.excel_row_num}</small></td>
                      <td>${escapeHtml(a.activity_date)}<br><small style="color:#64748b">${escapeHtml(a.raw_date_string)}</small></td>
                      <td>${escapeHtml(a.activity_type)}</td>
                      <td><strong>${escapeHtml(a.title)}</strong></td>
                      <td>
                        ${a.validation_warnings.map(w => `<div style="color:#b91c1c; font-size:12px;">• ${escapeHtml(w)}</div>`).join('')}
                      </td>
                      <td><span class="status-badge status-${a.status.replace(/\s+/g, '')}">${escapeHtml(a.status)}</span></td>
                      <td>
                        <button class="btn btn-sm btn-primary" onclick="openActivityDetailModal(${a.id})">${t('reviewFilesBtn')}</button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
              ${problematicActs.length > 12 ? `
                <div style="padding:8px; text-align:center; font-size:12.5px;">
                  + ${problematicActs.length - 12} more items —
                  <a href="javascript:void(0)" onclick="jumpToPartnerActivities(${pm.partner_id}, '', true)" style="font-weight:700; color:var(--primary);">View all in activities log →</a>
                </div>
              ` : ''}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

/* ============================================================================
   3. ACTIVITIES LOG & REVIEW WORKFLOW (Sections 4 & 8)
   ============================================================================ */
function renderActivitiesLogView() {
  const acts = getFilteredActivities();
  const { user } = state.bootstrap;
  const canApprove = user.role === 'SUPER_ADMIN' || user.role === 'DISSEMINATION_MANAGER';

  return `
    ${renderFilterBarHTML(true)}

    <div class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">${t('activitiesLogTitle')} (${acts.length} records)</h2>
          <p class="card-subtitle">${t('activitiesLogSubtitle')}</p>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-outline btn-sm" onclick="window.location.href='/api/export/excel?projectId=${state.currentProjectId}&partnerId=${state.filters.partnerId}&category=${encodeURIComponent(state.filters.category)}&status=${encodeURIComponent(state.filters.status)}'">${t('exportCurrentListExcel')}</button>
          <button class="btn btn-primary btn-sm" onclick="startNewActivity()">${t('newActivityBtn')}</button>
        </div>
      </div>

      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:95px;">${t('colActivityId')}</th>
              <th style="width:125px;">${t('colPartnerDate')}</th>
              <th style="width:165px;">${t('colTypeReach')}</th>
              <th>${t('colTitleDescTarget')}</th>
              <th style="width:155px;">${t('colSeparatedMetrics')}</th>
              <th style="width:175px;">${t('colEvidence')}</th>
              <th style="width:115px;">${t('colStatus')}</th>
              <th style="width:130px;">${t('colActions')}</th>
            </tr>
          </thead>
          <tbody>
            ${acts.map(a => {
              const canEditThis = user.role === 'SUPER_ADMIN' || user.role === 'DISSEMINATION_MANAGER' || (user.role === 'PARTNER_EDITOR' && user.partner_code === a.partner_code);
              return `
                <tr>
                  <td>
                    <strong style="color:var(--primary);">${escapeHtml(a.activity_code)}</strong>
                    ${a.excel_row_num ? `<div style="font-size:11px; color:var(--text-light);">Excel #${escapeHtml(a.excel_seq_num || a.excel_row_num)}</div>` : ''}
                  </td>
                  <td>
                    <strong>${escapeHtml(a.partner_name)}</strong>
                    <div style="font-size:12px; color:var(--text-muted);">${escapeHtml(a.activity_date)}</div>
                    ${a.end_date ? `<div style="font-size:11px; color:var(--text-light);">to ${escapeHtml(a.end_date)}</div>` : ''}
                  </td>
                  <td>
                    <div style="font-weight:600; font-size:12.5px;">${escapeHtml(a.activity_type)}</div>
                    ${a.social_platform ? `<span style="font-size:11px; background:#e0f2fe; color:#0369a1; padding:1px 6px; border-radius:4px; font-weight:600;">${escapeHtml(a.social_platform)}</span>` : ''}
                    <div style="margin-top:4px; display:flex; gap:3px; flex-wrap:wrap;">
                      ${a.reach_levels.map(rl => `<span style="font-size:10px; background:#f1f5f9; border:1px solid #cbd5e1; padding:1px 5px; border-radius:4px;">${escapeHtml(rl)}</span>`).join('')}
                    </div>
                  </td>
                  <td>
                    <div style="font-weight:700; color:var(--text-main); margin-bottom:2px;">${escapeHtml(a.title)}</div>
                    <div style="font-size:12px; color:var(--text-muted);">${escapeHtml(a.description.length > 140 ? a.description.substring(0, 140) + '...' : a.description)}</div>
                    <div style="font-size:11px; color:var(--text-light); margin-top:4px;">
                      <strong>Target:</strong> ${escapeHtml(a.raw_target_groups || a.target_groups.join(', '))}
                    </div>
                    ${a.validation_warnings.length > 0 ? `
                      <div style="margin-top:5px; padding:4px 8px; background:#fffbeb; border-left:3px solid #f59e0b; font-size:11px; color:#92400e;">
                        ⚠️ ${escapeHtml(a.validation_warnings[0])}
                      </div>
                    ` : ''}
                  </td>
                  <td>
                    <div style="font-size:12px; line-height:1.45;">
                      ${a.metric_reach > 0 ? `<div>Reach: <strong>${a.metric_reach.toLocaleString()}</strong></div>` : ''}
                      ${a.metric_views > 0 ? `<div>Views: <strong>${a.metric_views.toLocaleString()}</strong></div>` : ''}
                      ${a.metric_impressions > 0 ? `<div>Impr.: <strong>${a.metric_impressions.toLocaleString()}</strong></div>` : ''}
                      ${a.metric_likes > 0 ? `<div>Likes: <strong>${a.metric_likes.toLocaleString()}</strong></div>` : ''}
                      ${a.metric_shares > 0 ? `<div>Shares: <strong>${a.metric_shares.toLocaleString()}</strong></div>` : ''}
                      ${a.metric_event_participants > 0 ? `<div>Partic.: <strong>${a.metric_event_participants.toLocaleString()}</strong></div>` : ''}
                      ${a.metric_newsletter_recipients > 0 ? `<div>Newslet.: <strong>${a.metric_newsletter_recipients.toLocaleString()}</strong></div>` : ''}
                      ${(!a.metric_reach && !a.metric_views && !a.metric_impressions && !a.metric_event_participants && !a.metric_newsletter_recipients)
                        ? `<span style="color:var(--danger); font-size:11.5px; font-weight:600;">⚠️ ${escapeHtml(a.legacy_numbers_reached_raw || 'No metrics')}</span>`
                        : ''}
                    </div>
                  </td>
                  <td>
                    ${a.evidence_url ? `
                      <div style="margin-bottom:6px;">
                        <a href="${escapeHtml(a.evidence_url)}" target="_blank" rel="noopener" style="font-size:11.5px; color:var(--primary-hover); font-weight:600; text-decoration:underline;">
                          ${t('openUrlLink')}
                        </a>
                      </div>
                    ` : `<div style="font-size:11px; color:#94a3b8; margin-bottom:4px;">${t('noUrl')}</div>`}
                    ${a.evidence_files.length > 0 ? `
                      <div class="thumb-list">
                        ${a.evidence_files.map(ev => `
                          <img src="${escapeHtml(ev.file_path)}" class="thumb-img" title="${escapeHtml(ev.original_name)} (v${ev.version})" onclick="openEvidencePreviewModal('${escapeHtml(ev.file_path)}', '${escapeHtml(ev.original_name)}', ${ev.version}, '${escapeHtml(ev.version_notes || '')}')">
                        `).join('')}
                      </div>
                    ` : `
                      <span style="font-size:11px; color:var(--danger); font-weight:600;">${t('missingScreenshot')}</span>
                    `}
                  </td>
                  <td>
                    <span class="status-badge status-${a.status.replace(/\s+/g, '')}">${escapeHtml(a.status)}</span>
                    ${a.comments.length > 0 ? `<div style="font-size:11px; color:var(--text-light); margin-top:4px;">💬 ${a.comments.length} ${t('commentsCount')}</div>` : ''}
                  </td>
                  <td>
                    <div style="display:flex; flex-direction:column; gap:5px;">
                      <button class="btn btn-sm btn-primary" onclick="openActivityDetailModal(${a.id})">${t('reviewFilesBtn')}</button>
                      ${canEditThis ? `<button class="btn btn-sm btn-outline" onclick="editActivity(${a.id})">${t('editBtn')}</button>` : ''}
                      ${canApprove && a.status !== 'Approved' ? `
                        <button class="btn btn-sm btn-success" onclick="quickChangeStatus(${a.id}, 'Approved')">${t('approveBtn')}</button>
                      ` : ''}
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/* ============================================================================
   4. ADAPTIVE ACTIVITY REGISTRATION FORM (Sections 4 & 5)
   ============================================================================ */
function editActivity(actId) {
  state.editingActivityId = actId;
  state.pendingFormFiles = [];
  state.activeTab = 'form';
  renderHeaderAndNav();
  renderMainView();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderActivityFormView() {
  const { activeProject, partners, reportingPeriods, activities, user } = state.bootstrap;
  const existing = state.editingActivityId ? activities.find(a => a.id === state.editingActivityId) : null;

  let defaultPartnerId = existing ? existing.partner_id : (partners[0]?.id || 1);
  if (user.role === 'PARTNER_EDITOR' && user.partner_code) {
    const myPartner = partners.find(p => p.code === user.partner_code);
    if (myPartner) defaultPartnerId = myPartner.id;
  }

  const selCat = existing ? existing.activity_type : 'Official project social media';
  const selTargets = existing ? existing.target_groups : ['General Public'];
  const selTargetCounts = existing ? (existing.target_group_counts || {}) : {};
  const selReach = existing ? existing.reach_levels : ['National', 'European'];
  const selCountries = existing ? existing.countries_reached : ['Greece', 'EU-wide'];

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">${existing ? `${t('formEditTitle')}: ${escapeHtml(existing.activity_code)}` : t('formNewTitle')}</h2>
          <p class="card-subtitle">${t('formSubtitle')}</p>
        </div>
        ${existing ? `<button class="btn btn-outline btn-sm" onclick="startNewActivity()">+ ${t('newActivityBtn')}</button>` : ''}
      </div>

      <form id="activityForm" onsubmit="submitActivityForm(event)">
        <!-- SECTION A & B -->
        <div class="form-section">
          <h3 class="form-section-title">
            <span>${t('sectionABTitle')}</span>
            <span style="font-size:12px; color:var(--text-light);">${t('sectionABSub')}</span>
          </h3>

          <div class="form-grid-3">
            <div>
              <label class="stat-label">${t('fieldProject')}</label>
              <input type="text" class="form-control" value="${escapeHtml(activeProject.acronym)} (${escapeHtml(activeProject.project_number)})" disabled style="background:#f1f5f9; font-weight:600;">
            </div>

            <div>
              <label class="stat-label">${t('fieldPartner')}</label>
              <select id="f_partner_id" class="form-select" ${user.role === 'PARTNER_EDITOR' ? 'disabled style="background:#f1f5f9;"' : ''} required>
                ${partners.map(p => `<option value="${p.id}" ${p.id === defaultPartnerId ? 'selected' : ''}>${escapeHtml(p.name)} (${escapeHtml(p.country)})</option>`).join('')}
              </select>
            </div>

            <div>
              <label class="stat-label">${t('fieldActivityId')}</label>
              <input type="text" class="form-control" value="${existing ? escapeHtml(existing.activity_code) : 'Auto-generated upon save'}" disabled style="background:#f1f5f9; font-weight:700; color:var(--primary);">
            </div>

            <div>
              <label class="stat-label">${t('fieldDate')}</label>
              <input type="date" id="f_activity_date" class="form-control" value="${existing ? escapeHtml(existing.activity_date) : new Date().toISOString().slice(0, 10)}" required>
            </div>

            <div>
              <label class="stat-label">${t('fieldEndDate')}</label>
              <input type="date" id="f_end_date" class="form-control" value="${existing ? escapeHtml(existing.end_date || '') : ''}">
            </div>

            <div>
              <label class="stat-label">${t('fieldReportingPeriod')}</label>
              <select id="f_reporting_period_id" class="form-select">
                ${reportingPeriods.map(rp => `<option value="${rp.id}" ${(existing && existing.reporting_period_id === rp.id) ? 'selected' : ''}>${escapeHtml(rp.name)}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="form-grid-2" style="margin-top:14px;">
            <div>
              <label class="stat-label">${t('fieldType')}</label>
              <select id="f_activity_type" class="form-select" onchange="handleAdaptiveCategoryChange(this.value)" required>
                ${activeProject.categories.map(c => `<option value="${escapeHtml(c)}" ${selCat === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
              </select>
            </div>

            <div id="otherCategoryContainer" style="display:${selCat === 'Other Dissemination Activity' ? 'block' : 'none'};">
              <label class="stat-label" style="color:var(--danger);">${t('fieldOtherTypePrompt')}</label>
              <input type="text" id="f_activity_type_other" class="form-control" placeholder="e.g., Office Mural / Radio Interview / Podcast..." value="${existing ? escapeHtml(existing.activity_type_other || '') : ''}">
            </div>

            <div>
              <label class="stat-label">${t('fieldResponsible')}</label>
              <input type="text" id="f_responsible_person" class="form-control" value="${existing ? escapeHtml(existing.responsible_person || '') : escapeHtml(user.full_name)}" required>
            </div>
          </div>

          <div style="margin-top:14px;">
            <label class="stat-label">${t('fieldTitle')}</label>
            <input type="text" id="f_title" class="form-control" placeholder="${t('fieldTitlePlaceholder')}" value="${existing ? escapeHtml(existing.title) : ''}" required>
          </div>

          <div style="margin-top:14px;">
            <label class="stat-label">${t('fieldDescription')}</label>
            <textarea id="f_description" class="form-control" rows="3" placeholder="${t('fieldDescriptionPlaceholder')}" required>${existing ? escapeHtml(existing.description) : ''}</textarea>
          </div>
        </div>

        <!-- SECTION 5: ADAPTIVE CONTEXT FIELDS -->
        <div id="adaptiveContextSection" class="form-section adaptive-highlight"></div>

        <!-- SECTION C: TARGET GROUPS -->
        <div class="form-section">
          <h3 class="form-section-title">
            <span>${t('sectionCTitle')}</span>
            <span style="font-size:12px; color:var(--text-light);">${t('sectionCSub')}</span>
          </h3>

          <div class="checkbox-grid">
            ${activeProject.target_groups.map(tg => {
              const isChecked = selTargets.includes(tg);
              const countVal = selTargetCounts[tg] || '';
              return `
                <div class="checkbox-card">
                  <label style="display:flex; align-items:center; gap:8px; cursor:pointer; flex:1;">
                    <input type="checkbox" name="target_group_cb" value="${escapeHtml(tg)}" ${isChecked ? 'checked' : ''}>
                    <span>${escapeHtml(tg)}</span>
                  </label>
                  <input type="number" min="0" placeholder="Number" data-tg-count="${escapeHtml(tg)}" value="${escapeHtml(countVal)}" title="Optional estimated number reached">
                </div>
              `;
            }).join('')}
          </div>

          <div style="margin-top:14px;">
            <label class="stat-label">${t('fieldStakeholdersReached')}</label>
            <input type="text" id="f_stakeholders_reached" class="form-control" placeholder="${t('fieldStakeholdersPlaceholder')}" value="${existing ? escapeHtml(existing.stakeholders_reached || '') : ''}">
          </div>
        </div>

        <!-- SECTION D: GEOGRAPHIC REACH -->
        <div class="form-section">
          <h3 class="form-section-title">
            <span>${t('sectionDTitle')}</span>
            <span style="font-size:12px; color:var(--text-light);">${t('sectionDSub')}</span>
          </h3>

          <div class="form-grid-2">
            <div>
              <label class="stat-label" style="margin-bottom:8px; display:block;">${t('reachLevelLabel')}</label>
              <div style="display:flex; flex-wrap:wrap; gap:10px;">
                ${['Local', 'Regional', 'National', 'European', 'International'].map(lvl => `
                  <label style="display:inline-flex; align-items:center; gap:6px; padding:7px 12px; border:1px solid var(--border-strong); border-radius:6px; background:#fff; cursor:pointer; font-weight:600;">
                    <input type="checkbox" name="reach_level_cb" value="${lvl}" ${selReach.includes(lvl) ? 'checked' : ''}>
                    <span>${lvl} Level</span>
                  </label>
                `).join('')}
              </div>
            </div>

            <div>
              <label class="stat-label" style="margin-bottom:8px; display:block;">${t('countriesReachedLabel')}</label>
              <div style="display:flex; flex-wrap:wrap; gap:8px;">
                ${['Finland', 'Portugal', 'Greece', 'Türkiye', 'Bulgaria', 'EU-wide', 'International'].map(cnt => `
                  <label style="display:inline-flex; align-items:center; gap:6px; padding:6px 10px; border:1px solid var(--border); border-radius:6px; background:#fff; cursor:pointer; font-size:12.5px;">
                    <input type="checkbox" name="country_cb" value="${cnt}" ${selCountries.includes(cnt) ? 'checked' : ''}>
                    <span>${cnt}</span>
                  </label>
                `).join('')}
              </div>
            </div>
          </div>
        </div>

        <!-- SECTION E: STRICT METRICS -->
        <div class="form-section">
          <h3 class="form-section-title">
            <span>${t('sectionETitle')}</span>
            <span style="font-size:12px; color:var(--primary);">${t('sectionESub')}</span>
          </h3>

          <div class="form-grid-4">
            <div>
              <label class="stat-label">${t('metricReach')}</label>
              <input type="number" min="0" id="f_metric_reach" class="form-control" value="${existing ? existing.metric_reach : 0}">
            </div>
            <div>
              <label class="stat-label">${t('metricViews')}</label>
              <input type="number" min="0" id="f_metric_views" class="form-control" value="${existing ? existing.metric_views : 0}">
            </div>
            <div>
              <label class="stat-label">${t('metricImpressions')}</label>
              <input type="number" min="0" id="f_metric_impressions" class="form-control" value="${existing ? existing.metric_impressions : 0}">
            </div>
            <div>
              <label class="stat-label">${t('metricLikes')}</label>
              <input type="number" min="0" id="f_metric_likes" class="form-control" value="${existing ? existing.metric_likes : 0}">
            </div>
            <div>
              <label class="stat-label">${t('metricComments')}</label>
              <input type="number" min="0" id="f_metric_comments" class="form-control" value="${existing ? existing.metric_comments : 0}">
            </div>
            <div>
              <label class="stat-label">${t('metricShares')}</label>
              <input type="number" min="0" id="f_metric_shares" class="form-control" value="${existing ? existing.metric_shares : 0}">
            </div>
            <div>
              <label class="stat-label">${t('metricClicks')}</label>
              <input type="number" min="0" id="f_metric_clicks" class="form-control" value="${existing ? existing.metric_clicks : 0}">
            </div>
            <div>
              <label class="stat-label">${t('metricNewsletterRec')}</label>
              <input type="number" min="0" id="f_metric_newsletter_recipients" class="form-control" value="${existing ? existing.metric_newsletter_recipients : 0}">
            </div>
            <div>
              <label class="stat-label">${t('metricNewsletterOpens')}</label>
              <input type="number" min="0" id="f_metric_newsletter_opens" class="form-control" value="${existing ? existing.metric_newsletter_opens : 0}">
            </div>
            <div>
              <label class="stat-label">${t('metricParticipants')}</label>
              <input type="number" min="0" id="f_metric_event_participants" class="form-control" value="${existing ? existing.metric_event_participants : 0}">
            </div>
            <div>
              <label class="stat-label">${t('metricOrgs')}</label>
              <input type="number" min="0" id="f_metric_orgs_reached" class="form-control" value="${existing ? existing.metric_orgs_reached : 0}">
            </div>
          </div>
        </div>

        <!-- SECTION F: EVIDENCE FILES & VERSIONING -->
        <div class="form-section">
          <h3 class="form-section-title">
            <span>${t('sectionFTitle')}</span>
            <span style="font-size:12px; color:var(--success);">${t('sectionFSub')}</span>
          </h3>

          <div class="form-grid-2">
            <div>
              <label class="stat-label">${t('fieldEvidenceUrl')}</label>
              <input type="url" id="f_evidence_url" class="form-control" placeholder="https://www.instagram.com/p/... or https://epale.ec.europa.eu/..." value="${existing ? escapeHtml(existing.evidence_url || '') : ''}">
            </div>

            <div>
              <label class="stat-label">${t('fieldEvidenceFiles')}</label>
              <input type="file" id="f_evidence_files" class="form-control" multiple accept="image/*,.pdf" onchange="handleEvidenceFileSelect(event)">
            </div>
          </div>

          <div style="margin-top:10px;">
            <label class="stat-label">${t('fieldVersionNotes')}</label>
            <input type="text" id="f_version_notes" class="form-control" placeholder="e.g., Updated 30-day analytics screenshot / attendance sheet">
          </div>

          <div id="pendingFilesPreview" style="margin-top:12px;"></div>

          ${existing && existing.evidence_files.length > 0 ? `
            <div style="margin-top:14px; padding:12px; background:#f8fafc; border:1px solid var(--border); border-radius:8px;">
              <strong style="font-size:12.5px; display:block; margin-bottom:8px;">Attached Evidence Files in Database (${existing.evidence_files.length} files — Version History Preserved):</strong>
              <div style="display:flex; gap:12px; flex-wrap:wrap;">
                ${existing.evidence_files.map(ev => `
                  <div style="display:flex; align-items:center; gap:8px; background:#fff; padding:6px 10px; border:1px solid #cbd5e1; border-radius:6px;">
                    <img src="${escapeHtml(ev.file_path)}" style="width:42px; height:42px; object-fit:cover; border-radius:4px; cursor:pointer;" onclick="openEvidencePreviewModal('${escapeHtml(ev.file_path)}', '${escapeHtml(ev.original_name)}', ${ev.version}, '${escapeHtml(ev.version_notes || '')}')">
                    <div style="font-size:11.5px;">
                      <strong>v${ev.version} ${ev.is_original ? '(Original)' : '(Version)'}</strong><br>
                      <span>${escapeHtml(ev.original_name)}</span>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          <div style="margin-top:16px; padding:10px 14px; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px;">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:600; color:#166534;">
              <input type="checkbox" id="f_gdpr_consent" ${(!existing || existing.gdpr_consent_verified) ? 'checked' : ''} required>
              <span>${t('gdprConsentLabel')}</span>
            </label>
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; background:#fff; padding:16px 20px; border:1px solid var(--border); border-radius:var(--radius);">
          <div>
            <span class="stat-label">${t('colStatus')}:</span>
            <select id="f_status" class="form-select" style="width:auto; display:inline-block; margin-left:8px; font-weight:700;">
              <option value="Draft" ${existing && existing.status === 'Draft' ? 'selected' : ''}>Draft (Draft / In Progress)</option>
              <option value="Submitted" ${(!existing || existing.status === 'Submitted') ? 'selected' : ''}>Submitted (Submit to Dissemination Manager)</option>
              ${(user.role === 'SUPER_ADMIN' || user.role === 'DISSEMINATION_MANAGER') ? `
                <option value="Needs Revision" ${existing && existing.status === 'Needs Revision' ? 'selected' : ''}>Needs Revision (Return to Partner)</option>
                <option value="Approved" ${existing && existing.status === 'Approved' ? 'selected' : ''}>Approved (Final Approval)</option>
              ` : ''}
            </select>
          </div>

          <div style="display:flex; gap:10px;">
            <button type="button" class="btn btn-outline" onclick="switchTab('activities')">${t('cancelBtn')}</button>
            <button type="submit" class="btn btn-primary">${t('saveActivityBtn')}</button>
          </div>
        </div>
      </form>
    </div>
  `;
}

function handleAdaptiveCategoryChange(category) {
  const otherBox = document.getElementById('otherCategoryContainer');
  if (otherBox) {
    otherBox.style.display = category === 'Other Dissemination Activity' ? 'block' : 'none';
  }

  const adaptiveSec = document.getElementById('adaptiveContextSection');
  if (!adaptiveSec) return;

  const existing = state.editingActivityId
    ? state.bootstrap.activities.find(a => a.id === state.editingActivityId)
    : null;

  if (category.includes('social media') || category.includes('Website')) {
    adaptiveSec.innerHTML = `
      <h3 class="form-section-title">
        <span>📱 Social Media / Website Analytics Adaptive Fields (Section 5)</span>
        <span style="font-size:12px; color:#0369a1;">Required: Platform, Measurement Period, Public URL, Reach/Views & Screenshot Analytics</span>
      </h3>
      <div class="form-grid-3">
        <div>
          <label class="stat-label">Social Media Platform *</label>
          <select id="f_social_platform" class="form-select">
            ${['Instagram', 'Facebook', 'LinkedIn', 'YouTube', 'X / Twitter', 'TikTok', 'Organisation Website', 'EPALE Platform'].map(p =>
              `<option value="${p}" ${(existing && existing.social_platform === p) ? 'selected' : ''}>${p}</option>`
            ).join('')}
          </select>
        </div>
        <div>
          <label class="stat-label">Measurement Period</label>
          <input type="text" id="f_measurement_period" class="form-control" placeholder="e.g., Post Lifetime or Last 90 days" value="${existing ? escapeHtml(existing.measurement_period || 'Post Lifetime') : 'Post Lifetime'}">
        </div>
        <div>
          <label class="stat-label">Analytics Extraction Date</label>
          <input type="date" id="f_analytics_extraction_date" class="form-control" value="${existing ? escapeHtml(existing.analytics_extraction_date || new Date().toISOString().slice(0, 10)) : new Date().toISOString().slice(0, 10)}">
        </div>
      </div>
    `;
  } else if (category.includes('Newsletter')) {
    adaptiveSec.innerHTML = `
      <h3 class="form-section-title">
        <span>📧 Newsletter / Email Campaign Adaptive Fields (Section 5)</span>
        <span style="font-size:12px; color:#0369a1;">Required: Recipients Count, Opens/Clicks, Campaign Link/PDF & Dispatch Confirmation</span>
      </h3>
      <div class="form-grid-2">
        <div>
          <label class="stat-label">Dispatch Tool / Mailing Platform</label>
          <input type="text" id="f_social_platform" class="form-control" placeholder="e.g., Mailchimp / Brevo / Website Mailing List" value="${existing ? escapeHtml(existing.social_platform || 'Email Campaign') : 'Email Campaign'}">
        </div>
        <div>
          <label class="stat-label">Newsletter Issue / Campaign Name</label>
          <input type="text" id="f_measurement_period" class="form-control" placeholder="e.g., 1st Project Newsletter (M1-M6)" value="${existing ? escapeHtml(existing.measurement_period || '1st Newsletter') : '1st Newsletter'}">
        </div>
      </div>
    `;
  } else if (category.includes('Workshop') || category.includes('Event') || category.includes('Conference') || category.includes('Stakeholder')) {
    adaptiveSec.innerHTML = `
      <h3 class="form-section-title">
        <span>🎤 Event / Workshop / Conference Adaptive Fields (Section 5)</span>
        <span style="font-size:12px; color:#0369a1;">Required: Participants Count, Location, Target Audience, Event Photos & Attendance Signatures</span>
      </h3>
      <div class="form-grid-2">
        <div>
          <label class="stat-label">Event City & Country Location *</label>
          <input type="text" id="f_event_location" class="form-control" placeholder="e.g., Heraklion (DEKK), Lisbon, Tampere, or Online" value="${existing ? escapeHtml(existing.event_location || '') : ''}">
        </div>
        <div>
          <label class="stat-label">Organising Host / Event Context</label>
          <input type="text" id="f_publication_media_outlet" class="form-control" placeholder="e.g., 14th Pancretan Forum / Multiplier Event" value="${existing ? escapeHtml(existing.publication_media_outlet || '') : ''}">
        </div>
      </div>
    `;
  } else {
    adaptiveSec.innerHTML = `
      <h3 class="form-section-title">
        <span>📰 Article / Press Release / Publications Adaptive Fields (Section 5)</span>
        <span style="font-size:12px; color:#0369a1;">Required: Publication Outlet, Date, Public URL & Available Readership Metrics</span>
      </h3>
      <div class="form-grid-2">
        <div>
          <label class="stat-label">Media Outlet / Publication Platform</label>
          <input type="text" id="f_publication_media_outlet" class="form-control" placeholder="e.g., EPALE European Platform / Trade Press / Portal" value="${existing ? escapeHtml(existing.publication_media_outlet || '') : ''}">
        </div>
        <div>
          <label class="stat-label">Analytics Extraction Date</label>
          <input type="date" id="f_analytics_extraction_date" class="form-control" value="${existing ? escapeHtml(existing.analytics_extraction_date || new Date().toISOString().slice(0, 10)) : new Date().toISOString().slice(0, 10)}">
        </div>
      </div>
    `;
  }
}

function handleEvidenceFileSelect(event) {
  const files = Array.from(event.target.files || []);
  state.pendingFormFiles = [];
  const previewContainer = document.getElementById('pendingFilesPreview');
  if (!files.length) {
    if (previewContainer) previewContainer.innerHTML = '';
    return;
  }

  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      state.pendingFormFiles.push({
        name: file.name,
        size: file.size,
        type: file.type,
        fileType: file.type.includes('pdf') ? 'pdf' : 'screenshot',
        dataUrl: e.target.result
      });
      if (previewContainer) {
        previewContainer.innerHTML = `
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            ${state.pendingFormFiles.map(pf => `
              <div style="padding:6px 10px; background:#eff6ff; border:1px solid #93c5fd; border-radius:6px; font-size:12px;">
                📎 <strong>${escapeHtml(pf.name)}</strong> (${Math.round(pf.size / 1024)} KB) — Ready to upload
              </div>
            `).join('')}
          </div>
        `;
      }
    };
    reader.readAsDataURL(file);
  });
}

async function submitActivityForm(event) {
  event.preventDefault();

  const targetGroups = Array.from(document.querySelectorAll('input[name="target_group_cb"]:checked')).map(el => el.value);
  const targetGroupCounts = {};
  document.querySelectorAll('input[data-tg-count]').forEach(inp => {
    const tg = inp.getAttribute('data-tg-count');
    if (inp.value && Number(inp.value) > 0) {
      targetGroupCounts[tg] = Number(inp.value);
    }
  });

  const reachLevels = Array.from(document.querySelectorAll('input[name="reach_level_cb"]:checked')).map(el => el.value);
  const countriesReached = Array.from(document.querySelectorAll('input[name="country_cb"]:checked')).map(el => el.value);
  const versionNotes = document.getElementById('f_version_notes')?.value || '';

  const payload = {
    project_id: state.currentProjectId,
    partner_id: Number(document.getElementById('f_partner_id').value),
    reporting_period_id: Number(document.getElementById('f_reporting_period_id').value) || null,
    activity_date: document.getElementById('f_activity_date').value,
    end_date: document.getElementById('f_end_date').value,
    title: document.getElementById('f_title').value,
    activity_type: document.getElementById('f_activity_type').value,
    activity_type_other: document.getElementById('f_activity_type_other')?.value || '',
    description: document.getElementById('f_description').value,
    responsible_person: document.getElementById('f_responsible_person').value,
    target_groups: targetGroups.length ? targetGroups : ['General Public'],
    target_group_counts: targetGroupCounts,
    stakeholders_reached: document.getElementById('f_stakeholders_reached').value,
    reach_levels: reachLevels.length ? reachLevels : ['National'],
    countries_reached: countriesReached.length ? countriesReached : ['Greece'],
    social_platform: document.getElementById('f_social_platform')?.value || '',
    measurement_period: document.getElementById('f_measurement_period')?.value || '',
    analytics_extraction_date: document.getElementById('f_analytics_extraction_date')?.value || '',
    publication_media_outlet: document.getElementById('f_publication_media_outlet')?.value || '',
    event_location: document.getElementById('f_event_location')?.value || '',
    metric_reach: Number(document.getElementById('f_metric_reach').value) || 0,
    metric_views: Number(document.getElementById('f_metric_views').value) || 0,
    metric_impressions: Number(document.getElementById('f_metric_impressions').value) || 0,
    metric_likes: Number(document.getElementById('f_metric_likes').value) || 0,
    metric_comments: Number(document.getElementById('f_metric_comments').value) || 0,
    metric_shares: Number(document.getElementById('f_metric_shares').value) || 0,
    metric_clicks: Number(document.getElementById('f_metric_clicks').value) || 0,
    metric_newsletter_recipients: Number(document.getElementById('f_metric_newsletter_recipients').value) || 0,
    metric_newsletter_opens: Number(document.getElementById('f_metric_newsletter_opens').value) || 0,
    metric_event_participants: Number(document.getElementById('f_metric_event_participants').value) || 0,
    metric_orgs_reached: Number(document.getElementById('f_metric_orgs_reached').value) || 0,
    evidence_url: document.getElementById('f_evidence_url').value,
    gdpr_consent_verified: document.getElementById('f_gdpr_consent').checked,
    status: document.getElementById('f_status').value,
    uploaded_files: state.pendingFormFiles.map(f => ({ ...f, versionNotes }))
  };

  try {
    if (state.editingActivityId) {
      await apiFetch(`/api/activities/${state.editingActivityId}`, { method: 'PUT', body: payload });
      showToast('Activity updated successfully (original evidence preserved)!');
    } else {
      const res = await apiFetch('/api/activities', { method: 'POST', body: payload });
      showToast(`Activity registered successfully (${res.activityCode})!`);
    }
    state.editingActivityId = null;
    state.pendingFormFiles = [];
    state.activeTab = 'activities';
    await loadBootstrap();
  } catch (err) {
    showToast(err.message);
  }
}

/* ============================================================================
   5. KPI MONITORING VIEW (Section 7)
   ============================================================================ */
function renderKpisView() {
  const { kpis, user } = state.bootstrap;
  const canManage = user.role === 'SUPER_ADMIN' || user.role === 'DISSEMINATION_MANAGER';

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">${t('kpisTitle')}</h2>
          <p class="card-subtitle">${t('kpisSubtitle')}</p>
        </div>
        ${canManage ? `<button class="btn btn-primary btn-sm" onclick="openNewKpiModal()">${t('addNewKpiBtn')}</button>` : ''}
      </div>

      <div class="stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));">
        ${kpis.map(k => {
          const isCompleted = k.percentage >= 100;
          return `
            <div class="card" style="margin-bottom:0; border-top:4px solid ${isCompleted ? '#16a34a' : '#1e3a8a'};">
              <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                <div>
                  <span class="proj-badge">${escapeHtml(k.code)}</span>
                  <h3 style="margin:8px 0 4px 0; font-size:15px;">${escapeHtml(k.title)}</h3>
                </div>
                <span class="status-badge ${isCompleted ? 'status-Approved' : 'status-Submitted'}">
                  ${isCompleted ? t('kpiCompleted') : t('kpiInProgress')} (${k.percentage}%)
                </span>
              </div>
              <p style="font-size:12px; color:var(--text-muted); margin:6px 0 14px 0;">${escapeHtml(k.description || '')}</p>

              <div class="bar-track" style="height:14px; margin-bottom:10px;">
                <div class="${isCompleted ? 'bar-fill-success' : 'bar-fill-primary'}" style="width:${Math.min(100, k.percentage)}%"></div>
              </div>

              <div style="display:flex; justify-content:space-between; font-size:12.5px; color:var(--text-muted);">
                <span>${t('kpiTarget')}: <strong>${k.target_value.toLocaleString()} ${escapeHtml(k.unit)}</strong></span>
                <span>${t('kpiRecorded')}: <strong>${k.recorded_value.toLocaleString()}</strong></span>
                <span>${t('kpiApproved')}: <strong style="color:var(--success);">${k.approved_value.toLocaleString()}</strong></span>
              </div>

              ${canManage ? `
                <div style="margin-top:12px; text-align:right;">
                  <button class="btn btn-sm btn-outline" style="color:var(--danger);" onclick="deleteKpi(${k.id})">🗑️ Delete</button>
                </div>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

async function deleteKpi(id) {
  try {
    await apiFetch(`/api/kpis/${id}`, { method: 'DELETE' });
    showToast('KPI target deleted.');
    loadBootstrap();
  } catch (err) {
    showToast(err.message);
  }
}

/* ============================================================================
   6. EXPORTS VIEW (Section 9)
   ============================================================================ */
function renderExportsView() {
  const { partners, reportingPeriods } = state.bootstrap;

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">${t('exportsTitle')}</h2>
          <p class="card-subtitle">${t('exportsSubtitle')}</p>
        </div>
      </div>

      <div class="filter-bar">
        <div class="filter-item">
          <label>Filter Partner for Export</label>
          <select id="exp_partner" class="form-select">
            <option value="">${t('allPartners')} (Consolidated)</option>
            ${partners.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (${escapeHtml(p.country)})</option>`).join('')}
          </select>
        </div>
        <div class="filter-item">
          <label>${t('fieldReportingPeriod')}</label>
          <select id="exp_period" class="form-select">
            ${reportingPeriods.map(rp => `<option value="${rp.id}">${escapeHtml(rp.name)}</option>`).join('')}
          </select>
        </div>
        <div class="filter-item">
          <label>Activity Status Filter</label>
          <select id="exp_status" class="form-select">
            <option value="">${t('allStatuses')} (Include In-Review)</option>
            <option value="Approved">${t('statusApproved')} Only (Validated Report)</option>
          </select>
        </div>
      </div>

      <div class="stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));">
        <div class="card" style="border-top:4px solid #15803d;">
          <h3 class="card-title">${t('exportExcelCardTitle')}</h3>
          <p style="font-size:13px; color:var(--text-muted); margin:10px 0 18px 0;">${t('exportExcelCardDesc')}</p>
          <button class="btn btn-success" style="width:100%;" onclick="triggerExport('excel')">${t('downloadExcelBtn')}</button>
        </div>

        <div class="card" style="border-top:4px solid #1e3a8a;">
          <h3 class="card-title">${t('exportPdfCardTitle')}</h3>
          <p style="font-size:13px; color:var(--text-muted); margin:10px 0 18px 0;">${t('exportPdfCardDesc')}</p>
          <button class="btn btn-primary" style="width:100%;" onclick="triggerExport('pdf')">${t('downloadPdfBtn')}</button>
        </div>

        <div class="card" style="border-top:4px solid #d97706;">
          <h3 class="card-title">${t('exportZipCardTitle')}</h3>
          <p style="font-size:13px; color:var(--text-muted); margin:10px 0 18px 0;">${t('exportZipCardDesc')}</p>
          <button class="btn btn-warning" style="width:100%;" onclick="triggerExport('zip')">${t('downloadZipBtn')}</button>
        </div>
      </div>
    </div>
  `;
}

function triggerExport(type) {
  const partnerId = document.getElementById('exp_partner')?.value || '';
  const status = document.getElementById('exp_status')?.value || '';
  const lang = state.currentLang || 'en';
  const q = `projectId=${state.currentProjectId}&partnerId=${encodeURIComponent(partnerId)}&status=${encodeURIComponent(status)}&lang=${lang}`;

  if (type === 'excel') {
    window.location.href = `/api/export/excel?${q}`;
    showToast('Starting Excel (.xlsx) download...');
  } else if (type === 'zip') {
    window.location.href = `/api/export/evidence-zip?${q}`;
    showToast('Generating Evidence Package (.zip)...');
  } else if (type === 'pdf') {
    window.open(`/api/export/report-pdf-view?${q}`, '_blank');
  }
}

/* ============================================================================
   7. EXCEL IMPORT & VALIDATION ENGINE (Section 11)
   ============================================================================ */
function renderImportView() {
  const vr = state.importValidationResult;

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">${t('importTitle')}</h2>
          <p class="card-subtitle">${t('importSubtitle')}</p>
        </div>
      </div>

      <div class="form-grid-2" style="margin-bottom:18px;">
        <div class="form-section" style="margin-bottom:0;">
          <h3 class="form-section-title">${t('importOption1Title')}</h3>
          <p style="font-size:13px; color:var(--text-muted);">${t('importOption1Desc')}</p>
          <button class="btn btn-primary" onclick="runWorkspaceExcelValidation()">${t('runValidationBtn')}</button>
        </div>

        <div class="form-section" style="margin-bottom:0;">
          <h3 class="form-section-title">${t('importOption2Title')}</h3>
          <p style="font-size:13px; color:var(--text-muted);">${t('importOption2Desc')}</p>
          <input type="file" accept=".xlsx" class="form-control" onchange="handleImportExcelUpload(event)">
        </div>
      </div>

      ${vr ? `
        <div class="alert-banner alert-warning">
          <div>📋</div>
          <div>
            <strong>Validation Report Summary:</strong>
            Checked <strong>${vr.summary.totalSheets} Sheets</strong> with <strong>${vr.summary.totalRowsFound} activity records</strong>:
            ✅ <strong>${vr.summary.validRowsCount} fully valid</strong> |
            ⚠️ <strong>${vr.summary.flaggedRowsCount} flagged for manual review</strong> (e.g., non-numeric reached numbers, missing URLs, or date discrepancies).
          </div>
        </div>

        ${vr.sheets.map(sh => `
          <div style="border:1px solid var(--border-strong); border-radius:8px; padding:14px; margin-bottom:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <strong style="font-size:15px; color:var(--primary);">📄 Sheet: ${escapeHtml(sh.sheetName)}</strong>
              <div>
                <span class="status-badge status-Approved">✅ Valid: ${sh.validRows}</span>
                <span class="status-badge status-NeedsRevision">⚠️ Flagged: ${sh.flaggedRows}</span>
              </div>
            </div>
            <div class="table-responsive">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Date (Raw -> Parsed)</th>
                    <th>Category (Raw -> Mapped)</th>
                    <th>Description</th>
                    <th>Numbers Reached (Excel)</th>
                    <th>Validation Check</th>
                  </tr>
                </thead>
                <tbody>
                  ${sh.rows.map(r => `
                    <tr>
                      <td><strong>Row ${r.excelRow}</strong></td>
                      <td>${escapeHtml(r.rawDate)}<br><small style="color:var(--primary);">${escapeHtml(r.parsedDate)}</small></td>
                      <td>${escapeHtml(r.rawCategory)}<br><small style="color:var(--text-light);">→ ${escapeHtml(r.mappedCategory)}</small></td>
                      <td>${escapeHtml(r.description.substring(0, 75))}</td>
                      <td><strong>${escapeHtml(r.rawNumbers || '(Blank)')}</strong></td>
                      <td>
                        ${r.status === 'VALID'
                          ? `<span class="status-badge status-Approved">✅ Valid</span>`
                          : r.warnings.map(w => `<div style="color:#b91c1c; font-size:11.5px;">⚠️ ${escapeHtml(w)}</div>`).join('')
                        }
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `).join('')}
      ` : ''}
    </div>
  `;
}

async function runWorkspaceExcelValidation() {
  try {
    showToast('Running validation on Dissemination Log IN-BOUND.xlsx...');
    const res = await apiFetch('/api/import/validate', {
      method: 'POST',
      body: { project_id: state.currentProjectId, useWorkspaceInboundFile: true, fileName: 'Dissemination Log IN-BOUND.xlsx' }
    });
    state.importValidationResult = res;
    renderMainView();
    showToast('Validation run completed successfully!');
  } catch (err) {
    showToast(err.message);
  }
}

function handleImportExcelUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const res = await apiFetch('/api/import/validate', {
        method: 'POST',
        body: { project_id: state.currentProjectId, dataUrl: e.target.result, fileName: file.name }
      });
      state.importValidationResult = res;
      renderMainView();
      showToast(`Validation for ${file.name} completed!`);
    } catch (err) {
      showToast(err.message);
    }
  };
  reader.readAsDataURL(file);
}

/* ============================================================================
   8. ADMIN, ROLES, NOTIFICATIONS & AUDIT TRAIL VIEW (Sections 2, 3, 10, 12, 13)
   ============================================================================ */
function renderAdminView() {
  const { activeProject, users, notifications, auditLogs } = state.bootstrap;

  return `
    <div class="card" style="margin-bottom:18px; border-left:4px solid #10b981;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
        <div>
          <h3 style="margin:0; font-size:16px;">💾 Database Daily Backup & Disaster Recovery (Section 12)</h3>
          <p style="margin:4px 0 0 0; font-size:12.5px; color:var(--text-muted);">
            Download a full standalone binary backup copy of the SQLite database containing all projects, partners, activities, metrics, and audit records.
          </p>
        </div>
        <a href="/api/admin/backup-sqlite" class="btn btn-success" download>${t('backupDbBtn')}</a>
      </div>
    </div>

    <div class="dashboard-charts-grid">
      <!-- Users & RBAC Matrix -->
      <div class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">${t('usersCardTitle')}</h3>
            <p class="card-subtitle">${t('usersCardDesc')}</p>
          </div>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Username & Name</th>
                <th>Role</th>
                <th>Partner Scope</th>
                <th>Switch Demo User</th>
              </tr>
            </thead>
            <tbody>
              ${users.map(u => `
                <tr>
                  <td><strong>${escapeHtml(u.full_name)}</strong><br><small style="color:var(--text-light);">${escapeHtml(u.email)} (@${escapeHtml(u.username)})</small></td>
                  <td><span class="proj-badge">${escapeHtml(u.role)}</span></td>
                  <td>${escapeHtml(u.partner_code || 'All / Consortium')}</td>
                  <td>
                    <button class="btn btn-sm ${u.id === state.currentUserId ? 'btn-success' : 'btn-outline'}" onclick="state.currentUserId=${u.id}; loadBootstrap();">
                      ${u.id === state.currentUserId ? '✓ Active' : 'Switch'}
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Manageable Categories -->
      <div class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">${t('categoriesCardTitle')}</h3>
            <p class="card-subtitle">${t('categoriesCardDesc')}</p>
          </div>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px;">
          ${activeProject.categories.map(c => `
            <span style="padding:5px 10px; background:#f1f5f9; border:1px solid #cbd5e1; border-radius:6px; font-size:12.5px; font-weight:600;">
              ${escapeHtml(c)}
            </span>
          `).join('')}
        </div>
        <div style="display:flex; gap:8px;">
          <input type="text" id="newCatInput" class="form-control" placeholder="${t('newCategoryPlaceholder')}">
          <button class="btn btn-primary" onclick="addProjectCategory()">${t('addCategoryBtn')}</button>
        </div>
      </div>
    </div>

    <!-- Email Notifications Log -->
    <div class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">${t('notificationsCardTitle')}</h3>
          <p class="card-subtitle">Automated monthly reminders, missing evidence alerts, and revision requests log</p>
        </div>
        <button class="btn btn-warning btn-sm" onclick="openReminderModal(null)">+ Send New Notification</button>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Type</th>
              <th>Recipient</th>
              <th>Subject & Message</th>
              <th>Sender</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${notifications.length === 0 ? `
              <tr><td colspan="6" style="text-align:center; color:var(--text-light);">No notifications sent yet. Use «Send Reminder» from the Partner Matrix!</td></tr>
            ` : notifications.map(n => `
              <tr>
                <td>${escapeHtml(n.sent_at)}</td>
                <td><span class="proj-badge">${escapeHtml(n.notification_type)}</span></td>
                <td><strong>${escapeHtml(n.recipient_name)}</strong><br><small>${escapeHtml(n.recipient_email)}</small></td>
                <td><strong>${escapeHtml(n.subject)}</strong><br><small style="color:var(--text-muted); white-space:pre-line;">${escapeHtml(n.body.substring(0, 160))}...</small></td>
                <td>${escapeHtml(n.sent_by)}</td>
                <td><span class="status-badge status-Approved">${escapeHtml(n.status)}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Audit Trail -->
    <div class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">${t('auditTrailCardTitle')}</h3>
          <p class="card-subtitle">${t('auditTrailCardDesc')}</p>
        </div>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Timestamp (UTC)</th>
              <th>User</th>
              <th>Role</th>
              <th>Action</th>
              <th>Target</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            ${auditLogs.map(log => `
              <tr>
                <td style="white-space:nowrap;">${escapeHtml(log.created_at)}</td>
                <td><strong>${escapeHtml(log.user_name)}</strong></td>
                <td><span style="font-size:11px; font-weight:700; color:var(--primary);">${escapeHtml(log.user_role)}</span></td>
                <td><code>${escapeHtml(log.action)}</code></td>
                <td><strong>${escapeHtml(log.entity_ref || log.entity_type)}</strong></td>
                <td>${escapeHtml(log.details)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function addProjectCategory() {
  const inp = document.getElementById('newCatInput');
  const val = inp?.value.trim();
  if (!val) return;
  const cats = [...state.bootstrap.activeProject.categories];
  if (!cats.includes(val)) {
    cats.push(val);
    await apiFetch(`/api/projects/${state.currentProjectId}/categories`, {
      method: 'PUT',
      body: { categories: cats }
    });
    showToast(`Added category "${val}"!`);
    loadBootstrap();
  }
}

/* ============================================================================
   MODALS: Activity Details, Evidence Lightbox, Partner Reminder, New Project, Auth
   ============================================================================ */
function closeModal() {
  const el = document.getElementById('modalRoot');
  if (el) el.innerHTML = '';
}

function handleAuthButtonClick() {
  if (state.authToken) {
    state.authToken = '';
    state.authenticatedUser = null;
    localStorage.removeItem('tihc_auth_token');
    showToast(t('loggedOutSuccess'));
    renderHeaderAndNav();
  } else {
    openAuthModal();
  }
}

function openAuthModal() {
  const modalRoot = document.getElementById('modalRoot');
  modalRoot.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
      <div class="modal-window" style="max-width:480px;">
        <div class="modal-header">
          <h3 style="margin:0; font-size:16px;">${t('loginModalTitle')}</h3>
          <button class="btn btn-sm btn-outline" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">
          <form id="loginForm" onsubmit="handleLoginSubmit(event)">
            <div style="margin-bottom:12px;">
              <label class="stat-label">${t('loginUsername')}</label>
              <input type="text" id="login_username" class="form-control" value="manager_tihc" required>
            </div>
            <div style="margin-bottom:16px;">
              <label class="stat-label">${t('loginPassword')}</label>
              <input type="password" id="login_password" class="form-control" value="ManagerTIHC2026!" required>
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%;">${t('loginBtn')}</button>
          </form>

          <div style="margin-top:16px; padding:12px; background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px; font-size:11.5px;">
            <strong>${t('demoCredentialsTitle')}</strong>
            <ul style="margin:4px 0 0 0; padding-left:18px;">
              <li><code>manager_tihc</code> / <code>ManagerTIHC2026!</code> (Dissemination Leader)</li>
              <li><code>superadmin</code> / <code>AdminTIHC2026!</code> (Super Admin)</li>
              <li><code>editor_bfe</code> / <code>Bfe2026!</code> (Bulgaria Partner Editor)</li>
              <li><code>editor_mindshift</code> / <code>Mindshift2026!</code> (Portugal Partner Editor)</li>
              <li><code>reviewer_eu</code> / <code>Reviewer2026!</code> (Auditor)</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const username = document.getElementById('login_username')?.value.trim();
  const password = document.getElementById('login_password')?.value.trim();
  try {
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: { username, password }
    });
    if (res.token) {
      state.authToken = res.token;
      state.authenticatedUser = res.user;
      localStorage.setItem('tihc_auth_token', res.token);
      state.currentUserId = res.user.id;
    }
    closeModal();
    showToast(t('signedInSuccess'));
    loadBootstrap();
  } catch (err) {
    showToast(t('invalidCredentials'));
  }
}

function openEvidencePreviewModal(filePath, originalName, version, notes) {
  const modalRoot = document.getElementById('modalRoot');
  const isPdf = filePath.toLowerCase().endsWith('.pdf');
  modalRoot.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
      <div class="modal-window" style="max-width:860px;">
        <div class="modal-header">
          <div>
            <h3 style="margin:0; font-size:16px;">🖼️ Evidence Preview: ${escapeHtml(originalName)} (v${version})</h3>
            <div style="font-size:12px; color:var(--text-muted);">${escapeHtml(notes || 'Original evidence verification')}</div>
          </div>
          <button class="btn btn-sm btn-outline" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body" style="text-align:center; background:#0f172a; padding:20px;">
          ${isPdf
            ? `<iframe src="${escapeHtml(filePath)}" style="width:100%; height:600px; border:none; border-radius:8px; background:#fff;"></iframe>`
            : `<img src="${escapeHtml(filePath)}" style="max-width:100%; max-height:70vh; border-radius:8px; box-shadow:0 4px 20px rgba(0,0,0,0.4);">`
          }
        </div>
        <div class="modal-footer">
          <a href="${escapeHtml(filePath)}" download="${escapeHtml(originalName)}" class="btn btn-primary">⬇️ Download File</a>
          <button class="btn btn-outline" onclick="closeModal()">Close</button>
        </div>
      </div>
    </div>
  `;
}

function openActivityDetailModal(actId) {
  const a = state.bootstrap.activities.find(x => x.id === actId);
  if (!a) return;
  const { user } = state.bootstrap;
  const canReview = user.role === 'SUPER_ADMIN' || user.role === 'DISSEMINATION_MANAGER';
  const canEdit = canReview || (user.role === 'PARTNER_EDITOR' && user.partner_code === a.partner_code);
  const canReviewerDeleteReregister = user.role === 'REVIEWER';

  const modalRoot = document.getElementById('modalRoot');
  modalRoot.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
      <div class="modal-window">
        <div class="modal-header">
          <div>
            <span class="proj-badge">${escapeHtml(a.activity_code)}</span>
            <strong style="font-size:16px; margin-left:8px;">${escapeHtml(a.title)}</strong>
          </div>
          <div style="display:flex; gap:8px; align-items:center;">
            <span class="status-badge status-${a.status.replace(/\s+/g, '')}">${escapeHtml(a.status)}</span>
            <button class="btn btn-sm btn-outline" onclick="closeModal()">✕</button>
          </div>
        </div>

        <div class="modal-body">
          ${a.validation_warnings.length > 0 ? `
            <div class="alert-banner alert-warning">
              <div>⚠️</div>
              <div>
                <strong>Identified Warnings / Incomplete Items:</strong>
                ${a.validation_warnings.map(w => `<div>• ${escapeHtml(w)}</div>`).join('')}
              </div>
            </div>
          ` : ''}

          <div class="form-grid-3" style="background:#f8fafc; padding:14px; border-radius:8px; border:1px solid var(--border); margin-bottom:16px;">
            <div><span class="stat-label">Partner</span><div><strong>${escapeHtml(a.partner_name)}</strong> (${escapeHtml(a.partner_country)})</div></div>
            <div><span class="stat-label">Activity Date</span><div><strong>${escapeHtml(a.activity_date)}</strong> ${a.end_date ? `to ${escapeHtml(a.end_date)}` : ''} <small style="color:#64748b">(Excel: ${escapeHtml(a.raw_date_string)})</small></div></div>
            <div><span class="stat-label">Type</span><div><strong>${escapeHtml(a.activity_type)}</strong></div></div>
            <div><span class="stat-label">Reach Level</span><div>${escapeHtml(a.reach_levels.join(', '))} (${escapeHtml(a.countries_reached.join(', '))})</div></div>
            <div><span class="stat-label">Responsible Person</span><div>${escapeHtml(a.responsible_person || '-')}</div></div>
            <div><span class="stat-label">Platform / Media</span><div>${escapeHtml(a.social_platform || a.publication_media_outlet || '-')}</div></div>
          </div>

          <div style="margin-bottom:16px;">
            <span class="stat-label">Description</span>
            <div style="padding:10px 12px; background:#fff; border:1px solid var(--border); border-radius:6px; margin-top:4px;">
              ${escapeHtml(a.description)}
            </div>
          </div>

          <div style="margin-bottom:16px;">
            <span class="stat-label">Target Groups</span>
            <div style="margin-top:4px; font-size:13px;">
              <strong>Categories:</strong> ${escapeHtml(a.target_groups.join(', '))}<br>
              <strong>Excel Source:</strong> ${escapeHtml(a.raw_target_groups || '-')}<br>
              ${a.stakeholders_reached ? `<strong>Stakeholders Reached:</strong> ${escapeHtml(a.stakeholders_reached)}` : ''}
            </div>
          </div>

          <!-- Metrics -->
          <div style="margin-bottom:18px;">
            <span class="stat-label" style="display:block; margin-bottom:8px;">Dissemination Metrics (Section E)</span>
            <div class="form-grid-4">
              <div style="padding:8px 12px; border:1px solid var(--border); border-radius:6px;">
                <small style="color:#64748b;">Reach (Unique)</small>
                <div style="font-size:17px; font-weight:800; color:var(--primary);">${a.metric_reach.toLocaleString()}</div>
              </div>
              <div style="padding:8px 12px; border:1px solid var(--border); border-radius:6px;">
                <small style="color:#64748b;">Views</small>
                <div style="font-size:17px; font-weight:800; color:var(--primary);">${a.metric_views.toLocaleString()}</div>
              </div>
              <div style="padding:8px 12px; border:1px solid var(--border); border-radius:6px;">
                <small style="color:#64748b;">Impressions</small>
                <div style="font-size:17px; font-weight:800; color:var(--primary);">${a.metric_impressions.toLocaleString()}</div>
              </div>
              <div style="padding:8px 12px; border:1px solid var(--border); border-radius:6px;">
                <small style="color:#64748b;">Likes / Shares / Clicks</small>
                <div style="font-size:17px; font-weight:800; color:var(--primary);">${(a.metric_likes + a.metric_shares + a.metric_clicks).toLocaleString()}</div>
              </div>
              <div style="padding:8px 12px; border:1px solid var(--border); border-radius:6px;">
                <small style="color:#64748b;">Event Participants</small>
                <div style="font-size:17px; font-weight:800; color:var(--success);">${a.metric_event_participants.toLocaleString()}</div>
              </div>
              <div style="padding:8px 12px; border:1px solid var(--border); border-radius:6px;">
                <small style="color:#64748b;">Newsletter Recipients</small>
                <div style="font-size:17px; font-weight:800; color:var(--warning);">${a.metric_newsletter_recipients.toLocaleString()}</div>
              </div>
              <div style="padding:8px 12px; border:1px solid var(--border); border-radius:6px; grid-column: span 2;">
                <small style="color:#64748b;">Legacy Excel ("Numbers Reached")</small>
                <div style="font-size:13.5px; font-weight:700; color:var(--text-main);">${escapeHtml(a.legacy_numbers_reached_raw || '(Blank)')}</div>
              </div>
            </div>
          </div>

          <!-- Evidence Files -->
          <div style="margin-bottom:18px; padding:14px; background:#f8fafc; border:1px solid var(--border-strong); border-radius:8px;">
            <span class="stat-label" style="display:block; margin-bottom:8px;">Evidence Files & Versioning</span>
            <div style="margin-bottom:10px;">
              <strong>Public URL:</strong>
              ${a.evidence_url
                ? `<a href="${escapeHtml(a.evidence_url)}" target="_blank" rel="noopener" style="color:var(--primary-hover); font-weight:600; word-break:break-all;">${escapeHtml(a.evidence_url)} ↗</a>`
                : `<span style="color:var(--danger);">No public URL provided</span>`
              }
            </div>

            ${a.evidence_files.length > 0 ? `
              <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap:12px;">
                ${a.evidence_files.map(ev => `
                  <div style="background:#fff; border:1px solid #cbd5e1; border-radius:8px; padding:10px;">
                    <img src="${escapeHtml(ev.file_path)}" style="width:100%; height:130px; object-fit:cover; border-radius:6px; cursor:pointer;" onclick="openEvidencePreviewModal('${escapeHtml(ev.file_path)}', '${escapeHtml(ev.original_name)}', ${ev.version}, '${escapeHtml(ev.version_notes || '')}')">
                    <div style="margin-top:6px; font-size:12px;">
                      <span class="proj-badge">v${ev.version} ${ev.is_original ? '(Original)' : ''}</span>
                      <div style="font-weight:600; margin-top:4px; word-break:break-all;">${escapeHtml(ev.original_name)}</div>
                      <div style="color:#64748b; font-size:11px;">${escapeHtml(ev.version_notes || '')}</div>
                    </div>
                  </div>
                `).join('')}
              </div>
            ` : `
              <div style="color:var(--danger); font-weight:600;">❌ No analytics screenshot or photo attached.</div>
            `}
          </div>

          <!-- Review Workflow (Section 8) -->
          ${canReview ? `
            <div style="margin-bottom:18px; padding:14px; background:#eff6ff; border:1px solid #93c5fd; border-radius:8px;">
              <strong style="color:var(--primary); display:block; margin-bottom:8px;">🛡️ Dissemination Manager Action (Approve or Return for Revision):</strong>
              <textarea id="mgrReviewComment" class="form-control" rows="2" placeholder="Add evaluation note or revision instructions to partner...">${escapeHtml(a.manager_notes || '')}</textarea>
              <div style="display:flex; gap:8px; margin-top:10px;">
                <button class="btn btn-success btn-sm" onclick="submitManagerStatus(${a.id}, 'Approved')">✅ Approve Activity</button>
                <button class="btn btn-warning btn-sm" onclick="submitManagerStatus(${a.id}, 'Needs Revision')">↩️ Request Revision (Needs Revision + Email)</button>
                <button class="btn btn-outline btn-sm" onclick="submitManagerStatus(${a.id}, 'Submitted')">🔄 Mark Submitted</button>
              </div>
            </div>
          ` : ''}

          <!-- Comments Thread -->
          <div>
            <span class="stat-label" style="display:block; margin-bottom:8px;">💬 Comments History (${a.comments.length})</span>
            ${a.comments.map(c => `
              <div style="padding:8px 12px; background:#f8fafc; border-left:3px solid var(--primary); margin-bottom:8px; border-radius:4px; font-size:12.5px;">
                <strong>${escapeHtml(c.author_name)}</strong> <span style="color:#64748b;">(${escapeHtml(c.author_role)} • ${escapeHtml(c.created_at)})</span>
                <div style="margin-top:3px;">${escapeHtml(c.comment_text)}</div>
              </div>
            `).join('')}
            <div style="display:flex; gap:8px; margin-top:8px;">
              <input type="text" id="newCommentText" class="form-control" placeholder="Write a comment or clarification...">
              <button class="btn btn-outline btn-sm" onclick="addActivityComment(${a.id})">Post Comment</button>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          ${canEdit ? `
            <button class="btn btn-danger btn-sm" onclick="deleteActivityById(${a.id}, false)">🗑️ Delete</button>
            <button class="btn btn-primary" onclick="closeModal(); editActivity(${a.id});">✏️ Full Edit / Add Evidence Version</button>
          ` : ''}
          ${canReviewerDeleteReregister ? `
            <button class="btn btn-warning" onclick="deleteActivityById(${a.id}, true)">♻️ Delete & Re-register (Auditor)</button>
          ` : ''}
          <button class="btn btn-outline" onclick="closeModal()">Close</button>
        </div>
      </div>
    </div>
  `;
}

async function quickChangeStatus(actId, newStatus) {
  try {
    await apiFetch(`/api/activities/${actId}/status`, {
      method: 'POST',
      body: { status: newStatus, comment: `Approved by Dissemination Manager.` }
    });
    showToast(`Activity marked as "${newStatus}"!`);
    loadBootstrap();
  } catch (err) {
    showToast(err.message);
  }
}

async function submitManagerStatus(actId, newStatus) {
  const comment = document.getElementById('mgrReviewComment')?.value || '';
  try {
    await apiFetch(`/api/activities/${actId}/status`, {
      method: 'POST',
      body: { status: newStatus, comment }
    });
    closeModal();
    showToast(`Activity status updated to "${newStatus}"!`);
    loadBootstrap();
  } catch (err) {
    showToast(err.message);
  }
}

async function addActivityComment(actId) {
  const txt = document.getElementById('newCommentText')?.value.trim();
  if (!txt) return;
  try {
    await apiFetch(`/api/activities/${actId}/comments`, {
      method: 'POST',
      body: { comment_text: txt }
    });
    await loadBootstrap();
    openActivityDetailModal(actId);
    showToast('Comment posted.');
  } catch (err) {
    showToast(err.message);
  }
}

async function deleteActivityById(actId, reregisterAfter) {
  try {
    await apiFetch(`/api/activities/${actId}`, { method: 'DELETE' });
    closeModal();
    await loadBootstrap();
    if (reregisterAfter) {
      startNewActivity();
      showToast('Activity deleted. Ready for re-registration.');
    } else {
      showToast('Activity deleted.');
    }
  } catch (err) {
    showToast(err.message);
  }
}

/* ============================================================================
   PARTNER REMINDER MODAL (Section 10)
   ============================================================================ */
function openReminderModal(partnerId) {
  const { partnerPendingMatrix, activities, activeProject } = state.bootstrap;
  const pm = partnerId ? partnerPendingMatrix.find(x => x.partner_id === partnerId) : null;

  let recipientName = 'All Consortium Partners with Pending Items';
  let recipientEmail = partnerPendingMatrix.filter(x => x.missing_evidence_count > 0).map(x => x.contact_email).join(', ');
  let subject = `[${activeProject.acronym} Dissemination] Evidence & Metrics Submission Reminder`;
  let bodyLines = [];

  if (pm) {
    recipientName = `${pm.partner_name} (${pm.contact_person})`;
    recipientEmail = pm.contact_email;
    const probActs = activities.filter(a => a.partner_id === pm.partner_id && (a.missing_evidence_flag === 1 || a.status === 'Needs Revision'));
    bodyLines = [
      `Dear Partner ${pm.partner_name} (${pm.country}),`,
      ``,
      `As part of the dissemination monitoring for project ${activeProject.acronym} (${activeProject.project_number}) conducted by the Dissemination Leader (TIHC), please note the following pending items:`,
      `- Total recorded activities: ${pm.total_activities}`,
      `- Activities missing evidence (Analytics Screenshots/URLs): ${pm.missing_evidence_count}`,
      `- Activities needing partner revision: ${pm.needs_revision_count}`,
      ``,
      `Key activities requiring upload of screenshots or metric verification:`,
      ...probActs.slice(0, 10).map(a => `  • ${a.activity_code} (${a.activity_date}): "${a.title}" -> ${a.validation_warnings.join('; ') || 'Missing evidence'}`),
      ``,
      `Please log in to the TIHC Dissemination Platform to upload the corresponding analytics screenshots and verify metrics.`,
      ``,
      `Best regards,`,
      `Technical Schools of the Chamber of Heraklion (TIHC) — Dissemination Leader`
    ];
  } else {
    bodyLines = [
      `Dear ${activeProject.acronym} Consortium Partners,`,
      ``,
      `This is a friendly reminder to update your monthly dissemination activities and attach the required proof (Analytics Screenshots, Public URLs, Event Photos) on the centralized TIHC platform.`,
      ``,
      `Summary of pending items by partner:`,
      ...partnerPendingMatrix.map(p => `  • ${p.partner_name} (${p.country_code}): ${p.total_activities} activities (${p.missing_evidence_count} missing evidence, ${p.needs_revision_count} needs revision)`),
      ``,
      `Best regards,`,
      `TIHC Dissemination Management Team`
    ];
  }

  const modalRoot = document.getElementById('modalRoot');
  modalRoot.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
      <div class="modal-window" style="max-width:680px;">
        <div class="modal-header">
          <h3 style="margin:0; font-size:16px;">✉️ Send Partner Reminder Email (Section 10)</h3>
          <button class="btn btn-sm btn-outline" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-grid-2" style="margin-bottom:12px;">
            <div>
              <label class="stat-label">Notification Type</label>
              <select id="rem_type" class="form-select">
                <option value="missing_evidence">Missing Evidence Notification</option>
                <option value="monthly_reminder">Monthly Submission Reminder</option>
                <option value="revision_request">Revision Request Notification</option>
                <option value="report_deadline">Interim / Final Report Deadline Alert</option>
              </select>
            </div>
            <div>
              <label class="stat-label">Recipient (Email)</label>
              <input type="text" id="rem_email" class="form-control" value="${escapeHtml(recipientEmail)}">
              <input type="hidden" id="rem_name" value="${escapeHtml(recipientName)}">
              <input type="hidden" id="rem_partner_id" value="${partnerId || ''}">
            </div>
          </div>
          <div style="margin-bottom:12px;">
            <label class="stat-label">Subject</label>
            <input type="text" id="rem_subject" class="form-control" value="${escapeHtml(subject)}">
          </div>
          <div>
            <label class="stat-label">Email Body (Auto-composed)</label>
            <textarea id="rem_body" class="form-control" rows="12">${escapeHtml(bodyLines.join('\n'))}</textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" onclick="sendReminderEmail()">🚀 Send Email & Log to Audit Trail</button>
        </div>
      </div>
    </div>
  `;
}

async function sendReminderEmail() {
  try {
    await apiFetch('/api/notifications/send', {
      method: 'POST',
      body: {
        project_id: state.currentProjectId,
        partner_id: document.getElementById('rem_partner_id').value || null,
        notification_type: document.getElementById('rem_type').value,
        recipient_email: document.getElementById('rem_email').value,
        recipient_name: document.getElementById('rem_name').value,
        subject: document.getElementById('rem_subject').value,
        body: document.getElementById('rem_body').value
      }
    });
    closeModal();
    showToast('Email notification logged & sent to partner!');
    loadBootstrap();
  } catch (err) {
    showToast(err.message);
  }
}

/* ============================================================================
   NEW PROJECT FROM TEMPLATE (Section 2)
   ============================================================================ */
function openNewProjectModal() {
  const modalRoot = document.getElementById('modalRoot');
  modalRoot.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
      <div class="modal-window" style="max-width:680px;">
        <div class="modal-header">
          <h3 style="margin:0; font-size:16px;">➕ Create New European Project (from Template — Section 2)</h3>
          <button class="btn btn-sm btn-outline" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="alert-banner alert-info">
            <div>✨</div>
            <div>
              Instantly provisions a dedicated workspace, database tables, reporting periods, and default KPI indicators without requiring new software code.
            </div>
          </div>
          <div class="form-grid-2">
            <div>
              <label class="stat-label">Project Acronym *</label>
              <input type="text" id="np_acronym" class="form-control" placeholder="e.g., GREEN-SKILL-VET">
            </div>
            <div>
              <label class="stat-label">Project Number *</label>
              <input type="text" id="np_number" class="form-control" placeholder="e.g., 2026-1-EL01-KA220-VET-000412890">
            </div>
            <div style="grid-column: span 2;">
              <label class="stat-label">Full Project Title *</label>
              <input type="text" id="np_title" class="form-control" placeholder="e.g., Green Transition & Digital Skills in Vocational Education">
            </div>
            <div>
              <label class="stat-label">Start Date</label>
              <input type="date" id="np_start" class="form-control" value="2026-11-01">
            </div>
            <div>
              <label class="stat-label">End Date</label>
              <input type="date" id="np_end" class="form-control" value="2028-10-31">
            </div>
            <div>
              <label class="stat-label">Project Coordinator</label>
              <input type="text" id="np_coord" class="form-control" value="TIHC — Technical Schools of the Chamber of Heraklion">
            </div>
            <div>
              <label class="stat-label">Dissemination Leader</label>
              <input type="text" id="np_leader" class="form-control" value="TIHC — Technical Schools of the Chamber of Heraklion">
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" onclick="createNewProjectFromModal()">🚀 Create Project from Template</button>
        </div>
      </div>
    </div>
  `;
}

async function createNewProjectFromModal() {
  const acronym = document.getElementById('np_acronym').value.trim();
  const project_number = document.getElementById('np_number').value.trim();
  const title = document.getElementById('np_title').value.trim();
  if (!acronym || !project_number || !title) {
    showToast('Please fill in Acronym, Project Number, and Title.');
    return;
  }
  try {
    const res = await apiFetch('/api/projects', {
      method: 'POST',
      body: {
        acronym,
        project_number,
        title,
        start_date: document.getElementById('np_start').value,
        end_date: document.getElementById('np_end').value,
        coordinator_name: document.getElementById('np_coord').value,
        dissemination_leader: document.getElementById('np_leader').value,
        use_template: true
      }
    });
    closeModal();
    state.currentProjectId = res.projectId;
    await loadBootstrap();
    showToast(`New project "${acronym}" created successfully from template!`);
  } catch (err) {
    showToast(err.message);
  }
}

function openNewKpiModal() {
  const modalRoot = document.getElementById('modalRoot');
  modalRoot.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
      <div class="modal-window" style="max-width:560px;">
        <div class="modal-header">
          <h3 style="margin:0; font-size:16px;">🎯 Add New KPI Target (Section 7)</h3>
          <button class="btn btn-sm btn-outline" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-grid-2">
            <div>
              <label class="stat-label">KPI Code *</label>
              <input type="text" id="nk_code" class="form-control" value="KPI-${state.bootstrap.kpis.length + 1}">
            </div>
            <div>
              <label class="stat-label">Calculation Metric *</label>
              <select id="nk_type" class="form-select">
                <option value="activity_count">Total Activity Count</option>
                <option value="social_reach_views_sum">Social Media Reach + Views Sum</option>
                <option value="participants_sum">Event Participants Sum</option>
                <option value="newsletter_sum">Newsletter Recipients Sum</option>
                <option value="articles_count">Published Articles / Press Releases Count</option>
                <option value="events_count">Events / Workshops / Conferences Count</option>
              </select>
            </div>
            <div style="grid-column: span 2;">
              <label class="stat-label">Indicator Title *</label>
              <input type="text" id="nk_title" class="form-control" placeholder="e.g., Bilateral Policy Stakeholder Meetings">
            </div>
            <div>
              <label class="stat-label">Target Value *</label>
              <input type="number" id="nk_target" class="form-control" value="25">
            </div>
            <div>
              <label class="stat-label">Unit *</label>
              <input type="text" id="nk_unit" class="form-control" value="Activities">
            </div>
            <div style="grid-column: span 2;">
              <label class="stat-label">Description / Methodology</label>
              <input type="text" id="nk_desc" class="form-control" placeholder="Brief summary of target...">
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" onclick="saveNewKpi()">💾 Save KPI Target</button>
        </div>
      </div>
    </div>
  `;
}

async function saveNewKpi() {
  try {
    await apiFetch('/api/kpis', {
      method: 'POST',
      body: {
        project_id: state.currentProjectId,
        code: document.getElementById('nk_code').value,
        title: document.getElementById('nk_title').value,
        metric_type: document.getElementById('nk_type').value,
        target_value: Number(document.getElementById('nk_target').value) || 10,
        unit: document.getElementById('nk_unit').value,
        description: document.getElementById('nk_desc').value
      }
    });
    closeModal();
    showToast('New KPI target added!');
    loadBootstrap();
  } catch (err) {
    showToast(err.message);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  setLanguage(state.currentLang);
  loadBootstrap();
});
