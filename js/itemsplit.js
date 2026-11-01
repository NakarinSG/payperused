// แบ่งบิลตามรายการอาหาร: แต่ละรายการหารเท่ากันในคนที่กิน แล้วกระจาย "ส่วนต่าง"
// (ยอดสุทธิ − ราคารวมของรายการ = ค่าบริการ + VAT − ส่วนลด) ตามสัดส่วนยอดของแต่ละคน
// ใช้ได้ทั้งในหน้าเว็บ (window.ItemSplit) และใน node (require) สำหรับ test
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ItemSplit = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const round2 = n => Math.round(n * 100) / 100;

  // items: [{ name, price, eaters: [ชื่อ] }] — eaters ว่าง = ทุกคนใน everyone
  function split(items, total, everyone) {
    const base = {};
    let itemsSum = 0;
    for (const it of items) {
      const eaters = it.eaters && it.eaters.length ? it.eaters : everyone;
      if (!eaters.length || !(it.price > 0)) continue;
      itemsSum += it.price;
      for (const m of eaters) base[m] = (base[m] || 0) + it.price / eaters.length;
    }
    const extras = total - itemsSum;
    const shares = {};
    if (itemsSum > 0) {
      for (const [m, b] of Object.entries(base)) shares[m] = round2(b + extras * b / itemsSum);
    }
    return {
      shares,
      itemsSum: round2(itemsSum),
      extras: round2(extras),
      // ส่วนต่างเกิน 30% ของยอด มักแปลว่า AI อ่านรายการไม่ครบ/ผิด — ให้ผู้ใช้ตรวจ
      mismatch: itemsSum > 0 && Math.abs(extras) > total * 0.3,
    };
  }

  return { split };
}));
