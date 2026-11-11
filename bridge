// Jembatan Arduino Uno (USB) -> server presensi
// Cara pakai:  node bridge.js COM3        (ganti COM3 sesuai port Arduino)
//              node bridge.js list        (melihat daftar port yang tersedia)
const { SerialPort, ReadlineParser } = require('serialport');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000/api/scan';
const DEVICE_KEY = process.env.DEVICE_KEY || 'kunci-device-123';
const portName = process.argv[2];

async function listPorts() {
  const ports = await SerialPort.list();
  if (!ports.length) return console.log('Tidak ada port serial. Pastikan Arduino tersambung lewat USB.');
  console.log('Port yang tersedia:');
  ports.forEach(p => console.log(' -', p.path, p.manufacturer ? `(${p.manufacturer})` : ''));
}

async function kirim(uid) {
  try {
    const r = await fetch(SERVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': DEVICE_KEY },
      body: JSON.stringify({ uid })
    });
    const d = await r.json().catch(() => ({}));
    console.log(`[${new Date().toLocaleTimeString()}] ${uid} -> ${d.nama ? d.nama + ': ' : ''}${d.pesan || r.status}`);
    return r.ok;
  } catch (e) {
    console.log('Server tidak terjangkau. Pastikan "npm start" sedang berjalan.');
    return false;
  }
}

function mulai() {
  const port = new SerialPort({ path: portName, baudRate: 9600 }, err => {
    if (err) {
      console.log('Gagal membuka', portName + ':', err.message);
      console.log('Tutup Serial Monitor Arduino IDE (port hanya bisa dipakai satu program).');
      return listPorts().then(() => setTimeout(mulai, 3000));
    }
    console.log('Terhubung ke', portName, '- tempelkan kartu ke alat...');
  });
  const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
  parser.on('data', async line => {
    line = line.trim();
    if (!line.startsWith('UID:')) return;
    const ok = await kirim(line.slice(4).trim().toUpperCase());
    port.write(ok ? '1' : '0');   // Arduino membunyikan buzzer sesuai hasil
  });
  port.on('close', () => { console.log('Port terputus, mencoba lagi...'); setTimeout(mulai, 3000); });
}

if (!portName) { console.log('Contoh: node bridge.js COM3'); listPorts(); }
else if (portName === 'list') listPorts();
else mulai();
