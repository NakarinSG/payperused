# สแกนบิล / สลิป ด้วย AI (Cloudflare Worker)

ปุ่ม **📷 สแกนบิล / สลิป** ในฟอร์มเพิ่มรายการ ส่งรูปให้ Gemini อ่านชื่อรายการและยอดเงิน แล้วกรอกฟอร์มให้

```
หน้าเว็บ (GitHub Pages) ──POST /scan──▶ Cloudflare Worker ──▶ Gemini API
                                           │  ถือ GEMINI_API_KEY เป็น secret
                                           └─ Durable Object นับโควตา ต่อนาที / ต่อวัน / ต่อ IP
```

**ทำไมต้องมี Worker:** repo นี้เป็น public และ GitHub Pages เสิร์ฟทุกไฟล์ใน repo
ถ้าใส่ key ไว้ในหน้าเว็บ ใครก็ copy ไปใช้จนโควตาหมด หรือจนเสียเงินได้
ตัวนับฝั่ง browser กันไม่ได้ เพราะคนที่เอา key ไปจะเรียก API ตรงโดยไม่ผ่านเว็บ

---

## Deploy (ทำครั้งเดียว)

1. สมัคร Cloudflare (ฟรี ไม่ต้องผูกบัตร): https://dash.cloudflare.com/sign-up
2. ติดตั้งและ login:

   ```bash
   cd worker
   ```

   ```bash
   npm install
   ```

   ```bash
   npx wrangler login
   ```

3. **สร้าง API key ใหม่** ใน Google AI Studio แล้วใช้ key ใหม่นี้แทน key ที่เคยพิมพ์ในแชท (key ที่ถูกแชร์ไปแล้วควรถือว่าหลุด) จากนั้นลบ key เก่าทิ้ง
4. เก็บ key ไว้ใน Cloudflare (CLI จะให้วาง key ไม่มีการเขียนลงไฟล์):

   ```bash
   npx wrangler secret put GEMINI_API_KEY
   ```

5. ดูโควตาจริงใน AI Studio → **Rate limits** ของโมเดล `gemini-3.5-flash-lite`
   แล้วตั้ง `LIMIT_*` ใน `wrangler.jsonc` ให้ต่ำกว่านั้นเล็กน้อย (ดูหัวข้อถัดไป)
6. Deploy:

   ```bash
   npx wrangler deploy
   ```

   จะได้ URL เช่น `https://payperused-scan.<ชื่อบัญชี>.workers.dev`
7. ใส่ URL นั้นใน `index.html`:

   ```js
   const SCAN_API_URL = 'https://payperused-scan.<ชื่อบัญชี>.workers.dev';
   ```

   commit + push แล้วปุ่มสแกนจะโผล่ในฟอร์ม (ถ้าค่านี้ว่าง ปุ่มจะซ่อนอยู่)

---

## คำนวณการใช้งาน / ไม่ให้เกิน limit

ทุกครั้งก่อนเรียก Gemini Worker จะ "จองโควตา" จาก Durable Object ก่อน ถ้าไม่ผ่านเงื่อนไขข้อไหนจะตอบ 429 โดย**ไม่เรียก Gemini เลย**

| ตัวแปรใน `wrangler.jsonc` | ค่าตั้งต้น | ความหมาย |
|---|---|---|
| `LIMIT_PER_MINUTE` | `8` | ทั้งระบบ ต่อนาที (เทียบกับ RPM ของ Google) |
| `LIMIT_PER_DAY` | `200` | ทั้งระบบ ต่อวัน (เทียบกับ RPD ของ Google) |
| `LIMIT_PER_IP_PER_DAY` | `40` | ต่อเครื่อง/เครือข่าย ต่อวัน — กันคนเดียวใช้หมด |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | โมเดลที่ใช้ |

- **นับวันตามเวลา Pacific** เพราะ Google รีเซ็ตโควตารายวันตอนเที่ยงคืนเวลา Pacific ซึ่งตรงกับ **14:00 หรือ 15:00 น. เวลาไทย** (ขึ้นกับช่วงเวลาออมแสงของสหรัฐฯ)
- **Google ตอบ 429:** Worker หยุดเรียกทั้งระบบตามเวลาที่ Google บอก (`retryDelay`) ไม่ยิงซ้ำ
- **ครั้งที่ถูกปฏิเสธไม่นับเป็นการใช้งาน**
- **หน้าเว็บแสดง "AI วันนี้ 12/200 ครั้ง":** ถ้าโควตาเต็มหรือต้องรอ ปุ่มจะปิดเองและบอกเวลาที่ใช้ได้อีกครั้ง
- **ดูยอดปัจจุบัน:** เปิด `GET /usage` จากหน้าเว็บ จะได้จำนวนครั้งที่ใช้ทั้งรายนาทีและรายวัน รวมถึง token ที่ใช้วันนี้

**ตัวเลขจริงจากการทดสอบ** (รูปจริง 2 รูป, 1 พ.ย. 2569):

| | ค่า |
|---|---|
| token ต่อการสแกน 1 ครั้ง | ~1,500 (รูป + คำสั่ง + คำตอบ) |
| เวลาต่อครั้ง | 2–3 วินาที |
| 200 ครั้ง/วัน | ~300,000 token/วัน |
| 8 ครั้ง/นาที | ~12,000 token/นาที |

ถ้า project ใน AI Studio เปิด billing แล้ว ค่าใช้จ่ายต่อวันสูงสุดคำนวณได้แบบนี้:
`LIMIT_PER_DAY × ~1,500 token × ราคาต่อ token ของโมเดล` (ดูราคาได้ที่หน้า pricing ของ Gemini API)
ค่านี้มีเพดาน เพราะ Worker ไม่ยอมให้เกิน `LIMIT_PER_DAY` แม้จะโดนยิงถล่ม

---

## ความปลอดภัย

- **key:** อยู่ใน Cloudflare secret เท่านั้น ไม่อยู่ใน repo และไม่ถูกส่งไป browser
- **ใครเรียกได้:** รับเฉพาะ request ที่มี `Origin` ตรงกับ `ALLOWED_ORIGINS`
  ข้อนี้กันเว็บอื่นเอาไปใช้ แต่**ไม่ใช่การยืนยันตัวตน** เพราะ curl ปลอม Origin ได้
  รั้วจริงคือโควตาต่อวันและต่อ IP ความเสียหายสูงสุดคือปุ่มสแกนใช้ไม่ได้จนถึงรอบรีเซ็ต
- **ข้อมูล:** ไม่ log รูปหรือผลลัพธ์ IP เก็บเป็น hash ที่เปลี่ยน salt ทุกวัน
- **ไม่เชื่อ AI ตรงๆ:**
  - ยอด ชื่อ และวันที่ถูกตรวจและเกลาก่อนส่งกลับ
  - คำสั่งที่ส่งให้ AI บอกชัดว่าข้อความในรูปเป็นข้อมูล ไม่ใช่คำสั่ง (กัน prompt injection)
  - ผู้ใช้ต้องตรวจข้อมูลและกดบันทึกเอง
- **Privacy (Possible):** ถ้า project ใน AI Studio อยู่ใน free tier Google อาจนำข้อมูลที่ส่งไปใช้ปรับปรุงบริการ
  สลิปมีชื่อและเลขบัญชีบางส่วน ถ้าไม่ต้องการ ให้เปิด billing เพื่อใช้ paid tier

## ทดสอบในเครื่อง

สร้างไฟล์ env **นอกโฟลเดอร์โปรเจกต์** ที่มี `GEMINI_API_KEY=...` และ `ALLOWED_ORIGINS=http://localhost:8000` แล้วรัน:

```bash
npx wrangler dev --env-file /path/outside/repo/worker.env
```

```bash
npm test
```

## ปิด / ถอน

| ต้องการ | ทำ |
|---|---|
| ซ่อนปุ่มสแกน | ตั้ง `SCAN_API_URL = ''` ใน `index.html` แล้ว push |
| หยุดทันทีฝั่ง server | `npx wrangler secret delete GEMINI_API_KEY` |
| ลบ Worker | `npx wrangler delete` |
| key หลุด | ลบ key ใน AI Studio แล้วสร้างใหม่ + `wrangler secret put` อีกครั้ง |
