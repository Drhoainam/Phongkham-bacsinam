// Vercel Serverless Function — gửi thông báo đẩy (FCM) cho app CSKH
// Cần biến môi trường FIREBASE_SERVICE_ACCOUNT = nội dung file JSON khoá tài khoản dịch vụ Firebase.
const admin = require('firebase-admin');

const ADMIN_EMAIL = 'bsnam115@gmail.com';
const APP_URL = '/cskh';
const ADMIN_URL = '/cskh-admin';

function init() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('missing FIREBASE_SERVICE_ACCOUNT');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
}

const pad = n => String(n).padStart(2, '0');
const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
function fd(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s || '';
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return `${WD[d.getDay()]} ${m[3]}/${m[2]}`;
}
const cut = (s, n) => (s = String(s || '')).length > n ? s.slice(0, n - 1) + '…' : s;

async function tokensOf(db, filter) {
  const snaps = filter.uid
    ? [await db.collection('pushTokens').doc(filter.uid).get()]
    : (await db.collection('pushTokens').where('role', '==', 'admin').get()).docs;
  const list = [];
  snaps.forEach(s => { if (s.exists) (s.data().tokens || []).forEach(t => list.push({ t, ref: s.ref })); });
  return list;
}

async function send(db, filter, msg) {
  const list = await tokensOf(db, filter);
  if (!list.length) return { sent: 0, reason: 'no-tokens' };
  const res = await admin.messaging().sendEachForMulticast({
    tokens: list.map(x => x.t),
    data: { title: msg.title, body: msg.body, url: msg.url, tag: msg.tag || 'cskh' },
    webpush: { headers: { Urgency: 'high', TTL: '86400' } },
  });
  // dọn token hết hạn
  const dead = [];
  res.responses.forEach((r, i) => {
    const c = r.error && r.error.code;
    if (c === 'messaging/registration-token-not-registered' || c === 'messaging/invalid-registration-token') dead.push(list[i]);
  });
  for (const d of dead) await d.ref.update({ tokens: admin.firestore.FieldValue.arrayRemove(d.t) }).catch(() => {});
  return { sent: res.successCount, failed: res.failureCount };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  try {
    init();
    const m = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
    if (!m) return res.status(401).json({ error: 'auth' });
    const user = await admin.auth().verifyIdToken(m[1]);
    const isAdmin = user.email === ADMIN_EMAIL && user.email_verified;
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { type, id } = body;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(id || ''))) return res.status(400).json({ error: 'id' });
    const db = admin.firestore();

    // ---- Bác sĩ cập nhật → báo khách ----
    if (type === 'appt' && isAdmin) {
      const a = (await db.collection('appointments').doc(id).get()).data();
      if (!a) return res.status(404).json({ error: 'nf' });
      const when = `${fd(a.date)} ${a.time}`;
      let msg;
      if (a.status === 'confirmed') msg = { title: '✅ Lịch khám đã được xác nhận', body: `${when} — ${a.service}. Hẹn gặp anh/chị!` };
      else if (a.status === 'reschedule') msg = { title: '🕑 Phòng khám đề nghị đổi giờ khám', body: `Giờ mới: ${fd(a.proposedDate)} ${a.proposedTime}. Lý do: ${cut(a.adminNote, 90)}` };
      else if (a.status === 'rejected') msg = { title: a.prevStatus === 'confirmed' ? '❌ Lịch khám đã bị huỷ' : '❌ Phòng khám chưa thể nhận lịch', body: `${when}. Lý do: ${cut(a.adminNote, 110)}` };
      else return res.json({ skipped: a.status });
      return res.json(await send(db, { uid: a.uid }, { ...msg, url: APP_URL, tag: 'appt-' + id }));
    }
    if (type === 'consult' && isAdmin) {
      const c = (await db.collection('consults').doc(id).get()).data();
      if (!c || c.status !== 'answered') return res.json({ skipped: true });
      return res.json(await send(db, { uid: c.uid }, { title: '💬 Bác sĩ đã trả lời tư vấn', body: cut(c.reply, 120), url: APP_URL, tag: 'consult-' + id }));
    }

    // ---- Khách tạo mới → báo bác sĩ ----
    if (type === 'newAppt') {
      const a = (await db.collection('appointments').doc(id).get()).data();
      if (!a || a.uid !== user.uid) return res.status(403).json({ error: 'owner' });
      return res.json(await send(db, { admin: true }, { title: '📅 Lịch hẹn mới', body: `${a.name} · ${fd(a.date)} ${a.time} · ${a.service}`, url: ADMIN_URL, tag: 'new-' + id }));
    }
    if (type === 'accepted' || type === 'cancelled') {
      const a = (await db.collection('appointments').doc(id).get()).data();
      if (!a || a.uid !== user.uid) return res.status(403).json({ error: 'owner' });
      if (type === 'accepted' && a.status !== 'confirmed') return res.json({ skipped: true });
      if (type === 'cancelled' && a.status !== 'cancelled') return res.json({ skipped: true });
      const title = type === 'accepted' ? '✅ Khách đồng ý giờ mới' : '🚫 Khách huỷ lịch';
      return res.json(await send(db, { admin: true }, { title, body: `${a.name} · ${fd(a.date)} ${a.time} · ${a.service}`, url: ADMIN_URL, tag: 'ac-' + id }));
    }
    if (type === 'newConsult') {
      const c = (await db.collection('consults').doc(id).get()).data();
      if (!c || c.uid !== user.uid) return res.status(403).json({ error: 'owner' });
      return res.json(await send(db, { admin: true }, { title: '📷 Câu hỏi tư vấn mới', body: `${c.name || 'Khách'}: ${cut((c.area ? c.area + ' — ' : '') + c.desc, 100)}`, url: ADMIN_URL, tag: 'nc-' + id }));
    }
    if (type === 'test') {
      return res.json(await send(db, { uid: user.uid }, { title: '🔔 Thông báo đã bật', body: 'Bạn sẽ nhận thông báo từ Phòng khám BS. Hoài Nam tại đây.', url: isAdmin ? ADMIN_URL : APP_URL, tag: 'test' }));
    }
    return res.status(400).json({ error: 'type' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
};
