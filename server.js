const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'presensi.db'));
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS admin (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nama TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS prodi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama_prodi TEXT UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS peserta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nim TEXT UNIQUE NOT NULL,
  nama TEXT NOT NULL,
  prodi_id INTEGER NOT NULL REFERENCES prodi(id),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sesi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  judul TEXT NOT NULL,
  tanggal TEXT NOT NULL,
  jam_mulai TEXT,
  jam_selesai TEXT
);
CREATE TABLE IF NOT EXISTS presensi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  peserta_id INTEGER NOT NULL REFERENCES peserta(id) ON DELETE CASCADE,
  sesi_id INTEGER NOT NULL REFERENCES sesi(id) ON DELETE CASCADE,
  waktu_presensi TEXT,
  status TEXT NOT NULL CHECK (status IN ('hadir','izin','sakit','alpa')),
  keterangan TEXT,
  UNIQUE (peserta_id, sesi_id)
);
CREATE TABLE IF NOT EXISTS log_aktivitas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER REFERENCES admin(id),
  aksi TEXT NOT NULL,
  tabel_target TEXT,
  waktu TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// --- Migrasi: kolom kartu RFID + pengaturan sesi aktif (aman untuk database lama) ---
db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
if (!db.prepare('PRAGMA table_info(peserta)').all().some(c => c.name === 'rfid_uid')) {
  db.exec('ALTER TABLE peserta ADD COLUMN rfid_uid TEXT');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_peserta_rfid ON peserta(rfid_uid)');

// Akun admin awal (GANTI password setelah login pertama / lewat env)
if (!db.prepare('SELECT 1 FROM admin LIMIT 1').get()) {
  const pw = process.env.ADMIN_PASSWORD || 'admin123';
  db.prepare('INSERT INTO admin (username, password_hash, nama) VALUES (?,?,?)')
    .run('admin', bcrypt.hashSync(pw, 10), 'Administrator');
  ['Informatika', 'Sistem Informasi', 'Teknik Elektro', 'Manajemen', 'Akuntansi']
    .forEach(p => db.prepare('INSERT INTO prodi (nama_prodi) VALUES (?)').run(p));
  console.log('Admin dibuat -> username: admin, password:', pw);
}

const app = express();
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'ganti-rahasia-ini',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 3600 * 1000 }
}));

const log = (req, aksi, tabel) =>
  db.prepare('INSERT INTO log_aktivitas (admin_id, aksi, tabel_target) VALUES (?,?,?)')
    .run(req.session.adminId ?? null, aksi, tabel);
const needAdmin = (req, res, next) =>
  req.session.adminId ? next() : res.status(401).json({ error: 'Belum login' });

// ---------- Auth ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const a = db.prepare('SELECT * FROM admin WHERE username = ?').get(username || '');
  if (!a || !bcrypt.compareSync(password || '', a.password_hash))
    return res.status(401).json({ error: 'Username atau password salah' });
  req.session.adminId = a.id;
  req.session.nama = a.nama;
  res.json({ nama: a.nama });
});
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', (req, res) =>
  req.session.adminId ? res.json({ nama: req.session.nama }) : res.status(401).json({ error: 'Belum login' }));

// ---------- Perangkat RFID (ESP32) ----------
const DEVICE_KEY = process.env.DEVICE_KEY || 'kunci-device-123';
let lastScan = null;
const nowLocal = () => db.prepare("SELECT datetime('now','localtime') AS t").get().t;
const getSesiAktif = () => {
  const s = db.prepare("SELECT value FROM settings WHERE key='sesi_aktif'").get();
  if (s) {
    const r = db.prepare('SELECT * FROM sesi WHERE id=?').get(s.value);
    if (r) return r;
  }
  return db.prepare("SELECT * FROM sesi WHERE tanggal = date('now','localtime') ORDER BY id DESC").get() || null;
};
const setHadir = db.prepare(`
  INSERT INTO presensi (peserta_id, sesi_id, waktu_presensi, status)
  VALUES (?,?,?, 'hadir')
  ON CONFLICT(peserta_id, sesi_id)
  DO UPDATE SET status='hadir', waktu_presensi=excluded.waktu_presensi`);

app.post('/api/scan', (req, res) => {
  if (req.get('x-api-key') !== DEVICE_KEY) return res.status(401).json({ ok: false, pesan: 'API key salah' });
  const uid = String((req.body || {}).uid || '').trim().toUpperCase();
  if (!uid) return res.status(400).json({ ok: false, pesan: 'UID kosong' });
  lastScan = { uid, waktu: nowLocal(), ts: Date.now() };
  const p = db.prepare('SELECT id, nama FROM peserta WHERE rfid_uid = ?').get(uid);
  if (!p) return res.status(404).json({ ok: false, pesan: 'Kartu belum terdaftar' });
  const sesi = getSesiAktif();
  if (!sesi) return res.status(409).json({ ok: false, pesan: 'Belum ada sesi aktif' });
  const ada = db.prepare('SELECT status FROM presensi WHERE peserta_id=? AND sesi_id=?').get(p.id, sesi.id);
  if (ada && ada.status === 'hadir') return res.json({ ok: true, sudah: true, nama: p.nama, pesan: 'Sudah presensi' });
  setHadir.run(p.id, sesi.id, nowLocal());
  log(req, 'scan', 'presensi');
  res.json({ ok: true, sudah: false, nama: p.nama, pesan: 'Hadir' });
});

// Semua rute di bawah ini khusus admin
app.use('/api', needAdmin);

app.get('/api/sesi-aktif', (req, res) => res.json(getSesiAktif() || {}));
app.post('/api/sesi-aktif', (req, res) => {
  db.prepare("INSERT INTO settings (key, value) VALUES ('sesi_aktif', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(String(req.body.sesi_id));
  res.json({ ok: true });
});
app.get('/api/scan/terakhir', (req, res) =>
  res.json(lastScan && Date.now() - lastScan.ts < 120000 ? { uid: lastScan.uid, waktu: lastScan.waktu } : { uid: null }));

// ---------- Prodi ----------
app.get('/api/prodi', (req, res) => res.json(db.prepare('SELECT * FROM prodi ORDER BY nama_prodi').all()));
app.post('/api/prodi', (req, res) => {
  const nama = (req.body.nama_prodi || '').trim();
  if (!nama) return res.status(400).json({ error: 'Nama prodi wajib diisi' });
  try {
    const r = db.prepare('INSERT INTO prodi (nama_prodi) VALUES (?)').run(nama);
    log(req, 'tambah', 'prodi');
    res.json({ id: r.lastInsertRowid });
  } catch { res.status(400).json({ error: 'Prodi sudah ada' }); }
});

// ---------- Peserta ----------
app.get('/api/peserta', (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const prodi = req.query.prodi_id || null;
  res.json(db.prepare(`
    SELECT p.id, p.nim, p.nama, p.prodi_id, p.rfid_uid, pr.nama_prodi
    FROM peserta p JOIN prodi pr ON pr.id = p.prodi_id
    WHERE (p.nama LIKE ? OR p.nim LIKE ?) AND (? IS NULL OR p.prodi_id = ?)
    ORDER BY p.nama`).all(q, q, prodi, prodi));
});
app.post('/api/peserta', (req, res) => {
  const { nim, nama, prodi_id } = req.body;
  const uid = (req.body.rfid_uid || '').trim().toUpperCase() || null;
  if (!nim || !nama || !prodi_id) return res.status(400).json({ error: 'NIM, nama, dan prodi wajib diisi' });
  try {
    const r = db.prepare('INSERT INTO peserta (nim, nama, prodi_id, rfid_uid) VALUES (?,?,?,?)').run(nim.trim(), nama.trim(), prodi_id, uid);
    log(req, 'tambah', 'peserta');
    res.json({ id: r.lastInsertRowid });
  } catch { res.status(400).json({ error: 'NIM atau kartu RFID sudah terdaftar' }); }
});
app.put('/api/peserta/:id', (req, res) => {
  const { nim, nama, prodi_id } = req.body;
  const uid = (req.body.rfid_uid || '').trim().toUpperCase() || null;
  try {
    db.prepare('UPDATE peserta SET nim=?, nama=?, prodi_id=?, rfid_uid=? WHERE id=?').run(nim, nama, prodi_id, uid, req.params.id);
    log(req, 'ubah', 'peserta');
    res.json({ ok: true });
  } catch { res.status(400).json({ error: 'Gagal menyimpan (NIM atau kartu mungkin duplikat)' }); }
});
app.delete('/api/peserta/:id', (req, res) => {
  db.prepare('DELETE FROM peserta WHERE id=?').run(req.params.id);
  log(req, 'hapus', 'peserta');
  res.json({ ok: true });
});

// ---------- Sesi ----------
app.get('/api/sesi', (req, res) => res.json(db.prepare('SELECT * FROM sesi ORDER BY tanggal DESC, id DESC').all()));
app.post('/api/sesi', (req, res) => {
  const { judul, tanggal, jam_mulai, jam_selesai } = req.body;
  if (!judul || !tanggal) return res.status(400).json({ error: 'Judul dan tanggal wajib diisi' });
  const r = db.prepare('INSERT INTO sesi (judul, tanggal, jam_mulai, jam_selesai) VALUES (?,?,?,?)')
    .run(judul, tanggal, jam_mulai || null, jam_selesai || null);
  log(req, 'tambah', 'sesi');
  res.json({ id: r.lastInsertRowid });
});
app.delete('/api/sesi/:id', (req, res) => {
  db.prepare('DELETE FROM sesi WHERE id=?').run(req.params.id);
  log(req, 'hapus', 'sesi');
  res.json({ ok: true });
});

// ---------- Presensi per sesi ----------
app.get('/api/presensi', (req, res) => {
  const sesi = req.query.sesi_id;
  if (!sesi) return res.status(400).json({ error: 'sesi_id wajib' });
  res.json(db.prepare(`
    SELECT p.id AS peserta_id, p.nim, p.nama, pr.nama_prodi,
           pe.status, pe.waktu_presensi, pe.keterangan
    FROM peserta p
    JOIN prodi pr ON pr.id = p.prodi_id
    LEFT JOIN presensi pe ON pe.peserta_id = p.id AND pe.sesi_id = ?
    ORDER BY p.nama`).all(sesi));
});
app.post('/api/presensi', (req, res) => {
  const { peserta_id, sesi_id, status, keterangan } = req.body;
  if (!['hadir', 'izin', 'sakit', 'alpa'].includes(status)) return res.status(400).json({ error: 'Status tidak valid' });
  const waktu = status === 'hadir' ? nowLocal() : null;
  db.prepare(`
    INSERT INTO presensi (peserta_id, sesi_id, waktu_presensi, status, keterangan)
    VALUES (?,?,?,?,?)
    ON CONFLICT(peserta_id, sesi_id)
    DO UPDATE SET status=excluded.status, waktu_presensi=excluded.waktu_presensi, keterangan=excluded.keterangan
  `).run(peserta_id, sesi_id, waktu, status, keterangan || null);
  log(req, 'ubah', 'presensi');
  res.json({ ok: true });
});

// ---------- Rekap ----------
const rekapSql = `
  SELECT p.id, p.nim, p.nama, pr.nama_prodi,
    COALESCE(SUM(pe.status='hadir'),0) AS hadir,
    COALESCE(SUM(pe.status='izin'),0)  AS izin,
    COALESCE(SUM(pe.status='sakit'),0) AS sakit,
    COALESCE(SUM(pe.status='alpa'),0)  AS alpa,
    (SELECT COUNT(*) FROM sesi) AS total_sesi
  FROM peserta p
  JOIN prodi pr ON pr.id = p.prodi_id
  LEFT JOIN presensi pe ON pe.peserta_id = p.id
  GROUP BY p.id ORDER BY p.nama`;
const withPct = r => ({ ...r, persen: r.total_sesi ? Math.round(r.hadir * 100 / r.total_sesi) : 0 });

app.get('/api/rekap', (req, res) => res.json(db.prepare(rekapSql).all().map(withPct)));
app.get('/api/rekap/:id', (req, res) => {
  const riwayat = db.prepare(`
    SELECT s.judul, s.tanggal, pe.status, pe.waktu_presensi
    FROM sesi s LEFT JOIN presensi pe ON pe.sesi_id = s.id AND pe.peserta_id = ?
    ORDER BY s.tanggal DESC, s.id DESC`).all(req.params.id);
  res.json(riwayat);
});
app.get('/api/rekap.csv', (req, res) => {
  const rows = db.prepare(rekapSql).all().map(withPct);
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['NIM', 'Nama', 'Prodi', 'Hadir', 'Izin', 'Sakit', 'Alpa', 'Total Sesi', 'Persen'];
  const csv = [head.join(',')].concat(rows.map(r =>
    [r.nim, r.nama, r.nama_prodi, r.hadir, r.izin, r.sakit, r.alpa, r.total_sesi, r.persen + '%'].map(esc).join(','))).join('\n');
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="rekap-presensi.csv"' });
  res.send('\ufeff' + csv);
});

// ---------- Halaman ----------
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Berjalan di http://localhost:${PORT}`));
