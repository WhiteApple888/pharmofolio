const framework = [
  ['1', 'Expert Professional Practice', ['1.1 Demonstrates expert skills and knowledge', '1.2 Manages patient care responsibilities / delivery of professional activities', '1.3 Exhibits reasoning and judgement', '1.4 Uses professional autonomy']],
  ['2', 'Building Working Relationships', ['2.1 Ability to communicate effectively', '2.2 Collaborates with members of the health care team and offer consultations']],
  ['3', 'Leadership', ['3.1 Visioning', '3.2 Strategic planning', '3.3 Innovation', '3.4 Motivates individual']],
  ['4', 'Management', ['4.1 Implementing organisational priorities', '4.2 Managing resource utilisation', '4.3 Establishing standards of practice', '4.4 Managing risk', '4.5 Managing performance', '4.6 Managing change']],
  ['5', 'Education, Training and Development', ['5.1 Developing self and others', '5.2 Conducting education and training']],
  ['6', 'Research & Evaluation', ['6.1 Evaluating literature/data critically and identifying evidence/practice gaps', '6.2 Developing and evaluating protocols', '6.3 Disseminating evidence', '6.4 Guiding others undertaking research/project', '6.5 Establishing partnerships']],
];
const gradeProfiles = {
  P12: ['Foundation · supported practice', 'Able to successfully complete tasks with help from others.'],
  P13: ['Foundation · developing independence', 'Able to complete tasks independently; assistance from an expert may be required from time to time.'],
  P14: ['Intermediate · independent practice', 'Able to successfully complete tasks independently.'],
  P15: ['Advanced · trusted practice', 'Able to perform the actions associated with the skill without assistance.'],
  P16: ['Advanced · organisational influence', 'Recognised as a person to ask and able to contribute across broad organisational issues.'],
  P17: ['Expert · recognised authority', 'Recognised as an authority in an area of expertise.'],
  P18: ['Expert · strategic authority', 'Recognised as an authority who creates new applications and processes.'],
};
const allowedExtensions = new Set(['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'xlsx', 'txt', 'msg', 'eml']);
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const apiBaseUrl = '';
const apiUrl = path => `${apiBaseUrl}${path}`;

let currentUser = null;
let pharmacistProfiles = [];
let activePharmacist = { name: '', grade: 'P13', track: '', section: '', reporting_officer: '' };
let ownAssessment = null;
let selectedDomain = 'overview';
let reportees = [];
let selectedReportee = null;
let reporteeAssessment = null;
let ownDevelopmentResponse = null;
let reporteeDevelopmentResponse = null;
let reporteeCoachingDevelopment = null;
let reporteeEvidence = { items: [] };
let roResponseDraft = null;
let savedUploads = [];
let savedByContext = { assessment: [], coaching: [], development_plan: [] };
let conversations = [];
let currentConversation = null;
let conversationMessages = [];
let lastSummaryMessageId = null;
let selectedCoachGaps = new Set();
let summaryStale = false;
let teamRows = [];
let divisionRows = [];
let roResponseRefreshTimer = null;
const pharmacistWorkspaces = new Map();

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}
function confirmAction(title, description, actionLabel) {
  const dialog = $('#confirm-dialog');
  $('#confirm-title').textContent = title;
  $('#confirm-description').textContent = description;
  $('#confirm-proceed').textContent = actionLabel;
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    dialog.returnValue = 'cancel';
    dialog.showModal();
  });
}
function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  window.setTimeout(() => element.classList.remove('show'), 2800);
}
function emptyState(title, detail) {
  return `<div class="empty-state"><div class="empty-icon">◎</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(detail)}</p></div>`;
}
function formatDate(value) {
  if (!value) return 'Saved';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}
function pharmacistKey(profile = activePharmacist) {
  return profile.name || '__unassigned__';
}
function workspaceFor(key = pharmacistKey()) {
  if (!pharmacistWorkspaces.has(key)) pharmacistWorkspaces.set(key, { uploadedFiles: [], emailText: '', emailId: '', emailSaved: false, result: null });
  return pharmacistWorkspaces.get(key);
}
function newDraftId() {
  return crypto.randomUUID?.() || `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function activeResult() {
  return workspaceFor().result;
}
function apiError(data, response) {
  return data?.error || data?.detail || `The request failed (${response.status}).`;
}
async function request(path, options = {}) {
  const response = await fetch(apiUrl(path), { credentials: 'include', ...options });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('json') ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/auth/login') showLogin();
    throw new Error(apiError(data, response));
  }
  return data;
}
function jsonOptions(method, body) {
  return { method, headers: { 'content-type': 'application/json', 'x-requested-with': 'PharmPath' }, body: JSON.stringify(body) };
}
function setBusy(button, busy, busyLabel, idleLabel) {
  button.disabled = busy;
  button.textContent = busy ? busyLabel : idleLabel;
}

function showLogin() {
  currentUser = null;
  $('#auth-loading').classList.add('hidden');
  $('#app-shell').classList.add('hidden');
  $('#login-view').classList.remove('hidden');
  $('#login-password').value = '';
  $('#login-username').focus();
}
async function showApplication(user) {
  currentUser = user;
  $('#auth-loading').classList.add('hidden');
  $('#login-view').classList.add('hidden');
  $('#app-shell').classList.remove('hidden');
  $('#team-dashboard-nav').classList.toggle('hidden', !user.capabilities.team_dashboard && !user.capabilities.division_dashboard);
  $$('[data-dashboard-scope="division"]').forEach(button => button.classList.toggle('hidden', !user.capabilities.division_dashboard));
  $$('[data-dashboard-scope="team"]').forEach(button => button.classList.toggle('hidden', !user.capabilities.team_dashboard));
  $$('[data-dashboard-scope="individual"]').forEach(button => button.classList.toggle('hidden', !user.capabilities.reportee_assessment));
  $('#reportee-assessment-nav').classList.add('hidden');
  $('#user-name').textContent = user.name;
  $('#user-meta').textContent = `${user.profile.grade} · ${user.profile.track}`;
  $('#user-avatar').textContent = initials(user.name);
  $('#session-label').textContent = `Signed in as ${user.username}`;
  $('#welcome-heading').textContent = `Welcome back, ${user.name.split(/\s+/)[0]}`;
  $('#welcome-profile').textContent = `${user.profile.grade} · ${user.profile.track} · ${user.profile.section}`;
  await loadWorkspaceData();
  if (roResponseRefreshTimer) window.clearInterval(roResponseRefreshTimer);
  roResponseRefreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible' && $('#coaching-development').classList.contains('active-view')) loadOwnDevelopmentResponse();
  }, 15000);
  const directView = ['/team-dashboard', '/division-dashboard'].includes(location.pathname) ? 'team-dashboard' : location.pathname === '/reportee-assessment' ? 'reportee-assessment' : location.hash.replace('#', '') || 'overview';
  await switchView(directView, false);
}
async function authenticate() {
  try {
    const data = await request('/api/auth/me');
    await showApplication(data.user);
  } catch {
    showLogin();
  }
}
async function login(event) {
  event.preventDefault();
  const button = $('#login-button');
  const error = $('#login-error');
  error.textContent = '';
  setBusy(button, true, 'Signing in…', 'Sign in');
  try {
    const data = await request('/api/auth/login', jsonOptions('POST', { username: $('#login-username').value.trim(), password: $('#login-password').value }));
    await showApplication(data.user);
    history.replaceState(null, '', '/#overview');
  } catch (problem) {
    error.textContent = problem.message;
  } finally {
    setBusy(button, false, 'Signing in…', 'Sign in');
  }
}
async function logout() {
  try {
    await request('/api/auth/logout', jsonOptions('POST', {}));
  } finally {
    if (roResponseRefreshTimer) { window.clearInterval(roResponseRefreshTimer); roResponseRefreshTimer = null; }
    history.replaceState(null, '', '/');
    showLogin();
  }
}

async function switchView(view, updateLocation = true) {
  const permitted = {
    'team-dashboard': currentUser?.capabilities.team_dashboard || currentUser?.capabilities.division_dashboard,
    'division-dashboard': currentUser?.capabilities.division_dashboard,
    'reportee-assessment': currentUser?.capabilities.reportee_assessment,
  };
  if (view in permitted && !permitted[view]) {
    toast('You do not have access to that dashboard.');
    view = 'overview';
  }
  if (!document.getElementById(view)?.classList.contains('view')) view = 'overview';
  $$('.view').forEach(section => section.classList.toggle('active-view', section.id === view));
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === view));
  $('#crumb-label').textContent = ({
    mappings: 'Assessment',
    'coaching-development': 'Coaching & development plan',
    evidence: 'Evidence inbox',
    'team-dashboard': 'Team Dashboard',
    'division-dashboard': 'Division Dashboard',
    'reportee-assessment': 'Reportee assessment',
    overview: 'Overview',
  })[view] || 'Overview';
  if (updateLocation) history.replaceState(null, '', `/#${view}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (view === 'team-dashboard') await switchDashboardScope(currentUser?.capabilities.team_dashboard ? 'team' : 'division');
  if (view === 'division-dashboard') await loadDivisionDashboard();
  if (view === 'reportee-assessment') await switchDashboardScope('individual');
  if (view === 'coaching-development') { await loadConversations(); await loadOwnDevelopmentResponse(); }
}

async function loadWorkspaceData() {
  const [profileData, uploadData, assessmentData, coachingData, planData, currentAssessmentData] = await Promise.all([
    request('/api/profiles'),
    request('/api/uploads?context=evidence'),
    request('/api/saved-content?context=assessment'),
    request('/api/saved-content?context=coaching'),
    request('/api/saved-content?context=development_plan'),
    request('/api/assessment'),
  ]);
  pharmacistProfiles = profileData.profiles;
  savedUploads = uploadData.items;
  savedByContext = { assessment: assessmentData.items, coaching: coachingData.items, development_plan: planData.items };
  ownAssessment = currentAssessmentData.assessment;
  activePharmacist = pharmacistProfiles.find(profile => profile.user_id === currentUser.id) || pharmacistProfiles[0] || {
    name: currentUser.name, grade: currentUser.profile.grade, track: currentUser.profile.track, section: currentUser.profile.section,
  };
  if (ownAssessment?.ai_result) workspaceFor(pharmacistKey()).result = ownAssessment.ai_result;
  renderAll();
  renderSavedItems();
}

function fileIcon(filename) {
  const extension = filename.split('.').pop().toUpperCase();
  return ({ PDF: 'PDF', XLSX: 'XLS', DOCX: 'DOC', DOC: 'DOC', JPG: 'IMG', JPEG: 'IMG', PNG: 'IMG', EML: 'EML', MSG: 'MSG', TXT: 'TXT' })[extension] || 'FILE';
}
function evidenceRows() {
  const pending = workspaceFor().uploadedFiles.filter(item => !item.saved).map(item => ({
    id: item.id, kind: 'file', filename: item.file.name, activity: item.file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '), date: 'Not saved', status: 'Ready to submit', url: URL.createObjectURL(item.file), pending: true, canDelete: true,
  }));
  if (workspaceFor().emailText && !workspaceFor().emailSaved) pending.unshift({ id: workspaceFor().emailId, kind: 'email', filename: 'Pasted Outlook thread.eml', activity: 'Outlook thread', date: 'Not saved', status: 'Ready to submit', url: '', pending: true, canDelete: true });
  const persisted = savedUploads.map(item => ({
    id: item.id, kind: 'persisted', filename: item.filename, activity: item.mime_type.startsWith('text/') ? 'Saved text evidence' : 'Saved file evidence', date: formatDate(item.uploaded_at), status: 'Submitted', url: apiUrl(`/api/uploads/${item.id}/download`), size: item.size_bytes, canDelete: Boolean(currentUser && item.can_delete),
  }));
  return [...pending, ...persisted];
}
function evidenceActions(row) {
  const submit = row.pending
    ? `<button class="primary-btn evidence-submit" type="button" data-evidence-submit="${escapeHtml(row.id)}">Submit to RO</button>`
    : '<button class="secondary-btn evidence-submitted" type="button" disabled>Submitted</button>';
  const remove = row.canDelete
    ? `<button class="icon-btn evidence-delete" type="button" data-evidence-delete="${escapeHtml(row.id)}" data-evidence-kind="${escapeHtml(row.kind)}" aria-label="Delete ${escapeHtml(row.filename)}" title="Delete evidence">🗑</button>`
    : '';
  return `<div class="evidence-actions">${submit}${remove}</div>`;
}
function renderEvidence() {
  const rows = evidenceRows();
  $('#recent-list').innerHTML = rows.slice(0, 3).map(item => `<div class="evidence-row"><div class="file-icon">${fileIcon(item.filename)}</div><div><strong>${escapeHtml(item.activity)}</strong><small>${escapeHtml(item.filename)} · ${escapeHtml(item.date)}</small></div><span class="status">${escapeHtml(item.status)}</span></div>`).join('') || emptyState('No evidence yet', 'Upload approved work documents to begin building your portfolio.');
  $('#evidence-table').innerHTML = rows.map(item => `<div class="table-row"><div class="file-icon">${fileIcon(item.filename)}</div><div><strong>${escapeHtml(item.filename)}</strong><small>${escapeHtml(item.date)}${item.size ? ` · ${formatBytes(item.size)}` : ''}</small></div><div><strong>${escapeHtml(item.activity)}</strong><small>${escapeHtml(item.status)}</small></div>${item.url ? `<a class="download-link" href="${item.url}" download>Download</a>` : '<span class="pending-label">Pending</span>'}${evidenceActions(item)}</div>`).join('') || emptyState('Your inbox is empty', 'Choose files or paste an Outlook thread. Submitted items will remain available when you return.');
  $('#file-count-large').textContent = rows.length;
  $('#evidence-count').textContent = rows.length;
  $('#overview-evidence-count').textContent = savedUploads.length;
}
function addFiles(files) {
  const workspace = workspaceFor();
  let added = 0;
  [...files].forEach(file => {
    const extension = file.name.split('.').pop().toLowerCase();
    if (!allowedExtensions.has(extension)) {
      toast(`${file.name} is not a supported file type.`);
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast(`${file.name} is larger than 25 MB.`);
      return;
    }
    workspace.uploadedFiles.push({ id: newDraftId(), file, saved: false });
    added += 1;
  });
  renderEvidence();
  if (added) toast(`${added} file${added === 1 ? '' : 's'} added to the inbox`);
}
function addEmailEvidence() {
  const text = $('#email-text').value.trim();
  if (!text) {
    toast('Paste some email content first.');
    return;
  }
  const workspace = workspaceFor();
  workspace.emailText = text;
  workspace.emailSaved = false;
  workspace.emailId = newDraftId();
  $('#paste-panel').classList.add('hidden');
  $('#email-text').value = '';
  renderEvidence();
  toast('Outlook thread added to the inbox.');
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, dataUrl: reader.result });
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}
async function submitEvidence(id) {
  const status = $('#evidence-save-status');
  const workspace = workspaceFor();
  const file = workspace.uploadedFiles.find(item => item.id === id && !item.saved);
  const isEmail = id === workspace.emailId && workspace.emailText && !workspace.emailSaved;
  if (!file && !isEmail) {
    status.textContent = 'This evidence item is no longer available to submit.';
    return;
  }
  const button = document.querySelector(`[data-evidence-submit="${CSS.escape(id)}"]`);
  setBusy(button, true, 'Submitting…', 'Submit to RO');
  status.textContent = 'Submitting evidence to your private workspace…';
  try {
    if (file) {
      const encoded = await fileToDataUrl(file.file);
      await request('/api/uploads', jsonOptions('POST', { context: 'evidence', ...encoded }));
      file.saved = true;
    } else {
      await request('/api/uploads/text', jsonOptions('POST', { text: workspace.emailText, filename: 'Pasted Outlook thread.eml' }));
      workspace.emailSaved = true;
    }
    savedUploads = (await request('/api/uploads?context=evidence')).items;
    status.textContent = 'Evidence submitted.';
    renderEvidence();
    toast('Evidence submitted.');
  } catch (problem) {
    status.textContent = problem.message;
  } finally {
    if (button?.isConnected) setBusy(button, false, 'Submitting…', 'Submit to RO');
  }
}
async function deleteEvidence(id, kind) {
  const status = $('#evidence-save-status');
  const workspace = workspaceFor();
  if (kind === 'file') {
    workspace.uploadedFiles = workspace.uploadedFiles.filter(item => item.id !== id);
    renderEvidence();
    toast('Draft evidence removed.');
    return;
  }
  if (kind === 'email') {
    workspace.emailText = '';
    workspace.emailSaved = false;
    workspace.emailId = '';
    renderEvidence();
    toast('Draft evidence removed.');
    return;
  }
  const row = savedUploads.find(item => item.id === id);
  if (!row?.can_delete || !currentUser) {
    status.textContent = 'You do not have permission to delete this evidence.';
    return;
  }
  const button = document.querySelector(`[data-evidence-delete="${CSS.escape(id)}"]`);
  setBusy(button, true, 'Deleting…', '🗑');
  try {
    await request(`/api/evidence/${encodeURIComponent(id)}`, jsonOptions('DELETE', {}));
    savedUploads = savedUploads.filter(item => item.id !== id);
    renderEvidence();
    status.textContent = 'Evidence deleted.';
    toast('Evidence deleted.');
  } catch (problem) {
    status.textContent = problem.message;
  } finally {
    if (button?.isConnected) setBusy(button, false, 'Deleting…', '🗑');
  }
}

function mapResult(result) {
  return (result?.mappings || []).filter(mapping => /^[1-6]\./.test(String(mapping.standard_id))).map(mapping => ({
    standardId: mapping.standard_id,
    standard: `${mapping.standard_id} ${mapping.standard_name}`,
    activity: mapping.activity_title,
    confidence: mapping.confidence,
    confidenceScore: ({'No Evidence':0,'Not enough evidence':0,Foundation:.25,Intermediate:.5,Advanced:.75,Expert:1})[mapping.rating || mapping.current_level] ?? 0,
    excerpt: mapping.evidence_excerpt,
    rationale: mapping.rationale,
    source: mapping.source_reference || 'Uploaded evidence',
    currentLevel: mapping.current_level,
    expectedLevel: mapping.expected_level,
    gap: mapping.gap,
  }));
}
function ratingLabel(score) {
  return ['No Evidence', 'Foundation', 'Intermediate', 'Advanced', 'Expert'][Math.max(0, Math.min(4, Math.round(Number(score) * 4)))];
}
function assessmentMappings(assessment) {
  if (!assessment) return mapResult(activeResult());
  return assessment.items.map(item => {
    const mapping = item.ai.mapping;
    return {
      standardId: mapping.standard_id,
      standard: `${mapping.standard_id} ${mapping.standard_name}`,
      activity: mapping.activity_title,
      confidence: ratingLabel(Number(item.effective.confidence_score)),
      confidenceScore: Number(item.effective.confidence_score),
      excerpt: mapping.evidence_excerpt,
      rationale: item.effective.justification,
      source: mapping.source_reference || 'Uploaded evidence',
      currentLevel: mapping.current_level,
      expectedLevel: mapping.expected_level,
      gap: mapping.gap,
      assessmentItem: item,
    };
  });
}
function domainId(mapping) {
  return String(mapping.standardId || '').split('.')[0];
}
function averageConfidenceFor(domain, sourceMappings) {
  const scores = domain[2].map(standard => sourceMappings.filter(mapping => mapping.standardId === standard.split(' ')[0]).map(mapping => Number.isFinite(mapping.confidenceScore) ? mapping.confidenceScore : ({ high: 1, medium: .67, low: .33 })[mapping.confidence] || 0)).filter(values => values.length).map(values => Math.max(...values));
  return scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / domain[2].length * 100) : 0;
}
function mappedCoverage(domain, mappings) {
  return Math.round(new Set(mappings.filter(mapping => domainId(mapping) === domain[0]).map(mapping => mapping.standardId)).size / domain[2].length * 100);
}
function renderCoverage() {
  const mappings = mapResult(activeResult());
  $('#coverage-list').innerHTML = framework.map(domain => {
    const value = mappedCoverage(domain, mappings);
    return `<div class="coverage-item"><label>${escapeHtml(domain[1])}</label><span>${value}% covered</span><div class="coverage-bar"><i style="width:${value}%"></i></div></div>`;
  }).join('');
}
function radarPoint(index, value, radius = 105) {
  const angle = -Math.PI / 2 + Math.PI * 2 * index / framework.length;
  const distance = radius * value / 100;
  return [180 + Math.cos(angle) * distance, 150 + Math.sin(angle) * distance];
}
function renderRadarChart(mappings, target = '#radar-chart') {
  const values = framework.map(domain => averageConfidenceFor(domain, mappings));
  const points = values.map((value, index) => radarPoint(index, value).join(',')).join(' ');
  const rings = [25, 50, 75, 100].map(value => `<polygon points="${framework.map((_, index) => radarPoint(index, value).join(',')).join(' ')}"></polygon>`).join('');
  const axes = framework.map((_, index) => {
    const [x, y] = radarPoint(index, 100);
    return `<line x1="180" y1="150" x2="${x}" y2="${y}"></line>`;
  }).join('');
  const labels = framework.map((domain, index) => {
    const [x, y] = radarPoint(index, 124);
    const anchor = x < 140 ? 'end' : x > 220 ? 'start' : 'middle';
    return `<text x="${x}" y="${y}" text-anchor="${anchor}">${escapeHtml(domain[0] + ' · ' + domain[1].replace(' & ', ' / '))}</text>`;
  }).join('');
  $(target).innerHTML = `<svg viewBox="0 0 360 300" role="img" aria-label="Radar chart showing average rating across six DFP domains"><title>Six-domain average rating</title><g class="radar-grid">${rings}${axes}</g><polygon class="radar-fill" points="${points}"></polygon><g class="radar-points">${values.map((value, index) => { const [x, y] = radarPoint(index, value); return `<circle cx="${x}" cy="${y}" r="4"><title>${escapeHtml(framework[index][1] + ': ' + (value / 25).toFixed(1) + ' / 4 average rating')}</title></circle>`; }).join('')}</g><g class="radar-labels">${labels}</g></svg>`;
}
function confidenceScore(mapping) {
  return Number.isFinite(mapping.confidenceScore) ? Math.round(mapping.confidenceScore * 100) : ({ high: 100, medium: 67, low: 33 })[String(mapping.confidence || '').toLowerCase()] || 0;
}
function domainValues(domain, mappings) {
  return domain[2].map(standard => {
    const matches = mappings.filter(mapping => mapping.standardId === standard.split(' ')[0]);
    return { standard, value: Math.max(0, ...matches.map(confidenceScore)) };
  });
}
function renderDomainChart(mappings) {
  const selected = selectedDomain;
  const chart = $('#domain-chart');
  chart.classList.toggle('is-overview', selected === 'overview');
  if (selected === 'overview') {
    const levels = ['Foundation', 'Intermediate', 'Advanced', 'Expert'];
    const icons = ['✦', '◈', '▲', '◆'];
    chart.innerHTML = `<div class="distribution-grid">${framework.map(domain => {
      const values = domainValues(domain, mappings);
      const counts = [0, 0, 0, 0, 0];
      values.forEach(item => counts[Math.max(0, Math.min(4, Math.round(item.value / 25)))]++);
      const present = levels.map((level, index) => ({ level, index: index + 1, count: counts[index + 1] })).filter(item => item.count > 0);
      return `<button type="button" class="distribution-card" data-domain="${domain[0]}"><span class="distribution-title"><span class="distribution-number" aria-hidden="true">${domain[0].padStart(2, '0')}</span><strong>${escapeHtml(domain[1])}</strong></span><span class="distribution-values">${present.length ? present.map(item => `<span class="level-chip level-chip-${item.index}"><i aria-hidden="true">${icons[item.index - 1]}</i><span>${item.level}</span><b>${Math.round(item.count / values.length * 100)}%</b></span>`).join('') : '<span class="distribution-empty">No rated evidence yet</span>'}</span><span class="domain-chevron" aria-hidden="true">›</span></button>`;
    }).join('')}</div><p class="distribution-note">Percentages are based on all sub-domains, including those without evidence.</p>`;
    return;
  }
  const domain = framework.find(item => item[0] === selected) || framework[0];
  const values = domainValues(domain, mappings);
  chart.innerHTML = `<div class="domain-detail-head"><button type="button" class="domain-back" data-domain-back aria-label="Back to competency overview"><span aria-hidden="true">←</span></button><h4>${escapeHtml(domain[0] + ' · ' + domain[1])}</h4></div><div class="domain-plot"><div class="domain-chart-scale"><span>Expert</span><span>Advanced</span><span>Intermediate</span><span>Foundation</span><span>No Evidence</span></div><div class="domain-chart-scroll" tabindex="0" role="region" aria-label="Sub-domain rating chart, scroll horizontally to view all bars"><div class="bar-chart" style="--bar-count:${values.length}">${values.map(item => `<div class="bar-item"><div class="bar-track"><i style="height:${item.value}%" title="${ratingLabel(item.value / 100)}"></i></div><strong>${ratingLabel(item.value / 100)}</strong><span title="${escapeHtml(item.standard)}">${escapeHtml(item.standard)}</span></div>`).join('')}</div></div></div><p class="chart-note">Highest saved rating per sub-domain. Scroll horizontally to view all bars.</p>`;
}
function confidenceOptions(value) {
  const options = [[0, 'No Evidence'], [.25, 'Foundation'], [.5, 'Intermediate'], [.75, 'Advanced'], [1, 'Expert']];
  return `<option value="">Select rating</option>${options.map(([score, label]) => `<option value="${score}" ${value !== null && Math.abs(Number(value) - score) < .001 ? 'selected' : ''}>${label}</option>`).join('')}`;
}
function sourceLabel(source) {
  if (source === 'reporting_officer_final') return 'Reviewed by Reporting Officer';
  if (source === 'reportee_submitted') return 'Reviewed by Reportee';
  return `Using ${(source || 'ai_generated').replaceAll('_', ' ')}`;
}
function renderAssessmentDomains(items, standardIdFor, renderItem) {
  const groups = framework.map(([id, name]) => ({ id, name, items: [] }));
  const other = { id: '', name: 'Other items', items: [] };
  for (const item of items) {
    const domainId = String(standardIdFor(item) || '').match(/^([1-7])\./)?.[1];
    (groups.find(group => group.id === domainId) || other).items.push(item);
  }
  if (other.items.length) groups.push(other);
  return groups.map(group => `<details class="assessment-domain"><summary><span class="assessment-domain-number">${escapeHtml(group.id || '–')}</span><span class="assessment-domain-title">${escapeHtml(group.name)}</span><span class="assessment-domain-count">${group.items.length} ${group.items.length === 1 ? 'item' : 'items'}</span><span class="assessment-domain-chevron" aria-hidden="true">⌄</span></summary><div class="assessment-domain-items">${group.items.length ? group.items.map(renderItem).join('') : '<p class="assessment-domain-empty">No items in this domain.</p>'}</div></details>`).join('');
}
function renderFindings(mappings) {
  $('#assessment-table').innerHTML = mappings.length ? renderAssessmentDomains(mappings, mapping => mapping.standardId, mapping => {
    const item = mapping.assessmentItem;
    const owner = item?.reportee || {};
    const ai = item?.ai || { confidence_score: mapping.confidenceScore, justification: mapping.rationale };
    const officer = item?.reporting_officer || {};
    return `<details class="gap-domain assessment-finding editable-finding" data-owner-item="${escapeHtml(item?.id || '')}"><summary><span class="gap-domain-number">${escapeHtml(mapping.standardId.split('.')[0])}</span><span class="gap-domain-heading"><strong>${escapeHtml(mapping.standard)}</strong><small>${escapeHtml(mapping.activity)}</small></span><span class="source-badge effective-source">${escapeHtml(sourceLabel(item?.effective.source))}</span><span class="gap-domain-chevron" aria-hidden="true">⌄</span></summary><div class="finding-content"><div class="assessment-layers"><section class="assessment-layer ai-assessment-layer"><span class="source-badge ai-source">✦ AI-generated · non-final</span><strong>${ratingLabel(ai.confidence_score)}</strong><p>${escapeHtml(ai.justification)}</p></section><section class="assessment-layer owner-assessment-layer"><span class="source-badge owner-source">Your response${ownAssessment?.status === 'submitted' ? ' · submitted' : ' · draft'}</span><label>Final rating<select class="owner-confidence" ${ownAssessment?.status === 'submitted' ? 'disabled' : ''} required>${confidenceOptions(owner.confidence_score)}</select></label><label>Final response<textarea class="owner-justification" ${ownAssessment?.status === 'submitted' ? 'disabled' : ''} rows="4" maxlength="5000" placeholder="Explain your final assessment using the evidence shown." required>${escapeHtml(owner.justification || '')}</textarea></label><div class="item-save-row"><button class="secondary-btn save-owner-item" type="button" ${ownAssessment?.status === 'submitted' ? 'disabled' : ''}>Save item</button><span class="item-save-status">${owner.saved_at ? `Saved ${escapeHtml(formatDate(owner.saved_at))}` : 'Not saved'}</span></div></section>${officer.confidence_score !== null && officer.confidence_score !== undefined ? `<section class="assessment-layer officer-final-layer"><span class="source-badge officer-source">Reporting-officer final · authoritative</span><strong>${ratingLabel(officer.confidence_score)}</strong><p>${escapeHtml(officer.justification || '')}</p></section>` : ''}</div><ul><li>Evidence excerpt: ${escapeHtml(mapping.excerpt)}</li><li>Current evidence level: ${escapeHtml(mapping.currentLevel || 'Not enough evidence')}</li><li>Expected level: ${escapeHtml(mapping.expectedLevel || 'Not assessed')}</li>${mapping.gap ? `<li>Development consideration: ${escapeHtml(mapping.gap)}</li>` : ''}</ul><p class="source-citation"><b>Document consulted:</b> ${escapeHtml(mapping.source)}</p></div></details>`;
  }) : emptyState('No assessment yet', 'Run an analysis of your evidence to create an assessment.');
}
function renderAssessment() {
  const mappings = assessmentMappings(ownAssessment);
  $('#assessment-total').textContent = `${new Set(mappings.map(mapping => mapping.standardId)).size} / 23 mapped`;
  $('#assessment-status-label').textContent = ownAssessment?.status === 'submitted' ? `Submitted ${formatDate(ownAssessment.submitted_at)}` : ownAssessment ? 'Draft · not submitted' : 'Not started';
  $('#save-assessment').textContent = ownAssessment?.status === 'submitted' ? 'Reverse submission' : 'Submit assessment';
  $('#mapping-count').textContent = mappings.length;
  $('#overview-standards-count').textContent = new Set(mappings.map(mapping => mapping.standardId)).size;
  renderRadarChart(mappings);
  renderDomainChart(mappings);
  renderFindings(mappings);
}
async function analyzeWithOpenAI() {
  const button = $('#analyze-ai');
  const status = $('#ai-status');
  const profileAtSubmit = { ...activePharmacist };
  const workspace = workspaceFor(pharmacistKey(profileAtSubmit));
  const files = await Promise.all(workspace.uploadedFiles.map(item => fileToDataUrl(item.file)));
  if (workspace.emailText.trim()) files.push({ name: 'Pasted Outlook thread.eml', text: workspace.emailText });
  if (!files.length) {
    status.textContent = 'Upload a file or paste an Outlook thread first.';
    return;
  }
  setBusy(button, true, 'Running AI analysis…', 'Run AI Analysis →');
  status.textContent = 'Sending approved evidence to the secure server…';
  try {
    const data = await request('/api/map', jsonOptions('POST', { profile: { name: profileAtSubmit.name, grade: profileAtSubmit.grade, track: profileAtSubmit.track }, files }));
    workspace.result = data.result;
    ownAssessment = (await request('/api/assessment')).assessment;
    if (pharmacistKey() === pharmacistKey(profileAtSubmit)) renderAll();
    status.textContent = `Analysis complete · ${data.model}`;
    toast('AI analysis complete.');
  } catch (problem) {
    status.textContent = problem.message;
  } finally {
    setBusy(button, false, 'Running AI analysis…', activeResult() ? 'Run AI Analysis again →' : 'Run AI Analysis →');
  }
}
async function saveAssessment() {
  const status = $('#assessment-save-status');
  if (ownAssessment?.status === 'submitted') {
    try {
      ownAssessment = (await request('/api/assessment/reverse-submission', jsonOptions('POST', {}))).assessment;
      renderAssessment();
      status.textContent = 'Submission reversed. You can amend and resubmit your assessment.';
    } catch (problem) { status.textContent = problem.message; }
    return;
  }
  if (!ownAssessment) {
    status.textContent = 'Run an evidence analysis before submitting an assessment.';
    return;
  }
  const button = $('#save-assessment');
  setBusy(button, true, 'Submitting…', 'Submit assessment');
  try {
    const rows = $$('[data-owner-item]');
    for (const row of rows) await saveOwnerItem(row.dataset.ownerItem, false);
    ownAssessment = (await request('/api/assessment/submit', jsonOptions('POST', {}))).assessment;
    renderAssessment();
    $('#assessment-save-status').textContent = 'Assessment submitted to your reporting officer.';
    toast('Assessment submitted.');
  } catch (problem) {
    status.textContent = problem.message;
  } finally {
    setBusy(button, false, 'Submitting…', ownAssessment?.status === 'submitted' ? 'Reverse submission' : 'Submit assessment');
  }
}

async function saveOwnerItem(itemId, rerender = true) {
  const row = document.querySelector(`[data-owner-item="${CSS.escape(itemId)}"]`);
  if (!row) throw new Error('Assessment item is unavailable.');
  const rawScore = row.querySelector('.owner-confidence').value;
  const justification = row.querySelector('.owner-justification').value.trim();
  if (rawScore === '' || !justification) {
    const domain = row.closest('.assessment-domain');
    if (domain) domain.open = true;
    row.open = true;
    row.querySelector('.item-save-status').textContent = 'Choose a rating and enter a final response.';
    row.querySelector(rawScore === '' ? '.owner-confidence' : '.owner-justification').focus();
    throw new Error('Complete every rating and final response before saving.');
  }
  const button = row.querySelector('.save-owner-item');
  setBusy(button, true, 'Saving…', 'Save item');
  try {
    ownAssessment = (await request(`/api/assessment/items/${encodeURIComponent(itemId)}`, jsonOptions('PUT', { rating_score: Number(rawScore), justification }))).assessment;
    if (rerender) {
      const mappings = assessmentMappings(ownAssessment);
      renderRadarChart(mappings);
      renderDomainChart(mappings);
      row.classList.remove('has-unsaved-changes');
      row.querySelector('.item-save-status').textContent = 'Saved';
      $('#assessment-save-status').textContent = 'Saved. The radar chart now reflects your latest value.';
    }
  } finally {
    if (button.isConnected) setBusy(button, false, 'Saving…', 'Save item');
  }
}

function renderPlan() {
  const result = activeResult();
  const gaps = result?.gaps || [];
  const activities = result?.activities || [];
  const gapList = $('#gap-list');
  const openDomains = new Set([...gapList.querySelectorAll('details[open]')].map(details => details.dataset.gapDomain));
  const renderGap = gap => `<div class="gap-card"><div><h3>${escapeHtml(gap.standard_id)}</h3><p>${escapeHtml(gap.gap)}</p></div><span class="gap-tag">${escapeHtml(gap.priority)} priority</span><div class="gap-actions"><span>${escapeHtml(gap.evidence_needed)}</span><button type="button" data-coach-gap="${escapeHtml(gap.gap)}">Discuss in coaching →</button></div></div>`;
  if (!result) {
    gapList.innerHTML = emptyState('No competency gaps yet', 'Run analysis for this pharmacist to identify relevant competency gaps.');
  } else {
    const groups = framework.map(([id, name]) => ({ id, name, gaps: [] }));
    const unassigned = [];
    gaps.forEach(gap => {
      const match = String(gap.standard_id || '').trim().match(/^([1-7])\.\d+(?:\b|$)/);
      const group = match && groups.find(item => item.id === match[1]);
      (group ? group.gaps : unassigned).push(gap);
    });
    if (unassigned.length) groups.push({ id: 'other', name: 'Other gaps', gaps: unassigned });
    gapList.innerHTML = groups.map(group => `<details class="gap-domain" data-gap-domain="${group.id}"${openDomains.has(group.id) ? ' open' : ''}><summary><span class="gap-domain-number">${group.id === 'other' ? '–' : group.id}</span><span class="gap-domain-heading"><span class="gap-domain-kicker">${group.id === 'other' ? 'REQUIRES REVIEW' : `DOMAIN ${group.id}`}</span><strong>${escapeHtml(group.name)}</strong></span><span class="gap-domain-count">${group.gaps.length} ${group.gaps.length === 1 ? 'gap' : 'gaps'}</span><span class="gap-domain-chevron" aria-hidden="true">⌄</span></summary><div class="gap-domain-content">${group.gaps.length ? group.gaps.map(renderGap).join('') : '<p class="gap-domain-empty">No gaps identified in this domain.</p>'}</div></details>`).join('');
  }
  $('#activity-cards').innerHTML = activities.length ? activities.map(activity => `<article class="panel activity-card"><span class="eyebrow">EVIDENCE ACTIVITY</span><h3>${escapeHtml(activity.title)}</h3><p>${escapeHtml(activity.summary)}</p><small>${escapeHtml(activity.source_reference)} · ${escapeHtml(activity.date_or_period)}</small></article>`).join('') : emptyState('No mapped activities', 'Run analysis to create an activity view.');
  $('#gap-tab-count').textContent = gaps.length;
  $('#plan-standard-count').textContent = new Set(mapResult(result).map(mapping => mapping.standardId)).size;
  $('#plan-gap-count').textContent = gaps.length;
  $('#plan-activity-count').textContent = activities.length;
}
function renderReadOnlyDevelopmentResponse(response) {
  const items = response?.action_items || [];
  $('#reportee-action-items').innerHTML = items.length ? items.map(item => `<tr><td>${escapeHtml(item.action_item)}</td><td>${escapeHtml(item.target_date || '—')}</td><td>${escapeHtml(item.support_needed || '—')}</td></tr>`).join('') : '<tr><td colspan="3" class="read-only-empty">Awaiting your Reporting Officer\'s response.</td></tr>';
  $('#reportee-ro-notes').textContent = response?.discussion_notes || 'Awaiting your Reporting Officer\'s response.';
}
async function loadOwnDevelopmentResponse() {
  try {
    ownDevelopmentResponse = (await request('/api/development-plan-response')).response;
    renderReadOnlyDevelopmentResponse(ownDevelopmentResponse);
  } catch (problem) {
    $('#reportee-ro-notes').textContent = problem.message;
  }
}
function savedBody(item) {
  try { return JSON.parse(item.body); } catch { return { text: item.body || '' }; }
}
function summaryTitle(item) {
  return (item.title || 'Coaching summary').replace(/^Coaching summary\s*·\s*/i, '') || 'Coaching summary';
}
function savedPreview(item, context) {
  const body = savedBody(item);
  if (context === 'coaching') return String(body.summary || body.text || 'Open to read this summary.').replace(/\s+/g, ' ');
  if (body.version === 2) return `${(body.gaps || []).length} objectives · ${(body.response?.action_items || []).length} agreed actions · ${(body.summaries || []).length} coaching summaries`;
  return 'Earlier analysis snapshot: gaps, coaching recommendations and activities.';
}
async function savePlan() {
  const result = activeResult();
  const status = $('#plan-save-status');
  if (!result) { status.textContent = 'Run an evidence analysis before saving a development plan.'; return; }
  const button = $('#save-plan');
  setBusy(button, true, 'Saving…', 'Save plan');
  try {
    // Fetch the latest submitted response so a saved version is a faithful snapshot.
    const response = (await request('/api/development-plan-response')).response;
    ownDevelopmentResponse = response;
    renderReadOnlyDevelopmentResponse(response);
    const selected = new Set($$('[data-include-summary]:checked').map(input => input.dataset.includeSummary));
    const summaries = savedByContext.coaching.filter(item => selected.has(item.id)).map(item => ({ title: item.title, body: savedBody(item), created_at: item.created_at }));
    await request('/api/saved-content', jsonOptions('POST', {
      context: 'development_plan', content_type: 'development_plan',
      title: `Development plan · ${activePharmacist.name} · ${new Date().toLocaleDateString()}`,
      body: JSON.stringify({ version: 2, gaps: result.gaps || [], coaching: result.coaching || [], activities: result.activities || [], response: { action_items: response?.action_items || [], discussion_notes: response?.discussion_notes || '' }, summaries }),
      metadata: { profile: activePharmacist },
    }));
    savedByContext.development_plan = (await request('/api/saved-content?context=development_plan')).items;
    renderSavedItems();
    status.textContent = 'Development plan saved to your account.';
    toast('Development plan saved.');
  } catch (problem) { status.textContent = problem.message; }
  finally { setBusy(button, false, 'Saving…', 'Save plan'); }
}
function renderSavedList(target, items, emptyTitle) {
  if (target === '#saved-assessments') {
    $(target).innerHTML = items.length ? `<div class="saved-items">${items.map(item => `<article class="saved-item"><div><span class="generated-badge">✦ AI-generated</span><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(formatDate(item.created_at))}</p></div><span class="saved-check">Saved</span></article>`).join('')}</div>` : emptyState(emptyTitle, 'Saved items will appear here and remain linked to your account.');
    return;
  }
  const context = target === '#saved-coaching' ? 'coaching' : 'development_plan';
  const selected = new Set([...$(target).querySelectorAll('[data-include-summary]:checked')].map(input => input.dataset.includeSummary));
  $(target).innerHTML = items.length ? `<div class="saved-records">${items.map(item => {
    const body = savedBody(item);
    const title = context === 'coaching' ? summaryTitle(item) : context === 'development_plan' && body.version !== 2 ? 'Analysis snapshot' : item.title;
    const label = context === 'coaching' ? 'summary' : context === 'development_plan' ? 'snapshot' : 'assessment';
    return `<article class="saved-record"><div class="saved-record-main"><span class="saved-record-kind">${context === 'development_plan' && body.version !== 2 ? 'Earlier analysis' : context === 'development_plan' ? 'Plan version' : 'AI-generated'}</span><h4>${escapeHtml(title)}</h4><p class="saved-record-preview">${escapeHtml(savedPreview(item, context))}</p><time>${escapeHtml(formatDate(item.created_at))}</time>${context === 'coaching' ? `<label class="saved-include"><input type="checkbox" data-include-summary="${escapeHtml(item.id)}" ${selected.has(item.id) ? 'checked' : ''}> Include in next saved plan</label>` : ''}</div><div class="saved-record-actions"><button type="button" class="secondary-btn" data-view-saved="${escapeHtml(item.id)}" data-saved-context="${context}">View ${label}</button><details class="saved-menu"><summary aria-label="More options for ${escapeHtml(title)}">⋯</summary><div class="saved-menu-popover">${context === 'coaching' ? `<button type="button" class="menu-action" data-rename-summary="${escapeHtml(item.id)}">Rename summary</button><button type="button" class="delete-link" data-delete-summary="${escapeHtml(item.id)}">Delete summary</button>` : `<button type="button" class="delete-link" data-delete-plan="${escapeHtml(item.id)}">Delete snapshot</button>`}</div></details></div></article>`;
  }).join('')}</div>` : emptyState(emptyTitle, 'Saved items will appear here and remain linked to your account.');
}
function renderSavedItems() {
  renderSavedList('#saved-assessments', savedByContext.assessment, 'No saved assessments');
  renderSavedList('#saved-coaching', savedByContext.coaching, 'No saved coaching summaries');
  renderSavedList('#saved-plans', savedByContext.development_plan, 'No saved development plans');
}
function detailSection(title, content) { return `<section><h3>${escapeHtml(title)}</h3>${content}</section>`; }
function detailText(value) { return `<p class="saved-detail-text">${escapeHtml(value || 'None recorded.')}</p>`; }
function detailList(items, render) { return items?.length ? `<ul>${items.map(item => `<li>${render(item)}</li>`).join('')}</ul>` : '<p class="saved-detail-empty">None recorded.</p>'; }
function summaryContent(body) {
  return detailSection('Summary', detailText(body.summary || body.text)) + (body.action_items?.length ? detailSection('Next steps', detailList(body.action_items, item => escapeHtml(item))) : '');
}
function planContent(body) {
  if (body.text) return detailText(body.text);
  let html = body.version === 2 ? '' : '<p class="saved-detail-notice">This earlier snapshot contains analysis results only. It does not include agreed actions, RO notes or coaching summaries.</p>';
  html += detailSection('Development objectives', detailList(body.gaps, gap => `<strong>${escapeHtml(gap.standard_id || 'Development area')}</strong> ${escapeHtml(gap.gap || '')}${gap.priority ? ` <span>· ${escapeHtml(gap.priority)} priority</span>` : ''}${gap.evidence_needed ? `<p>${escapeHtml(gap.evidence_needed)}</p>` : ''}`));
  html += detailSection('Coaching recommendations', detailList(body.coaching, item => typeof item === 'string' ? escapeHtml(item) : `<strong>${escapeHtml(item.recommendation || '')}</strong><p>${escapeHtml(item.gap || '')}${item.suggested_timeframe ? ` · ${escapeHtml(item.suggested_timeframe)}` : ''}</p>`));
  html += detailSection('Evidence activities', detailList(body.activities, item => `<strong>${escapeHtml(item.title || '')}</strong><p>${escapeHtml(item.summary || '')}</p>`));
  if (body.version === 2) {
    html += detailSection('Agreed action items', detailList(body.response?.action_items, item => `<strong>${escapeHtml(item.action_item)}</strong><p>Target: ${escapeHtml(item.target_date || 'Not set')} · Support: ${escapeHtml(item.support_needed || 'Not specified')}</p>`));
    html += detailSection('RO discussion notes', detailText(body.response?.discussion_notes));
    html += detailSection('Included coaching summaries', detailList(body.summaries, item => `<strong>${escapeHtml(summaryTitle(item))}</strong><p class="saved-detail-text">${escapeHtml(item.body?.summary || item.body?.text || '')}</p>${item.body?.action_items?.length ? `<ul>${item.body.action_items.map(action => `<li>${escapeHtml(action)}</li>`).join('')}</ul>` : ''}`));
  }
  return html;
}
function viewSaved(id, context) {
  const ro = context.startsWith('ro_');
  const baseContext = ro ? context.slice(3) : context;
  const items = ro ? (baseContext === 'coaching' ? reporteeCoachingDevelopment?.coaching_takeaways : reporteeCoachingDevelopment?.saved_development_plans) : savedByContext[baseContext];
  const item = items?.find(entry => entry.id === id);
  context = baseContext;
  if (!item) return;
  const body = savedBody(item), legacy = context === 'development_plan' && body.version !== 2;
  $('#saved-detail-kind').textContent = context === 'coaching' ? 'AI-GENERATED COACHING SUMMARY' : legacy ? 'EARLIER ANALYSIS SNAPSHOT' : 'SAVED PLAN VERSION';
  $('#saved-detail-title').textContent = context === 'coaching' ? summaryTitle(item) : legacy ? 'Analysis snapshot' : item.title;
  $('#saved-detail-date').textContent = `Saved ${formatDate(item.created_at)}`;
  $('#saved-detail-content').innerHTML = context === 'coaching' ? summaryContent(body) : context === 'development_plan' ? planContent(body) : detailText(item.body);
  $('#saved-detail-dialog').showModal();
}

function accordionToolbar(target) {
  return `<div class="accordion-toolbar" data-accordion-controls="${target}"><button type="button" data-expand-all>Expand all</button><button type="button" data-collapse-all>Collapse all</button></div>`;
}
function renderCoachGaps() {
  const gaps = activeResult()?.gaps || [];
  const options = $('#coach-gap-options');
  const openDomains = new Set([...options.querySelectorAll('details[open]')].map(details => details.dataset.coachDomain));
  if (!gaps.length) {
    options.innerHTML = '<p class="coach-no-gaps">Run an evidence analysis to see your competency gaps here.</p>';
  } else {
    const groups = framework.map(([id, name]) => ({ id, name, gaps: [] }));
    const unassigned = [];
    gaps.forEach((gap, index) => {
      const match = String(gap.standard_id || '').trim().match(/^([1-7])\.\d+(?:\b|$)/);
      const group = match && groups.find(item => item.id === match[1]);
      (group ? group.gaps : unassigned).push({ gap, index });
    });
    if (unassigned.length) groups.push({ id: 'other', name: 'Other gaps', gaps: unassigned });
    options.innerHTML = groups.map(group => `<details class="gap-domain coach-gap-domain" data-coach-domain="${group.id}"${openDomains.has(group.id) ? ' open' : ''}><summary><span class="gap-domain-number">${group.id === 'other' ? '–' : group.id}</span><span class="gap-domain-heading"><span class="gap-domain-kicker">${group.id === 'other' ? 'REQUIRES REVIEW' : `DOMAIN ${group.id}`}</span><strong>${escapeHtml(group.name)}</strong></span><span class="gap-domain-count">${group.gaps.length}</span><span class="gap-domain-chevron" aria-hidden="true">⌄</span></summary><div class="gap-domain-content">${group.gaps.length ? `<label class="coach-domain-select"><input type="checkbox" data-coach-domain-select="${group.id}"><span>Select all in this domain</span></label>` + group.gaps.map(({ gap, index }) => `<label class="coach-gap-option"><input type="checkbox" data-coach-gap-index="${index}" ${selectedCoachGaps.has(gap.gap) ? 'checked' : ''}><span><strong>${escapeHtml(gap.standard_id || 'Development area')}</strong>${escapeHtml(gap.gap)}</span></label>`).join('') : '<p class="gap-domain-empty">No gaps identified in this domain.</p>'}</div></details>`).join('');
  }
  const selectedCount = gaps.filter(gap => selectedCoachGaps.has(gap.gap)).length;
  $('#coach-gap-count').textContent = `${selectedCount} selected`;
  const all = $('#coach-select-all');
  all.disabled = !gaps.length;
  all.checked = gaps.length > 0 && selectedCount === gaps.length;
  all.indeterminate = selectedCount > 0 && selectedCount < gaps.length;
  options.querySelectorAll('[data-coach-domain-select]').forEach(input => {
    const indices = [...input.closest('details').querySelectorAll('[data-coach-gap-index]')];
    const count = indices.filter(item => item.checked).length;
    input.checked = count === indices.length;
    input.indeterminate = count > 0 && count < indices.length;
  });
}
function openCoachDialog() {
  setCoachTab('chat');
  if (!$('#coach-dialog').open) $('#coach-dialog').showModal();
  renderCoachGaps();
  $('#chat-input').focus();
}
function setCoachTab(name) {
  $('#coach-dialog').dataset.tab = name;
  $$('[data-coach-tab]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.coachTab === name)));
}
function renderCoachStarters() {
  const recommendations = activeResult()?.coaching || [];
  $('#coach-context').textContent = activePharmacist.name ? `FOR ${activePharmacist.name.toUpperCase()} · ${activePharmacist.grade} · ${activePharmacist.track.toUpperCase()}` : 'PRIVATE COACHING';
  $('#coach-starters').innerHTML = recommendations.length ? `<span>Evidence-informed starters</span>${recommendations.slice(0, 3).map(item => `<button type="button" data-starter="${escapeHtml(item.gap)}">${escapeHtml(item.gap)}</button>`).join('')}` : '';
}
async function loadConversations(force = false) {
  if (conversations.length && !force) {
    renderConversationList();
    return;
  }
  try {
    conversations = (await request('/api/coaching/conversations')).conversations;
    renderConversationList();
    if (!currentConversation && conversations.length) await openConversation(conversations[0].id);
    else renderChat();
  } catch (problem) {
    $('#coaching-status').textContent = problem.message;
  }
}
function renderConversationList() {
  $('#conversation-list').innerHTML = conversations.length ? conversations.map(item => `<div class="conversation-row"><button type="button" class="conversation-item ${currentConversation?.id === item.id ? 'active' : ''}" data-conversation-id="${escapeHtml(item.id)}"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(formatDate(item.updated_at))}</span></button><button type="button" class="rename-link" data-rename-conversation="${escapeHtml(item.id)}" aria-label="Rename conversation ${escapeHtml(item.title)}">Rename</button><button type="button" class="delete-link" data-delete-conversation="${escapeHtml(item.id)}" aria-label="Delete conversation ${escapeHtml(item.title)}">Delete</button></div>`).join('') : emptyState('No conversations yet', 'Start a new coaching conversation when you are ready.');
}
let renameTarget = null;
function openRename(kind, id) {
  const item = kind === 'conversation' ? conversations.find(entry => entry.id === id) : savedByContext.coaching.find(entry => entry.id === id);
  if (!item) return;
  renameTarget = { kind, id };
  $('#rename-title').textContent = kind === 'conversation' ? 'Rename conversation' : 'Rename coaching summary';
  $('#rename-input').value = kind === 'conversation' ? item.title : summaryTitle(item);
  $('#rename-error').textContent = '';
  $('#rename-dialog').showModal();
  $('#rename-input').focus();
  $('#rename-input').select();
}
$('#rename-cancel').addEventListener('click', () => $('#rename-dialog').close());
$('#rename-form').addEventListener('submit', async event => {
  event.preventDefault();
  const title = $('#rename-input').value.trim();
  if (!title) { $('#rename-error').textContent = 'Enter a name.'; return; }
  const target = renameTarget;
  if (!target) return;
  const button = $('#rename-save');
  setBusy(button, true, 'Saving…', 'Save name');
  $('#rename-error').textContent = '';
  try {
    const path = target.kind === 'conversation' ? `/api/coaching/conversations/${encodeURIComponent(target.id)}` : `/api/coaching/summaries/${encodeURIComponent(target.id)}`;
    const data = await request(path, jsonOptions('PATCH', { title }));
    if (target.kind === 'conversation') {
      conversations = conversations.map(item => item.id === target.id ? data.conversation : item);
      if (currentConversation?.id === target.id) { currentConversation = data.conversation; renderChat(); }
      renderConversationList();
    } else {
      savedByContext.coaching = savedByContext.coaching.map(item => item.id === target.id ? data.item : item);
      renderSavedItems();
    }
    $('#rename-dialog').close();
    toast('Name saved.');
  } catch (problem) { $('#rename-error').textContent = problem.message; }
  finally { setBusy(button, false, 'Saving…', 'Save name'); }
});
async function deleteConversation(id) {
  if (!await confirmAction('Delete conversation?', 'The conversation and its messages will be permanently deleted. Saved coaching summaries remain available.', 'Delete conversation')) return;
  try {
    await request(`/api/coaching/conversations/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'x-requested-with': 'PharmPath' } });
    conversations = conversations.filter(item => item.id !== id);
    if (currentConversation?.id === id) {
      currentConversation = null; conversationMessages = []; lastSummaryMessageId = null;
      selectedCoachGaps = new Set(); summaryStale = false;
      renderChat();
    }
    renderConversationList();
    toast('Conversation deleted.');
  } catch (problem) { toast(problem.message); }
}
async function deleteCoachingSummary(id) {
  if (!await confirmAction('Delete coaching summary?', 'This saved summary will be permanently deleted. The original conversation will remain.', 'Delete summary')) return;
  try {
    await request(`/api/coaching/summaries/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'x-requested-with': 'PharmPath' } });
    savedByContext.coaching = savedByContext.coaching.filter(item => item.id !== id);
    renderSavedItems();
    toast('Coaching summary deleted.');
  } catch (problem) { toast(problem.message); }
}
async function deletePlanSnapshot(id) {
  if (!await confirmAction('Delete saved snapshot?', 'This saved version will be permanently deleted. Your current plan and coaching summaries will remain.', 'Delete snapshot')) return;
  try {
    await request(`/api/development-plan-snapshots/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'x-requested-with': 'PharmPath' } });
    savedByContext.development_plan = savedByContext.development_plan.filter(item => item.id !== id);
    renderSavedItems();
    toast('Saved snapshot deleted.');
  } catch (problem) { toast(problem.message); }
}
async function createConversation({ preserveSelection = false } = {}) {
  const data = await request('/api/coaching/conversations', jsonOptions('POST', { title: 'New coaching conversation' }));
  conversations.unshift(data.conversation);
  currentConversation = data.conversation;
  conversationMessages = [];
  lastSummaryMessageId = null;
  if (!preserveSelection) selectedCoachGaps = new Set();
  summaryStale = false;
  renderConversationList();
  renderChat();
  $('#chat-input').focus();
  return data.conversation;
}
async function openConversation(id) {
  $('#coaching-status').textContent = 'Opening conversation…';
  try {
    const data = await request(`/api/coaching/conversations/${id}`);
    const sameConversation = currentConversation?.id === data.conversation.id;
    currentConversation = data.conversation;
    conversationMessages = data.messages;
    const latestSummary = [...conversationMessages].reverse().find(message => message.type === 'summary');
    lastSummaryMessageId = latestSummary?.id || null;
    if (!sameConversation) selectedCoachGaps = new Set(latestSummary?.metadata?.selected_gaps || []);
    const selectionChanged = latestSummary && JSON.stringify([...selectedCoachGaps].sort()) !== JSON.stringify([...(latestSummary.metadata?.selected_gaps || [])].sort());
    summaryStale = Boolean(latestSummary && (selectionChanged || conversationMessages.slice(conversationMessages.indexOf(latestSummary) + 1).some(message => message.type === 'chat')));
    renderConversationList();
    renderChat();
    $('#coaching-status').textContent = '';
  } catch (problem) {
    $('#coaching-status').textContent = problem.message;
  }
}
function renderChat() {
  renderCoachStarters();
  renderCoachGaps();
  const summary = [...conversationMessages].reverse().find(message => message.id === lastSummaryMessageId);
  $('#coach-summary-preview').innerHTML = summary ? `<p>${escapeHtml(summary.content)}</p>${summary.metadata?.action_items?.length ? `<ul>${summary.metadata.action_items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}${summaryStale ? '<small>Conversation or selections changed. Summarise again to refresh.</small>' : ''}` : 'Your summary and next steps will appear here.';
  $('#conversation-title').textContent = currentConversation?.title || 'Start a conversation';
  $('#chat-messages').innerHTML = conversationMessages.length ? conversationMessages.map(message => {
    const actions = message.metadata?.action_items || [];
    return `<article class="chat-message ${message.role} ${message.type === 'summary' ? 'summary' : ''}"><div class="message-meta"><strong>${message.role === 'user' ? 'You' : message.type === 'summary' ? 'AI-generated summary' : 'PharmPath coach'}</strong>${message.is_ai_generated ? '<span class="generated-badge">✦ AI-generated</span>' : ''}</div><p>${escapeHtml(message.content)}</p>${actions.length ? `<h4>Actionable next steps</h4><ul>${actions.map(action => `<li>${escapeHtml(action)}</li>`).join('')}</ul>` : ''}</article>`;
  }).join('') : emptyState('A quiet place to think', 'Start with a goal, a challenge, or one of the evidence-informed prompts above.');
  $('#summarize-conversation').disabled = !conversationMessages.some(message => message.type === 'chat');
  $('#save-summary').disabled = !lastSummaryMessageId || summaryStale;
  $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;
}
async function sendMessage(event) {
  event.preventDefault();
  const input = $('#chat-input');
  const content = input.value.trim();
  if (!content) return;
  const button = $('#send-message');
  const status = $('#coaching-status');
  try {
    if (!currentConversation) await createConversation({ preserveSelection: true });
    input.value = '';
    if (lastSummaryMessageId) summaryStale = true;
    conversationMessages.push({ id: `local-${Date.now()}`, role: 'user', type: 'chat', content, is_ai_generated: false, metadata: {} });
    renderChat();
    setBusy(button, true, 'Thinking…', 'Send');
    status.textContent = 'Your coach is thinking…';
    await request(`/api/coaching/conversations/${currentConversation.id}/messages`, jsonOptions('POST', { content, selected_gaps: [...selectedCoachGaps] }));
    await openConversation(currentConversation.id);
    conversations = (await request('/api/coaching/conversations')).conversations;
    currentConversation = conversations.find(item => item.id === currentConversation.id) || currentConversation;
    renderConversationList();
    status.textContent = '';
  } catch (problem) {
    status.textContent = problem.message;
    if (currentConversation) await openConversation(currentConversation.id);
  } finally {
    setBusy(button, false, 'Thinking…', 'Send');
  }
}
async function summarizeConversation() {
  const button = $('#summarize-conversation');
  const status = $('#coaching-status');
  if (!currentConversation) return;
  setBusy(button, true, 'Summarising…', 'Summarise');
  status.textContent = 'Creating a concise summary and next steps…';
  try {
    const data = await request(`/api/coaching/conversations/${currentConversation.id}/summary`, jsonOptions('POST', { selected_gaps: [...selectedCoachGaps] }));
    summaryStale = false;
    conversationMessages.push(data.summary);
    lastSummaryMessageId = data.summary.id;
    renderChat();
    status.textContent = 'Summary ready. Review it, then save it if useful.';
  } catch (problem) {
    status.textContent = problem.message;
  } finally {
    setBusy(button, false, 'Summarising…', 'Summarise');
    button.disabled = !conversationMessages.some(message => message.type === 'chat');
  }
}
async function saveSummary() {
  const button = $('#save-summary');
  const status = $('#coaching-status');
  if (!currentConversation || !lastSummaryMessageId) return;
  setBusy(button, true, 'Saving…', 'Save summary');
  try {
    await request(`/api/coaching/conversations/${currentConversation.id}/summaries/${lastSummaryMessageId}/save`, jsonOptions('POST', {}));
    savedByContext.coaching = (await request('/api/saved-content?context=coaching')).items;
    renderSavedItems();
    status.textContent = 'AI-generated summary and next steps saved.';
    toast('Coaching summary saved.');
  } catch (problem) {
    status.textContent = problem.message;
  } finally {
    setBusy(button, false, 'Saving…', 'Save summary');
  }
}

function scoreClass(score) {
  if (score >= 75) return 'high';
  if (score >= 50) return 'mid';
  if (score >= 25) return 'mid-low';
  return 'low';
}
function dashboardRowsFor(scope, rows) {
  const grade = $(`#${scope}-grade-filter`)?.value || '';
  const section = $(`#${scope}-section-filter`)?.value || '';
  return rows.filter(row => (!grade || row.grade === grade) && (!section || row.section === section));
}
function syncDashboardFilters(scope, rows) {
  for (const [field, values] of [['grade', [...new Set(rows.map(row => row.grade))]], ['section', [...new Set(rows.map(row => row.section))]]]) {
    const select = $(`#${scope}-${field}-filter`);
    if (!select) continue;
    const selected = select.value;
    select.innerHTML = `<option value="">All ${field === 'grade' ? 'job grades' : 'sections'}</option>${values.sort().map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`;
    select.value = values.includes(selected) ? selected : '';
  }
}
async function loadTeamDashboard() {
  $('#team-score-body').innerHTML = '<tr><td colspan="10">Loading authorised team data…</td></tr>';
  try {
    const data = await request('/api/team-dashboard');
    teamRows = data.profiles;
    syncDashboardFilters('team', teamRows);
    const rows = dashboardRowsFor('team', teamRows);
    $('#team-data-note').textContent = `${data.source} · ${rows.length} staff shown`;
    $('#team-score-body').innerHTML = rows.map(profile => {
      const index = teamRows.indexOf(profile);
      const scores = profile.assessment?.domain_scores || [];
      const status = profile.assessment ? (profile.assessment.status === 'submitted' ? 'Submitted' : 'AI / draft') : 'Not assessed';
      return `<tr class="${profile.assessment ? '' : 'not-analysed'}"><td><button class="team-staff-button" data-team-profile="${index}">${escapeHtml(profile.name)}<small>Review assessment →</small></button></td><td><strong>${escapeHtml(profile.grade)} · ${escapeHtml(profile.track)}</strong><small>${escapeHtml(profile.section)} · RO: ${escapeHtml(profile.reporting_officer || 'Not listed')}</small></td>${framework.map((_, scoreIndex) => Number.isFinite(scores[scoreIndex]) ? `<td><span class="team-score ${scoreClass(scores[scoreIndex])}">${scores[scoreIndex]}</span></td>` : '<td><span class="team-score empty">—</span></td>').join('')}<td><span class="overall-score ${profile.assessment ? 'mid' : 'empty'}">${escapeHtml(status)}</span></td></tr>`;
    }).join('') || '<tr><td colspan="10">No pharmacist profiles were found.</td></tr>';
    renderCompetencyLineChart(rows, '#team-line-chart', '#team-chart-note', 'reportee');
  } catch (problem) {
    $('#team-score-body').innerHTML = `<tr><td colspan="10">${escapeHtml(problem.message)}</td></tr>`;
    $('#team-line-chart').innerHTML = emptyState('Chart unavailable', problem.message);
  }
}

async function loadDivisionDashboard() {
  $('#division-score-body').innerHTML = '<tr><td colspan="10">Loading authorised division data…</td></tr>';
  try {
    const data = await request('/api/division-dashboard');
    divisionRows = data.profiles;
    syncDashboardFilters('division', divisionRows);
    const rows = dashboardRowsFor('division', divisionRows);
    $('#division-data-note').textContent = `${data.source} · ${rows.length} staff shown`;
    $('#division-score-body').innerHTML = rows.map(profile => {
      const scores = profile.assessment?.domain_scores || [];
      const status = profile.assessment ? (profile.assessment.status === 'submitted' ? 'Submitted' : 'AI / draft') : 'Not assessed';
      return `<tr class="${profile.assessment ? '' : 'not-analysed'}"><td><strong>${escapeHtml(profile.name)}</strong></td><td><strong>${escapeHtml(profile.grade)} · ${escapeHtml(profile.track)}</strong><small>${escapeHtml(profile.section)} · RO: ${escapeHtml(profile.reporting_officer || 'Not listed')}</small></td>${framework.map((_, scoreIndex) => Number.isFinite(scores[scoreIndex]) ? `<td><span class="team-score ${scoreClass(scores[scoreIndex])}">${scores[scoreIndex]}</span></td>` : '<td><span class="team-score empty">—</span></td>').join('')}<td><span class="overall-score ${profile.assessment ? 'mid' : 'empty'}">${escapeHtml(status)}</span></td></tr>`;
    }).join('') || '<tr><td colspan="10">No pharmacist profiles were found.</td></tr>';
    renderCompetencyLineChart(rows, '#division-line-chart', '#division-chart-note', 'pharmacist');
  } catch (problem) {
    $('#division-score-body').innerHTML = `<tr><td colspan="10">${escapeHtml(problem.message)}</td></tr>`;
    $('#division-line-chart').innerHTML = emptyState('Chart unavailable', problem.message);
  }
}

async function switchDashboardScope(scope) {
  if (scope === 'division' && !currentUser?.capabilities.division_dashboard) return;
  if (scope === 'team' && !currentUser?.capabilities.team_dashboard) return;
  if (scope === 'individual' && !currentUser?.capabilities.reportee_assessment) return;
  $$('.dashboard-scope-tab').forEach(button => button.classList.toggle('active', button.dataset.dashboardScope === scope));
  $('#team-dashboard').classList.toggle('active-view', scope === 'team');
  $('#division-dashboard').classList.toggle('active-view', scope === 'division');
  $('#reportee-assessment').classList.toggle('active-view', scope === 'individual');
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === 'team-dashboard'));
  $('#crumb-label').textContent = 'Team Dashboard';
  if (scope === 'division') await loadDivisionDashboard();
  else if (scope === 'team') await loadTeamDashboard();
  else await loadReportees();
}

function linearTrend(rows) {
  const n = rows.length;
  const sumX = rows.reduce((sum, row) => sum + row.years_in_job_grade, 0);
  const sumY = rows.reduce((sum, row) => sum + row.assessment.percentage_met, 0);
  const sumXY = rows.reduce((sum, row) => sum + row.years_in_job_grade * row.assessment.percentage_met, 0);
  const sumXX = rows.reduce((sum, row) => sum + row.years_in_job_grade ** 2, 0);
  const denominator = n * sumXX - sumX ** 2;
  if (!denominator) return null;
  const slope = (n * sumXY - sumX * sumY) / denominator;
  return { slope, intercept: (sumY - slope * sumX) / n };
}
function renderCompetencyLineChart(rows, chartSelector, noteSelector, noun) {
  const valid = rows.map((row, index) => ({ ...row, rowIndex: index })).filter(row => Number.isFinite(row.years_in_job_grade) && Number.isFinite(row.assessment?.percentage_met));
  const omitted = rows.length - valid.length;
  $(noteSelector).textContent = omitted ? `${omitted} ${noun}${omitted === 1 ? '' : 's'} omitted for missing tenure or assessment data` : `${valid.length} ${noun}${valid.length === 1 ? '' : 's'} plotted`;
  if (!valid.length) {
    $(chartSelector).innerHTML = emptyState('No valid chart data yet', 'Add years in current job grade to the profile CSV and complete an assessment to plot a pharmacist.');
    return;
  }
  const palette = ['#009CA2', '#12458D', '#3e79bd', '#5b8fc9', '#74bec1', '#496a92'];
  const groups = [...new Set(valid.map(row => row.section || row.track))];
  const colourFor = group => palette[groups.indexOf(group) % palette.length];
  const width = 820, height = 390, left = 72, right = 28, top = 24, bottom = 64;
  const xMax = Math.max(1, Math.ceil(Math.max(...valid.map(row => row.years_in_job_grade))));
  const x = value => left + value / xMax * (width - left - right);
  const y = value => top + (100 - value) / 100 * (height - top - bottom);
  const yGrid = [0, 20, 40, 60, 80, 100].map(value => `<g class="scatter-grid"><line x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}"></line><text x="${left - 13}" y="${y(value) + 4}" text-anchor="end">${value}%</text></g>`).join('');
  const xTicks = Array.from({ length: Math.min(xMax, 8) + 1 }, (_, index) => index * xMax / Math.min(xMax, 8)).map(value => `<g class="scatter-grid"><line x1="${x(value)}" y1="${top}" x2="${x(value)}" y2="${height - bottom}"></line><text x="${x(value)}" y="${height - bottom + 24}" text-anchor="middle">${Number.isInteger(value) ? value : value.toFixed(1)}</text></g>`).join('');
  const trends = groups.map(group => {
    const groupRows = valid.filter(row => (row.section || row.track) === group);
    const trend = groupRows.length >= 2 ? linearTrend(groupRows) : null;
    if (!trend) return '';
    const minX = Math.min(...groupRows.map(row => row.years_in_job_grade));
    const maxX = Math.max(...groupRows.map(row => row.years_in_job_grade));
    const valueAt = years => Math.max(0, Math.min(100, trend.intercept + trend.slope * years));
    return `<line class="trend-line" x1="${x(minX)}" y1="${y(valueAt(minX))}" x2="${x(maxX)}" y2="${y(valueAt(maxX))}" stroke="${colourFor(group)}"></line>`;
  }).join('');
  const target = Math.round(valid.reduce((sum, row) => sum + (Number.isFinite(row.target_percentage) ? row.target_percentage : 80), 0) / valid.length);
  const points = valid.map(row => `<circle class="scatter-point" tabindex="0" role="button" aria-label="${escapeHtml(`${row.name}, ${row.assessment.percentage_met}% of standards met, ${row.years_in_job_grade} years in job grade. Activate to open Individual view.`)}" data-dashboard-row="${row.rowIndex}" cx="${x(row.years_in_job_grade)}" cy="${y(row.assessment.percentage_met)}" r="7" fill="${colourFor(row.section || row.track)}"></circle>`).join('');
  const legend = groups.map(group => `<span><i style="background:${colourFor(group)}"></i>${escapeHtml(group)}</span>`).join('');
  $(chartSelector).innerHTML = `<div class="scatter-wrap"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Percentage of competency standards met by years in current job grade">${yGrid}${xTicks}<line class="target-line" x1="${left}" y1="${y(target)}" x2="${width - right}" y2="${y(target)}"></line><text class="target-label" x="${width - right - 5}" y="${y(target) - 8}" text-anchor="end">${target}% average grade target</text>${trends}${points}<text class="axis-label" x="${(left + width - right) / 2}" y="${height - 10}" text-anchor="middle">Years in current job grade</text><text class="axis-label" transform="translate(18 ${(top + height - bottom) / 2}) rotate(-90)" text-anchor="middle">% standards met</text></svg><div class="chart-tooltip" role="status"></div></div><div class="scatter-legend">${legend}<span class="trend-key">Dotted lines show section trends</span></div>`;
  const tooltip = $(`${chartSelector} .chart-tooltip`);
  const showTooltip = (point, event) => {
    const row = rows[Number(point.dataset.dashboardRow)];
    tooltip.innerHTML = `<strong>${escapeHtml(row.name)}</strong><span>${row.assessment.percentage_met}% of standards met</span><span>${row.years_in_job_grade} years in job grade</span><span class="tooltip-action">Tap to open Individual view</span>`;
    const wrapRect = $(`${chartSelector} .scatter-wrap`).getBoundingClientRect();
    const pointRect = point.getBoundingClientRect();
    tooltip.style.left = `${Math.min(wrapRect.width - 230, Math.max(8, (event?.clientX || pointRect.left + pointRect.width / 2) - wrapRect.left + 12))}px`;
    tooltip.style.top = `${Math.max(8, (event?.clientY || pointRect.top) - wrapRect.top - 24)}px`;
    tooltip.classList.add('visible');
  };
  $$(`${chartSelector} .scatter-point`).forEach(point => {
    point.addEventListener('pointerenter', event => showTooltip(point, event));
    point.addEventListener('pointermove', event => showTooltip(point, event));
    point.addEventListener('focus', () => showTooltip(point));
    point.addEventListener('click', event => { showTooltip(point, event); openIndividualDashboard(rows[Number(point.dataset.dashboardRow)]); });
    point.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openIndividualDashboard(rows[Number(point.dataset.dashboardRow)]); } });
    point.addEventListener('pointerleave', () => tooltip.classList.remove('visible'));
    point.addEventListener('blur', () => tooltip.classList.remove('visible'));
  });
}

async function openIndividualDashboard(profile) {
  if (!profile?.user_id) return;
  selectedReportee = profile;
  await switchView('reportee-assessment');
}

async function loadReportees() {
  const select = $('#reportee-select');
  try {
    reportees = (await request('/api/reportees')).reportees;
    select.innerHTML = `<option value="">Select reportee</option>${reportees.map(row => `<option value="${escapeHtml(row.user_id)}">${escapeHtml(row.name)} · ${escapeHtml(row.grade)}</option>`).join('')}`;
    if (!selectedReportee && reportees.length) selectedReportee = reportees[0];
    if (selectedReportee) {
      select.value = selectedReportee.user_id;
      await loadReporteeAssessment(selectedReportee.user_id);
    } else {
      $('#reportee-content').classList.add('hidden');
      $('#reportee-empty').innerHTML = emptyState('No direct reportees', 'This tab is available only when a reporting relationship exists.');
    }
  } catch (problem) {
    $('#reportee-empty').innerHTML = emptyState('Reportee assessments unavailable', problem.message);
  }
}
async function loadReporteeAssessment(userId) {
  selectedReportee = reportees.find(row => row.user_id === userId) || null;
  if (!selectedReportee) return;
  $('#reportee-empty').innerHTML = emptyState('Loading coaching record', `Opening ${selectedReportee.name}'s coaching and development record.`);
  try {
    const [assessmentData, coachingData, evidenceData] = await Promise.all([
      request(`/api/reportee-assessments/${encodeURIComponent(userId)}`),
      request(`/api/reportees/${encodeURIComponent(userId)}/coaching-development`),
      request(`/api/reportees/${encodeURIComponent(userId)}/evidence`),
    ]);
    reporteeAssessment = assessmentData.assessment;
    reporteeCoachingDevelopment = coachingData;
    reporteeEvidence = evidenceData;
    reporteeDevelopmentResponse = { ...reporteeCoachingDevelopment.response, can_edit: Boolean(reporteeCoachingDevelopment.can_edit) };
    roResponseDraft = structuredClone(reporteeDevelopmentResponse);
    renderReporteeAssessment();
    showReporteeDetail('assessment');
  } catch (problem) {
    $('#reportee-content').classList.add('hidden');
    $('#reportee-empty').innerHTML = emptyState('Assessment unavailable', problem.message);
  }
}
function renderReporteeAssessment() {
  const record = reporteeCoachingDevelopment || { coaching_takeaways: [], development_objectives: {}, saved_development_plans: [], chat_history: [] };
  $('#reportee-empty').classList.add('hidden');
  $('#reportee-content').classList.remove('hidden');
  const grade = gradeProfiles[selectedReportee.grade] || gradeProfiles.P13;
  $('#reportee-grade-badge').textContent = selectedReportee.grade;
  $('#reportee-grade-title').textContent = `${selectedReportee.name} · ${grade[0]}`;
  $('#reportee-grade-description').textContent = `${selectedReportee.track} · ${selectedReportee.section} · ${selectedReportee.years_in_job_grade ?? 'Tenure not recorded'}${Number.isFinite(selectedReportee.years_in_job_grade) ? ' years in job grade' : ''}`;
  $('#reportee-submission-status').textContent = record.response?.updated_at ? `RO response updated ${formatDate(record.response.updated_at)}` : 'RO response not submitted';
  renderReporteeCompetency();
  $('#ro-coaching-takeaways').innerHTML = renderRoSavedItems(record.coaching_takeaways, 'No saved coaching takeaways', 'ro_coaching');
  const objectives = record.development_objectives || {};
  const focus = objectives.focus_areas || [];
  const gaps = objectives.gaps || [];
  const groups = framework.map(([id, name]) => ({ id, name, gaps: [], focus: [] }));
  const other = { id: 'other', name: 'Other objectives', gaps: [], focus: [] };
  const domainFor = id => groups.find(group => group.id === String(id || '').trim().match(/^([1-7])\.\d+(?:\b|$)/)?.[1]);
  gaps.forEach(gap => (domainFor(gap.standard_id) || other).gaps.push(gap));
  focus.forEach(item => {
    const matchingGap = gaps.find(gap => gap.gap && item.gap && gap.gap.trim().toLowerCase() === item.gap.trim().toLowerCase());
    (domainFor(item.standard_id) || domainFor(matchingGap?.standard_id) || other).focus.push(item);
  });
  if (other.gaps.length || other.focus.length) groups.push(other);
  const objectiveList = $('#ro-development-objectives');
  const openObjectives = new Set([...objectiveList.querySelectorAll('details[open]')].map(item => item.dataset.objectiveDomain));
  objectiveList.innerHTML = (focus.length || gaps.length) ? `${accordionToolbar('ro-objective-domains')}<div id="ro-objective-domains" class="ro-objective-domains">${groups.map(group => `<details class="gap-domain" data-objective-domain="${group.id}"${openObjectives.has(group.id) ? ' open' : ''}><summary><span class="gap-domain-number">${group.id === 'other' ? '–' : group.id}</span><span class="gap-domain-heading"><span class="gap-domain-kicker">${group.id === 'other' ? 'REQUIRES REVIEW' : `DOMAIN ${group.id}`}</span><strong>${escapeHtml(group.name)}</strong></span><span class="gap-domain-count">${group.gaps.length + group.focus.length}</span><span class="gap-domain-chevron" aria-hidden="true">⌄</span></summary><div class="gap-domain-content ro-objective-list">${group.focus.map(item => `<article><strong>${escapeHtml(item.gap || item.recommendation_type || 'Focus area')}</strong><p>${escapeHtml(item.recommendation || '')}</p></article>`).join('')}${group.gaps.map(item => `<article><strong>${escapeHtml(item.standard_id || 'Development objective')}</strong><p>${escapeHtml(item.gap || item.evidence_needed || '')}</p></article>`).join('') || (!group.focus.length ? '<p class="gap-domain-empty">No objectives identified in this domain.</p>' : '')}</div></details>`).join('')}</div>` : emptyState('No development objectives saved', 'Objectives will appear after the reportee saves an evidence analysis.');
  $('#ro-saved-plans').innerHTML = renderRoSavedItems(record.saved_development_plans, 'No saved development plans', 'ro_development_plan');
  $('#ro-chat-history').innerHTML = record.chat_history?.length ? `${accordionToolbar('ro-chat-domains')}<div class="ro-chat-history" id="ro-chat-domains">${record.chat_history.map(chat => `<details><summary><strong>${escapeHtml(chat.title)}</strong><span>${escapeHtml(formatDate(chat.updated_at))}</span></summary><div>${chat.messages.length ? chat.messages.map(message => `<article class="ro-chat-message ${escapeHtml(message.role)}"><strong>${escapeHtml(message.role === 'assistant' ? 'AI Coaching Assistant' : 'Reportee')}</strong><p>${escapeHtml(message.content)}</p></article>`).join('') : '<p class="read-only-notes">No messages in this conversation.</p>'}</div></details>`).join('')}</div>` : emptyState('No coaching conversations', 'The reportee has not started an AI coaching conversation.');
  renderReporteeEvidence();
  renderReporteeDevelopmentEditor();
}
function renderReporteeEvidence() {
  const items = reporteeEvidence?.items || [];
  const reporteeId = selectedReportee?.user_id || '';
  $('#reportee-evidence-count').textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;
  $('#reportee-evidence-list').innerHTML = items.length ? `<div class="reportee-evidence-list">${items.map(item => `<article><div class="file-icon">${fileIcon(item.filename)}</div><div><strong>${escapeHtml(item.filename)}</strong><span>${escapeHtml(item.mime_type || 'Saved evidence')} · ${escapeHtml(formatBytes(item.size_bytes || 0))}</span></div><time>${escapeHtml(formatDate(item.uploaded_at))}</time><button class="secondary-btn reportee-evidence-download" type="button" data-reportee-evidence-download="${escapeHtml(item.id)}" data-reportee-id="${escapeHtml(reporteeId)}" title="Download file" aria-label="Download ${escapeHtml(item.filename)}">Download</button></article>`).join('')}</div>` : emptyState('No submitted evidence', 'This staff member has not submitted evidence to their inbox yet.');
}
async function downloadReporteeEvidence(reporteeId, uploadId, button) {
  if (!reporteeId || !uploadId) return;
  setBusy(button, true, 'Downloading…', 'Download');
  try {
    const response = await fetch(apiUrl(`/api/reportees/${encodeURIComponent(reporteeId)}/evidence/${encodeURIComponent(uploadId)}/download`), { credentials: 'include' });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(apiError(data, response));
    }
    const disposition = response.headers.get('content-disposition') || '';
    const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || 'evidence-download';
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await response.blob());
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    toast('Download started.');
  } catch (problem) {
    toast(problem.message);
  } finally {
    if (button?.isConnected) setBusy(button, false, 'Downloading…', 'Download');
  }
}
function renderReporteeCompetency() {
  const hasAssessment = Boolean(reporteeAssessment);
  if (!hasAssessment) {
    $('#reverse-reportee-submission').classList.add('hidden');
    $('#submit-officer-review').classList.add('hidden');
    $('#reportee-assessment-table').innerHTML = emptyState('Assessment not submitted', `${selectedReportee.name} has not submitted an assessment for reporting-officer review.`);
    $('#reportee-radar-chart').innerHTML = emptyState('No assessment data', 'No competency profile is available yet.');
    $('#reportee-assessment-total').textContent = '0 / 23 mapped';
    return;
  }
  const mappings = assessmentMappings(reporteeAssessment);
  $('#reportee-assessment-total').textContent = `${new Set(mappings.map(mapping => mapping.standardId)).size} / 23 mapped`;
  renderRadarChart(mappings, '#reportee-radar-chart');
  const canEdit = Boolean(reporteeCoachingDevelopment?.can_edit);
  const reviewSubmitted = reporteeAssessment.officer_status === 'submitted';
  $('#reverse-reportee-submission').classList.toggle('hidden', !canEdit || !reviewSubmitted);
  $('#submit-officer-review').classList.toggle('hidden', !canEdit || reviewSubmitted);
  $('#reportee-save-status').textContent = reviewSubmitted ? 'Review submitted' : 'Review draft';
  $('#reportee-assessment-table').innerHTML = renderAssessmentDomains(reporteeAssessment.items, item => item.ai.mapping.standard_id, item => {
    const mapping = item.ai.mapping;
    const locked = Boolean(item.reporting_officer.saved_at) || !canEdit || reviewSubmitted;
    return `<details class="gap-domain assessment-finding editable-finding" data-officer-item="${escapeHtml(item.id)}"><summary><span class="gap-domain-number">${escapeHtml(String(mapping.standard_id).split('.')[0])}</span><span class="gap-domain-heading"><strong>${escapeHtml(`${mapping.standard_id} ${mapping.standard_name}`)}</strong><small>${escapeHtml(mapping.activity_title)}</small></span><span class="source-badge effective-source">${escapeHtml(sourceLabel(item.effective.source))}</span><span class="gap-domain-chevron" aria-hidden="true">⌄</span></summary><div class="finding-content"><div class="assessment-layers reportee-review-layers"><section class="assessment-layer ai-assessment-layer"><span class="source-badge ai-source">✦ AI-generated · non-final</span><strong>${ratingLabel(item.ai.confidence_score)}</strong><p>${escapeHtml(item.ai.justification)}</p></section><section class="assessment-layer submitted-layer"><span class="source-badge owner-source">Reportee-submitted · non-final after review</span><strong>${item.reportee.confidence_score == null ? 'Not rated' : ratingLabel(item.reportee.confidence_score)}</strong><p>${escapeHtml(item.reportee.justification || '')}</p></section><section class="assessment-layer officer-assessment-layer ${locked ? 'is-locked' : ''}"><span class="source-badge officer-source">Reporting-officer final</span><label>Final rating<select class="officer-confidence" ${locked ? 'disabled' : ''} required>${confidenceOptions(item.reporting_officer.confidence_score)}</select></label><label>Final written assessment<textarea class="officer-justification" rows="4" maxlength="5000" placeholder="Enter the authoritative final assessment." ${locked ? 'disabled' : ''} required>${escapeHtml(item.reporting_officer.justification || '')}</textarea></label><div class="item-save-row">${canEdit && !reviewSubmitted ? `<button class="secondary-btn save-officer-item" type="button">${locked ? 'Edit' : 'Save'}</button>` : ''}<span class="item-save-status">${item.reporting_officer.saved_at ? `Saved ${escapeHtml(formatDate(item.reporting_officer.saved_at))}` : 'Not saved'}</span></div></section></div></div></details>`;
  });
}
function showReporteeDetail(name) {
  const coaching = name === 'coaching';
  const evidence = name === 'evidence';
  $('#reportee-assessment-pane').classList.toggle('hidden', coaching || evidence);
  $('#reportee-coaching-pane').classList.toggle('hidden', !coaching);
  $('#reportee-evidence-pane').classList.toggle('hidden', !evidence);
  $$('.reportee-detail-tab').forEach(button => {
    const active = button.dataset.reporteeDetail === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
}
function renderRoSavedItems(items = [], emptyTitle, context) {
  return items.length ? `<div class="ro-saved-list">${items.map(item => `<article><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(formatDate(item.created_at))}</span><button type="button" class="secondary-btn" data-view-saved="${escapeHtml(item.id)}" data-saved-context="${context}">View ${context === 'ro_coaching' ? 'summary' : 'snapshot'}</button></article>`).join('')}</div>` : emptyState(emptyTitle, 'Items saved by the reportee will appear here.');
}
function renderReporteeDevelopmentEditor() {
  const response = roResponseDraft || { action_items: [], discussion_notes: '' };
  if (!reporteeDevelopmentResponse?.can_edit) {
    $('#ro-plan-editor').innerHTML = '<p class="read-only-notes">This record is read-only. Only the reportee’s direct Reporting Officer can submit an RO response.</p>';
    return;
  }
  const items = response.action_items?.length ? response.action_items : [{ action_item: '', target_date: '', support_needed: '' }];
  $('#ro-plan-editor').innerHTML = `<div id="ro-action-list">${items.map(item => `<div class="ro-action-editor"><textarea class="ro-action-item" rows="3" maxlength="1000" placeholder="Agreed action item">${escapeHtml(item.action_item)}</textarea><input class="ro-target-date" maxlength="120" placeholder="Target date" value="${escapeHtml(item.target_date)}"><textarea class="ro-support-needed" rows="3" maxlength="1000" placeholder="Support needed from RO">${escapeHtml(item.support_needed)}</textarea><button type="button" class="remove-action">Remove</button></div>`).join('')}</div><div class="ro-notes-editor"><label for="ro-discussion-notes">RO discussion notes</label><textarea id="ro-discussion-notes" maxlength="5000" placeholder="Record the discussion, feedback, and agreed follow-up.">${escapeHtml(response.discussion_notes || '')}</textarea></div><div class="ro-plan-actions"><button type="button" class="secondary-btn" id="add-ro-action">+ Add action</button><button type="button" class="secondary-btn" id="cancel-ro-plan">Cancel draft</button><button type="button" class="primary-btn" id="save-ro-plan">Submit RO response</button></div>`;
}
function captureRoResponseDraft() {
  if (!$('#ro-plan-editor')) return;
  roResponseDraft = {
    action_items: [...$$('.ro-action-editor')].map(row => ({ action_item: row.querySelector('.ro-action-item').value, target_date: row.querySelector('.ro-target-date').value, support_needed: row.querySelector('.ro-support-needed').value })),
    discussion_notes: $('#ro-discussion-notes')?.value || '',
  };
}
async function saveReporteeDevelopmentResponse() {
  captureRoResponseDraft();
  const action_items = roResponseDraft.action_items.map(item => ({ action_item: item.action_item.trim(), target_date: item.target_date.trim(), support_needed: item.support_needed.trim() })).filter(item => item.action_item || item.target_date || item.support_needed);
  const discussion_notes = roResponseDraft.discussion_notes.trim();
  const button = $('#save-ro-plan');
  setBusy(button, true, 'Saving…', 'Save response');
  try {
    reporteeDevelopmentResponse = (await request(`/api/reportees/${encodeURIComponent(selectedReportee.user_id)}/development-plan-response`, jsonOptions('PUT', { action_items, discussion_notes }))).response;
    roResponseDraft = structuredClone(reporteeDevelopmentResponse);
    reporteeCoachingDevelopment.response = reporteeDevelopmentResponse;
    renderReporteeDevelopmentEditor();
    $('#ro-plan-save-status').textContent = 'Response submitted. It is now available in the reportee’s read-only plan.';
    toast('RO response saved.');
  } catch (problem) { $('#ro-plan-save-status').textContent = problem.message; }
}
async function saveOfficerItem(itemId) {
  const row = document.querySelector(`[data-officer-item="${CSS.escape(itemId)}"]`);
  const button = row.querySelector('.save-officer-item');
  if (row.querySelector('.officer-confidence').disabled) {
    row.querySelectorAll('.officer-confidence, .officer-justification').forEach(input => { input.disabled = false; });
    row.querySelector('.officer-assessment-layer').classList.remove('is-locked');
    button.textContent = 'Save';
    row.querySelector('.officer-confidence').focus();
    return;
  }
  const rawScore = row.querySelector('.officer-confidence').value;
  const justification = row.querySelector('.officer-justification').value.trim();
  if (rawScore === '' || !justification) {
    row.querySelector('.item-save-status').textContent = 'Choose a score and enter a final assessment.';
    return;
  }
  setBusy(button, true, 'Saving…', 'Save');
  try {
    reporteeAssessment = (await request(`/api/reportee-assessments/${encodeURIComponent(selectedReportee.user_id)}/items/${encodeURIComponent(itemId)}`, jsonOptions('PUT', { rating_score: Number(rawScore), justification }))).assessment;
    row.querySelectorAll('.officer-confidence, .officer-justification').forEach(input => { input.disabled = true; });
    row.querySelector('.officer-assessment-layer').classList.add('is-locked');
    row.classList.remove('has-unsaved-changes');
    row.querySelector('.item-save-status').textContent = 'Saved';
    button.textContent = 'Edit';
    renderRadarChart(assessmentMappings(reporteeAssessment), '#reportee-radar-chart');
    $('#reportee-save-status').textContent = 'Assessment saved as a draft. Submit the review to share it with the reportee.';
    toast('Final assessment saved.');
  } catch (problem) {
    $('#reportee-save-status').textContent = problem.message;
  } finally {
    if (button.isConnected) setBusy(button, false, 'Saving…', row.querySelector('.officer-confidence').disabled ? 'Edit' : 'Save');
  }
}

function renderAll() {
  renderEvidence();
  renderCoverage();
  renderAssessment();
  renderPlan();
  renderCoachStarters();
}

$('#reset-workspace').addEventListener('click', async () => {
  if (!await confirmAction('Reset your workspace?', 'This permanently deletes your DFP analyses and assessment responses, coaching conversations, saved summaries, development plans and reporting-officer plan response. Your saved evidence files will remain.', 'Reset workspace')) return;
  const button = $('#reset-workspace');
  setBusy(button, true, 'Resetting…', 'Reset workspace');
  try {
    await request('/api/workspace/reset', jsonOptions('POST', {}));
    workspaceFor().result = null;
    ownAssessment = null;
    ownDevelopmentResponse = null;
    conversations = [];
    currentConversation = null;
    conversationMessages = [];
    lastSummaryMessageId = null;
    selectedCoachGaps = new Set();
    summaryStale = false;
    await loadWorkspaceData();
    renderReadOnlyDevelopmentResponse(null);
    renderConversationList();
    renderChat();
    renderCoachGaps();
    toast('Your workspace has been reset.');
  } catch (problem) { toast(problem.message); }
  finally { setBusy(button, false, 'Resetting…', 'Reset workspace'); }
});

$('#login-form').addEventListener('submit', login);
$('#logout-button').addEventListener('click', logout);
$$('.nav-item,[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
$('#browse-btn').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', event => { addFiles(event.target.files); event.target.value = ''; });
const dropZone = $('#drop-zone');
['dragenter', 'dragover'].forEach(name => dropZone.addEventListener(name, event => { event.preventDefault(); dropZone.classList.add('dragging'); }));
['dragleave', 'drop'].forEach(name => dropZone.addEventListener(name, event => { event.preventDefault(); dropZone.classList.remove('dragging'); }));
dropZone.addEventListener('drop', event => addFiles(event.dataTransfer.files));
$('#paste-email').addEventListener('click', () => $('#paste-panel').classList.remove('hidden'));
$('#close-paste').addEventListener('click', () => $('#paste-panel').classList.add('hidden'));
$('#analyze-email').addEventListener('click', addEmailEvidence);
$('#copy-outlook-prompt').addEventListener('click', async () => {
  const prompt = $('#outlook-prompt-text');
  const status = $('#copy-prompt-status');
  try {
    await navigator.clipboard.writeText(prompt.value);
    status.textContent = 'Copied to clipboard.';
  } catch {
    prompt.focus();
    prompt.select();
    status.textContent = 'Select and copy the prompt above.';
  }
});
$('#outlook-prompt').addEventListener('toggle', event => {
  if (!event.target.open) $('#copy-prompt-status').textContent = '';
});
document.addEventListener('click', event => {
  const prompt = $('#outlook-prompt');
  if (prompt.open && !prompt.contains(event.target)) prompt.open = false;
});
document.addEventListener('keydown', event => {
  const prompt = $('#outlook-prompt');
  if (event.key === 'Escape' && prompt.open) { prompt.open = false; prompt.querySelector('summary').focus(); }
});
$('#analyze-ai').addEventListener('click', analyzeWithOpenAI);
$('#domain-chart').addEventListener('click', event => {
  const domainButton = event.target.closest('[data-domain]');
  const backButton = event.target.closest('[data-domain-back]');
  if (!domainButton && !backButton) return;
  const previousDomain = selectedDomain;
  selectedDomain = domainButton ? domainButton.dataset.domain : 'overview';
  renderDomainChart(assessmentMappings(ownAssessment));
  const focusTarget = domainButton ? $('[data-domain-back]') : $(`[data-domain="${previousDomain}"]`);
  focusTarget?.focus();
});
$('#save-assessment').addEventListener('click', saveAssessment);
async function changeOfficerSubmission(reverse) {
  const button = reverse ? $('#reverse-reportee-submission') : $('#submit-officer-review');
  if (!reverse && $('#reportee-assessment-table .has-unsaved-changes')) {
    $('#reportee-save-status').textContent = 'Save your changes before submitting the review.';
    return;
  }
  const label = reverse ? 'Reverse submission' : 'Submit review';
  setBusy(button, true, reverse ? 'Reversing…' : 'Submitting…', label);
  try {
    const action = reverse ? 'reverse-submission' : 'submit-review';
    reporteeAssessment = (await request(`/api/reportee-assessments/${encodeURIComponent(selectedReportee.user_id)}/${action}`, jsonOptions('POST', {}))).assessment;
    renderReporteeCompetency();
    $('#reportee-save-status').textContent = reverse ? 'Review submission reversed. Your saved assessments are available to edit.' : 'Review submitted to the reportee.';
  } catch (problem) { $('#reportee-save-status').textContent = problem.message; }
  finally { setBusy(button, false, reverse ? 'Reversing…' : 'Submitting…', label); }
}
$('#reverse-reportee-submission').addEventListener('click', () => changeOfficerSubmission(true));
$('#submit-officer-review').addEventListener('click', () => changeOfficerSubmission(false));
$('#save-plan').addEventListener('click', savePlan);
$('#close-saved-detail').addEventListener('click', () => $('#saved-detail-dialog').close());
$('#new-conversation').addEventListener('click', async () => { await createConversation(); openCoachDialog(); });
$('#open-coaching-chat').addEventListener('click', openCoachDialog);
$('#close-coaching-chat').addEventListener('click', () => $('#coach-dialog').close());
$$('[data-coach-tab]').forEach(button => button.addEventListener('click', () => setCoachTab(button.dataset.coachTab)));
function updateCoachSelection(inputs, checked) {
  const gaps = activeResult()?.gaps || [];
  inputs.forEach(input => {
    const gap = gaps[Number(input.dataset.coachGapIndex)]?.gap;
    if (gap) { if (checked) selectedCoachGaps.add(gap); else selectedCoachGaps.delete(gap); }
  });
  if (lastSummaryMessageId) summaryStale = true;
  renderChat();
}
$('#coach-select-all').addEventListener('change', event => {
  updateCoachSelection([...$('#coach-gap-options').querySelectorAll('[data-coach-gap-index]')], event.target.checked);
  $('#coach-select-all').focus();
});
$('#coach-gap-options').addEventListener('change', event => {
  const input = event.target;
  if (input.matches('[data-coach-domain-select]')) {
    const id = input.dataset.coachDomainSelect;
    updateCoachSelection([...input.closest('details').querySelectorAll('[data-coach-gap-index]')], input.checked);
    $(`[data-coach-domain-select="${id}"]`)?.focus();
  } else if (input.matches('[data-coach-gap-index]')) {
    const index = input.dataset.coachGapIndex;
    updateCoachSelection([input], input.checked);
    $(`[data-coach-gap-index="${index}"]`)?.focus();
  }
});
$('#chat-form').addEventListener('submit', sendMessage);
$('#summarize-conversation').addEventListener('click', summarizeConversation);
$('#save-summary').addEventListener('click', saveSummary);
$('#reportee-select').addEventListener('change', event => loadReporteeAssessment(event.target.value));
function setDevelopmentSection(button, expanded) {
  button.setAttribute('aria-expanded', String(expanded));
  document.getElementById(button.getAttribute('aria-controls')).classList.toggle('hidden', !expanded);
}
$$('[data-development-toggle]').forEach(button => button.addEventListener('click', () => {
  setDevelopmentSection(button, button.getAttribute('aria-expanded') !== 'true');
}));
$('[data-sections-expand]').addEventListener('click', () => $$('[data-development-toggle]').forEach(button => setDevelopmentSection(button, true)));
$('[data-sections-collapse]').addEventListener('click', () => $$('[data-development-toggle]').forEach(button => setDevelopmentSection(button, false)));
document.addEventListener('input', event => {
  if (event.target.closest('#ro-plan-editor')) captureRoResponseDraft();
  const row = event.target.closest('[data-owner-item],[data-officer-item]');
  if (!row || !event.target.matches('select,textarea')) return;
  row.classList.add('has-unsaved-changes');
  row.querySelector('.item-save-status').textContent = 'Unsaved changes';
});
document.addEventListener('click', event => {
  const control = event.target.closest('[data-expand-all],[data-collapse-all]');
  if (control) {
    const target = document.getElementById(control.closest('[data-accordion-controls]').dataset.accordionControls);
    target?.querySelectorAll('details').forEach(details => { details.open = control.hasAttribute('data-expand-all'); });
  }
  const reporteeEvidenceDownload = event.target.closest('[data-reportee-evidence-download]');
  if (reporteeEvidenceDownload) downloadReporteeEvidence(reporteeEvidenceDownload.dataset.reporteeId, reporteeEvidenceDownload.dataset.reporteeEvidenceDownload, reporteeEvidenceDownload);
  const submitEvidenceButton = event.target.closest('[data-evidence-submit]');
  if (submitEvidenceButton) submitEvidence(submitEvidenceButton.dataset.evidenceSubmit);
  const deleteEvidenceButton = event.target.closest('[data-evidence-delete]');
  if (deleteEvidenceButton) deleteEvidence(deleteEvidenceButton.dataset.evidenceDelete, deleteEvidenceButton.dataset.evidenceKind);
  const ownerSave = event.target.closest('.save-owner-item');
  if (ownerSave) saveOwnerItem(ownerSave.closest('[data-owner-item]').dataset.ownerItem).catch(problem => { $('#assessment-save-status').textContent = problem.message; });
  const officerSave = event.target.closest('.save-officer-item');
  if (officerSave) saveOfficerItem(officerSave.closest('[data-officer-item]').dataset.officerItem);
  if (event.target.closest('#add-ro-action')) {
    captureRoResponseDraft();
    $('#ro-action-list').insertAdjacentHTML('beforeend', '<div class="ro-action-editor"><textarea class="ro-action-item" rows="3" maxlength="1000" placeholder="Agreed action item"></textarea><input class="ro-target-date" maxlength="120" placeholder="Target date"><textarea class="ro-support-needed" rows="3" maxlength="1000" placeholder="Support needed from RO"></textarea><button type="button" class="remove-action">Remove</button></div>');
  }
  const removeAction = event.target.closest('.remove-action');
  if (removeAction) { removeAction.closest('.ro-action-editor').remove(); captureRoResponseDraft(); }
  if (event.target.closest('#cancel-ro-plan')) { roResponseDraft = structuredClone(reporteeDevelopmentResponse || { action_items: [], discussion_notes: '' }); renderReporteeDevelopmentEditor(); $('#ro-plan-save-status').textContent = 'Draft changes discarded.'; }
  if (event.target.closest('#save-ro-plan')) saveReporteeDevelopmentResponse();
  const reporteeDetail = event.target.closest('[data-reportee-detail]');
  if (reporteeDetail) showReporteeDetail(reporteeDetail.dataset.reporteeDetail);
  const renameConversationButton = event.target.closest('[data-rename-conversation]');
  if (renameConversationButton) openRename('conversation', renameConversationButton.dataset.renameConversation);
  const renameSummaryButton = event.target.closest('[data-rename-summary]');
  if (renameSummaryButton) openRename('summary', renameSummaryButton.dataset.renameSummary);
  const deleteConversationButton = event.target.closest('[data-delete-conversation]');
  if (deleteConversationButton) deleteConversation(deleteConversationButton.dataset.deleteConversation);
  const viewSavedButton = event.target.closest('[data-view-saved]');
  if (viewSavedButton) viewSaved(viewSavedButton.dataset.viewSaved, viewSavedButton.dataset.savedContext);
  const deletePlanButton = event.target.closest('[data-delete-plan]');
  if (deletePlanButton) deletePlanSnapshot(deletePlanButton.dataset.deletePlan);
  const deleteSummaryButton = event.target.closest('[data-delete-summary]');
  if (deleteSummaryButton) deleteCoachingSummary(deleteSummaryButton.dataset.deleteSummary);
  const conversation = event.target.closest('[data-conversation-id]');
  if (conversation) { openCoachDialog(); openConversation(conversation.dataset.conversationId); }
  const teamProfile = event.target.closest('[data-team-profile]');
  if (teamProfile) {
    const row = teamRows[Number(teamProfile.dataset.teamProfile)];
    selectedReportee = row;
    switchDashboardScope('individual');
  }
  const starter = event.target.closest('[data-starter],[data-coach-gap]');
  if (starter) {
    $('#chat-input').value = `Help me work through this development area: ${starter.dataset.starter || starter.dataset.coachGap}`;
    switchView('coaching-development').then(() => { openCoachDialog(); $('#chat-input').focus(); });
  }
});
$$('.plan-tab').forEach(button => button.addEventListener('click', () => {
  $$('.plan-tab').forEach(item => item.classList.toggle('active', item === button));
  $('#gaps-plan').classList.toggle('hidden', button.dataset.plan !== 'gaps');
  $('#activities-plan').classList.toggle('hidden', button.dataset.plan !== 'activities');
}));
$$('.dashboard-scope-tab').forEach(button => button.addEventListener('click', () => switchDashboardScope(button.dataset.dashboardScope)));
$('#team-grade-filter').addEventListener('change', loadTeamDashboard);
$('#team-section-filter').addEventListener('change', loadTeamDashboard);
$('#division-grade-filter').addEventListener('change', loadDivisionDashboard);
$('#division-section-filter').addEventListener('change', loadDivisionDashboard);
$('#clear-team-filters').addEventListener('click', () => { $('#team-grade-filter').value = ''; $('#team-section-filter').value = ''; loadTeamDashboard(); });
$('#clear-division-filters').addEventListener('click', () => { $('#division-grade-filter').value = ''; $('#division-section-filter').value = ''; loadDivisionDashboard(); });
$('#dashboard-export').addEventListener('click', () => toast('Dashboard export preview ready.'));
$('#export-btn').addEventListener('click', () => toast('Plan export preview ready.'));
window.addEventListener('popstate', () => currentUser && switchView(location.hash.replace('#', '') || 'overview', false));

authenticate();
