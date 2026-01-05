/**
 * KONFIGURASI UTAMA
 * Ganti ID di bawah ini dengan ID Spreadsheet dan Folder Google Drive Anda.
 */
const CONFIG = {
  SHEET_ID: "1S9Ed1Ad1bmBxEUacbb4BN0Ipe2Qw-b3X2xQ5YUObX4I", // ID Spreadsheet Database
  SHEET_NAME: "Sheet1",                                     // Nama Sheet
  PARENT_FOLDER_ID: "1lr5IvQGrflG5m10vbRagl-9vDlr7xRz7",    // ID Folder Induk Siswa
  LEDGER_FOLDER_ID: "1v8375dOSCgA3rJcFia-E_FLNkAhZm32F"     // ID Folder Ledger
};

// ==========================================
// CORE SYSTEM
// ==========================================

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Admin Rapor - R.A. Ririhena, S.MG')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);
  
  try {
    const data = JSON.parse(e.postData.contents);
    let res;

    switch (data.action) {
      case "read": res = getAllStudents(); break;
      case "add": res = addStudent(data); break;
      case "delete": res = deleteStudent(data.row); break;
      case "upload": res = uploadFile(data); break;
      case "checkLedger": res = checkLedger(data.year, data.semester); break;
      case "checkStudentFile": res = checkStudentFile(data); break; // Cek status file per siswa
      default: res = { status: "error", message: "Aksi tidak dikenal" };
    }
    
    return response(res);
  } catch (err) {
    return response({ status: "error", message: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

function response(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// ==========================================
// DATABASE & DRIVE FUNCTIONS
// ==========================================

function getAllStudents() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  const lastRow = sheet.getLastRow();
  
  if (lastRow < 2) return [];
  
  const values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  return values.map((r, i) => ({
    row: i + 2,
    no: r[0], nis: r[1], nama: r[2], kelas: r[3], folderId: r[4]
  }));
}

// Cek Ledger Global
function checkLedger(year, semester) {
  try {
    const folder = DriveApp.getFolderById(CONFIG.LEDGER_FOLDER_ID);
    const files = folder.getFiles();
    const tag = `LEDGER_${year.replace('/','-')}_${semester.toUpperCase()}`;
    
    while(files.hasNext()){
      let f = files.next();
      if(f.getName().includes(tag) && !f.isTrashed()) {
        return { exists: true, url: f.getUrl(), name: f.getName() };
      }
    }
    return { exists: false };
  } catch(e) { return { exists: false, error: e.message }; }
}

// Cek Status File Siswa (Identitas / Rapor)
function checkStudentFile(data) {
  try {
    if(!data.folderId) return { exists: false };
    const folder = DriveApp.getFolderById(data.folderId);
    const files = folder.getFiles();
    
    let searchTag = "";
    if (data.type === 'RAPOR') {
      // Tag: 2024-2025_GANJIL_RAPOR
      searchTag = `${data.year.replace('/','-')}_${data.semester.toUpperCase()}_RAPOR`;
    } else {
      searchTag = "IDENTITAS";
    }

    while (files.hasNext()) {
      let f = files.next();
      if (f.getName().includes(searchTag) && !f.isTrashed()) {
        return { exists: true };
      }
    }
    return { exists: false };
  } catch (e) { return { exists: false }; }
}

function uploadFile(data) {
  try {
    // Tentukan folder tujuan
    const targetId = (data.target === "LEDGER") ? CONFIG.LEDGER_FOLDER_ID : data.folderId;
    const folder = DriveApp.getFolderById(targetId);
    
    let finalName = "";
    const cleanYear = data.year ? data.year.replace('/', '-') : "";
    const cleanSem = data.semester ? data.semester.toUpperCase() : "";

    // FORMAT NAMA FILE (PENTING AGAR TIDAK TERTUKAR)
    if (data.target === "LEDGER") {
      finalName = `LEDGER_${cleanYear}_${cleanSem}_${data.fileName}`;
      deleteOldFiles(folder, `LEDGER_${cleanYear}_${cleanSem}`); // Hapus versi lama
    } else if (data.target === "RAPOR") {
      finalName = `${cleanYear}_${cleanSem}_RAPOR_${data.fileName}`;
      deleteOldFiles(folder, `${cleanYear}_${cleanSem}_RAPOR`);
    } else if (data.target === "IDENTITAS") {
      finalName = `IDENTITAS_${data.fileName}`;
      deleteOldFiles(folder, "IDENTITAS");
    }

    const decoded = Utilities.base64Decode(data.fileData);
    const blob = Utilities.newBlob(decoded, data.mimeType, finalName);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    return { status: "success", url: file.getUrl() };
  } catch (e) { return { status: "error", message: e.message }; }
}

function deleteOldFiles(folder, partialName) {
  const files = folder.getFiles();
  while (files.hasNext()) {
    let f = files.next();
    if (f.getName().includes(partialName)) f.setTrashed(true);
  }
}

function addStudent(data) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  
  // Buat Folder Drive
  const parent = DriveApp.getFolderById(CONFIG.PARENT_FOLDER_ID);
  const newFolder = parent.createFolder(`${data.nama} - ${data.nis}`);
  newFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  
  const newNo = Math.max(1, sheet.getLastRow());
  sheet.appendRow([newNo, data.nis, data.nama, "X", newFolder.getId()]);
  return { status: "success" };
}

function deleteStudent(row) {
  const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.SHEET_NAME);
  sheet.deleteRow(Number(row));
  return { status: "success" };
}
