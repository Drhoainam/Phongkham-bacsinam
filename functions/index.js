// Cloud Functions — tự gửi thông báo đẩy (chuông) cho app CSKH Phòng khám BS. Hoài Nam
// Chạy khi lịch hẹn / tư vấn / token thông báo thay đổi trong Firestore. Không cần khoá bí mật.
const { onDocumentCreated, onDocumentUpdated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');

admin.initializeApp();
setGlobalOptions({ region: 'asia-southeast1', maxInstances: 3, memory: '256MiB' });

const db = admin.firestore();
const APP_URL = '/cskh';
const ADMIN_URL = '/cskh-admin';
const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
function fd(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s || '';
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return `${WD[d.getDay()]} ${m[3]}/${m[2]}`;
}
const cut = (s, n) => (s = String(s || '')).length > n ? s.slice(0, n - 1) + '…' : s;

async function tokensOf(target) {
  const snaps = target.uid
    ? [await db.collection('pushTokens').doc(target.uid).get()]
    : (await db.collection('pushTokens').where('role', '==', 'admin').get()).docs;
  const list = [];
  snaps.forEach(s => { if (s.exists) (s.data().tokens || []).forEach(t => list.push({ t, ref: s.ref })); });
  return list;
}

async function send(target, msg, onlyTokens) {
  let list = await tokensOf(target);
  if (onlyTokens) list = list.filter(x => onlyTokens.includes(x.t));
  if (!list.length) return;
  const res = await admin.messaging().sendEachForMulticast({
    tokens: list.map(x => x.t),
    data: { title: msg.title, body: msg.body, url: msg.url, tag: msg.tag || 'cskh' },
    webpush: { headers: { Urgency: 'high', TTL: '86400' } },
  });
  const dead = [];
  res.responses.forEach((r, i) => {
    const c = r.error && r.error.code;
    if (c === 'messaging/registration-token-not-registered' || c === 'messaging/invalid-registration-token' || c === 'messaging/invalid-argument') dead.push(list[i]);
  });
  for (const d of dead) await d.ref.update({ tokens: admin.firestore.FieldValue.arrayRemove(d.t) }).catch(() => {});
  console.log('push', msg.tag, 'ok', res.successCount, 'fail', res.failureCount);
}

// ---- Lịch hẹn mới → báo bác sĩ ----
exports.apptCreated = onDocumentCreated('appointments/{id}', async e => {
  const a = e.data && e.data.data(); if (!a) return;
  await send({ admin: true }, { title: '📅 Lịch hẹn mới', body: `${a.name} · ${fd(a.date)} ${a.time} · ${a.service}`, url: ADMIN_URL, tag: 'new-' + e.params.id });
});

// ---- Lịch hẹn thay đổi ----
exports.apptUpdated = onDocumentUpdated('appointments/{id}', async e => {
  const b = e.data.before.data(), a = e.data.after.data(), id = e.params.id;
  const when = `${fd(a.date)} ${a.time}`;
  const statusChanged = b.status !== a.status;
  const newProposal = a.status === 'reschedule' && (statusChanged || b.proposedDate !== a.proposedDate || b.proposedTime !== a.proposedTime || b.adminNote !== a.adminNote);

  // Phòng khám → khách
  if (statusChanged && a.status === 'confirmed' && b.status === 'pending')
    return send({ uid: a.uid }, { title: '✅ Lịch khám đã được xác nhận', body: `${when} — ${a.service}. Hẹn gặp anh/chị!`, url: APP_URL, tag: 'appt-' + id });
  if (newProposal)
    return send({ uid: a.uid }, { title: '🕑 Phòng khám đề nghị đổi giờ khám', body: `Giờ mới: ${fd(a.proposedDate)} ${a.proposedTime}. Lý do: ${cut(a.adminNote, 90)}`, url: APP_URL, tag: 'appt-' + id });
  if (statusChanged && a.status === 'rejected')
    return send({ uid: a.uid }, { title: b.status === 'confirmed' ? '❌ Lịch khám đã bị huỷ' : '❌ Phòng khám chưa thể nhận lịch', body: `${when}. Lý do: ${cut(a.adminNote, 110)}`, url: APP_URL, tag: 'appt-' + id });

  // Khách → phòng khám
  if (statusChanged && a.status === 'confirmed' && b.status === 'reschedule')
    return send({ admin: true }, { title: '✅ Khách đồng ý giờ mới', body: `${a.name} · ${when} · ${a.service}`, url: ADMIN_URL, tag: 'ac-' + id });
  if (statusChanged && a.status === 'cancelled')
    return send({ admin: true }, { title: '🚫 Khách huỷ lịch', body: `${a.name} · ${fd(b.date)} ${b.time} · ${a.service}`, url: ADMIN_URL, tag: 'cx-' + id });
});

// ---- Tư vấn mới → báo bác sĩ ----
exports.consultCreated = onDocumentCreated('consults/{id}', async e => {
  const c = e.data && e.data.data(); if (!c) return;
  await send({ admin: true }, { title: '📷 Câu hỏi tư vấn mới', body: `${c.name || 'Khách'}: ${cut((c.area ? c.area + ' — ' : '') + (c.desc || ''), 100)}`, url: ADMIN_URL, tag: 'nc-' + e.params.id });
});

// ---- Bác sĩ trả lời tư vấn → báo khách ----
exports.consultUpdated = onDocumentUpdated('consults/{id}', async e => {
  const b = e.data.before.data(), a = e.data.after.data();
  if (a.status !== 'answered' || !a.reply || b.reply === a.reply) return;
  await send({ uid: a.uid }, { title: '💬 Bác sĩ đã trả lời tư vấn', body: cut(a.reply, 120), url: APP_URL, tag: 'consult-' + e.params.id });
});

// ---- Vừa bật thông báo trên máy mới → gửi chuông thử ----
exports.tokenAdded = onDocumentWritten('pushTokens/{uid}', async e => {
  const before = (e.data.before.exists && e.data.before.data().tokens) || [];
  const after = (e.data.after.exists && e.data.after.data().tokens) || [];
  const fresh = after.filter(t => !before.includes(t));
  if (!fresh.length) return;
  const isAdmin = e.data.after.data().role === 'admin';
  await send({ uid: e.params.uid }, { title: '🔔 Đã bật thông báo', body: isAdmin ? 'Máy này sẽ báo khi có lịch hẹn hoặc câu hỏi tư vấn mới.' : 'Bạn sẽ nhận thông báo từ Phòng khám BS. Hoài Nam tại đây.', url: isAdmin ? ADMIN_URL : APP_URL, tag: 'test' }, fresh);
});
