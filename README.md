# กาญนะจ๊ะบุรีทริป PWA v1.3.0

PWA เกมทริป + สมุดความทรงจำ + Album Feed + Google Drive Hub สำหรับกลุ่มเพื่อนวัย 23–24 ที่ไปทริปกาญจนบุรี/เขื่อนเขาแหลม/สังขละบุรี

## สิ่งที่ใช้ได้ทันที

- เปิด `index.html` หรือ Deploy ขึ้น GitHub Pages ได้เลย
- เพิ่มสมาชิกแก๊ง
- เพิ่มโมเมนต์/เช็กอิน/Quote เป็น Feed กลางของทริป
- อัปโหลดรูป/วิดีโอหลายไฟล์ในโพสต์เดียวแบบอัลบั้ม
- เก็บไฟล์รูป/วิดีโอขึ้น Google Drive ด้วยไฟล์ต้นฉบับเต็มความละเอียด ไม่บีบอัด ไม่ resize และไม่แปลงเป็น JPEG ใหม่
- คนอื่นที่อยู่ใน Drive Folder เดียวกันสามารถ Sync แล้วกดบันทึกรูปรายไฟล์หรือทั้งอัลบั้มได้
- เล่น Quest, Most Likely, Truth, Mission, Caption Battle, Secret Buddy, Trip Bingo
- โหวตเพื่อน / Reaction / Quote เด็ด
- Memory Reel สำหรับนำเสนอความทรงจำรวม
- หารค่าใช้จ่าย
- Checklist + Safety Reminder
- Export/Import Backup
- ติดตั้งเป็น PWA และมี Offline Cache

## Drive-first ทำงานอย่างไร

แอพใช้ Google Drive เป็นศูนย์กลางข้อมูลของทริป ส่วนข้อมูลในเครื่องเป็น Local cache และ Pending queue เท่านั้น

โครงสร้างใน Drive:

```text
กาญนะจ๊ะบุรีทริป - Shared Memories/
  members/      # สมาชิกแก๊ง
  moments/      # JSON ของโพสต์/โมเมนต์ แยก 1 โพสต์ = 1 ไฟล์
  media/        # รูปและวิดีโอต้นฉบับเต็มความละเอียด
  reactions/    # reaction
  votes/        # ผลโหวต
  quotes/       # Quote เด็ด
  expenses/     # ค่าใช้จ่าย
  quests/       # Quest ที่ทำสำเร็จ
  games/        # Bingo/เกม
  meta/         # manifest ของทริป
```

เหตุผลที่แยก 1 โพสต์ = 1 JSON:

- ลดโอกาสข้อมูลชนกันเมื่อหลายคนอัปเดตพร้อมกัน
- ซิงก์ง่าย ตรวจสอบง่าย
- เพิ่มฟีเจอร์ใหม่ภายหลังโดยไม่ต้องแก้ไฟล์รวมก้อนเดียว

## Album Feed และความละเอียดรูป

เวอร์ชันนี้เปลี่ยนจากการแนบไฟล์เดียวเป็น Album-first:

- เลือกหลายรูป/หลายวิดีโอได้ในช่องเดียว
- ถ้าเชื่อม Drive อยู่ แอพอัปโหลดไฟล์ต้นฉบับขึ้น `media/` โดยตรง
- ถ้ายังไม่เชื่อม Drive แอพเก็บไฟล์ต้นฉบับไว้ใน IndexedDB ของเครื่องก่อน แล้วรอ `ส่ง Pending เข้า Hub`
- metadata ของโพสต์จะเก็บใน `moments/`
- ไม่มีการบีบอัดรูป ไม่มีการลดขนาดรูป และไม่มีการแปลงไฟล์รูปก่อนอัปโหลดขึ้น Drive

หมายเหตุ: ไฟล์ใหญ่จะใช้พื้นที่ Drive ตามขนาดจริง และการ Sync/Download จะขึ้นกับอินเทอร์เน็ตของแต่ละเครื่อง

## วิธี Deploy บน GitHub Pages

1. สร้าง repo ใหม่ เช่น `kannajaburi-trip`
2. อัปโหลดไฟล์ทั้งหมดในโฟลเดอร์นี้ขึ้น repo
3. ไปที่ `Settings > Pages`
4. เลือก `Deploy from a branch`
5. เลือก branch `main` และ folder `/root`
6. เปิดลิงก์ GitHub Pages ที่ได้

## ตั้งค่า Google OAuth สำหรับ Drive

1. ไปที่ Google Cloud Console
2. สร้าง Project ใหม่
3. เปิดใช้งาน Google Drive API
4. ไปที่ Google Auth Platform / OAuth consent screen แล้วตั้งค่าแอพ
5. สร้าง OAuth Client ID ชนิด `Web application`
6. เพิ่ม Authorized JavaScript origins เช่น:
   - `https://YOUR-USERNAME.github.io`
   - `http://localhost:8000` สำหรับทดสอบในเครื่อง
7. คัดลอก Client ID มาใส่ในหน้า `More > Google Drive Sync`
8. กด `เชื่อมต่อ Drive`
9. กด `สร้างโฟลเดอร์ทริป` หรือวาง Folder ID ของโฟลเดอร์ที่สร้างเอง
10. แชร์โฟลเดอร์ root ให้เพื่อนเป็น Editor
11. ให้เพื่อนใส่ Client ID และ Folder ID เดียวกัน แล้วกด Sync

## วิธีใช้เป็นคลังรูปกลางของทริป

1. เจ้าของทริปสร้าง/ตั้งค่า Drive Folder
2. แชร์ Folder ให้เพื่อนทุกคนเป็น Editor
3. ทุกคนเปิดแอพจาก GitHub Pages เดียวกัน
4. ใส่ Client ID และ Folder ID เดียวกัน
5. กด Sync Hub
6. โพสต์อัลบั้มใน Feed
7. เพื่อนคนอื่นกด Sync แล้วกด `บันทึก` รายรูป หรือ `บันทึกทั้งอัลบั้ม`

## ทดสอบบนเครื่อง

```bash
python3 -m http.server 8000
```

แล้วเปิด:

```text
http://localhost:8000
```

หมายเหตุ: OAuth ของ Google ต้องรันผ่าน `http://localhost` หรือ HTTPS บน GitHub Pages ไม่ควรเปิดจาก `file://` ถ้าจะใช้ Drive Sync

## โครงสร้างไฟล์

- `index.html` โครงหลัก
- `src/app.js` UI และ workflow หลัก
- `src/state.js` Local state, export/import, utility
- `src/drive.js` Google Drive API integration
- `src/mediaStore.js` IndexedDB สำหรับเก็บไฟล์ต้นฉบับเต็มความละเอียดก่อนอัปโหลด Drive
- `src/styles.css` ธีม UI
- `sw.js` Service Worker / Offline cache
- `manifest.webmanifest` PWA install config

## ข้อจำกัดที่ควรรู้

- GitHub Pages เป็น Static Hosting จึงไม่มีฐานข้อมูลในตัว แอพจึงใช้ Google Drive เป็น Hub แทน
- การ Sync ไม่ใช่ real-time แบบวินาทีต่อวินาที แต่มีปุ่ม Sync และ Live sync ระหว่างเปิดแอพ
- การบันทึกหลายไฟล์พร้อมกันบนมือถือบางรุ่นอาจถูก browser จำกัด ให้ยืนยันหลายครั้ง
- ถ้าล้างข้อมูล browser ก่อนส่ง Pending เข้า Hub ไฟล์ที่ยังอยู่เฉพาะในเครื่องอาจหาย ดังนั้นระหว่างทริปควรเชื่อม Drive แล้วกดส่ง Pending เป็นระยะ
