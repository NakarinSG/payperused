// node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const PromptPay = require('../js/promptpay.js');
const ItemSplit = require('../js/itemsplit.js');

// ค่าคาดหวังสร้างจาก promptpay-qr 0.5.0 (dtinth) ซึ่งแอปธนาคารไทยสแกนผ่าน
const FIXTURES = [
  ['0812345678', undefined, '00020101021129370016A000000677010111011300668123456785802TH530376463045D82'],
  ['0812345678', 315, '00020101021229370016A000000677010111011300668123456785802TH53037645406315.006304C69D'],
  ['081-234-5678', 1259.39, '00020101021229370016A000000677010111011300668123456785802TH530376454071259.3963043DC3'],
  ['1101700207366', undefined, '00020101021129370016A000000677010111021311017002073665802TH530376463044B43'],
  ['1101700207366', 0.5, '00020101021229370016A000000677010111021311017002073665802TH530376454040.506304ADED'],
  ['123456789012345', 42, '00020101021229390016A00000067701011103151234567890123455802TH5303764540542.006304D5B9'],
  ['0612345678', 99.99, '00020101021229370016A000000677010111011300666123456785802TH5303764540599.996304DE9B'],
];

test('PromptPay payload ตรงกับ promptpay-qr ทุกแบบ', () => {
  for (const [id, amount, expected] of FIXTURES) assert.equal(PromptPay.payload(id, amount), expected, `${id} ${amount}`);
});

test('PromptPay: CRC-16/CCITT-FALSE check value', () => {
  assert.equal(PromptPay.crc16('123456789'), '29B1');
});

test('PromptPay: ตรวจรูปแบบเลข กันพิมพ์ผิดแล้วเงินไปผิดคน', () => {
  assert.equal(PromptPay.parseId('1101700207367'), null, 'เลขบัตรหลักตรวจสอบผิด');
  for (const bad of ['', '12345', '08123456789', '08-12a-45678', null]) assert.equal(PromptPay.parseId(bad), null, String(bad));
  assert.equal(PromptPay.parseId(' 081 234 5678 ').type, 'phone');
  assert.throws(() => PromptPay.payload('12345', 10));
  assert.equal(PromptPay.mask('0812345678'), 'เบอร์ •••5678');
  assert.equal(PromptPay.mask('xx'), '');
});

test('ItemSplit: หารรายการตามคนกิน แล้วกระจายค่าบริการ/VAT ตามสัดส่วน', () => {
  const r = ItemSplit.split([
    { name: 'ข้าวซอย x4', price: 400, eaters: [] },          // ทุกคน → คนละ 100
    { name: 'แกงฮังเล', price: 200, eaters: ['นัท', 'บอส'] }, // คนละ 100
    { name: 'เบียร์', price: 200, eaters: ['ต้น'] },
  ], 880, ['นัท', 'บอส', 'มิ้นท์', 'ต้น']);
  // ราคารายการรวม 800, ส่วนต่าง 80 (10%) กระจายตามสัดส่วน
  assert.deepEqual(r.shares, { 'นัท': 220, 'บอส': 220, 'มิ้นท์': 110, 'ต้น': 330 });
  assert.deepEqual([r.itemsSum, r.extras, r.mismatch], [800, 80, false]);
  const sum = Object.values(r.shares).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 880) < 0.05);
});

test('ItemSplit: ส่วนลด (ส่วนต่างติดลบ) และกรณียอดไม่ตรงมาก', () => {
  const r = ItemSplit.split([{ name: 'a', price: 100, eaters: ['A'] }, { name: 'b', price: 100, eaters: ['B'] }], 180, ['A', 'B']);
  assert.deepEqual(r.shares, { A: 90, B: 90 });
  assert.equal(ItemSplit.split([{ name: 'a', price: 100, eaters: [] }], 500, ['A', 'B']).mismatch, true);
  assert.deepEqual(ItemSplit.split([], 100, ['A']).shares, {});
});
