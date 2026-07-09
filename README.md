# กาญนะจ๊ะบุรีทริป PWA v2.1.0

อัปเดตตามคำขอ: Profile Upload + IG Story + Universal Trip Home + Admin-only Hub

## เพิ่ม/แก้ใน v2.1.0

- เพิ่มช่องอัปโหลดรูปโปรไฟล์ในหน้า “บัญชีของฉัน”
- รูปโปรไฟล์แสดงใน Feed, Story, คอมเมนต์, สมาชิก และหัวโพสต์
- ระบบ Story แบบ IG-style ยังอยู่ครบ: Your story, story row, story viewer เต็มจอ, next/previous
- หน้า Home ปรับเป็น Universal Trip Home ใช้ได้กับทริปอื่น ไม่ผูกกับกาญจนบุรีเท่านั้น
- เพิ่มข้อมูลทริปที่ Admin แก้ได้: ชื่อทริป, ปลายทาง, Day/ช่วง, Mood, แผนวันนี้
- Member ไม่เห็นและไม่สามารถแก้ Firebase/Drive settings ได้แล้ว
- เฉพาะ Admin เท่านั้นที่ตั้งค่า Firebase/Drive, สร้าง Drive folder และ publish Hub
- เพิ่มระบบ Invite Link: Admin กดคัดลอกลิงก์เชิญ สมาชิกเปิดลิงก์แล้วรับค่า Firebase/Drive อัตโนมัติ
- Admin Hub publish ค่า Firebase + Drive ไปที่ tripSettings/admin-drive-hub เพื่อให้สมาชิกที่เชื่อม Firebase แล้วรับค่า Hub ต่อเนื่อง
- เพิ่ม cache-busting `?v=2.1.0` ให้ CSS/JS เพื่อลดปัญหา PWA โหลด UI เก่า
- อัปเดต Service Worker cache เป็น v2.1.0
- อัปเดต storage schema เป็น v12

## Login เริ่มต้น

Admin ครั้งแรก:

- username: `admin`
- password: `1234`

หลังเข้าแอพให้เปลี่ยนรหัส Admin ในหน้า “บัญชีของฉัน”

Member:

- เปิดลิงก์เชิญจาก Admin
- กรอก username/password เพื่อสร้างหรือเข้าสู่บัญชี
- ไม่ต้องตั้งค่า Firebase หรือ Drive เอง

## วิธีใช้งาน Admin Hub

1. Admin เข้าระบบ
2. ไปหน้า More/Tools
3. ตั้งค่า Firebase และ Google Drive เฉพาะ Admin
4. กด “บันทึก Admin Hub”
5. กด “เชื่อมต่อข้อมูล”
6. กด “เชื่อมต่อพื้นที่รูป” หรือ “สร้างโฟลเดอร์รูปทริป”
7. กด “แชร์ Hub ให้ทุกคน”
8. กด “คัดลอกลิงก์เชิญ” แล้วส่งให้เพื่อน

## ข้อจำกัด

- Firebase config ต้องถูกตั้งในเครื่อง Admin ก่อน ถึงจะสร้างลิงก์เชิญสมาชิกได้
- Google Drive ยังต้องใช้ OAuth ของผู้ใช้ที่มีสิทธิ์ในโฟลเดอร์นั้นตามข้อจำกัดของ Google APIs แต่สมาชิกไม่ต้องกรอกค่า Client ID/Folder ID เอง
- รูป/วิดีโอยังคงเก็บเต็มความละเอียด ไม่บีบอัด ไม่ resize

## วิธีอัปเดต

แตก ZIP แล้วอัปโหลดไฟล์ทั้งหมดทับของเดิมใน GitHub repo จากนั้นเปิดแอพใหม่ ถ้ายังเห็นหน้าเก่าให้ล้าง site data/cache หรือเปิดจากลิงก์ใหม่อีกครั้ง เพราะ PWA อาจยังจำ service worker เดิม
