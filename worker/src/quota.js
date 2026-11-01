// ตัวนับโควตา (pure functions) — Durable Object ใน index.js เรียกใช้ และ test ได้โดยไม่ต้องรัน Worker
//
// Gemini API รีเซ็ตโควตารายวัน (RPD) ตอนเที่ยงคืนเวลา Pacific จึงนับ "วัน" ตามเวลานั้นให้ตรงกับฝั่ง Google
// ตั้ง limit ให้ต่ำกว่าโควตาจริงใน AI Studio เล็กน้อย จะได้ไม่โดน 429 จาก Google ก่อน

const PACIFIC = 'America/Los_Angeles';

export function pacificDay(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: PACIFIC }).format(new Date(now));
}

function pacificHour(t) {
  return +new Intl.DateTimeFormat('en-US', { timeZone: PACIFIC, hour: 'numeric', hourCycle: 'h23' }).format(new Date(t));
}

// เที่ยงคืน Pacific = 07:00 UTC (ช่วงเวลาออมแสง) หรือ 08:00 UTC — วันที่เปลี่ยนเวลายาว 23/25 ชม. จึงคิดจาก 86400 ตรงๆ ไม่ได้
export function secondsUntilPacificMidnight(now) {
  const [y, m, d] = pacificDay(now).split('-').map(Number);
  const tomorrowUtc = Date.UTC(y, m - 1, d + 1);
  const offsetHours = pacificHour(tomorrowUtc + 7 * 3600e3) === 0 ? 7 : 8;
  return Math.max(1, Math.ceil((tomorrowUtc + offsetHours * 3600e3 - now) / 1000));
}

export function limitsFromEnv(env) {
  const n = (v, d) => (Number.isFinite(+v) && +v >= 0 ? Math.floor(+v) : d);
  return {
    perMinute: n(env.LIMIT_PER_MINUTE, 8),
    perDay: n(env.LIMIT_PER_DAY, 200),
    perIpPerDay: n(env.LIMIT_PER_IP_PER_DAY, 40),
  };
}

function fresh(now) {
  return { day: pacificDay(now), dayCount: 0, dayTokens: 0, minute: Math.floor(now / 60000), minuteCount: 0, ip: {}, cooldownUntil: 0 };
}

// เลื่อนหน้าต่างเวลา: ข้ามวัน → ล้างตัวนับรายวันและราย IP, ข้ามนาที → ล้างตัวนับรายนาที
function roll(state, now) {
  const s = state ? { ...state, ip: { ...state.ip } } : fresh(now);
  const day = pacificDay(now);
  if (s.day !== day) Object.assign(s, { day, dayCount: 0, dayTokens: 0, ip: {} });
  const minute = Math.floor(now / 60000);
  if (s.minute !== minute) Object.assign(s, { minute, minuteCount: 0 });
  return s;
}

export function snapshot(state, now, limits) {
  const s = roll(state, now);
  return {
    day: { used: s.dayCount, limit: limits.perDay, resetIn: secondsUntilPacificMidnight(now) },
    minute: { used: s.minuteCount, limit: limits.perMinute },
    tokensToday: s.dayTokens,
    cooldown: s.cooldownUntil > now ? Math.ceil((s.cooldownUntil - now) / 1000) : 0,
  };
}

// จองสิทธิ์ 1 ครั้งก่อนเรียก Gemini — ไม่ผ่านเงื่อนไขไหนก็ปฏิเสธพร้อมบอกว่าต้องรอกี่วินาที
export function reserve(state, { now, ipKey, limits }) {
  const s = roll(state, now);
  const deny = (reason, retryAfter) => ({ state: s, result: { ok: false, reason, retryAfter, usage: snapshot(s, now, limits) } });

  if (s.cooldownUntil > now) return deny('cooldown', Math.ceil((s.cooldownUntil - now) / 1000));
  if (s.dayCount >= limits.perDay) return deny('day', secondsUntilPacificMidnight(now));
  if (s.minuteCount >= limits.perMinute) return deny('minute', 60 - Math.floor((now % 60000) / 1000));
  if ((s.ip[ipKey] || 0) >= limits.perIpPerDay) return deny('ip', secondsUntilPacificMidnight(now));

  s.dayCount += 1;
  s.minuteCount += 1;
  s.ip[ipKey] = (s.ip[ipKey] || 0) + 1;
  return { state: s, result: { ok: true, usage: snapshot(s, now, limits) } };
}

// Google ตอบ 429 → หยุดยิงทั้งระบบตามเวลาที่ Google บอก (ไม่งั้นทุกคนจะยิงซ้ำเข้าไปเรื่อยๆ)
export function cooldown(state, now, seconds) {
  const s = roll(state, now);
  s.cooldownUntil = Math.max(s.cooldownUntil, now + Math.max(1, seconds) * 1000);
  return s;
}

export function recordTokens(state, now, tokens) {
  const s = roll(state, now);
  s.dayTokens += Math.max(0, Math.floor(+tokens || 0));
  return s;
}
