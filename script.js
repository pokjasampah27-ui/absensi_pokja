/* =========================================================
   KEHADIRAN PEGAWAI ADIWIYATA & MONITORING PIKET KELAS
   Frontend Logic (script.js)
   ========================================================= */

const APP_CONFIG = {
  // Ganti dengan Executable Web App URL dari Google Apps Script Anda
  API_URL: "https://script.google.com/macros/s/AKfycbxYOUR_DEPLOYED_SCRIPT_ID_HERE/exec",
  TIMEZONE: "Asia/Jakarta",
  DEBOUNCE_DELAY: 300
};

/* =========================================================
   STATE MANAGEMENT
   ========================================================= */

const state = {
  tab: "dashboard",
  employees: [],
  classes: [],
  attendanceHistory: [],
  dutyHistory: [],
  attendancePage: 1,
  dutyPage: 1,
  attendanceTotalPages: 1,
  dutyTotalPages: 1,
  recap: null,
  server: null
};

/* =========================================================
   DOM HELPERS & UTILS
   ========================================================= */

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

function escapeHTML(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(dateStr) {
  if (!dateStr) return "-";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function todayInputDate() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function debounce(func, delay = APP_CONFIG.DEBOUNCE_DELAY) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => func.apply(this, args), delay);
  };
}

/* =========================================================
   UI STATE, CLOCK & NOTIFICATIONS
   ========================================================= */

function setLoading(isLoading, message = "Memuat...") {
  const loader = $("#globalLoader");
  const loaderText = $("#loaderText");
  if (!loader) return;

  if (isLoading) {
    if (loaderText) loaderText.textContent = message;
    loader.classList.remove("hidden");
  } else {
    loader.classList.add("hidden");
  }
}

function showToast(message, type = "success") {
  const toast = $("#toast");
  if (!toast) return;

  toast.textContent = message;
  toast.className = `toast toast-${type} show`;

  setTimeout(() => {
    toast.className = "toast hidden";
  }, 3500);
}

function setButtonLoading(button, isLoading, loadingText = "Menyimpan...") {
  if (!button) return;
  if (isLoading) {
    button.dataset.originalText = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span> ${loadingText}`;
  } else {
    button.disabled = false;
    if (button.dataset.originalText) {
      button.innerHTML = button.dataset.originalText;
    }
  }
}

function updateConnection(isConnected, statusText = "") {
  const dot = $("#connectionDot");
  const text = $("#connectionText");

  if (dot) {
    dot.className = `connection-dot ${isConnected ? "online" : "offline"}`;
  }
  if (text) {
    text.textContent = statusText || (isConnected ? "Online" : "Offline");
  }
}

function startClock() {
  const clockEl = $("#clockTime");
  const update = () => {
    if (clockEl) {
      const now = new Date();
      clockEl.textContent = now.toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
    }
  };
  update();
  setInterval(update, 1000);
}

/* =========================================================
   API LAYER (GAS FETCH Wrapper)
   ========================================================= */

async function apiGet(action, params = {}) {
  const url = new URL(APP_CONFIG.API_URL);
  url.searchParams.append("action", action);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, value);
    }
  });

  const response = await fetch(url.toString());
  const json = await response.json();

  if (!json.success) {
    throw new Error(json.message || "Gagal mengambil data dari server.");
  }
  return json;
}

async function apiPost(action, body = {}) {
  const url = `${APP_CONFIG.API_URL}?action=${encodeURIComponent(action)}`;
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ payload: JSON.stringify(body) })
  });

  const json = await response.json();

  if (!json.success) {
    throw new Error(json.message || "Gagal mengirim data ke server.");
  }
  return json;
}

/* =========================================================
   INITIALIZATION & TAB SYSTEM
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  startClock();
  initApp().catch(handleError);
  setupEventListeners();
});

async function initApp() {
  setLoading(true, "Menghubungkan ke sistem...");

  try {
    const health = await apiGet("health");
    state.server = health.data;
    updateConnection(true, "Online");

    // Set tanggal default untuk form
    const today = todayInputDate();
    if ($("#attendanceDate")) $("#attendanceDate").value = today;
    if ($("#dutyDate")) $("#dutyDate").value = today;

    // Load Master Data
    await Promise.all([
      loadEmployees(),
      loadClasses()
    ]);

    // Load initial view
    switchTab("dashboard");
  } catch (error) {
    updateConnection(false, "Offline");
    handleError(error);
  } finally {
    setLoading(false);
  }
}

function setupEventListeners() {
  // Navigation Tabs (Desktop Sidebar & Mobile Nav)
  $$(".nav-item, .mobile-nav-item").forEach((tabBtn) => {
    tabBtn.addEventListener("click", (e) => {
      const tabName = e.currentTarget.dataset.tab;
      if (tabName) switchTab(tabName);
    });
  });

  // Attendance Form
  $("#attendanceForm")?.addEventListener("submit", handleAttendanceSubmit);

  // Duty Form
  $("#dutyForm")?.addEventListener("submit", handleDutySubmit);

  // Search & Filter Listeners (Debounced)
  $("#searchAttendance")?.addEventListener(
    "input",
    debounce(() => {
      state.attendancePage = 1;
      loadAttendanceHistory().catch(handleError);
    })
  );

  $("#searchDuty")?.addEventListener(
    "input",
    debounce(() => {
      state.dutyPage = 1;
      loadDutyHistory().catch(handleError);
    })
  );

  // Recap Filters
  $("#recapPeriod")?.addEventListener("change", toggleCustomRange);
  $("#btnApplyRecap")?.addEventListener("click", () => loadRecap().catch(handleError));
  $("#btnExportCSV")?.addEventListener("click", exportRecapCSV);

  // Settings Action
  $("#btnTestConnection")?.addEventListener("click", testConnection);
  $("#btnRefreshHistory")?.addEventListener("click", refreshHistory);
}

function switchTab(tabName) {
  state.tab = tabName;

  // Active state untuk Desktop Nav
  $$(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });

  // Active state untuk Mobile Nav
  $$(".mobile-nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });

  // Toggle Page Visibility
  $$(".page").forEach((page) => {
    const isTarget = page.id === `page-${tabName}` || page.id === tabName;
    page.classList.toggle("active", isTarget);
    page.classList.toggle("hidden", !isTarget);
  });

  // Load Tab Specific Data
  if (tabName === "attendance") {
    loadAttendanceHistory().catch(handleError);
  } else if (tabName === "duty") {
    loadDutyHistory().catch(handleError);
  } else if (tabName === "recap") {
    loadRecap().catch(handleError);
  } else if (tabName === "settings") {
    loadSettingsPage().catch(handleError);
  }
}

/* =========================================================
   MASTER DATA LOADERS
   ========================================================= */

async function loadEmployees() {
  const result = await apiGet("getEmployees");
  state.employees = result.data || [];
  renderEmployeeDropdown(state.employees);
}

function renderEmployeeDropdown(employees) {
  const select = $("#employeeSelect");
  if (!select) return;

  select.innerHTML = '<option value="">-- Pilih Pegawai --</option>';
  employees.forEach((emp) => {
    const opt = document.createElement("option");
    opt.value = emp.id || emp.nama;
    opt.textContent = `${emp.nama} ${emp.jabatan ? `(${emp.jabatan})` : ""}`;
    select.appendChild(opt);
  });
}

async function loadClasses() {
  const result = await apiGet("getClasses");
  state.classes = result.data || [];
  renderClassDropdown(state.classes);
}

function renderClassDropdown(classes) {
  const select = $("#classSelect") || $("#dutyClassSelect");
  if (!select) return;

  select.innerHTML = '<option value="">-- Pilih Kelas --</option>';
  classes.forEach((cls) => {
    const opt = document.createElement("option");
    opt.value = cls.id || cls.namaKelas;
    opt.textContent = cls.namaKelas || cls.kelas;
    select.appendChild(opt);
  });
}

/* =========================================================
   FORM SUBMISSION HANDLERS
   ========================================================= */

async function handleAttendanceSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const submitBtn = form.querySelector('button[type="submit"]');

  const payload = {
    employeeId: $("#employeeSelect")?.value,
    date: $("#attendanceDate")?.value,
    status: $("#attendanceStatus")?.value,
    notes: $("#attendanceNotes")?.value
  };

  if (!payload.employeeId || !payload.date || !payload.status) {
    showToast("Mohon lengkapi seluruh field wajib!", "error");
    return;
  }

  setButtonLoading(submitBtn, true, "Menyimpan Absensi...");

  try {
    await apiPost("submitAttendance", payload);
    showToast("Kehadiran pegawai berhasil dicatat.");
    form.reset();
    if ($("#attendanceDate")) $("#attendanceDate").value = todayInputDate();
    loadAttendanceHistory().catch(handleError);
  } catch (error) {
    handleError(error);
  } finally {
    setButtonLoading(submitBtn, false);
  }
}

async function handleDutySubmit(e) {
  e.preventDefault();
  const form = e.target;
  const submitBtn = form.querySelector('button[type="submit"]');

  const payload = {
    classId: ($("#classSelect") || $("#dutyClassSelect"))?.value,
    date: $("#dutyDate")?.value,
    presenceStatus: $("#dutyPresenceStatus")?.value,
    wasteSeparation: $("#dutyWasteSeparation")?.value,
    adiwiyataAttitude: $("#dutyAttitude")?.value,
    notes: $("#dutyNotes")?.value
  };

  if (!payload.classId || !payload.date || !payload.presenceStatus) {
    showToast("Mohon lengkapi seluruh field wajib!", "error");
    return;
  }

  setButtonLoading(submitBtn, true, "Menyimpan Piket...");

  try {
    await apiPost("submitDuty", payload);
    showToast("Monitoring piket kelas berhasil dicatat.");
    form.reset();
    if ($("#dutyDate")) $("#dutyDate").value = todayInputDate();
    loadDutyHistory().catch(handleError);
  } catch (error) {
    handleError(error);
  } finally {
    setButtonLoading(submitBtn, false);
  }
}

/* =========================================================
   HISTORY DATA LOADERS & RENDERERS
   ========================================================= */

async function loadAttendanceHistory() {
  const search = $("#searchAttendance")?.value || "";
  const params = {
    page: state.attendancePage,
    search: search
  };

  const result = await apiGet("getAttendanceHistory", params);
  state.attendanceHistory = result.data.items || [];
  state.attendanceTotalPages = result.data.totalPages || 1;

  renderAttendanceTable(state.attendanceHistory);
  renderPagination("attendance", state.attendancePage, state.attendanceTotalPages);
}

function renderAttendanceTable(items) {
  const tbody = $("#attendanceTableBody");
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Belum ada riwayat presensi.</td></tr>';
    return;
  }

  tbody.innerHTML = items
    .map(
      (item, index) => `
      <tr>
        <td>${(state.attendancePage - 1) * 10 + (index + 1)}</td>
        <td><strong>${escapeHTML(item.employeeName || item.nama)}</strong></td>
        <td>${formatDate(item.date || item.tanggal)}</td>
        <td>${statusBadge(item.status)}</td>
        <td>${escapeHTML(item.notes || item.catatan || "-")}</td>
      </tr>
    `
    )
    .join("");
}

async function loadDutyHistory() {
  const search = $("#searchDuty")?.value || "";
  const params = {
    page: state.dutyPage,
    search: search
  };

  const result = await apiGet("getDutyHistory", params);
  state.dutyHistory = result.data.items || [];
  state.dutyTotalPages = result.data.totalPages || 1;

  renderDutyTable(state.dutyHistory);
  renderPagination("duty", state.dutyPage, state.dutyTotalPages);
}

function renderDutyTable(items) {
  const tbody = $("#dutyTableBody");
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Belum ada riwayat piket kelas.</td></tr>';
    return;
  }

  tbody.innerHTML = items
    .map(
      (item, index) => `
      <tr>
        <td>${(state.dutyPage - 1) * 10 + (index + 1)}</td>
        <td><strong>${escapeHTML(item.className || item.kelas)}</strong></td>
        <td>${formatDate(item.date || item.tanggal)}</td>
        <td>${statusBadge(item.presenceStatus || item.kehadiran)}</td>
        <td>${statusBadge(item.wasteSeparation || item.pemilahanSampah)}</td>
        <td>${statusBadge(item.adiwiyataAttitude || item.sikap)}</td>
        <td>${escapeHTML(item.notes || item.catatan || "-")}</td>
      </tr>
    `
    )
    .join("");
}

/* =========================================================
   PAGINATION & REFRESH HELPERS
   ========================================================= */

function renderPagination(type, currentPage, totalPages) {
  const container = $(`#${type}Pagination`);
  if (!container) return;

  const current = Number(currentPage) || 1;
  const total = Number(totalPages) || 1;

  container.innerHTML = `
    <span class="pagination-info">Halaman <strong>${current}</strong> dari <strong>${total}</strong></span>
    <div class="pagination-buttons">
      <button class="btn btn-small btn-light" data-pagination="${type}-prev" ${current <= 1 ? "disabled" : ""}>&laquo; Prev</button>
      <button class="btn btn-small btn-light" data-pagination="${type}-next" ${current >= total ? "disabled" : ""}>Next &raquo;</button>
    </div>
  `;

  // Attach button click events
  container
    .querySelector(`[data-pagination="${type}-prev"]`)
    ?.addEventListener("click", () => {
      if (current <= 1) return;
      if (type === "attendance") {
        state.attendancePage--;
        loadAttendanceHistory().catch(handleError);
      } else {
        state.dutyPage--;
        loadDutyHistory().catch(handleError);
      }
    });

  container
    .querySelector(`[data-pagination="${type}-next"]`)
    ?.addEventListener("click", () => {
      if (current >= total) return;
      if (type === "attendance") {
        state.attendancePage++;
        loadAttendanceHistory().catch(handleError);
      } else {
        state.dutyPage++;
        loadDutyHistory().catch(handleError);
      }
    });
}

function refreshHistory() {
  setLoading(true, "Memuat ulang data...");
  Promise.all([
    loadAttendanceHistory(),
    loadDutyHistory()
  ])
    .then(() => showToast("Riwayat berhasil diperbarui."))
    .catch(handleError)
    .finally(() => setLoading(false));
}

function statusBadge(status) {
  if (!status) return `<span class="status-badge neutral">-</span>`;

  const s = String(status).toLowerCase();
  let badgeClass = "neutral";

  if (s === "hadir" || s === "terpilah" || s === "ramah" || s === "sangat baik") {
    badgeClass = "success";
  } else if (s === "izin" || s === "sakit" || s === "acuh" || s === "cukup") {
    badgeClass = "warning";
  } else if (s === "tidak hadir" || s === "tercampur" || s === "kurang" || s === "tidak sopan") {
    badgeClass = "danger";
  }

  return `<span class="status-badge ${badgeClass}">${escapeHTML(status)}</span>`;
}

/* =========================================================
   RECAP & REPORT
   ========================================================= */

function toggleCustomRange() {
  const period = $("#recapPeriod")?.value;
  const customRange = $("#customDateRange");

  if (customRange) {
    customRange.classList.toggle("hidden", period !== "custom");
  }

  loadRecap().catch(handleError);
}

async function loadRecap() {
  const period = $("#recapPeriod")?.value || "today";
  const startDate = $("#recapStart")?.value || "";
  const endDate = $("#recapEnd")?.value || "";

  const params = { period };

  if (period === "custom") {
    if (!startDate || !endDate) return;
    params.startDate = startDate;
    params.endDate = endDate;
  }

  setLoading(true, "Memuat data rekap...");

  try {
    const result = await apiGet("getRecap", params);
    state.recap = result.data;
    renderRecap(result.data);
  } finally {
    setLoading(false);
  }
}

function renderRecap(data) {
  if (!data) return;

  // Render Rekap Pegawai
  const empTbody = $("#recapEmployeeBody");
  if (empTbody) {
    const empItems = data.employeeRecap || [];
    empTbody.innerHTML = empItems.length
      ? empItems.map((item, i) => `
        <tr>
          <td>${i + 1}</td>
          <td><strong>${escapeHTML(item.nama || item.name || "-")}</strong></td>
          <td>${escapeHTML(item.hadir || 0)}</td>
          <td>${escapeHTML(item.izin || 0)}</td>
          <td>${escapeHTML(item.sakit || 0)}</td>
          <td>${escapeHTML(item.tidakHadir || 0)}</td>
        </tr>
      `).join("")
      : `<tr><td colspan="6" class="empty-cell">Tidak ada data rekap pegawai.</td></tr>`;
  }

  // Render Rekap Piket Kelas
  const dutyTbody = $("#recapDutyBody");
  if (dutyTbody) {
    const dutyItems = data.dutyRecap || [];
    dutyTbody.innerHTML = dutyItems.length
      ? dutyItems.map((item, i) => `
        <tr>
          <td>${i + 1}</td>
          <td><strong>${escapeHTML(item.kelas || item.className || "-")}</strong></td>
          <td>${escapeHTML(item.hadir || 0)}</td>
          <td>${escapeHTML(item.tidakHadir || 0)}</td>
          <td>${escapeHTML(item.terpilah || 0)}</td>
          <td>${escapeHTML(item.tercampur || 0)}</td>
        </tr>
      `).join("")
      : `<tr><td colspan="6" class="empty-cell">Tidak ada data rekap piket kelas.</td></tr>`;
  }
}

function exportRecapCSV() {
  if (!state.recap) {
    showToast("Belum ada data rekap untuk diunduh.", "error");
    return;
  }

  let csvContent = "data:text/csv;charset=utf-8,";
  
  // Section Rekap Pegawai
  csvContent += "REKAP ABSENSI PEGAWAI\r\n";
  csvContent += "No,Nama,Hadir,Izin,Sakit,Tidak Hadir\r\n";

  (state.recap.employeeRecap || []).forEach((item, index) => {
    csvContent += `${index + 1},"${item.nama || ""}","${item.hadir || 0}","${item.izin || 0}","${item.sakit || 0}","${item.tidakHadir || 0}"\r\n`;
  });

  // Section Rekap Piket Kelas
  csvContent += "\r\nREKAP PIKET KELAS\r\n";
  csvContent += "No,Kelas,Hadir,Tidak Hadir,Tong Terpilah,Tong Tercampur\r\n";

  (state.recap.dutyRecap || []).forEach((item, index) => {
    csvContent += `${index + 1},"${item.kelas || ""}","${item.hadir || 0}","${item.tidakHadir || 0}","${item.terpilah || 0}","${item.tercampur || 0}"\r\n`;
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `Rekap_Adiwiyata_${todayInputDate()}.csv`);
  document.body.appendChild(link);

  link.click();
  document.body.removeChild(link);

  showToast("File CSV berhasil diunduh.");
}

/* =========================================================
   SETTINGS & UTILITIES
   ========================================================= */

async function loadSettingsPage() {
  setText("#settingApiUrl", APP_CONFIG.API_URL);
  setText("#settingTimezone", APP_CONFIG.TIMEZONE);

  if (state.server) {
    setText("#settingServerStatus", state.server.status || "Aktif");
    setText("#settingSpreadsheetName", state.server.spreadsheetName || "-");
  }
}

async function testConnection() {
  const btn = $("#btnTestConnection");
  setButtonLoading(btn, true, "Menguji...");

  try {
    const health = await apiGet("health");
    state.server = health.data;
    updateConnection(true, "Online");
    showToast("Koneksi ke backend Google Apps Script berhasil!");
  } catch (error) {
    updateConnection(false, "Offline");
    handleError(error);
  } finally {
    setButtonLoading(btn, false);
  }
}

function setText(selector, text) {
  const el = $(selector);
  if (el) {
    el.textContent = text ?? "";
  }
}

function handleError(error) {
  console.error("[App Error]:", error);
  showToast(error.message || "Terjadi kesalahan sistem.", "error");
}
