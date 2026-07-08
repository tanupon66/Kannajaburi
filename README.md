# กาญนะจ๊ะบุรีทริป PWA v1.7.0 — Full System Integration

PWA สำหรับทริปกาญจนบุรี/สังขละบุรีแบบ Social Memory Book: Feed คล้าย Instagram, บัญชีแยกแต่ละคน, Firebase realtime สำหรับข้อมูลโซเชียล และ Google Drive สำหรับเก็บรูป/วิดีโอต้นฉบับเต็มความละเอียด

## สิ่งที่อัปเดตใน v1.7.0

### 1) Feed / ความทรงจำ
- หน้า Feed แสดงโพสต์แบบ Social Feed ไม่แสดงฟอร์มเพิ่มโมเมนต์ค้างอยู่บนหน้า
- กด `＋ เพิ่มโมเมนต์` แล้วเปิด modal สำหรับกรอกแคปชัน เช็กอิน และอัปโหลดรูป/วิดีโอทั้งอัลบั้ม
- อัปโหลดรูป/วิดีโอแบบ full resolution ไม่ resize ไม่บีบอัด ไม่แปลงไฟล์
- คอมเมนต์ใต้โพสต์ได้จริง
- เจ้าของคอมเมนต์หรือ Admin ลบคอมเมนต์ได้
- เจ้าของโพสต์หรือ Admin ลบโพสต์ได้แบบ soft-delete
- Reaction จำกัด 1 บัญชีต่อ 1 โพสต์ เปลี่ยน reaction ได้ และกด reaction เดิมซ้ำเพื่อยกเลิกได้
- กด ☆ เพื่อเก็บโมเมนต์เข้า Vlog Studio / Memory Reel ได้

### 2) Account / Admin
- ทุกคนมีบัญชีแยกเป็นของตัวเอง: ชื่อ สีประจำตัว คาแรกเตอร์ และสิทธิ์ Admin/Member
- Admin ตั้งค่า Drive Hub แล้วแชร์ค่า Folder ID + Client ID ให้สมาชิกผ่าน Firebase ได้
- สมาชิกยังต้อง authorize Google Drive ของตัวเองเมื่อจะอัปโหลดไฟล์เข้า Drive โดยตรง เพราะเว็บ Static ไม่สามารถใช้ OAuth token ของ Admin แทนทุกคนอย่างปลอดภัย

### 3) ค่าใช้จ่าย
- เพิ่มรายการค่าใช้จ่ายได้
- ลบรายการค่าใช้จ่ายได้ เฉพาะเจ้าของหรือ Admin
- ยอดรวมคำนวณจากรายการที่ยังไม่ถูกลบ
- คำนวณหารต่อคนจากสมาชิกที่ยัง active
- ซิงก์รายการผ่าน Firebase/Drive พร้อมสถานะ soft-delete

### 4) ระบบโหวต
- เพิ่มผลโหวตได้ เช่น MVP, คนฮาที่สุด, คนหลับไวสุด
- ลบผลโหวตได้ เฉพาะเจ้าของหรือ Admin
- เมื่อเพิ่มผลโหวต ระบบสร้างโพสต์รางวัลลง Feed อัตโนมัติ
- เมื่อลบผลโหวต โพสต์รางวัลที่ผูกกันจะถูกซ่อนด้วย
- Recap ใช้เฉพาะผลโหวตที่ยัง active

### 5) เกม
- Card Game: Most Likely, Truth, Mission, Caption Battle
- เกมสามารถโพสต์โมเมนต์ลง Feed พร้อมรูป/วิดีโอและแคปชันได้
- Secret Buddy ถูกซิงก์เป็นข้อมูลเกมร่วมกันผ่าน Firebase/Drive มากขึ้น
- เมื่อทำ Secret Buddy สำเร็จ ระบบสร้างโพสต์ความทรงจำลง Feed
- Trip Bingo ซิงก์เป็น shared game state

### 6) Quest / ภารกิจ
- ทำ Quest สำเร็จ/ยกเลิกได้ผ่าน quest events
- ข้อมูล Quest ซิงก์แบบ event-based เพื่อให้เครื่องอื่นรับสถานะล่าสุด
- เพิ่มปุ่ม `โพสต์หลักฐาน` ในแต่ละ Quest เพื่อเปิด modal โพสต์รูป/วิดีโอ/แคปชันลง Feed โดยผูกประเภทเป็นหลักฐานภารกิจ

### 7) Quote / Memory Reel
- เพิ่ม Quote เด็ดได้
- Quote ถูกสร้างเป็นโพสต์ใน Feed อัตโนมัติ
- ลบ Quote ได้ เฉพาะเจ้าของหรือ Admin และโพสต์ที่ผูกกันจะถูกซ่อนด้วย
- Memory Reel ใช้ข้อมูล active เท่านั้น: โมเมนต์, Quest, Vote, Quote และ Vlog Pick

### 8) Checklist / Safety / Backup
- Checklist จำสถานะ checkbox ได้แล้ว
- Checklist ซิงก์ผ่าน Firebase/Drive ใน collection `checklists`
- Export/Import backup ยังอยู่
- Reset local ล้าง storage key เวอร์ชันล่าสุดและ legacy keys ให้ถูกต้อง

## โครงสร้างข้อมูล

Firebase Firestore ใช้เป็นฐานข้อมูล realtime:

```text
trips/{tripId}/accounts
trips/{tripId}/tripSettings
trips/{tripId}/members
trips/{tripId}/moments
trips/{tripId}/comments
trips/{tripId}/reactions
trips/{tripId}/votes
trips/{tripId}/quotes
trips/{tripId}/expenses
trips/{tripId}/quests
trips/{tripId}/games
trips/{tripId}/checklists
```

Google Drive ใช้เป็น Media Hub และ backup JSON:

```text
กาญนะจ๊ะบุรีทริป - Shared Memories/
  accounts/
  tripSettings/
  members/
  moments/
  media/
  reactions/
  comments/
  votes/
  quotes/
  expenses/
  quests/
  games/
  checklists/
  meta/
```

## วิธี deploy บน GitHub Pages

1. แตกไฟล์ ZIP
2. อัปโหลดไฟล์ทั้งหมดไปยัง GitHub repo
3. เปิด GitHub Pages จาก branch/main หรือ docs ตามที่ตั้งค่า
4. เปิดแอพจาก URL ของ GitHub Pages
5. เข้า More แล้วตั้งค่า Firebase + Google Drive
6. สร้างบัญชี Admin ก่อน แล้วเชื่อม Firebase
7. Admin เชื่อม Drive / สร้าง Drive Folder
8. Admin กด `Admin: แชร์ Drive Hub ให้ทุกคน`
9. สมาชิกสร้างบัญชีตัวเอง แล้วเชื่อม Firebase เพื่อรับค่า Drive Hub อัตโนมัติ

## ข้อจำกัดที่ต้องรู้

- GitHub Pages เป็น Static hosting จึงไม่มี server สำหรับเก็บ secret หรือรับ webhook
- Google Drive OAuth token ของ Admin ไม่สามารถแชร์ให้สมาชิกทุกคนใช้แทนได้อย่างปลอดภัย
- ถ้าสมาชิกจะอัปโหลดไฟล์เข้า Drive ด้วยเครื่องตัวเอง สมาชิกต้องกดอนุญาต Google Drive อย่างน้อยครั้งแรก
- Firebase ใช้ realtime data ได้ดีสำหรับ Feed/Comment/Reaction แต่รูป/วิดีโอ full-res ยังเก็บใน Google Drive ตามโจทย์
- ถ้าต้องการให้สมาชิกไม่ต้อง authorize Drive เลย ต้องเพิ่ม backend เช่น Firebase Cloud Functions หรือเปลี่ยน media storage เป็น Firebase Storage แล้วให้ Admin backup ไป Drive ภายหลัง

## ตรวจแล้วใน v1.7.0

- JS syntax check ผ่าน: app.js, state.js, drive.js, firebaseHub.js
- Service Worker cache version เป็น v1.7.0
- Storage schema เป็น v7
- Soft-delete ใช้กับ Feed, Comment, Vote, Expense, Quote, Member
- Active list ถูกใช้ใน Recap, Expense, Feed และระบบแสดงผลหลัก

