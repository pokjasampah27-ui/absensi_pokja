/* ============================================================
 * ABSENSI ADIWIYATA - FRONTEND
 * GitHub Pages + Google Apps Script + Google Spreadsheet
 *
 * SESUAI DENGAN Code.gs:
 *   EMPLOYEES
 *   ATTENDANCE
 *   CLASS_DUTY
 *   SETTINGS
 *   PIKET KELAS
 * ============================================================ */

/* ============================================================
 * KONFIGURASI
 * ============================================================ */

// GANTI DENGAN URL WEB APP GOOGLE APPS SCRIPT KAMU.
// Contoh:
// const API_URL = 'https://script.google.com/macros/s/XXXXXXXX/exec';
const API_URL = 'https://script.google.com/macros/s/AKfycbxas_06nj7D3INUKSNjdzTaft7j38WrGp3596JtF4pF6rINcx7UHvSK5BB3C432RLavPA/exec';

const APP = {
  timezone: 'Asia/Jakarta',
  employees: [],
  classes: [],
  attendanceRows: [],
  classDutyRows: [],
  settings: {},
  activeTab: 'dashboard',
  loaded: false
};

/* ============================================================
 * DOM
 * ============================================================ */

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindNavigation();
  bindForms();
  bindFilters();
  bindQuickActions();
  updateClock();
  setInterval(updateClock, 1000);
  setTodayDefaults();
  renderApiState();

  if (!isApiConfigured()) {
    showToast('Masukkan URL Web App Google Apps Script pada script.js terlebih dahulu.', 'warning', 6000);
    return;
  }

  await loadInitialData();
}

/* ============================================================
 * API
 * ============================================================ */

function isApiConfigured() {
  return API_URL &&
    API_URL.startsWith('https://script.google.com/macros/s/') &&
    API_URL.endsWith('/exec');
}

async function apiGet(action, params = {}) {
  if (!isApiConfigured()) {
    throw new Error('URL Web App belum dikonfigurasi di script.js.');
  }

  const query = new URLSearchParams({ action, ...params });
  const response = await fetch(`${API_URL}?${query.toString()}`, {
    method: 'GET',
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const json = await response.json();

  if (!json.success) {
    throw new Error(json.message || 'Permintaan gagal.');
  }

  return json.data;
}

async function apiPost(action, payload = {}) {
  if (!isApiConfigured()) {
    throw new Error('URL Web App belum dikonfigurasi di script.js.');
  }

  // text/plain menghindari preflight CORS pada Google Apps Script.
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8'
    },
    body: JSON.stringify({
      action,
      ...payload
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const json = await response.json();

  if (!json.success) {
    const error = new Error(json.message || 'Permintaan gagal.');
    error.code = json.errorCode || '';
    error.data = json.data;
    throw error;
  }

  return json.data;
}

/* ============================================================
 * INITIAL DATA
 * ============================================================ */

async function loadInitialData() {
  setLoading(true);

  try {
    const data = await apiGet('getInitialData');

    APP.employees = Array.isArray(data.employees) ? data.employees : [];
    APP.classes = Array.isArray(data.classes) ? data.classes : [];
    APP.settings = data.settings || {};
    APP.loaded = true;

    renderApiState();
    renderAll();
    await refreshData();
  } catch (error) {
    console.error(error);
    renderApiState(error.message);
    showToast(error.message, 'error', 7000);
  } finally {
    setLoading(false);
  }
}

async function refreshData() {
  if (!APP.loaded) return;

  try {
    const [attendance, classDuty] = await Promise.all([
      apiGet('getAttendanceRows'),
      apiGet('getClassDutyRows')
    ]);

    APP.attendanceRows = Array.isArray(attendance) ? attendance : [];
    APP.classDutyRows = Array.isArray(classDuty) ? classDuty : [];

    renderAll();
  } catch (error) {
    console.error(error);
    showToast(`Gagal memuat data: ${error.message}`, 'error');
  }
}

/* ============================================================
 * NAVIGATION
 * ============================================================ */

function bindNavigation() {
  $$('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });

  $$('.mobile-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tab) {
  APP.activeTab = tab;

  $$('.page-section').forEach(section => {
    section.classList.toggle('active', section.id === `page-${tab}`);
  });

  $$('.nav-btn, .mobile-nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  const title = $('#pageTitle');
  const subtitle = $('#pageSubtitle');

  const labels = {
    dashboard: ['Dashboard', 'Ringkasan aktivitas Adiwiyata hari ini'],
    pegawai: ['Presensi Pegawai', 'Kelola kehadiran pegawai secara terpusat'],
    piket: ['Piket Kelas', 'Pantau kehadiran dan kondisi piket kelas'],
    rekap: ['Rekap & Analitik', 'Lihat statistik presensi dan piket']
  };

  if (labels[tab]) {
    title.textContent = labels[tab][0];
    subtitle.textContent = labels[tab][1];
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ============================================================
 * FORMS
 * ============================================================ */

function bindForms() {
  $('#attendanceForm')?.addEventListener('submit', handleAttendanceSubmit);
  $('#classDutyForm')?.addEventListener('submit', handleClassDutySubmit);

  $('#attendanceStatus')?.addEventListener('change', toggleAttendanceNote);
  $('#classDutyAttendance')?.addEventListener('change', toggleDutyFields);

  $('#employeeSearch')?.addEventListener('input', renderAttendanceTable);
  $('#classSearch')?.addEventListener('input', renderClassDutyTable);
}

function bindFilters() {
  $('#attendanceDateFilter')?.addEventListener('change', renderAttendanceTable);
  $('#attendanceStatusFilter')?.addEventListener('change', renderAttendanceTable);
  $('#classDutyDateFilter')?.addEventListener('change', renderClassDutyTable);
  $('#classDutyClassFilter')?.addEventListener('change', renderClassDutyTable);

  $('#recapStart')?.addEventListener('change', renderRecap);
  $('#recapEnd')?.addEventListener('change', renderRecap);
  $('#recapType')?.addEventListener('change', renderRecap);
}

function bindQuickActions() {
  $('#btnRefresh')?.addEventListener('click', async () => {
    await refreshData();
    showToast('Data berhasil diperbarui.', 'success');
  });

  $('#btnGoAttendance')?.addEventListener('click', () => switchTab('pegawai'));
  $('#btnGoPiket')?.addEventListener('click', () => switchTab('piket'));
  $('#btnGoRecap')?.addEventListener('click', () => switchTab('rekap'));

  $('#btnResetAttendance')?.addEventListener('click', resetAttendanceForm);
  $('#btnResetDuty')?.addEventListener('click', resetClassDutyForm);
  $('#btnExportAttendance')?.addEventListener('click', () => exportCsv('attendance'));
  $('#btnExportDuty')?.addEventListener('click', () => exportCsv('classDuty'));
}

/* ============================================================
 * ATTENDANCE
 * ============================================================ */

async function handleAttendanceSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const submit = $('button[type="submit"]', form);

  const payload = {
    nama: $('#employeeName').value,
    idPegawai: $('#employeeId').value,
    jabatan: $('#employeePosition').value,
    tanggal: $('#attendanceDate').value,
    status: $('#attendanceStatus').value,
    keterangan: $('#attendanceNote').value
  };

  if (!payload.nama || !payload.tanggal || !payload.status) {
    showToast('Lengkapi nama, tanggal, dan status.', 'warning');
    return;
  }

  setButtonLoading(submit, true, 'Menyimpan...');

  try {
    await apiPost('saveAttendance', payload);
    showToast('Presensi pegawai berhasil disimpan.', 'success');
    resetAttendanceForm();
    await refreshData();
  } catch (error) {
    if (error.code === 'DUPLICATE_ATTENDANCE') {
      showToast('Presensi pegawai untuk tanggal tersebut sudah ada.', 'warning');
    } else {
      showToast(error.message, 'error');
    }
  } finally {
    setButtonLoading(submit, false, 'Simpan Presensi');
  }
}

function selectEmployee(employee) {
  $('#employeeName').value = employee.name || employee.nama || '';
  $('#employeeId').value = employee.id || '';
  $('#employeePosition').value = employee.position || employee.jabatan || '';

  $('#employeePicker').classList.remove('open');
  $('#employeeName').classList.add('filled');

  const selected = $('#selectedEmployee');
  if (selected) {
    selected.innerHTML = `
      <div class="selected-avatar">${initials(employee.name || employee.nama)}</div>
      <div>
        <strong>${escapeHtml(employee.name || employee.nama)}</strong>
        <span>${escapeHtml(employee.position || employee.jabatan || 'Pegawai')}</span>
      </div>
      <button type="button" class="icon-btn small" onclick="clearSelectedEmployee()" aria-label="Hapus pilihan">×</button>
    `;
    selected.classList.add('show');
  }
}

function clearSelectedEmployee() {
  $('#employeeName').value = '';
  $('#employeeId').value = '';
  $('#employeePosition').value = '';
  $('#selectedEmployee')?.classList.remove('show');
  $('#employeePicker')?.classList.remove('open');
  $('#employeeSearchBox')?.focus();
}

function openEmployeePicker() {
  const picker = $('#employeePicker');
  picker.classList.toggle('open');
  renderEmployeePicker($('#employeeSearchBox')?.value || '');
}

function renderEmployeePicker(search = '') {
  const list = $('#employeePickerList');
  if (!list) return;

  const q = normalize(search);
  const filtered = APP.employees.filter(emp =>
    normalize(emp.name || emp.nama).includes(q) ||
    normalize(emp.position || emp.jabatan).includes(q)
  );

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-picker">Pegawai tidak ditemukan.</div>`;
    return;
  }

  list.innerHTML = filtered.map(emp => `
    <button type="button" class="employee-option" data-id="${escapeAttr(emp.id)}">
      <div class="option-avatar">${initials(emp.name || emp.nama)}</div>
      <div class="option-text">
        <strong>${escapeHtml(emp.name || emp.nama)}</strong>
        <span>${escapeHtml(emp.position || emp.jabatan || 'Pegawai')}</span>
      </div>
    </button>
  `).join('');

  $$('.employee-option', list).forEach(btn => {
    btn.addEventListener('click', () => {
      const employee = APP.employees.find(e => String(e.id) === String(btn.dataset.id));
      if (employee) selectEmployee(employee);
    });
  });
}

function resetAttendanceForm() {
  $('#attendanceForm')?.reset();
  $('#attendanceDate').value = localDateString();
  $('#employeeId').value = '';
  $('#employeePosition').value = '';
  $('#selectedEmployee')?.classList.remove('show');
  $('#attendanceNoteWrap')?.classList.add('hidden');
}

function toggleAttendanceNote() {
  const status = $('#attendanceStatus')?.value;
  $('#attendanceNoteWrap')?.classList.toggle('hidden', status === 'HADIR' || !status);
}

async function deleteAttendance(id) {
  if (!confirm('Hapus data presensi ini? Tindakan ini tidak dapat dibatalkan.')) return;

  try {
    await apiPost('deleteAttendance', { id });
    showToast('Data presensi berhasil dihapus.', 'success');
    await refreshData();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function getFilteredAttendance() {
  const date = $('#attendanceDateFilter')?.value || '';
  const status = $('#attendanceStatusFilter')?.value || '';
  const search = normalize($('#employeeSearch')?.value || '');

  return APP.attendanceRows.filter(row => {
    const rowDate = normalizeDateValue(row.tanggal || row.TANGGAL);
    const rowName = normalize(row.nama || row.NAMA);
    const rowStatus = String(row.status || row.STATUS_KEHADIRAN || '').toUpperCase();

    return (!date || rowDate === date) &&
      (!status || rowStatus === status) &&
      (!search || rowName.includes(search));
  });
}

/* ============================================================
 * CLASS DUTY
 * ============================================================ */

async function handleClassDutySubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const submit = $('button[type="submit"]', form);

  const payload = {
    namaKelas: $('#className').value,
    tanggal: $('#classDutyDate').value,
    kehadiran: $('#classDutyAttendance').value,
    kondisiTongSampah: $('#binCondition').value,
    responPetugasPiket: $('#petugasResponse').value
  };

  if (!payload.namaKelas || !payload.tanggal || !payload.kehadiran ||
      !payload.kondisiTongSampah || !payload.responPetugasPiket) {
    showToast('Lengkapi seluruh data piket kelas.', 'warning');
    return;
  }

  setButtonLoading(submit, true, 'Menyimpan...');

  try {
    await apiPost('saveClassDuty', payload);
    showToast('Data piket kelas berhasil disimpan.', 'success');
    resetClassDutyForm();
    await refreshData();
  } catch (error) {
    if (error.code === 'DUPLICATE_CLASS_DUTY') {
      showToast('Data piket kelas untuk tanggal tersebut sudah ada.', 'warning');
    } else {
      showToast(error.message, 'error');
    }
  } finally {
    setButtonLoading(submit, false, 'Simpan Piket');
  }
}

function selectClass(value) {
  $('#className').value = value;
  $('#classPicker')?.classList.remove('open');

  const selected = $('#selectedClass');
  if (selected) {
    selected.textContent = value;
    selected.classList.add('show');
  }
}

function openClassPicker() {
  const picker = $('#classPicker');
  picker.classList.toggle('open');
  renderClassPicker($('#classPickerSearch')?.value || '');
}

function renderClassPicker(search = '') {
  const list = $('#classPickerList');
  if (!list) return;

  const q = normalize(search);
  const filtered = APP.classes.filter(item =>
    normalize(item.kelas || item.className).includes(q)
  );

  if (!filtered.length) {
    list.innerHTML = `
      <div class="empty-picker">
        Tidak ada kelas pada master <b>PIKET KELAS</b>.
        <br><small>Kamu tetap dapat mengetik nama kelas secara manual.</small>
      </div>`;
    return;
  }

  list.innerHTML = filtered.map(item => {
    const name = item.kelas || item.className;
    return `
      <button type="button" class="class-option" data-class="${escapeAttr(name)}">
        <span class="class-badge">K</span>
        <strong>${escapeHtml(name)}</strong>
      </button>`;
  }).join('');

  $$('.class-option', list).forEach(btn => {
    btn.addEventListener('click', () => selectClass(btn.dataset.class));
  });
}

function toggleDutyFields() {
  const status = $('#classDutyAttendance')?.value;
  const disabled = status !== 'HADIR';

  // Backend tetap membutuhkan kedua field, sehingga saat tidak piket
  // dropdown tetap tersedia. Hanya diberi penjelasan visual.
  $('#dutyConditionHint')?.classList.toggle('show', disabled);
}

function resetClassDutyForm() {
  $('#classDutyForm')?.reset();
  $('#classDutyDate').value = localDateString();
  $('#selectedClass')?.classList.remove('show');
  $('#dutyConditionHint')?.classList.remove('show');
}

async function deleteClassDuty(id) {
  if (!confirm('Hapus data piket kelas ini? Tindakan ini tidak dapat dibatalkan.')) return;

  try {
    await apiPost('deleteClassDuty', { id });
    showToast('Data piket kelas berhasil dihapus.', 'success');
    await refreshData();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function getFilteredClassDuty() {
  const date = $('#classDutyDateFilter')?.value || '';
  const classFilter = normalize($('#classDutyClassFilter')?.value || '');
  const search = normalize($('#classSearch')?.value || '');

  return APP.classDutyRows.filter(row => {
    const rowDate = normalizeDateValue(row.tanggal || row.TANGGAL);
    const rowClass = normalize(row.namaKelas || row.kelas || row.NAMA_KELAS);

    return (!date || rowDate === date) &&
      (!classFilter || rowClass === classFilter) &&
      (!search || rowClass.includes(search));
  });
}

/* ============================================================
 * RENDER ALL
 * ============================================================ */

function renderAll() {
  renderEmployeeCount();
  renderClassCount();
  renderDashboard();
  renderEmployeePicker();
  renderClassPicker();
  renderClassOptions();
  renderAttendanceTable();
  renderClassDutyTable();
  renderRecap();
  renderRecentActivity();
}

function renderEmployeeCount() {
  $('#employeeCount') && ($('#employeeCount').textContent = APP.employees.length);
}

function renderClassCount() {
  $('#classCount') && ($('#classCount').textContent = APP.classes.length);
}

function renderDashboard() {
  const today = localDateString();

  const attendanceToday = APP.attendanceRows.filter(r =>
    normalizeDateValue(r.tanggal || r.TANGGAL) === today
  );

  const dutyToday = APP.classDutyRows.filter(r =>
    normalizeDateValue(r.tanggal || r.TANGGAL) === today
  );

  const hadir = attendanceToday.filter(r =>
    String(r.status || r.STATUS_KEHADIRAN).toUpperCase() === 'HADIR'
  ).length;

  const nonHadir = attendanceToday.length - hadir;

  const dutyHadir = dutyToday.filter(r =>
    String(r.kehadiran || r.KEHADIRAN).toUpperCase() === 'HADIR'
  ).length;

  setText('#todayAttendance', attendanceToday.length);
  setText('#todayPresent', hadir);
  setText('#todayAbsent', nonHadir);
  setText('#todayDuty', dutyHadir);
  setText('#todayDutyTotal', dutyToday.length);

  const attendanceRate = attendanceToday.length
    ? Math.round((hadir / attendanceToday.length) * 100)
    : 0;

  setText('#attendanceRate', `${attendanceRate}%`);
  const ring = $('#attendanceRing');
  if (ring) ring.style.setProperty('--progress', `${attendanceRate * 3.6}deg`);

  const statusPill = $('#todayStatus');
  if (statusPill) {
    statusPill.textContent = attendanceToday.length
      ? `${attendanceToday.length} presensi tercatat`
      : 'Belum ada presensi';
  }
}

function renderAttendanceTable() {
  const tbody = $('#attendanceTableBody');
  const count = $('#attendanceResultCount');
  if (!tbody) return;

  const rows = getFilteredAttendance();

  if (count) count.textContent = `${rows.length} data`;

  if (!rows.length) {
    tbody.innerHTML = emptyTableRow(7, 'Belum ada data presensi yang sesuai filter.');
    return;
  }

  const sorted = [...rows].sort((a, b) => {
    const da = String(a.tanggal || a.TANGGAL || '');
    const db = String(b.tanggal || b.TANGGAL || '');
    return db.localeCompare(da);
  });

  tbody.innerHTML = sorted.map(row => {
    const id = row.ID || row.id || '';
    const name = row.nama || row.NAMA || '-';
    const position = row.jabatan || row.JABATAN || '-';
    const date = normalizeDateValue(row.tanggal || row.TANGGAL);
    const status = String(row.status || row.STATUS_KEHADIRAN || '').toUpperCase();
    const note = row.keterangan || row.KETERANGAN || '-';

    return `
      <tr>
        <td><span class="date-chip">${formatDateDisplay(date)}</span></td>
        <td>
          <div class="person-cell">
            <div class="table-avatar">${initials(name)}</div>
            <div>
              <strong>${escapeHtml(name)}</strong>
              <small>${escapeHtml(position)}</small>
            </div>
          </div>
        </td>
        <td><span class="status-badge ${statusClass(status)}">${escapeHtml(status || '-')}</span></td>
        <td class="muted">${escapeHtml(note)}</td>
        <td class="mono">${escapeHtml(row.ID || id || '-')}</td>
        <td class="muted">${escapeHtml(row.TIMESTAMP || row.timestamp || '-')}</td>
        <td>
          <button class="table-action danger" type="button" onclick="deleteAttendance('${escapeAttr(id)}')">Hapus</button>
        </td>
      </tr>`;
  }).join('');
}

function renderClassDutyTable() {
  const tbody = $('#classDutyTableBody');
  const count = $('#classDutyResultCount');
  if (!tbody) return;

  const rows = getFilteredClassDuty();

  if (count) count.textContent = `${rows.length} data`;

  if (!rows.length) {
    tbody.innerHTML = emptyTableRow(7, 'Belum ada data piket kelas yang sesuai filter.');
    return;
  }

  const sorted = [...rows].sort((a, b) =>
    String(b.tanggal || b.TANGGAL || '').localeCompare(String(a.tanggal || a.TANGGAL || ''))
  );

  tbody.innerHTML = sorted.map(row => {
    const id = row.ID || row.id || '';
    const date = normalizeDateValue(row.tanggal || row.TANGGAL);
    const cls = row.namaKelas || row.kelas || row.NAMA_KELAS || '-';
    const hadir = String(row.kehadiran || row.KEHADIRAN || '').toUpperCase();
    const condition = row.kondisiTongSampah || row.KONDISI_TONG_SAMPAH || '-';
    const response = row.responPetugasPiket || row.RESPON_PETUGAS_PIKET || '-';

    return `
      <tr>
        <td><span class="date-chip">${formatDateDisplay(date)}</span></td>
        <td><span class="class-tag">${escapeHtml(cls)}</span></td>
        <td><span class="status-badge ${hadir === 'HADIR' ? 'success' : 'danger'}">${escapeHtml(hadir || '-')}</span></td>
        <td><span class="condition-pill">${escapeHtml(condition)}</span></td>
        <td>${escapeHtml(response)}</td>
        <td class="mono">${escapeHtml(id || '-')}</td>
        <td>
          <button class="table-action danger" type="button" onclick="deleteClassDuty('${escapeAttr(id)}')">Hapus</button>
        </td>
      </tr>`;
  }).join('');
}

function renderRecentActivity() {
  const container = $('#recentActivity');
  if (!container) return;

  const items = [
    ...APP.attendanceRows.map(r => ({
      type: 'attendance',
      date: normalizeDateValue(r.tanggal || r.TANGGAL),
      name: r.nama || r.NAMA || '-',
      detail: r.status || r.STATUS_KEHADIRAN || '-'
    })),
    ...APP.classDutyRows.map(r => ({
      type: 'duty',
      date: normalizeDateValue(r.tanggal || r.TANGGAL),
      name: r.namaKelas || r.kelas || r.NAMA_KELAS || '-',
      detail: r.kehadiran || r.KEHADIRAN || '-'
    }))
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);

  if (!items.length) {
    container.innerHTML = `<div class="empty-state compact">Belum ada aktivitas.</div>`;
    return;
  }

  container.innerHTML = items.map(item => `
    <div class="activity-item">
      <div class="activity-icon ${item.type}">
        ${item.type === 'attendance' ? '✓' : 'K'}
      </div>
      <div class="activity-main">
        <strong>${escapeHtml(item.name)}</strong>
        <span>${item.type === 'attendance' ? 'Presensi pegawai' : 'Piket kelas'} · ${escapeHtml(item.detail)}</span>
      </div>
      <time>${formatDateDisplay(item.date)}</time>
    </div>
  `).join('');
}

/* ============================================================
 * RECAP
 * ============================================================ */

async function renderRecap() {
  const type = $('#recapType')?.value || 'pegawai';
  const startDate = $('#recapStart')?.value || '';
  const endDate = $('#recapEnd')?.value || '';

  if (!APP.loaded) return;

  if (type === 'pegawai') {
    const result = await safeApiGet('getEmployeeRecap', { startDate, endDate });
    if (!result) return;
    renderEmployeeRecap(result);
  } else {
    const result = await safeApiGet('getClassRecap', { startDate, endDate });
    if (!result) return;
    renderClassRecap(result);
  }
}

async function safeApiGet(action, params) {
  try {
    return await apiGet(action, params);
  } catch (error) {
    console.error(error);
    showToast(`Gagal memuat rekap: ${error.message}`, 'error');
    return null;
  }
}

function renderEmployeeRecap(result) {
  setText('#recapHadir', result.stats?.HADIR || 0);
  setText('#recapIzin', result.stats?.IZIN || 0);
  setText('#recapSakit', result.stats?.SAKIT || 0);
  setText('#recapAlfa', result.stats?.ALFA || 0);
  setText('#recapTotal', result.stats?.TOTAL || 0);

  const details = result.details || {};
  const rows = Object.values(details).sort((a, b) => (b.total || 0) - (a.total || 0));

  const tbody = $('#recapTableBody');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = emptyTableRow(6, 'Belum ada data rekap pada rentang tanggal tersebut.');
    return;
  }

  tbody.innerHTML = rows.map((row, index) => `
    <tr>
      <td><span class="rank">${index + 1}</span></td>
      <td>
        <div class="person-cell">
          <div class="table-avatar">${initials(row.nama)}</div>
          <div>
            <strong>${escapeHtml(row.nama)}</strong>
            <small>${escapeHtml(row.jabatan || '-')}</small>
          </div>
        </div>
      </td>
      <td><span class="number success-text">${row.HADIR || 0}</span></td>
      <td><span class="number warning-text">${row.IZIN || 0}</span></td>
      <td><span class="number info-text">${row.SAKIT || 0}</span></td>
      <td><span class="number danger-text">${row.ALFA || 0}</span></td>
      <td><strong>${row.total || 0}</strong></td>
    </tr>
  `).join('');
}

function renderClassRecap(result) {
  setText('#recapHadir', result.stats?.HADIR || 0);
  setText('#recapIzin', 0);
  setText('#recapSakit', 0);
  setText('#recapAlfa', result.stats?.['TIDAK PIKET'] || 0);
  setText('#recapTotal', result.stats?.TOTAL || 0);

  const details = result.details || {};
  const rows = Object.values(details).sort((a, b) =>
    (b.persentaseKehadiran || 0) - (a.persentaseKehadiran || 0)
  );

  const tbody = $('#recapTableBody');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = emptyTableRow(6, 'Belum ada data rekap piket pada rentang tanggal tersebut.');
    return;
  }

  tbody.innerHTML = rows.map((row, index) => `
    <tr>
      <td><span class="rank">${index + 1}</span></td>
      <td><span class="class-tag">${escapeHtml(row.kelas)}</span></td>
      <td><span class="number success-text">${row.HADIR || 0}</span></td>
      <td><span class="number warning-text">${row['TIDAK PIKET'] || 0}</span></td>
      <td><strong>${row.total || 0}</strong></td>
      <td>
        <div class="progress-inline">
          <div class="mini-progress"><span style="width:${Math.min(100, Number(row.persentaseKehadiran || 0))}%"></span></div>
          <b>${Number(row.persentaseKehadiran || 0).toFixed(2)}%</b>
        </div>
      </td>
    </tr>
  `).join('');

  // Ubah header rekap sesuai jenis data.
  setRecapHeaders('kelas');
}

function setRecapHeaders(type) {
  const headers = $$('#recapTable thead th');
  if (!headers.length) return;

  if (type === 'pegawai') {
    headers[1].textContent = 'Pegawai';
    headers[2].textContent = 'Hadir';
    headers[3].textContent = 'Izin';
    headers[4].textContent = 'Sakit';
    headers[5].textContent = 'Alfa';
    headers[6].textContent = 'Total';
  } else {
    headers[1].textContent = 'Kelas';
    headers[2].textContent = 'Hadir';
    headers[3].textContent = 'Tidak Piket';
    headers[4].textContent = 'Total';
    headers[5].textContent = 'Persentase';
    headers[6].textContent = '';
  }
}

/* ============================================================
 * OPTIONS
 * ============================================================ */

function renderClassOptions() {
  const selectFilter = $('#classDutyClassFilter');
  if (!selectFilter) return;

  const current = selectFilter.value;
  const names = [...new Set(APP.classes.map(c => c.kelas || c.className).filter(Boolean))];

  selectFilter.innerHTML = `
    <option value="">Semua kelas</option>
    ${names.map(name => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`).join('')}
  `;

  if (names.includes(current)) selectFilter.value = current;
}

/* ============================================================
 * CLOCK / DEFAULTS
 * ============================================================ */

function updateClock() {
  const now = new Date();

  const dateText = new Intl.DateTimeFormat('id-ID', {
    timeZone: APP.timezone,
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).format(now);

  const timeText = new Intl.DateTimeFormat('id-ID', {
    timeZone: APP.timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(now);

  setText('#currentDate', dateText);
  setText('#currentTime', timeText);
}

function setTodayDefaults() {
  const today = localDateString();

  ['attendanceDate', 'classDutyDate', 'attendanceDateFilter', 'classDutyDateFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = today;
  });

  const start = $('#recapStart');
  const end = $('#recapEnd');
  if (start && !start.value) start.value = monthStartString();
  if (end && !end.value) end.value = today;
}

/* ============================================================
 * API STATE
 * ============================================================ */

function renderApiState(errorMessage = '') {
  const dot = $('#apiDot');
  const label = $('#apiLabel');
  const banner = $('#configBanner');

  if (!isApiConfigured()) {
    dot?.classList.add('offline');
    if (label) label.textContent = 'Belum terhubung';
    banner?.classList.remove('hidden');
    return;
  }

  if (errorMessage) {
    dot?.classList.add('offline');
    if (label) label.textContent = 'Koneksi bermasalah';
    banner?.classList.remove('hidden');
    const msg = $('#configBannerText');
    if (msg) msg.textContent = errorMessage;
    return;
  }

  dot?.classList.remove('offline');
  if (label) label.textContent = 'Terhubung';
  banner?.classList.add('hidden');
}

/* ============================================================
 * LOADING
 * ============================================================ */

function setLoading(isLoading) {
  document.body.classList.toggle('loading', isLoading);
  $('#globalLoader')?.classList.toggle('show', isLoading);
}

function setButtonLoading(button, loading, text) {
  if (!button) return;

  if (loading) {
    button.dataset.originalText = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span>${text}`;
  } else {
    button.disabled = false;
    button.innerHTML = button.dataset.originalText || text;
  }
}

/* ============================================================
 * EXPORT CSV
 * ============================================================ */

function exportCsv(type) {
  const rows = type === 'attendance'
    ? getFilteredAttendance()
    : getFilteredClassDuty();

  if (!rows.length) {
    showToast('Tidak ada data untuk diekspor.', 'warning');
    return;
  }

  const headers = type === 'attendance'
    ? ['ID', 'TIMESTAMP', 'TANGGAL', 'NAMA', 'JABATAN', 'STATUS_KEHADIRAN', 'KETERANGAN']
    : ['ID', 'TIMESTAMP', 'TANGGAL', 'NAMA_KELAS', 'KEHADIRAN', 'KONDISI_TONG_SAMPAH', 'RESPON_PETUGAS_PIKET'];

  const csvRows = [headers];

  rows.forEach(row => {
    csvRows.push(headers.map(header => {
      let value = row[header];

      if (header === 'NAMA' && !value) value = row.nama || '';
      if (header === 'JABATAN' && !value) value = row.jabatan || '';
      if (header === 'STATUS_KEHADIRAN' && !value) value = row.status || '';
      if (header === 'KETERANGAN' && !value) value = row.keterangan || '';
      if (header === 'NAMA_KELAS' && !value) value = row.namaKelas || row.kelas || '';
      if (header === 'KEHADIRAN' && !value) value = row.kehadiran || '';
      if (header === 'KONDISI_TONG_SAMPAH' && !value) value = row.kondisiTongSampah || '';
      if (header === 'RESPON_PETUGAS_PIKET' && !value) value = row.responPetugasPiket || '';

      return csvEscape(value ?? '');
    }));
  });

  const csv = '\uFEFF' + csvRows.map(row => row.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  a.href = url;
  a.download = `${type === 'attendance' ? 'presensi-pegawai' : 'piket-kelas'}-${localDateString()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  showToast('File CSV berhasil dibuat.', 'success');
}

/* ============================================================
 * TOAST
 * ============================================================ */

function showToast(message, type = 'info', duration = 4000) {
  const container = $('#toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '!' : type === 'warning' ? '!' : 'i'}</div>
    <div class="toast-message">${escapeHtml(message)}</div>
    <button type="button" class="toast-close">×</button>
  `;

  $('.toast-close', toast).addEventListener('click', () => toast.remove());
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('hide');
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

/* ============================================================
 * UTILITIES
 * ============================================================ */

function localDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const get = type => parts.find(p => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function monthStartString() {
  const today = localDateString();
  return `${today.slice(0, 7)}-01`;
}

function normalizeDateValue(value) {
  if (!value) return '';

  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;

    const d = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (d) return `${d[3]}-${String(d[2]).padStart(2, '0')}-${String(d[1]).padStart(2, '0')}`;
  }

  return '';
}

function formatDateDisplay(date) {
  if (!date) return '-';

  const [y, m, d] = date.split('-');
  if (!y || !m || !d) return date;

  return `${d}/${m}/${y}`;
}

function normalize(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function statusClass(status) {
  if (status === 'HADIR') return 'success';
  if (status === 'IZIN') return 'warning';
  if (status === 'SAKIT') return 'info';
  if (status === 'ALFA') return 'danger';
  return '';
}

function emptyTableRow(colspan, message) {
  return `<tr><td colspan="${colspan}"><div class="empty-state">${escapeHtml(message)}</div></td></tr>`;
}

function setText(selector, value) {
  const el = $(selector);
  if (el) el.textContent = value;
}

function csvEscape(value) {
  const text = String(value).replace(/"/g, '""');
  return `"${text}"`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

// Tutup picker ketika klik di luar.
document.addEventListener('click', event => {
  const employeePicker = $('#employeePicker');
  const classPicker = $('#classPicker');

  if (employeePicker && !employeePicker.contains(event.target)) {
    employeePicker.classList.remove('open');
  }

  if (classPicker && !classPicker.contains(event.target)) {
    classPicker.classList.remove('open');
  }
});

// Input pencarian picker.
document.addEventListener('input', event => {
  if (event.target.id === 'employeeSearchBox') {
    renderEmployeePicker(event.target.value);
  }

  if (event.target.id === 'classPickerSearch') {
    renderClassPicker(event.target.value);
  }
});

// Expose functions used by inline buttons.
window.openEmployeePicker = openEmployeePicker;
window.clearSelectedEmployee = clearSelectedEmployee;
window.openClassPicker = openClassPicker;
window.deleteAttendance = deleteAttendance;
window.deleteClassDuty = deleteClassDuty;
