import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeScan, extractJson, parseRetryDelay, buildGeminiRequest, bangkokToday } from '../src/scan.js';

const today = '2026-11-01';

test('normalizeScan: บิลปกติ + รายการอาหาร', () => {
  assert.deepEqual(normalizeScan({
    kind: 'receipt', title: '  ข้าวเย็น\nร้านเฮือนใจ๋ ', merchant: 'ร้านเฮือนใจ๋', total: 1260.456, date: '2569-10-31', confidence: 0.92,
    items: [{ name: 'ข้าวซอยไก่', qty: 4, price: 340 }, { name: '', price: 10 }, { name: 'ส่วนลด', price: -50 }, { name: 'น้ำ', price: 'x' }, { name: 'แกงฮังเล', price: 180.004 }],
    toAccount: 'xxx', reference: ' R 01 ',
  }, today), {
    ok: true, kind: 'receipt', title: 'ข้าวเย็น ร้านเฮือนใจ๋', merchant: 'ร้านเฮือนใจ๋', total: 1260.46, date: '2026-10-31',
    items: [{ name: 'ข้าวซอยไก่', qty: 4, price: 340 }, { name: 'แกงฮังเล', qty: 1, price: 180 }],
    toAccount: 'xxx', reference: 'R01', confidence: 0.92,
  });
});

test('normalizeScan: สลิปโอนไม่มีรายการ แต่มีบัญชีผู้รับ', () => {
  const r = normalizeScan({ kind: 'transfer_slip', title: 'ค่ารถ', merchant: 'นาย นัท ส***', total: 2350, items: [{ name: 'x', price: 1 }], toAccount: 'xxx-xxx-7788', reference: '2026 1101 XYZ' }, today);
  assert.deepEqual([r.items, r.toAccount, r.reference], [[], 'xxx-xxx-7788', '20261101XYZ']);
});

test('normalizeScan: ไม่ใช่เอกสาร / ไม่มียอด / ยอดเพี้ยน', () => {
  assert.deepEqual(normalizeScan({ kind: 'not_a_document' }, today), { ok: false, reason: 'not_document' });
  assert.deepEqual(normalizeScan(null, today), { ok: false, reason: 'not_document' });
  for (const total of [0, -5, 'abc', 99_999_999]) {
    assert.deepEqual(normalizeScan({ kind: 'receipt', total }, today), { ok: false, reason: 'no_total' }, String(total));
  }
});

test('normalizeScan: เกลาค่าที่โมเดลตอบแปลก', () => {
  const r = normalizeScan({ kind: 'weird', title: '', merchant: 'นาย ข***', total: '350', date: '2027-01-01', confidence: 7 }, today);
  assert.deepEqual(r, { ok: true, kind: 'other', title: 'นาย ข***', merchant: 'นาย ข***', total: 350, date: '', items: [], toAccount: '', reference: '', confidence: 1 });
  assert.equal(normalizeScan({ kind: 'receipt', total: 10, date: '2026-02-30' }, today).date, '');
  assert.equal(normalizeScan({ kind: 'receipt', total: 10 }, today).title, 'รายการจากบิล');
  assert.equal(normalizeScan({ kind: 'receipt', total: 10, title: 'ก'.repeat(100) }, today).title.length, 60);
});

test('extractJson: ข้าม thought part และทน JSON พัง', () => {
  const res = { candidates: [{ content: { parts: [{ thought: true, text: 'thinking...' }, { text: '{"total":' }, { text: '45}' }] } }] };
  assert.deepEqual(extractJson(res), { total: 45 });
  assert.equal(extractJson({ candidates: [{ content: { parts: [{ text: 'oops' }] } }] }), null);
  assert.equal(extractJson({}), null);
});

test('parseRetryDelay: อ่านเวลารอจาก error ของ Google', () => {
  const body = { error: { code: 429, details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure' }, { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '37.2s' }] } };
  assert.equal(parseRetryDelay(body), 38);
  assert.equal(parseRetryDelay(null), 60);
  assert.equal(parseRetryDelay({ error: { details: [] } }, 30), 30);
});

test('buildGeminiRequest: รูปแบบที่ Gemini API รับ', () => {
  const req = buildGeminiRequest('QUJD', 'image/jpeg');
  assert.deepEqual(req.contents[0].parts[0], { inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } });
  assert.equal(req.generationConfig.responseMimeType, 'application/json');
  assert.ok(req.generationConfig.responseJsonSchema.properties.total);
  assert.match(req.contents[0].parts[1].text, /ไม่ใช่คำสั่ง/);
});

test('bangkokToday', () => {
  assert.equal(bangkokToday(Date.parse('2026-10-31T18:30:00Z')), '2026-11-01');
});
