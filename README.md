# กาญนะจ๊ะบุรีทริป PWA v2.5.0 — Drive Upload Fix + Real Feed Polish

เวอร์ชันนี้แก้ปัญหาจาก v2.4.0 ที่หน้า Feed แสดงสถานะ “กำลังอัปโหลด” นาน, รูปอัลบั้มแสดงเหมือนมีแค่รูปแรก, ไอคอน/คอมเมนต์ยังไม่สวย และ Drive Hub ว่างเมื่อยังไม่ได้อนุญาต Drive หรือ scope ไม่พอสำหรับ shared folder

## สิ่งที่แก้

- ปรับระบบอัปโหลดให้แสดงสถานะจริง: พร้อมอัปโหลด / รอเชื่อมต่อ Drive / กำลังอัปโหลดไฟล์ 1/9, 2/9 ฯลฯ / error / pending
- ถ้ายังไม่เชื่อม Google Drive จะไม่หลอกว่าอัปโหลดอยู่ แต่บอกว่า “รอเชื่อมต่อ Google Drive”
- เปลี่ยน Google Drive scope เป็น `https://www.googleapis.com/auth/drive` เพื่อให้สมาชิกที่ได้รับสิทธิ์ Editor สามารถอัปโหลดเข้าโฟลเดอร์กลางของ Admin ได้ง่ายขึ้น
- อัปโหลด metadata ของโพสต์ลง Drive ด้วย แม้จะใช้ Firebase เป็น realtime feed เพื่อให้ Drive ไม่เป็นโฟลเดอร์ว่าง
- ปรับอัลบั้มให้มี thumbnail rail และปุ่มเลือกรูป ช่วยให้เห็นว่ามี 9 รูปจริง ไม่ใช่แค่รูปแรก
- ปรับรูปใน Feed เป็น object-fit: contain เพื่อลดปัญหารูปถูกครอปหนักเกินไป
- ปรับคอมเมนต์ให้เหมือนแอพมากขึ้น: avatar, bubble, input แบบ modern, ปุ่มส่งเล็กลง
- ปรับไอคอน action/reaction ให้กดง่ายและไม่ทับกับรูป
- อัปเดต cache-busting เป็น v2.5.0

## หมายเหตุสำคัญเรื่อง Drive

ถ้าอัปเดตจากเวอร์ชันเก่า ให้เข้า Google Cloud Console > OAuth consent screen > Data access แล้วเพิ่ม scope:

`https://www.googleapis.com/auth/drive`

จากนั้นให้ Admin และสมาชิกกดเชื่อมต่อ Drive ใหม่ 1 ครั้ง เพราะ scope เปลี่ยนจาก `drive.file` เป็น `drive` เพื่อให้เขียนไฟล์เข้าโฟลเดอร์กลางที่แชร์กันได้จริงกว่าเดิม

ถ้า OAuth ยังอยู่โหมด Testing ต้องเพิ่ม Gmail ของเพื่อนใน Test users ด้วย
