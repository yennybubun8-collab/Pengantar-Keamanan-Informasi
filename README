# Presensi RFID (Website + Database SQLite + ESP32)

Alur:  Kartu -> RC522 -> ESP32 --WiFi--> server.js (Node) -> presensi.db -> Dashboard admin

## 1. Jalankan website (sekali install)
    npm install
    (jika muncul peringatan install-scripts:)
    npm install-scripts approve better-sqlite3
    npm rebuild better-sqlite3
    npm start
Buka http://localhost:3000  -> login: admin / admin123
Jika PowerShell memblokir npm:  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

## 2. Hardware ESP32 (utama)
Kode: firmware/esp32/esp32.ino   (library: MFRC522)
Wiring RC522 -> ESP32:  SDA=5, SCK=18, MOSI=23, MISO=19, RST=22, 3.3V=3V3, GND=GND
Ubah WIFI_SSID, WIFI_PASS, SERVER_URL (IP laptop dari 'ipconfig'), API_KEY.

## 2b. Hardware Arduino Uno (cadangan, lewat USB)
Kode: firmware/uno/uno.ino. Jalankan tambahan:  node bridge.js COM3   (node bridge.js list untuk cek port)
Wiring RC522 -> Uno: SDA=10, SCK=13, MOSI=11, MISO=12, RST=9, 3.3V, GND

## 3. Pemakaian
1. Tempel kartu -> Daftar Peserta -> Edit -> "Ambil dari scan terakhir" -> Simpan
2. Input Presensi -> pilih sesi -> "Jadikan sesi aktif"
3. Tempel kartu -> presensi tercatat otomatis

## Keamanan (ganti sebelum dipakai sungguhan)
    $env:ADMIN_PASSWORD="passwordkuat"   (sebelum menjalankan PERTAMA kali)
    $env:SESSION_SECRET="teks-acak-panjang"
    $env:DEVICE_KEY="kunci-rahasia"      (samakan dengan API_KEY di esp32.ino)
