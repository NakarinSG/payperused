import test from 'node:test';
import assert from 'node:assert/strict';
import { reserve, snapshot, cooldown, recordTokens, limitsFromEnv, pacificDay, secondsUntilPacificMidnight } from '../src/quota.js';

const limits = { perMinute: 3, perDay: 5, perIpPerDay: 4 };
// 2026-11-01 10:00:15 เวลาไทย = 2026-10-31 20:00:15 เวลา Pacific (PDT, UTC-7)
const T0 = Date.parse('2026-11-01T03:00:15Z');

function run(state, n, { now = T0, ipKey = 'a' } = {}) {
  const results = [];
  for (let i = 0; i < n; i++) {
    const r = reserve(state, { now, ipKey, limits });
    state = r.state;
    results.push(r.result);
  }
  return { state, results };
}

test('ต่อนาที: ครบแล้วปฏิเสธ พร้อมบอกวินาทีที่ต้องรอ แล้วนาทีถัดไปใช้ได้อีก', () => {
  let { state, results } = run(undefined, 4);
  assert.deepEqual(results.map(r => r.ok), [true, true, true, false]);
  assert.equal(results[3].reason, 'minute');
  assert.equal(results[3].retryAfter, 45);
  assert.deepEqual(results[2].usage.minute, { used: 3, limit: 3 });
  ({ results } = run(state, 1, { now: T0 + 60_000 }));
  assert.equal(results[0].ok, true);
});

test('ต่อวัน: ครบแล้วรอถึงเที่ยงคืน Pacific ไม่ใช่เที่ยงคืนไทย', () => {
  let state;
  for (let m = 0; m < 5; m++) ({ state } = run(state, 1, { now: T0 + m * 60_000, ipKey: `ip${m}` }));
  const r = reserve(state, { now: T0 + 10 * 60_000, ipKey: 'new', limits }).result;
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'day');
  // 20:10:15 PDT → เหลือ 3:49:45 ถึงเที่ยงคืน
  assert.equal(r.retryAfter, 3 * 3600 + 49 * 60 + 45);
  // ผ่านเที่ยงคืน Pacific (07:00 UTC) แล้วนับใหม่
  const next = reserve(state, { now: Date.parse('2026-11-01T07:00:05Z'), ipKey: 'new', limits }).result;
  assert.equal(next.ok, true);
  assert.equal(next.usage.day.used, 1);
});

test('ต่อ IP: คนเดียวใช้เกินโควตาของตัวเองไม่ได้ แต่คนอื่นยังใช้ได้', () => {
  let state;
  const lim = { perMinute: 100, perDay: 100, perIpPerDay: 2 };
  const res = [];
  for (const ipKey of ['x', 'x', 'x', 'y']) {
    const r = reserve(state, { now: T0, ipKey, limits: lim });
    state = r.state;
    res.push(r.result.ok ? 'ok' : r.result.reason);
  }
  assert.deepEqual(res, ['ok', 'ok', 'ip', 'ok']);
});

test('cooldown หลัง Google ตอบ 429: ปฏิเสธทุกคนจนครบเวลา', () => {
  let state = cooldown(undefined, T0, 37);
  let r = reserve(state, { now: T0 + 10_000, ipKey: 'a', limits });
  assert.deepEqual([r.result.ok, r.result.reason, r.result.retryAfter], [false, 'cooldown', 27]);
  r = reserve(r.state, { now: T0 + 38_000, ipKey: 'a', limits });
  assert.equal(r.result.ok, true);
});

test('ตัวที่ถูกปฏิเสธไม่นับเป็นการใช้งาน / นับ token รายวัน', () => {
  let { state } = run(undefined, 6);
  assert.equal(snapshot(state, T0, limits).minute.used, 3);
  state = recordTokens(state, T0, 1200.7);
  state = recordTokens(state, T0, 'x');
  assert.equal(snapshot(state, T0, limits).tokensToday, 1200);
});

test('state ไม่ถูกแก้ทับ (immutable)', () => {
  const { state } = run(undefined, 1);
  const before = JSON.stringify(state);
  reserve(state, { now: T0, ipKey: 'b', limits });
  assert.equal(JSON.stringify(state), before);
});

test('limitsFromEnv / เวลา Pacific', () => {
  assert.deepEqual(limitsFromEnv({ LIMIT_PER_MINUTE: '10', LIMIT_PER_DAY: 'abc', LIMIT_PER_IP_PER_DAY: '-1' }), { perMinute: 10, perDay: 200, perIpPerDay: 40 });
  assert.equal(pacificDay(T0), '2026-10-31');
  assert.equal(secondsUntilPacificMidnight(Date.parse('2026-11-01T06:59:59Z')), 1);
  // 1 พ.ย. 2026 สหรัฐฯ เลิกเวลาออมแสง วันนั้นยาว 25 ชม. → เที่ยงคืนถัดไปคือ 08:00 UTC (15:00 เวลาไทย)
  assert.equal(secondsUntilPacificMidnight(Date.parse('2026-11-01T08:25:00Z')), 23 * 3600 + 35 * 60);
  // 8 มี.ค. 2026 เริ่มเวลาออมแสง วันนั้นยาว 23 ชม. → เที่ยงคืนถัดไปคือ 07:00 UTC
  assert.equal(secondsUntilPacificMidnight(Date.parse('2026-03-08T09:00:00Z')), 22 * 3600);
});
