/*
 * SanRha_Snapfood — ตัวอย่างไฟล์ค่าเริ่มต้น
 *
 * วิธีใช้: คัดลอกไฟล์นี้เป็น config.js แล้วใส่ OpenAI API key
 * config.js ถูกใส่ใน .gitignore แล้ว จึงไม่ถูก push ขึ้น GitHub
 * (ถ้าไม่มี config.js แอปยังใช้ได้ แค่ต้องกรอก key ในหน้าโปรไฟล์ของแอปแทน)
 */
window.FOODSNAP_CONFIG = {
  OPENAI_API_KEY: '',        // เช่น 'sk-proj-xxxxxxxx'
  MODEL: 'gpt-4o-mini',      // เปลี่ยนเป็น 'gpt-4o' ได้ถ้าอยากให้แม่นขึ้น
};
