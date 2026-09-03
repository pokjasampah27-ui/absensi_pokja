/* =========================================================
   KEHADIRAN PEGAWAI ADIWIYATA & MONITORING PIKET KELAS
   SCRIPT.JS
   Frontend: GitHub Pages
   Backend : Google Apps Script Web App
   Database: Google Spreadsheet
   ========================================================= */

const APP_CONFIG = {
  API_URL: "PASTE_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE",
  DEFAULT_LIMIT: 25,
  MAX_LIMIT: 100,
  TIMEZONE: "Asia/Jakarta",

  CLASSES: [
    "10 M1","10 M2","10 M3","10 M4","10 M5",
    "11 M1","11 M2","11 M3","11 M4",
    "12 M1","12 M2","12 M3","12 M4","12 M5"
  ],

  EMPLOYEE_STATUS: ["Hadir","Tidak Hadir","Izin","Sakit"],
  DUTY_STATUS: ["Hadir","Tidak Hadir"],
  TRASH_CONDITION: ["Terpilah","Tercampur"],
  DUTY_RESPONSE: ["Ramah","Acuh","Tidak Sopan"]
};

const state = {
  page: "dashboard",
  employees: [],
  classes: [],
  dashboard: null,
  employeeHistory: { items: [], pagination: {} },
  dutyHistory: { items: [], pagination: {} },
  recap: null,
  settings: {},
  server: null,
  attendancePage: 1,
  dutyPage: 1
};

/* =========================================================
   DOM HELPERS
   ========================================================= */

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showToast(message, type = "success") {
  const box = $("#toast");
  if (!box) return;

  box.textContent = message;
  box.className = `toast show ${type}`;

  clearTimeout(showToast.timer);

  showToast.timer = setTimeout(() => {
    box.className = "toast";
  }, 3500);
}

function setLoading(show, text = "Memproses...") {
  const loader = $("#loadingOverlay");
  if (!loader) return;

  $("#loadingText").textContent = text;
  loader.classList.toggle("hidden", !show);
}

function setButtonLoading(button, loading, text = "Memproses...") {
  if (!button) return;

  if (loading) {
    button.dataset.originalText = button.innerHTML;
    button.disabled = true;
    button.innerHTML =
      `<span class="spinner"></span>${text}`;
  } else {
    button.disabled = false;
    button.innerHTML =
      button.dataset.originalText || button.innerHTML;
  }
}

function todayInputDate() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_CONFIG.TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);

  const get = (type) =>
    parts.find(p => p.type === type)?.value || "";

  return `${get("year")}-${get("month")}-${get("day")}`;
}

function isoToDMY(iso) {
  if (!iso) return "";

  const [y, m, d] = iso.split("-");

  return y && m && d
    ? `${d}/${m}/${y}`
    : "";
}

function dmyToISO(dmy) {
  if (!dmy) return "";

  const [d, m, y] = dmy.split("/");

  return y && m && d
    ? `${y}-${m}-${d}`
    : "";
}

function formatDateDisplay(value) {
  if (!value) return "-";

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(String(value))) {
    return value;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("id-ID", {
    timeZone: APP_CONFIG.TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(parsed);
}

function debounce(fn, delay = 250) {
  let timer;

  return (...args) => {
    clearTimeout(timer);

    timer = setTimeout(() => {
      fn(...args);
    }, delay);
  };
}

/* =========================================================
   API
   ========================================================= */

function assertApiConfigured() {
  if (
    !APP_CONFIG.API_URL ||
    APP_CONFIG.API_URL.includes(
      "PASTE_GOOGLE_APPS_SCRIPT"
    )
  ) {
    throw new Error(
      "URL Web App Google Apps Script belum diisi di APP_CONFIG.API_URL."
    );
  }
}

async function apiGet(action, params = {}) {
  assertApiConfigured();

  const url = new URL(APP_CONFIG.API_URL);

  url.searchParams.set("action", action);

  Object.entries(params).forEach(([key, value]) => {
    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      url.searchParams.set(
        key,
        String(value)
      );
    }
  });

  const response = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const result = await response.json();

  if (!result.success) {
    throw new Error(
      result.message ||
      "Permintaan gagal."
    );
  }

  return result;
}

async function apiPost(action, data = {}) {
  assertApiConfigured();

  const body = new URLSearchParams();

  body.set("action", action);

  Object.entries(data).forEach(([key, value]) => {
    if (
      value !== undefined &&
      value !== null
    ) {
      body.set(
        key,
        typeof value === "object"
          ? JSON.stringify(value)
          : String(value)
      );
    }
  });

  const response = await fetch(
    APP_CONFIG.API_URL,
    {
      method: "POST",
      body,
      redirect: "follow"
    }
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const result = await response.json();

  if (
    !result.success &&
    result.code !== "DUPLICATE"
  ) {
    throw new Error(
      result.message ||
      "Permintaan gagal."
    );
  }

  return result;
}

/* =========================================================
   INITIALIZATION
   ========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  init
);

async function init() {
  bindNavigation();
  bindGlobalEvents();

  buildClassOptions();
  buildEmployeeStatusOptions();
  buildDutyOptions();
  buildTrashOptions();
  buildResponseOptions();

  setDefaultDates();

  renderClock();

  setInterval(
    renderClock,
    1000
  );

  showPage("dashboard");

  try {
    await loadInitialData();
  } catch (error) {
    console.error(error);

    showToast(
      error.message,
      "error"
    );

    updateConnection(
      false,
      error.message
    );
  }
}

async function loadInitialData() {
  setLoading(
    true,
    "Menghubungkan ke server..."
  );

  try {
    const [
      health,
      employees,
      classes,
      settings
    ] = await Promise.all([
      apiGet("health"),
      apiGet("getEmployees"),
      apiGet("getClasses"),
      apiGet("getSettings")
    ]);

    state.server = health.data;

    state.employees =
      employees.data.employees || [];

    state.classes =
      classes.data.classes ||
      APP_CONFIG.CLASSES;

    state.settings =
      settings.data.settings || {};

    updateConnection(
      true,
      "Terhubung"
    );

    updateAppTitle();

    populateEmployeeSelects();

    buildClassOptions();

    await refreshDashboard();

  } finally {
    setLoading(false);
  }
}

/* =========================================================
   NAVIGATION
   ========================================================= */

function bindNavigation() {
  $$(".nav-item").forEach(btn => {
    btn.addEventListener(
      "click",
      () => {
        const page =
          btn.dataset.page;

        showPage(page);
      }
    );
  });

  $$(".mobile-nav-item").forEach(btn => {
    btn.addEventListener(
      "click",
      () => {
        showPage(
          btn.dataset.page
        );
      }
    );
  });
}

function showPage(page) {
  state.page = page;

  $$(".page").forEach(section => {
    section.classList.toggle(
      "active",
      section.id === `page-${page}`
    );
  });

  $$(".nav-item").forEach(btn => {
    btn.classList.toggle(
      "active",
      btn.dataset.page === page
    );
  });

  $$(".mobile-nav-item").forEach(btn => {
    btn.classList.toggle(
      "active",
      btn.dataset.page === page
    );
  });

  const titleMap = {
    dashboard: [
      "Dashboard",
      "Ringkasan kegiatan hari ini"
    ],

    attendance: [
      "Absensi Pegawai",
      "Catat kehadiran pegawai Adiwiyata"
    ],

    duty: [
      "Piket Kelas",
      "Monitoring kehadiran dan kondisi tong sampah"
    ],

    history: [
      "Riwayat",
      "Telusuri data absensi dan piket"
    ],

    recap: [
      "Rekap & Laporan",
      "Ringkasan berdasarkan periode"
    ],

    settings: [
      "Pengaturan",
      "Status koneksi dan informasi sistem"
    ]
  };

  const [
    title,
    subtitle
  ] =
    titleMap[page] ||
    titleMap.dashboard;

  $("#pageTitle").textContent =
    title;

  $("#pageSubtitle").textContent =
    subtitle;

  if (page === "dashboard") {
    refreshDashboard()
      .catch(handleError);
  }

  if (page === "history") {
    loadAttendanceHistory()
      .catch(handleError);

    loadDutyHistory()
      .catch(handleError);
  }

  if (page === "recap") {
    loadRecap()
      .catch(handleError);
  }

  if (page === "settings") {
    loadSettingsPage()
      .catch(handleError);
  }

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

/* =========================================================
   GLOBAL EVENTS
   ========================================================= */

function bindGlobalEvents() {

  $("#employeeAttendanceForm")
    ?.addEventListener(
      "submit",
      submitEmployeeAttendance
    );

  $("#dutyForm")
    ?.addEventListener(
      "submit",
      submitDuty
    );

  $("#attendanceStatus")
    ?.addEventListener(
      "change",
      toggleAttendanceNote
    );

  $("#dutyAttendance")
    ?.addEventListener(
      "change",
      toggleDutyDetails
    );

  $("#refreshDashboard")
    ?.addEventListener(
      "click",
      () =>
        refreshDashboard()
          .catch(handleError)
    );

  $("#refreshHistory")
    ?.addEventListener(
      "click",
      refreshHistory
    );

  $("#refreshRecap")
    ?.addEventListener(
      "click",
      () =>
        loadRecap()
          .catch(handleError)
    );

  $("#testConnection")
    ?.addEventListener(
      "click",
      testConnection
    );

  $("#attendanceSearch")
    ?.addEventListener(
      "input",
      debounce(() => {
        state.attendancePage = 1;

        loadAttendanceHistory()
          .catch(handleError);
      })
    );

  $("#attendanceStatusFilter")
    ?.addEventListener(
      "change",
      () => {
        state.attendancePage = 1;

        loadAttendanceHistory()
          .catch(handleError);
      }
    );

  $("#attendanceDateFilter")
    ?.addEventListener(
      "change",
      () => {
        state.attendancePage = 1;

        loadAttendanceHistory()
          .catch(handleError);
      }
    );

  $("#dutyClassFilter")
    ?.addEventListener(
      "change",
      () => {
        state.dutyPage = 1;

        loadDutyHistory()
          .catch(handleError);
      }
    );

  $("#dutyAttendanceFilter")
    ?.addEventListener(
      "change",
      () => {
        state.dutyPage = 1;

        loadDutyHistory()
          .catch(handleError);
      }
    );

  $("#dutyDateFilter")
    ?.addEventListener(
      "change",
      () => {
        state.dutyPage = 1;

        loadDutyHistory()
          .catch(handleError);
      }
    );

  $("#recapPeriod")
    ?.addEventListener(
      "change",
      toggleCustomRange
    );

  $("#recapStart")
    ?.addEventListener(
      "change",
      () =>
        loadRecap()
          .catch(handleError)
    );

  $("#recapEnd")
    ?.addEventListener(
      "change",
      () =>
        loadRecap()
          .catch(handleError)
    );

  $("#exportRecap")
    ?.addEventListener(
      "click",
      exportRecapCSV
    );

  $("#employeeSelect")
    ?.addEventListener(
      "change",
      updateEmployeeInfo
    );
}

/* =========================================================
   SELECT OPTIONS
   ========================================================= */

function buildClassOptions() {
  const classes =
    state.classes.length
      ? state.classes
      : APP_CONFIG.CLASSES;

  const targets = [
    "#dutyClass",
    "#dutyClassFilter"
  ];

  targets.forEach(selector => {
    const select = $(selector);

    if (!select) return;

    const first =
      selector === "#dutyClassFilter"
        ? `<option value="">Semua kelas</option>`
        : `<option value="">Pilih kelas...</option>`;

    select.innerHTML =
      first +
      classes
        .map(
          cls =>
            `<option value="${escapeHTML(cls)}">${escapeHTML(cls)}</option>`
        )
        .join("");
  });
}

function buildEmployeeStatusOptions() {
  const select =
    $("#attendanceStatus");

  if (!select) return;

  select.innerHTML =
    `<option value="">Pilih status...</option>` +
    APP_CONFIG.EMPLOYEE_STATUS
      .map(
        status =>
          `<option value="${escapeHTML(status)}">${escapeHTML(status)}</option>`
      )
      .join("");
}

function buildDutyOptions() {
  const select =
    $("#dutyAttendance");

  if (!select) return;

  select.innerHTML =
    `<option value="">Pilih status...</option>` +
    APP_CONFIG.DUTY_STATUS
      .map(
        status =>
          `<option value="${escapeHTML(status)}">${escapeHTML(status)}</option>`
      )
      .join("");
}

function buildTrashOptions() {
  const select =
    $("#trashCondition");

  if (!select) return;

  select.innerHTML =
    `<option value="">Pilih kondisi...</option>` +
    APP_CONFIG.TRASH_CONDITION
      .map(
        item =>
          `<option value="${escapeHTML(item)}">${escapeHTML(item)}</option>`
      )
      .join("");
}

function buildResponseOptions() {
  const select =
    $("#dutyResponse");

  if (!select) return;

  select.innerHTML =
    `<option value="">Pilih respon...</option>` +
    APP_CONFIG.DUTY_RESPONSE
      .map(
        item =>
          `<option value="${escapeHTML(item)}">${escapeHTML(item)}</option>`
      )
      .join("");
}

function populateEmployeeSelects() {
  const select =
    $("#employeeSelect");

  if (!select) return;

  select.innerHTML =
    `<option value="">Pilih pegawai...</option>` +
    state.employees
      .map(employee => {
        const id =
          employee.id ??
          employee.ID ??
          employee.ID_PEGAWAI ??
          "";

        const name =
          employee.name ??
          employee.nama ??
          employee.NAMA ??
          employee.NAMA_LENGKAP ??
          "";

        return `
          <option value="${escapeHTML(id)}">
            ${escapeHTML(name)}
          </option>
        `;
      })
      .join("");
}

function updateEmployeeInfo() {
  const select =
    $("#employeeSelect");

  const info =
    $("#employeeInfo");

  if (!select || !info) return;

  const id =
    select.value;

  const employee =
    state.employees.find(
      item =>
        String(
          item.id ??
          item.ID ??
          item.ID_PEGAWAI ??
          ""
        ) === String(id)
    );

  if (!employee) {
    info.innerHTML = "";
    return;
  }

  const name =
    employee.name ??
    employee.nama ??
    employee.NAMA ??
    employee.NAMA_LENGKAP ??
    "-";

  const position =
    employee.position ??
    employee.jabatan ??
    employee.JABATAN ??
    "-";

  info.innerHTML = `
    <div class="employee-info-box">
      <strong>${escapeHTML(name)}</strong>
      <span>${escapeHTML(position)}</span>
    </div>
  `;
}

/* =========================================================
   DEFAULT DATES
   ========================================================= */

function setDefaultDates() {
  const today =
    todayInputDate();

  if ($("#attendanceDate")) {
    $("#attendanceDate").value =
      today;
  }

  if ($("#dutyDate")) {
    $("#dutyDate").value =
      today;
  }

  if ($("#attendanceDateFilter")) {
    $("#attendanceDateFilter").value =
      today;
  }

  if ($("#dutyDateFilter")) {
    $("#dutyDateFilter").value =
      today;
  }

  if ($("#recapStart")) {
    $("#recapStart").value =
      today;
  }

  if ($("#recapEnd")) {
    $("#recapEnd").value =
      today;
  }
}

/* =========================================================
   CLOCK / CONNECTION
   ========================================================= */

function renderClock() {
  const now =
    new Date();

  const time =
    new Intl.DateTimeFormat(
      "id-ID",
      {
        timeZone:
          APP_CONFIG.TIMEZONE,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      }
    ).format(now);

  const date =
    new Intl.DateTimeFormat(
      "id-ID",
      {
        timeZone:
          APP_CONFIG.TIMEZONE,
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric"
      }
    ).format(now);

  if ($("#liveTime")) {
    $("#liveTime").textContent =
      time;
  }

  if ($("#liveDate")) {
    $("#liveDate").textContent =
      date;
  }

  if ($("#heroDate")) {
    $("#heroDate").textContent =
      date;
  }
}

function updateConnection(
  connected,
  text
) {
  const badge =
    $("#connectionBadge");

  const dot =
    $("#connectionDot");

  if (badge) {
    badge.textContent =
      text;
  }

  if (dot) {
    dot.className =
      connected
        ? "connection-dot online"
        : "connection-dot offline";
  }
}

function updateAppTitle() {
  const name =
    state.settings.appName ||
    state.settings.APP_NAME ||
    state.settings.namaAplikasi ||
    "Adiwiyata";

  document.title =
    name;

  if ($("#appName")) {
    $("#appName").textContent =
      name;
  }
}

/* =========================================================
   DASHBOARD
   ========================================================= */

async function refreshDashboard() {
  try {
    const result =
      await apiGet(
        "getDashboard"
      );

    state.dashboard =
      result.data;

    renderDashboard(
      state.dashboard
    );

  } catch (error) {
    handleError(error);
  }
}

function renderDashboard(data) {
  if (!data) return;

  const source =
    data.dashboard ||
    data;

  const getValue = (
    ...keys
  ) => {
    for (const key of keys) {
      if (
        source[key] !==
        undefined
      ) {
        return source[key];
      }
    }

    return 0;
  };

  setText(
    "#statHadir",
    getValue(
      "hadir",
      "Hadir",
      "employeeHadir"
    )
  );

  setText(
    "#statIzin",
    getValue(
      "izin",
      "Izin"
    )
  );

  setText(
    "#statSakit",
    getValue(
      "sakit",
      "Sakit"
    )
  );

  setText(
    "#statTidakHadir",
    getValue(
      "tidakHadir",
      "Tidak Hadir",
      "alpa"
    )
  );

  setText(
    "#dutyPresent",
    getValue(
      "piketHadir",
      "dutyHadir",
      "hadirPiket"
    )
  );

  setText(
    "#dutyAbsent",
    getValue(
      "piketTidakHadir",
      "dutyTidakHadir",
      "tidakHadirPiket"
    )
  );

  setText(
    "#trashSorted",
    getValue(
      "terpilah",
      "trashSorted"
    )
  );

  setText(
    "#trashMixed",
    getValue(
      "tercampur",
      "trashMixed"
    )
  );

  setText(
    "#friendly",
    getValue(
      "ramah",
      "friendly"
    )
  );

  setText(
    "#indifferent",
    getValue(
      "acuh",
      "indifferent"
    )
  );

  setText(
    "#impolite",
    getValue(
      "tidakSopan",
      "impolite"
    )
  );

  const totalClasses =
    getValue(
      "totalKelas",
      "classesTotal"
    );

  const completedClasses =
    getValue(
      "kelasSelesai",
      "classesCompleted"
    );

  setText(
    "#classProgressText",
    `${completedClasses} / ${totalClasses}`
  );

  const percentage =
    totalClasses > 0
      ? Math.round(
          (completedClasses /
            totalClasses) *
          100
        )
      : 0;

  const progress =
    $("#classProgress");

  if (progress) {
    progress.style.width =
      `${percentage}%`;
  }

  setText(
    "#classProgressPercent",
    `${percentage}%`
  );
}

/* =========================================================
   EMPLOYEE ATTENDANCE
   ========================================================= */

function toggleAttendanceNote() {
  const status =
    $("#attendanceStatus")?.value;

  const noteField =
    $("#attendanceNoteField");

  const note =
    $("#attendanceNote");

  if (!noteField) return;

  const requiresNote =
    status &&
    status !== "Hadir";

  noteField.classList.toggle(
    "hidden",
    !requiresNote
  );

  if (note) {
    note.required =
      requiresNote;

    if (!requiresNote) {
      note.value = "";
    }
  }
}

async function submitEmployeeAttendance(
  event
) {
  event.preventDefault();

  const button =
    $("#employeeSubmit");

  const employeeId =
    $("#employeeSelect")?.value;

  const date =
    $("#attendanceDate")?.value;

  const status =
    $("#attendanceStatus")?.value;

  const note =
    $("#attendanceNote")?.value.trim();

  if (!employeeId) {
    showToast(
      "Silakan pilih pegawai.",
      "error"
    );
    return;
  }

  if (!date) {
    showToast(
      "Tanggal belum dipilih.",
      "error"
    );
    return;
  }

  if (!status) {
    showToast(
      "Silakan pilih status.",
      "error"
    );
    return;
  }

  if (
    status !== "Hadir" &&
    !note
  ) {
    showToast(
      "Keterangan wajib diisi untuk status selain Hadir.",
      "error"
    );
    return;
  }

  setButtonLoading(
    button,
    true,
    "Menyimpan..."
  );

  try {
    const result =
      await apiPost(
        "saveEmployeeAttendance",
        {
          employeeId,
          date: dmyToISO(
            isoToDMY(date)
          ),
          status,
          note
        }
      );

    if (
      result.code ===
      "DUPLICATE"
    ) {
      const shouldUpdate =
        confirm(
          "Data absensi pegawai pada tanggal tersebut sudah ada. Apakah ingin memperbaruinya?"
        );

      if (!shouldUpdate) {
        return;
      }

      await apiPost(
        "updateEmployeeAttendance",
        {
          id:
            result.data?.id ||
            result.data?.attendanceId ||
            "",
          employeeId,
          date,
          status,
          note
        }
      );

      showToast(
        "Absensi pegawai berhasil diperbarui."
      );

    } else {
      showToast(
        result.message ||
        "Absensi pegawai berhasil disimpan."
      );
    }

    $("#employeeAttendanceForm")
      ?.reset();

    setDefaultDates();

    toggleAttendanceNote();

    await refreshDashboard();

  } catch (error) {
    handleError(error);
  } finally {
    setButtonLoading(
      button,
      false
    );
  }
}

/* =========================================================
   DUTY / PIKET
   ========================================================= */

function toggleDutyDetails() {
  const status =
    $("#dutyAttendance")?.value;

  const detail =
    $("#dutyDetails");

  const trash =
    $("#trashCondition");

  const response =
    $("#dutyResponse");

  const present =
    status === "Hadir";

  detail?.classList.toggle(
    "hidden",
    !present
  );

  if (trash) {
    trash.required =
      present;

    if (!present) {
      trash.value = "";
    }
  }

  if (response) {
    response.required =
      present;

    if (!present) {
      response.value = "";
    }
  }
}

async function submitDuty(event) {
  event.preventDefault();

  const button =
    $("#dutySubmit");

  const date =
    $("#dutyDate")?.value;

  const className =
    $("#dutyClass")?.value;

  const attendance =
    $("#dutyAttendance")?.value;

  const trashCondition =
    $("#trashCondition")?.value;

  const response =
    $("#dutyResponse")?.value;

  if (!date) {
    showToast(
      "Tanggal belum dipilih.",
      "error"
    );
    return;
  }

  if (!className) {
    showToast(
      "Silakan pilih kelas.",
      "error"
    );
    return;
  }

  if (!attendance) {
    showToast(
      "Silakan pilih status piket.",
      "error"
    );
    return;
  }

  if (
    attendance === "Hadir" &&
    (!trashCondition ||
      !response)
  ) {
    showToast(
      "Kondisi tong sampah dan respon petugas wajib diisi jika Hadir.",
      "error"
    );
    return;
  }

  setButtonLoading(
    button,
    true,
    "Menyimpan..."
  );

  try {
    const result =
      await apiPost(
        "saveClassDuty",
        {
          date,
          className,
          attendance,
          trashCondition:
            attendance === "Hadir"
              ? trashCondition
              : "",
          response:
            attendance === "Hadir"
              ? response
              : ""
        }
      );

    if (
      result.code ===
      "DUPLICATE"
    ) {
      const shouldUpdate =
        confirm(
          `Data piket kelas ${className} pada tanggal tersebut sudah ada. Apakah ingin memperbaruinya?`
        );

      if (!shouldUpdate) {
        return;
      }

      await apiPost(
        "updateClassDuty",
        {
          id:
            result.data?.id ||
            result.data?.dutyId ||
            "",
          date,
          className,
          attendance,
          trashCondition:
            attendance === "Hadir"
              ? trashCondition
              : "",
          response:
            attendance === "Hadir"
              ? response
              : ""
        }
      );

      showToast(
        "Data piket berhasil diperbarui."
      );

    } else {
      showToast(
        result.message ||
        "Data piket berhasil disimpan."
      );
    }

    $("#dutyForm")?.reset();

    setDefaultDates();

    toggleDutyDetails();

    await refreshDashboard();

  } catch (error) {
    handleError(error);
  } finally {
    setButtonLoading(
      button,
      false
    );
  }
}

/* =========================================================
   HISTORY
   ========================================================= */

async function loadAttendanceHistory() {
  const params = {
    page:
      state.attendancePage,
    limit:
      APP_CONFIG.DEFAULT_LIMIT,
    search:
      $("#attendanceSearch")?.value || "",
    status:
      $("#attendanceStatusFilter")?.value || "",
    date:
      $("#attendanceDateFilter")?.value || ""
  };

  const result =
    await apiGet(
      "getEmployeeAttendanceHistory",
      params
    );

  state.employeeHistory =
    result.data || {
      items: [],
      pagination: {}
    };

  renderAttendanceHistory();
}

async function loadDutyHistory() {
  const params = {
    page:
      state.dutyPage,
    limit:
      APP_CONFIG.DEFAULT_LIMIT,
    className:
      $("#dutyClassFilter")?.value || "",
    attendance:
      $("#dutyAttendanceFilter")?.value || "",
    date:
      $("#dutyDateFilter")?.value || ""
  };

  const result =
    await apiGet(
      "getClassDutyHistory",
      params
    );

  state.dutyHistory =
    result.data || {
      items: [],
      pagination: {}
    };

  renderDutyHistory();
}

function renderAttendanceHistory() {
  const tbody =
    $("#attendanceHistoryBody");

  if (!tbody) return;

  const items =
    state.employeeHistory.items ||
    [];

  if (!items.length) {
    tbody.innerHTML = `
      <tr>
        <td
          colspan="7"
          class="empty-cell"
        >
          Belum ada data absensi.
        </td>
      </tr>
    `;

    renderPagination(
      "attendance",
      state.employeeHistory.pagination
    );

    return;
  }

  tbody.innerHTML =
    items.map(
      (item, index) => `
        <tr>
          <td>${escapeHTML(index + 1)}</td>
          <td>
            <strong>
              ${escapeHTML(
                item.nama ||
                item.name ||
                item.NAMA ||
                "-"
              )}
            </strong>
          </td>
          <td>
            ${escapeHTML(
              item.jabatan ||
              item.position ||
              item.JABATAN ||
              "-"
            )}
          </td>
          <td>
            ${escapeHTML(
              formatDateDisplay(
                item.tanggal ||
                item.date ||
                item.TANGGAL
              )
            )}
          </td>
          <td>
            ${statusBadge(
              item.status ||
              item.STATUS
            )}
          </td>
          <td>
            ${escapeHTML(
              item.keterangan ||
              item.note ||
              item.KETERANGAN ||
              "-"
            )}
          </td>
          <td>
            ${escapeHTML(
              item.updatedAt ||
              item.timestamp ||
              "-"
            )}
          </td>
        </tr>
      `
    ).join("");

  renderPagination(
    "attendance",
    state.employeeHistory.pagination
  );
}

function renderDutyHistory() {
  const tbody =
    $("#dutyHistoryBody");

  if (!tbody) return;

  const items =
    state.dutyHistory.items ||
    [];

  if (!items.length) {
    tbody.innerHTML = `
      <tr>
        <td
          colspan="8"
          class="empty-cell"
        >
          Belum ada data piket kelas.
        </td>
      </tr>
    `;

    renderPagination(
      "duty",
      state.dutyHistory.pagination
    );

    return;
  }

  tbody.innerHTML =
    items.map(
      (item, index) => `
        <tr>
          <td>${escapeHTML(index + 1)}</td>

          <td>
            ${escapeHTML(
              item.kelas ||
              item.className ||
              item.KELAS ||
              "-"
            )}
          </td>

          <td>
            ${escapeHTML(
              formatDateDisplay(
                item.tanggal ||
                item.date ||
                item.TANGGAL
              )
            )}
          </td>

          <td>
            ${statusBadge(
              item.status ||
              item.attendance ||
              item.STATUS
            )}
          </td>

          <td>
            ${escapeHTML(
              item.kondisiTong ||
              item.trashCondition ||
              item.KONDISI_TONG ||
              "-"
            )}
          </td>

          <td>
            ${escapeHTML(
              item.respon ||
              item.response ||
              item.RESPON ||
              "-"
            )}
          </td>

          <td>
            ${escapeHTML(
              item.petugas ||
              item.staff ||
              "-"
            )}
          </td>

          <td>
            ${escapeHTML(
              item.timestamp ||
              "-"
            )}
          </td>
        </tr>
      `
    ).join("");

  renderPagination(
    "duty",
    state.dutyHistory.pagination
  );
}

function renderPagination(
  type,
  pagination = {}
) {
  const current =
    Number(
      pagination.page ||
      pagination.currentPage ||
      1
    );

  const totalPages =
    Number(
      pagination.totalPages ||
      pagination.pages ||
      1
    );

  const info =
    $(`#${type}PaginationInfo`);

  const buttons =
    $(`#${type}PaginationButtons`);

  if (info) {
    info.textContent =
      `Halaman ${current} dari ${totalPages}`;
  }

  if (!buttons) return;

  buttons.innerHTML = `
    <button
      class="btn btn-light btn-small"
      ${current <= 1 ? "disabled" : ""}
      data-pagination="${type}-prev"
    >
      ← Sebelumnya
    </button>

    <button
      class="btn btn-light btn-small"
      ${current >= totalPages ? "disabled" : ""}
      data-pagination="${type}-next"
    >
      Berikutnya →
    </button>
  `;

  buttons
    .querySelector(
      `[data-pagination="${type}-prev"]`
    )
    ?.addEventListener(
      "click",
      () => {
        if (current <= 1) return;

        if (type === "attendance") {
          state.attendancePage--;
          loadAttendanceHistory()
            .catch(handleError);
        } else {
          state.dutyPage--;
          loadDutyHistory()
            .catch(handleError);
        }
      }
    );

  buttons
    .querySelector(
      `[data-pagination="${type}-next"]`
    )
    ?.addEventListener(
      "click",
      () => {
        if (current >= totalPages) return;

        if (type === "attendance") {
          state.attendancePage++;
          loadAttendanceHistory()
            .catch(handleError);
        } else {
          state.dutyPage++;
          loadDutyHistory()
            .catch(handleError);
        }
      }
    );
}

function refreshHistory() {
  state.attendancePage = 1;
  state.dutyPage = 1;

  Promise.all([
    loadAttendanceHistory(),
    loadDutyHistory()
  ]).catch(handleError);
}

/* =========================================================
   RECAP
   ========================================================= */

function toggleCustomRange() {
  const period =
    $("#recapPeriod")?.value;

  $("#customRange")
    ?.classList.toggle(
      "hidden",
      period !== "custom"
    );

  loadRecap()
    .catch(handleError);
}

async function loadRecap() {
  const period =
    $("#recapPeriod")?.value ||
    "today";

  const params = {
    period
  };

  if (period === "custom") {
    params.startDate =
      $("#recapStart")?.value || "";

    params.endDate =
      $("#recapEnd")?.value || "";
  }

  const result =
    await apiGet(
      "getRecap",
      params
    );

  state.recap =
    result.data || {};

  renderRecap(
    state.recap
  );
}

function renderRecap(data) {
  const source =
    data.recap ||
    data;

  setText(
    "#recapTotal",
    source.total ||
    source.totalRecords ||
    0
  );

  setText(
    "#recapHadir",
    source.hadir ||
    0
  );

  setText(
    "#recapIzin",
    source.izin ||
    0
  );

  setText(
    "#recapSakit",
    source.sakit ||
    0
  );

  setText(
    "#recapTidakHadir",
    source.tidakHadir ||
    0
  );

  const employeeRows =
    source.employees ||
    source.employeeRecap ||
    [];

  const employeeBody =
    $("#recapEmployeeBody");

  if (employeeBody) {
    employeeBody.innerHTML =
      employeeRows.length
        ? employeeRows
            .map(
              item => `
                <tr>
                  <td>
                    ${escapeHTML(
                      item.nama ||
                      item.name ||
                      "-"
                    )}
                  </td>
                  <td>
                    ${escapeHTML(
                      item.hadir ||
                      0
                    )}
                  </td>
                  <td>
                    ${escapeHTML(
                      item.izin ||
                      0
                    )}
                  </td>
                  <td>
                    ${escapeHTML(
                      item.sakit ||
                      0
                    )}
                  </td>
                  <td>
                    ${escapeHTML(
                      item.tidakHadir ||
                      0
                    )}
                  </td>
                  <td>
                    ${escapeHTML(
                      item.total ||
                      0
                    )}
                  </td>
                </tr>
              `
            )
            .join("")
        : `
          <tr>
            <td
              colspan="6"
              class="empty-cell"
            >
              Tidak ada data.
            </td>
          </tr>
        `;
  }

  const classRows =
    source.classes ||
    source.classRecap ||
    [];

  const classBody =
    $("#recapClassBody");

  if (classBody) {
    classBody.innerHTML =
      classRows.length
        ? classRows
            .map(
              item => `
                <tr>
                  <td>
                    ${escapeHTML(
                      item.kelas ||
                      item.className ||
                      "-"
                    )}
                  </td>
                  <td>
                    ${escapeHTML(
                      item.hadir ||
                      0
                    )}
                  </td>
                  <td>
                    ${escapeHTML(
                      item.tidakHadir ||
                      0
                    )}
                  </td>
                  <td>
                    ${escapeHTML(
                      item.terpilah ||
                      0
                    )}
                  </td>
                  <td>
                    ${escapeHTML(
                      item.tercampur ||
                      0
                    )}
                  </td>
                  <td>
                    ${escapeHTML(
                      item.ramah ||
                      0
                    )}
                  </td>
                  <td>
                    ${escapeHTML(
                      item.acuh ||
                      0
                    )}
                  </td>
                  <td>
                    ${escapeHTML(
                      item.tidakSopan ||
                      0
                    )}
                  </td>
                </tr>
              `
            )
            .join("")
        : `
          <tr>
            <td
              colspan="8"
              class="empty-cell"
            >
              Tidak ada data.
            </td>
          </tr>
        `;
  }
}

/* =========================================================
   EXPORT CSV
   ========================================================= */

function exportRecapCSV() {
  const source =
    state.recap || {};

  const rows = [];

  rows.push([
    "Jenis",
    "Nama/Kelas",
    "Hadir",
    "Izin",
    "Sakit",
    "Tidak Hadir",
    "Total"
  ]);

  const employees =
    source.employees ||
    source.employeeRecap ||
    [];

  employees.forEach(item => {
    rows.push([
      "Pegawai",
      item.nama ||
        item.name ||
        "",
      item.hadir || 0,
      item.izin || 0,
      item.sakit || 0,
      item.tidakHadir || 0,
      item.total || 0
    ]);
  });

  const csv =
    rows
      .map(row =>
        row
          .map(csvEscape)
          .join(",")
      )
      .join("\r\n");

  const blob =
    new Blob(
      ["\uFEFF" + csv],
      {
        type:
          "text/csv;charset=utf-8;"
      }
    );

  const url =
    URL.createObjectURL(blob);

  const a =
    document.createElement("a");

  a.href = url;

  a.download =
    `rekap-adiwiyata-${todayInputDate()}.csv`;

  document.body.appendChild(a);

  a.click();

  a.remove();

  URL.revokeObjectURL(url);

  showToast(
    "Rekap berhasil diekspor."
  );
}

function csvEscape(value) {
  const text =
    String(value ?? "");

  if (
    text.includes(",") ||
    text.includes('"') ||
    text.includes("\n")
  ) {
    return `"${text.replace(
      /"/g,
      '""'
    )}"`;
  }

  return text;
}

/* =========================================================
   SETTINGS
   ========================================================= */

async function loadSettingsPage() {
  try {
    const [
      health,
      settings
    ] = await Promise.all([
      apiGet("health"),
      apiGet("getSettings")
    ]);

    state.server =
      health.data;

    state.settings =
      settings.data.settings ||
      {};

    renderSettings();

    updateConnection(
      true,
      "Terhubung"
    );

  } catch (error) {
    updateConnection(
      false,
      "Tidak terhubung"
    );

    throw error;
  }
}

function renderSettings() {
  const settings =
    state.settings || {};

  setText(
    "#settingAppName",
    settings.appName ||
    settings.APP_NAME ||
    "Kehadiran Adiwiyata"
  );

  setText(
    "#settingTimezone",
    settings.timezone ||
    settings.TIMEZONE ||
    APP_CONFIG.TIMEZONE
  );

  setText(
    "#settingSpreadsheet",
    settings.spreadsheetName ||
    settings.SPREADSHEET_NAME ||
    "-"
  );

  setText(
    "#settingDateFormat",
    settings.dateFormat ||
    settings.DATE_FORMAT ||
    "dd/MM/yyyy"
  );

  setText(
    "#settingServerTime",
    state.server?.serverTime ||
    "-"
  );

  setText(
    "#settingStatus",
    state.server
      ? "ONLINE"
      : "OFFLINE"
  );
}

async function testConnection() {
  const button =
    $("#testConnection");

  setButtonLoading(
    button,
    true,
    "Mengecek..."
  );

  try {
    const result =
      await apiGet("health");

    state.server =
      result.data;

    updateConnection(
      true,
      "Terhubung"
    );

    renderSettings();

    showToast(
      "Koneksi server berhasil."
    );

  } catch (error) {
    updateConnection(
      false,
      "Tidak terhubung"
    );

    showToast(
      error.message,
      "error"
    );

  } finally {
    setButtonLoading(
      button,
      false
    );
  }
}

/* =========================================================
   UI HELPERS
   ========================================================= */

function setText(
  selector,
  value
) {
  const element =
    $(selector);

  if (element) {
    element.textContent =
      value ?? "-";
  }
}

function statusBadge(status) {
  const value =
    String(status ?? "-");

  let type =
    "neutral";

  if (
    value === "Hadir"
  ) {
    type = "success";
  } else if (
    value === "Izin"
  ) {
    type = "info";
  } else if (
    value === "Sakit"
  ) {
    type = "warning";
  } else if (
    value === "Tidak Hadir"
  ) {
    type = "danger";
  }

  return `
    <span class="status-badge ${type}">
      ${escapeHTML(value)}
    </span>
  `;
}

function handleError(error) {
  console.error(error);

  showToast(
    error?.message ||
    "Terjadi kesalahan.",
    "error"
  );
}
