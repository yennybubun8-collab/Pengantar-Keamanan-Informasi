<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Login Admin</title>
<link rel="stylesheet" href="style.css"></head>
<body class="center">
<form id="f" class="card login">
  <h1>Presensi<span>Ku</span></h1>
  <p class="muted">Masuk sebagai admin</p>
  <label>Username<input name="username" required autofocus></label>
  <label>Password<input name="password" type="password" required></label>
  <p id="err" class="error" role="alert"></p>
  <button class="btn primary" type="submit">Masuk</button>
</form>
<script>
document.getElementById('f').onsubmit = async e => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  const r = await fetch('/api/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  if (r.ok) location.href = '/';
  else document.getElementById('err').textContent = (await r.json()).error;
};
</script></body></html>
