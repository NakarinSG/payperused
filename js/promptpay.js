// Thai QR (PromptPay) ตามมาตรฐาน EMVCo — แอปธนาคารไทยสแกนได้ทุกเจ้า และถ้าใส่ยอดไว้ ยอดจะขึ้นเองไม่ต้องพิมพ์
// ใช้ได้ทั้งในหน้าเว็บ (window.PromptPay) และใน node (require) สำหรับ test
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PromptPay = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const PROMPTPAY_AID = 'A000000677010111';
  const ID_TAG = { phone: '01', nationalId: '02', ewallet: '03' };

  function field(id, value) {
    return id + String(value.length).padStart(2, '0') + value;
  }

  // CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) ตามที่ EMVCo กำหนด
  function crc16(str) {
    let crc = 0xffff;
    for (let i = 0; i < str.length; i++) {
      crc ^= str.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  // เลขบัตรประชาชน/เลขผู้เสียภาษี 13 หลัก มีหลักตรวจสอบ — กันพิมพ์ผิดหลักเดียวแล้วเงินไปผิดคน
  function validCitizenId(d) {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += +d[i] * (13 - i);
    return (11 - (sum % 11)) % 10 === +d[12];
  }

  // รับเบอร์มือถือ 10 หลัก / เลขบัตร 13 หลัก / e-wallet 15 หลัก (มีขีดหรือเว้นวรรคได้)
  function parseId(input) {
    const digits = String(input == null ? '' : input).replace(/[\s-]/g, '');
    if (!/^\d+$/.test(digits)) return null;
    if (/^0\d{9}$/.test(digits)) return { type: 'phone', digits, value: ('0066' + digits.slice(1)) };
    if (digits.length === 13 && validCitizenId(digits)) return { type: 'nationalId', digits, value: digits };
    if (digits.length === 15) return { type: 'ewallet', digits, value: digits };
    return null;
  }

  // ลำดับ field ตาม promptpay-qr (dtinth) ที่แอปธนาคารไทยสแกนผ่านมานาน — test เทียบผลกับ library นี้
  function payload(input, amount) {
    const id = parseId(input);
    if (!id) throw new Error('invalid PromptPay ID');
    const withAmount = Number.isFinite(amount) && amount > 0;
    const data = field('00', '01')
      + field('01', withAmount ? '12' : '11')
      + field('29', field('00', PROMPTPAY_AID) + field(ID_TAG[id.type], id.value))
      + field('58', 'TH')
      + field('53', '764')
      + (withAmount ? field('54', amount.toFixed(2)) : '')
      + '6304';
    return data + crc16(data);
  }

  // แสดงแค่ 4 หลักท้าย — เลขเต็มอยู่ใน QR อยู่แล้ว ไม่ต้องโชว์บนจอให้คนข้างๆ เห็น
  function mask(input) {
    const id = parseId(input);
    if (!id) return '';
    const label = id.type === 'phone' ? 'เบอร์' : id.type === 'nationalId' ? 'เลขบัตร' : 'e-Wallet';
    return `${label} •••${id.digits.slice(-4)}`;
  }

  return { parseId, payload, crc16, mask };
}));
