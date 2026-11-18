'use strict';

/* ================= Helpers ================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const fmtK = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(n)));
const sum = (arr, f) => arr.reduce((s, x) => s + num(x[f]), 0);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const TH_DAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

/* ================= Storage ================= */
const KEYS = { profile: 'fs_profile', meals: 'fs_meals', apiKey: 'fs_apikey', model: 'fs_model' };
const store = {
  get(k, fallback) {
    try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; }
  },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

/* ================= TDEE ================= */
const DEFAULT_PROFILE = { weight: null, height: null, age: 25, sex: 'male', activity: 1.375 };
const DEFAULT_MODEL = 'gpt-4o-mini';
const ACTIVITY = [
  { v: 1.2, label: 'นั่งทำงาน แทบไม่ออกกำลัง' },
  { v: 1.375, label: 'ออกกำลังเบา 1–3 วัน/สัปดาห์' },
  { v: 1.55, label: 'ออกกำลังปานกลาง 3–5 วัน/สัปดาห์' },
  { v: 1.725, label: 'ออกกำลังหนัก 6–7 วัน/สัปดาห์' },
  { v: 1.9, label: 'หนักมาก / งานใช้แรง / ซ้อมวันละ 2 รอบ' },
];

/* API key / model: key typed in the app wins, otherwise the default from config.js */
const config = () => window.FOODSNAP_CONFIG || {};
const defaultKey = () => String(config().OPENAI_API_KEY || '').trim();
const userKey = () => store.get(KEYS.apiKey, '');
const getApiKey = () => userKey() || defaultKey();
const getModel = () => store.get(KEYS.model, '') || config().MODEL || DEFAULT_MODEL;

const calcBMR = (p) => {
  const base = 10 * p.weight + 6.25 * p.height - 5 * p.age;
  return p.sex === 'female' ? base - 161 : base + 5;
};
const calcTDEE = (p) => (p.weight && p.height ? Math.round(calcBMR(p) * p.activity) : 0);
const calcBMI = (p) => { const m = p.height / 100; return p.weight / (m * m); };
const bmiLabel = (b) => (b < 18.5 ? 'น้ำหนักน้อย' : b < 23 ? 'สมส่วน' : b < 25 ? 'ท้วม' : b < 30 ? 'อ้วนระดับ 1' : 'อ้วนระดับ 2');

/* Macro split of TDEE: protein 25% · carbs 50% · fat 25% */
const macroTargets = (tdee) => ({ protein: (tdee * 0.25) / 4, carbs: (tdee * 0.5) / 4, fat: (tdee * 0.25) / 9 });

/* ================= State ================= */
let profile = { ...DEFAULT_PROFILE, ...store.get(KEYS.profile, {}) };
let meals = store.get(KEYS.meals, []);
if (!Array.isArray(meals)) meals = [];
let draft = null;

const mealsOn = (k) => meals.filter((m) => m.date === k).sort((a, b) => a.ts - b.ts);
const statusOf = (kcal, tdee) => (!kcal ? 'empty' : kcal > tdee * 1.1 ? 'over' : kcal >= tdee * 0.9 ? 'near' : 'under');

const MEAL_TYPES = [
  { id: 'breakfast', label: 'เช้า', emoji: '🌅' },
  { id: 'lunch', label: 'กลางวัน', emoji: '☀️' },
  { id: 'dinner', label: 'เย็น', emoji: '🌙' },
  { id: 'snack', label: 'ของว่าง', emoji: '🧋' },
];
const mealType = (id) => MEAL_TYPES.find((t) => t.id === id) || MEAL_TYPES[3];
const guessMealType = (h = new Date().getHours()) => (h >= 5 && h < 10 ? 'breakfast' : h >= 11 && h < 14 ? 'lunch' : h >= 17 && h < 21 ? 'dinner' : 'snack');

/* ================= UI basics ================= */
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function celebrate(x = innerWidth / 2, y = innerHeight - 90) {
  const emojis = ['🔥', '✨', '🍊', '💪', '🎉'];
  for (let i = 0; i < 9; i++) {
    const e = document.createElement('span');
    e.className = 'pop';
    e.textContent = emojis[i % emojis.length];
    e.style.left = x - 13 + 'px';
    e.style.top = y - 13 + 'px';
    e.style.setProperty('--dx', (Math.random() * 220 - 110).toFixed(0) + 'px');
    e.style.setProperty('--rot', (Math.random() * 120 - 60).toFixed(0) + 'deg');
    document.body.appendChild(e);
    setTimeout(() => e.remove(), 1000);
  }
}

function go(view) {
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
  $$('.nav-btn[data-go]').forEach((b) => b.classList.toggle('active', b.dataset.go === view));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (view === 'today') renderToday();
  if (view === 'history') renderHistory();
  if (view === 'settings') renderSettings();
}

/* ================= TODAY ================= */
function mealItemHTML(m) {
  const t = mealType(m.mealType);
  const time = new Date(m.ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  const thumb = m.thumb ? `<img src="${m.thumb}" alt="">` : t.emoji;
  return `<li class="meal">
    <div class="thumb">${thumb}</div>
    <div class="meal-info">
      <strong>${esc(m.name)}</strong>
      <span>${t.emoji} ${t.label} · ${time}${m.protein ? ` · P${Math.round(m.protein)} C${Math.round(m.carbs)} F${Math.round(m.fat)}` : ''}</span>
    </div>
    <div class="meal-kcal"><b>${fmt(m.calories)}</b><small>kcal</small></div>
    <button class="del" data-del="${esc(m.id)}" aria-label="ลบ">×</button>
  </li>`;
}

function renderToday() {
  const now = new Date();
  $('#todayLabel').textContent = now.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long' });
  const h = now.getHours();
  $('#greetEyebrow').textContent = h < 11 ? 'อรุณสวัสดิ์ ☀️' : h < 16 ? 'บ่ายแล้วนะ 🌤️' : h < 20 ? 'ตอนเย็นแล้ว 🌇' : 'ดึกแล้วน้า 🌙';

  const list = mealsOn(dateKey());
  const eaten = Math.round(sum(list, 'calories'));
  const tdee = calcTDEE(profile);
  const ratio = tdee ? eaten / tdee : 0;
  const st = statusOf(eaten, tdee);
  const diff = Math.abs(tdee - eaten);

  const copy = {
    empty: ['ยังไม่ได้กินอะไรเลย', 'กดปุ่มกล้องแล้วถ่ายจานแรกของวันได้เลย 📸'],
    under: ['ยังกินได้อีกนะ 😋', `ห่างจาก TDEE อีก ${fmt(diff)} kcal`],
    near: ['ใกล้ TDEE แล้ว เป๊ะมาก! 🎯', `ต่างจาก TDEE แค่ ${fmt(diff)} kcal — สมดุลสุดๆ`],
    over: ['เกิน TDEE แล้วน้า 🔥', `เกินไป ${fmt(diff)} kcal พรุ่งนี้ค่อยว่ากันใหม่`],
  }[st];
  $('#statusTitle').textContent = copy[0];
  $('#statusMsg').textContent = copy[1];

  $('#eatenNum').textContent = fmt(eaten);
  $('#tdeeNum').textContent = fmt(tdee);
  const C = 2 * Math.PI * 52;
  $('#ringFg').style.strokeDashoffset = String(C * (1 - Math.min(ratio, 1)));
  const wrap = $('.ring-wrap');
  wrap.classList.toggle('near', st === 'near');
  wrap.classList.toggle('over', st === 'over');

  $('#remainNum').textContent = fmt(Math.max(tdee - eaten, 0));
  $('#pctNum').textContent = Math.round(ratio * 100);
  $('#mealCount').textContent = list.length;

  const tg = macroTargets(tdee);
  const macros = [
    { k: 'protein', label: 'โปรตีน', color: 'var(--mac-p)' },
    { k: 'carbs', label: 'คาร์บ', color: 'var(--mac-c)' },
    { k: 'fat', label: 'ไขมัน', color: 'var(--mac-f)' },
  ];
  $('#macros').innerHTML = macros.map((m) => {
    const got = sum(list, m.k);
    const pct = tg[m.k] ? Math.min((got / tg[m.k]) * 100, 100) : 0;
    return `<div>
      <div class="macro-top"><b>${m.label}</b><span>${Math.round(got)} / ${Math.round(tg[m.k])} g</span></div>
      <div class="bar-track"><div class="bar-fill" style="background:${m.color}" data-w="${pct}"></div></div>
    </div>`;
  }).join('');
  requestAnimationFrame(() => $$('#macros .bar-fill').forEach((b) => { b.style.width = b.dataset.w + '%'; }));

  $('#todayList').innerHTML = list.length
    ? list.slice().reverse().map(mealItemHTML).join('')
    : `<li class="empty"><span class="big">🍽️</span>ยังไม่มีมื้อไหนเลยวันนี้<br>ถ่ายรูปอาหารแล้ว AI จะนับแคลให้เอง</li>`;
}

/* ================= HISTORY ================= */
function renderHistory() {
  const tdee = calcTDEE(profile);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const k = dateKey(d);
    days.push({ k, d, kcal: Math.round(sum(mealsOn(k), 'calories')) });
  }

  const W = 340, H = 210, top = 26, bottom = 30, side = 6;
  const ch = H - top - bottom;
  const maxV = Math.max(tdee * 1.3, ...days.map((x) => x.kcal), 500);
  const slot = (W - side * 2) / 7;
  const bw = Math.min(30, slot * 0.6);
  const yOf = (v) => top + ch - (v / maxV) * ch;

  let svg = '';
  days.forEach((x, i) => {
    const cx = side + slot * i + slot / 2;
    const isToday = i === 6;
    svg += `<rect class="bar track" x="${cx - bw / 2}" y="${top}" width="${bw}" height="${ch}" rx="10"/>`;
    if (x.kcal) {
      const h = Math.max((x.kcal / maxV) * ch, 10);
      svg += `<rect class="bar ${statusOf(x.kcal, tdee)}" x="${cx - bw / 2}" y="${top + ch - h}" width="${bw}" height="${h}" rx="10"/>`;
      svg += `<text class="bar-val" x="${cx}" y="${top + ch - h - 6}">${fmtK(x.kcal)}</text>`;
    }
    svg += `<text class="bar-lbl${isToday ? ' today' : ''}" x="${cx}" y="${H - 8}">${isToday ? 'วันนี้' : TH_DAYS[x.d.getDay()]}</text>`;
  });
  const ty = yOf(tdee);
  svg += `<line class="tdee-line" x1="${side}" x2="${W - side}" y1="${ty}" y2="${ty}"/>`;
  svg += `<text class="tdee-lbl" x="${W - side}" y="${ty - 6}">TDEE ${fmt(tdee)}</text>`;
  $('#weekChart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="แคลอรี่ 7 วันล่าสุดเทียบ TDEE">${svg}</svg>`;

  const logged = days.filter((x) => x.kcal);
  const avg = logged.length ? sum(logged, 'kcal') / logged.length : 0;
  const onTarget = logged.filter((x) => statusOf(x.kcal, tdee) === 'near').length;
  let streak = 0;
  for (let i = days.length - 1; i >= 0 && days[i].kcal; i--) streak++;
  $('#weekStats').innerHTML = `
    <div class="stat hl"><span>เฉลี่ย/วัน</span><strong>${fmt(avg)}</strong><small>kcal</small></div>
    <div class="stat"><span>ใกล้ TDEE</span><strong>${onTarget}</strong><small>จาก ${logged.length} วัน</small></div>
    <div class="stat"><span>สตรีค</span><strong>${streak}🔥</strong><small>วันติด</small></div>`;

  const keys = [...new Set(meals.map((m) => m.date))].sort().reverse().slice(0, 30);
  $('#historyList').innerHTML = keys.length
    ? keys.map((k) => {
        const list = mealsOn(k);
        const kcal = Math.round(sum(list, 'calories'));
        const st = statusOf(kcal, tdee);
        const label = k === dateKey() ? 'วันนี้' : fromKey(k).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' });
        return `<div class="day-group">
          <div class="day-head"><h4>${label}</h4><span class="${st}">${fmt(kcal)} / ${fmt(tdee)} kcal</span></div>
          <ul class="meal-list">${list.slice().reverse().map(mealItemHTML).join('')}</ul>
        </div>`;
      }).join('')
    : `<div class="empty"><span class="big">📭</span>ยังไม่มีประวัติ เริ่มบันทึกมื้อแรกกันเลย</div>`;
}

/* ================= SETTINGS ================= */
function fillProfileForm(form) {
  form.weight.value = profile.weight ?? '';
  form.height.value = profile.height ?? '';
  if (form.age) form.age.value = profile.age;
  $$('input[name=sex]', form).forEach((r) => { r.checked = r.value === profile.sex; });
  if (form.activity) form.activity.value = String(profile.activity);
}

function readProfileForm(form) {
  return {
    weight: num(form.weight.value),
    height: num(form.height.value),
    age: Math.round(num(form.age.value)) || DEFAULT_PROFILE.age,
    sex: ($('input[name=sex]:checked', form) || {}).value || DEFAULT_PROFILE.sex,
    activity: num(form.activity.value) || DEFAULT_PROFILE.activity,
  };
}

function renderTdeeCard(p) {
  const ok = p.weight > 0 && p.height > 0;
  const bmr = ok ? calcBMR(p) : 0;
  const tdee = ok ? calcTDEE(p) : 0;
  const bmi = ok ? calcBMI(p) : 0;
  $('#setTdee').textContent = fmt(tdee);
  $('#setBmr').textContent = fmt(bmr);
  $('#setBmi').textContent = ok ? `${bmi.toFixed(1)} · ${bmiLabel(bmi)}` : '-';

  const sexAdj = p.sex === 'female' ? '− 161' : '+ 5';
  $('#calcSteps').innerHTML = ok
    ? `<div>🧮 <b>ของคุณ:</b> BMR = 10×${p.weight} + 6.25×${p.height} − 5×${p.age} ${sexAdj} = <b>${fmt(bmr)}</b> kcal</div>
       <div>⚡ TDEE = ${fmt(bmr)} × ${p.activity} = <b>${fmt(tdee)}</b> kcal/วัน</div>
       <div>🎯 อยากลดน้ำหนัก ≈ <b>${fmt(tdee - 500)}</b> · อยากเพิ่ม ≈ <b>${fmt(tdee + 300)}</b> kcal/วัน</div>`
    : 'กรอกน้ำหนักและส่วนสูงเพื่อดูการคำนวณ';
  $('#actTable').innerHTML = ACTIVITY.map((a) =>
    `<tr class="${a.v === p.activity ? 'cur' : ''}"><td>${a.label}</td><td>× ${a.v}</td></tr>`).join('');
}

function renderSettings() {
  const form = $('#profileForm');
  fillProfileForm(form);
  renderTdeeCard(profile);
  const key = userKey();
  const hasDefault = !!defaultKey();
  const inp = $('#apiKeyInput');
  inp.value = key;
  inp.placeholder = hasDefault ? 'ใช้ key ค่าเริ่มต้นอยู่ — ไม่ต้องกรอก' : 'sk-...';
  $('#apiForm').model.value = getModel();
  const ks = $('#keyStatus');
  ks.textContent = key ? 'ใช้ key ของคุณ ✓' : hasDefault ? 'ใช้ค่าเริ่มต้น ✓' : 'ยังไม่ได้ใส่';
  ks.classList.toggle('ok', !!(key || hasDefault));
  $('#keyNote').textContent = hasDefault && !key
    ? '✅ ตั้ง key ค่าเริ่มต้นไว้ใน config.js แล้ว ถ่ายรูปได้เลย ช่องนี้เว้นว่างได้ (กรอกเฉพาะถ้าอยากใช้ key อื่น)'
    : '🔒 Key เก็บในเบราว์เซอร์นี้ และส่งตรงไปที่ api.openai.com เท่านั้น — ตั้งค่าเริ่มต้นใน config.js ได้ถ้าไม่อยากกรอกในแอป';
}

/* ================= Image utils ================= */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('เปิดรูปนี้ไม่ได้ ลองรูปอื่นนะ')); };
    img.src = url;
  });
}
function resizeImage(img, max = 768, q = 0.72) {
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s);
  c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}
function squareThumb(img, size = 160) {
  const w = img.naturalWidth, h = img.naturalHeight, s = Math.min(w, h);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d').drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, size, size);
  return c.toDataURL('image/jpeg', 0.7);
}

/* ================= OpenAI ================= */
const SYSTEM_PROMPT = `คุณคือนักโภชนาการผู้เชี่ยวชาญอาหารไทยและอาหารนานาชาติ
ดูรูปแล้วระบุอาหารและเครื่องดื่มทุกอย่างที่เห็น ประเมินปริมาณจากขนาดภาชนะและสัดส่วนจริง แล้วประมาณพลังงาน (kcal) และสารอาหารหลัก
ตอบเป็น JSON เท่านั้น ตามรูปแบบนี้:
{"is_food": true, "items": [{"name": "ชื่อเมนูภาษาไทย", "portion": "ปริมาณโดยประมาณ เช่น 1 จาน (~350 g)", "calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0}], "comment": "คอมเมนต์สั้นๆ 1 ประโยคภาษาไทย น้ำเสียงเพื่อนสนิทสาย GenZ เกี่ยวกับมื้อนี้"}
ถ้าในรูปไม่มีอาหาร ให้ตอบ {"is_food": false, "items": [], "comment": "บอกสั้นๆ ว่าไม่เจออาหาร"}
ตัวเลขทั้งหมดเป็น number ไม่ต้องใส่หน่วย`;

async function analyzeFood(dataUrl) {
  const key = getApiKey();
  const model = getModel();
  let res;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'ช่วยวิเคราะห์อาหารในรูปนี้ แล้วตอบเป็น JSON ตามรูปแบบที่กำหนด' },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });
  } catch {
    throw new Error('เชื่อมต่อ OpenAI ไม่ได้ เช็กอินเทอร์เน็ตอีกทีนะ');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || '';
    if (res.status === 401) throw new Error('API key ไม่ถูกต้อง ลองเช็กในหน้าโปรไฟล์อีกที');
    if (res.status === 429) throw new Error('เรียกถี่ไปหรือเครดิต OpenAI หมด ' + (msg ? `(${msg})` : ''));
    if (res.status === 404) throw new Error(`ไม่พบโมเดล "${model}" ลองเปลี่ยนโมเดลในหน้าโปรไฟล์`);
    throw new Error(msg || `เกิดข้อผิดพลาด (${res.status})`);
  }
  let j;
  try { j = JSON.parse(data?.choices?.[0]?.message?.content || ''); } catch {
    throw new Error('AI ตอบกลับมาอ่านไม่ออก ลองใหม่หรือกรอกเองได้เลย');
  }
  const items = (Array.isArray(j.items) ? j.items : []).map((it) => ({
    name: String(it.name || '').trim(),
    portion: String(it.portion || '').trim(),
    calories: Math.round(num(it.calories)),
    protein: num(it.protein_g),
    carbs: num(it.carbs_g),
    fat: num(it.fat_g),
  })).filter((it) => it.name || it.calories);
  if (j.is_food === false || !items.length) {
    throw new Error(j.comment ? `ไม่เจออาหารในรูป: ${j.comment}` : 'ไม่เจออาหารในรูปนี้ ลองถ่ายใหม่ให้เห็นจานชัดๆ');
  }
  return { items, comment: String(j.comment || '') };
}

/* ================= Sheet ================= */
const sheet = $('#sheet');
const sheetBody = $('#sheetBody');

function openSheet() {
  sheet.hidden = false;
  document.body.classList.add('no-scroll');
  requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('open')));
}
function closeSheet() {
  sheet.classList.remove('open');
  document.body.classList.remove('no-scroll');
  draft = null;
  setTimeout(() => { if (!draft) { sheet.hidden = true; sheetBody.innerHTML = ''; } }, 300);
}

function sheetLoading() {
  sheetBody.innerHTML = `
    <div class="preview scanning"><img src="${draft.preview}" alt=""></div>
    <p class="loading-text">AI กำลังส่องจานของคุณ<span class="dots"></span><small>กำลังเดาเมนูและนับแคลให้ แป๊บเดียว 🔍</small></p>`;
}

function sheetError(msg) {
  sheetBody.innerHTML = `
    ${draft.preview ? `<div class="preview"><img src="${draft.preview}" alt=""></div>` : ''}
    <div class="err-box">😵 ${esc(msg)}</div>
    <div class="btn-row">
      <button class="ghost-btn" data-action="retry" style="flex:1">ลองใหม่</button>
      <button class="btn-primary" data-action="to-manual" style="flex:2">กรอกเองดีกว่า</button>
    </div>`;
}

function sheetEdit() {
  const isAI = draft.source === 'ai';
  sheetBody.innerHTML = `
    ${draft.preview ? `<div class="preview"><img src="${draft.preview}" alt=""></div>` : ''}
    <h3>${isAI ? 'AI เดาว่าเป็น... 👀' : 'เพิ่มเมนูเอง ✍️'}</h3>
    <p class="sub">${isAI ? 'แก้ชื่อหรือแคลได้ถ้า AI เดาเพี้ยน' : 'ใส่ชื่อเมนูกับแคลอรี่โดยประมาณ'}</p>
    ${draft.comment ? `<div class="bubble">${esc(draft.comment)}</div>` : ''}
    <div class="chips">${MEAL_TYPES.map((t) =>
      `<button class="chip${t.id === draft.mealType ? ' on' : ''}" data-type="${t.id}">${t.emoji} ${t.label}</button>`).join('')}
    </div>
    <div class="items" id="draftItems"></div>
    <button class="add-item" data-action="add-item">+ เพิ่มรายการ</button>
    <div class="total-box">
      <div><span>รวมมื้อนี้</span><strong id="draftTotal">0</strong> <small>kcal</small></div>
      <div class="after" id="draftAfter"></div>
    </div>
    <button class="btn-primary" data-action="save">บันทึกมื้อนี้ 🔥</button>`;
  renderDraftItems();
}

function renderDraftItems() {
  $('#draftItems').innerHTML = draft.items.map((it, i) => `
    <div class="item">
      <input type="text" data-i="${i}" data-f="name" value="${esc(it.name)}" placeholder="ชื่อเมนู เช่น ข้าวมันไก่">
      <input type="number" class="kcal-in" data-i="${i}" data-f="calories" value="${it.calories || ''}" placeholder="kcal" inputmode="numeric" min="0">
      <button class="del" data-rm="${i}" aria-label="ลบรายการ">×</button>
      ${it.portion ? `<div class="portion">≈ ${esc(it.portion)}${it.protein ? ` · P${Math.round(it.protein)} C${Math.round(it.carbs)} F${Math.round(it.fat)} g` : ''}</div>` : ''}
    </div>`).join('');
  updateDraftTotal();
}

function updateDraftTotal() {
  const total = Math.round(sum(draft.items, 'calories'));
  const tdee = calcTDEE(profile);
  const eaten = Math.round(sum(mealsOn(dateKey()), 'calories'));
  const after = eaten + total;
  $('#draftTotal').textContent = fmt(total);
  $('#draftAfter').innerHTML = `รวมทั้งวันจะเป็น<br><b>${fmt(after)} / ${fmt(tdee)}</b> kcal`;
}

function newDraft(source, extra = {}) {
  draft = { source, mealType: guessMealType(), items: [], comment: '', preview: '', thumb: '', ...extra };
}

function openManual() {
  newDraft('manual', { items: [{ name: '', portion: '', calories: 0, protein: 0, carbs: 0, fat: 0 }] });
  sheetEdit();
  openSheet();
  setTimeout(() => $('#draftItems input')?.focus(), 320);
}

async function runAnalysis() {
  sheetLoading();
  try {
    const r = await analyzeFood(draft.preview);
    if (!draft) return; // closed while waiting
    draft.items = r.items;
    draft.comment = r.comment;
    sheetEdit();
  } catch (e) {
    if (draft) sheetError(e.message);
  }
}

async function handleFile(file) {
  if (!file) return;
  try {
    const img = await loadImage(file);
    newDraft('ai', { preview: resizeImage(img), thumb: squareThumb(img) });
    openSheet();
    runAnalysis();
  } catch (e) {
    toast(e.message);
  }
}

function saveDraft(btn) {
  const items = draft.items
    .map((it) => ({ ...it, name: it.name.trim(), calories: Math.round(num(it.calories)) }))
    .filter((it) => it.name || it.calories > 0);
  if (!items.length) return toast('ใส่อย่างน้อย 1 รายการก่อนนะ');
  const meal = {
    id: uid(),
    ts: Date.now(),
    date: dateKey(),
    mealType: draft.mealType,
    name: items.map((it) => it.name || 'ไม่ระบุชื่อ').join(' + '),
    items,
    calories: Math.round(sum(items, 'calories')),
    protein: Math.round(sum(items, 'protein')),
    carbs: Math.round(sum(items, 'carbs')),
    fat: Math.round(sum(items, 'fat')),
    thumb: draft.thumb || '',
    comment: draft.comment || '',
  };
  meals.push(meal);
  if (!store.set(KEYS.meals, meals)) {
    meal.thumb = ''; // retry without the image
    if (!store.set(KEYS.meals, meals)) {
      meals.pop();
      return toast('พื้นที่เก็บข้อมูลเต็ม ลองลบมื้อเก่าๆ ก่อนนะ');
    }
    toast('พื้นที่ใกล้เต็ม เลยบันทึกแบบไม่มีรูป');
  } else {
    toast(`บันทึกแล้ว +${fmt(meal.calories)} kcal 🔥`);
  }
  const r = btn.getBoundingClientRect();
  celebrate(r.left + r.width / 2, r.top);
  closeSheet();
  go('today');
}

/* ================= Events ================= */
document.addEventListener('click', (e) => {
  const goBtn = e.target.closest('[data-go]');
  if (goBtn) return go(goBtn.dataset.go);

  const del = e.target.closest('[data-del]');
  if (del) {
    const m = meals.find((x) => x.id === del.dataset.del);
    if (m && confirm(`ลบ "${m.name}" ออกจากบันทึก?`)) {
      meals = meals.filter((x) => x.id !== m.id);
      store.set(KEYS.meals, meals);
      renderToday();
      if ($('#view-history').classList.contains('active')) renderHistory();
      toast('ลบแล้ว 🗑️');
    }
    return;
  }

  const act = e.target.closest('[data-action]');
  if (!act) return;
  switch (act.dataset.action) {
    case 'snap':
      if (!getApiKey()) {
        toast('ยังไม่มี API key — ใส่ใน config.js หรือกรอกตรงนี้ก่อนนะ 🔑', 3500);
        go('settings');
        setTimeout(() => $('#apiKeyInput').focus(), 400);
        return;
      }
      $('#fileInput').click();
      break;
    case 'manual': openManual(); break;
    case 'retry': runAnalysis(); break;
    case 'to-manual':
      draft.source = 'manual';
      draft.items = [{ name: '', portion: '', calories: 0, protein: 0, carbs: 0, fat: 0 }];
      sheetEdit();
      break;
    case 'add-item':
      draft.items.push({ name: '', portion: '', calories: 0, protein: 0, carbs: 0, fat: 0 });
      renderDraftItems();
      $$('#draftItems input[data-f=name]').pop()?.focus();
      break;
    case 'save': saveDraft(act); break;
  }
});

sheetBody.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-type]');
  if (chip) {
    draft.mealType = chip.dataset.type;
    $$('.chip', sheetBody).forEach((c) => c.classList.toggle('on', c === chip));
  }
  const rm = e.target.closest('[data-rm]');
  if (rm) {
    draft.items.splice(Number(rm.dataset.rm), 1);
    if (!draft.items.length) draft.items.push({ name: '', portion: '', calories: 0, protein: 0, carbs: 0, fat: 0 });
    renderDraftItems();
  }
});
sheetBody.addEventListener('input', (e) => {
  const el = e.target;
  if (!draft || el.dataset.i == null) return;
  const it = draft.items[Number(el.dataset.i)];
  if (el.dataset.f === 'calories') it.calories = num(el.value);
  else it.name = el.value;
  updateDraftTotal();
});
sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });

$('#fileInput').addEventListener('change', (e) => {
  handleFile(e.target.files[0]);
  e.target.value = '';
});

/* Onboarding */
$('#onboardForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  profile = { ...profile, weight: num(f.weight.value), height: num(f.height.value) };
  store.set(KEYS.profile, profile);
  $('#onboard').hidden = true;
  renderToday();
  toast(`TDEE ของคุณคือ ${fmt(calcTDEE(profile))} kcal/วัน ✨`, 3500);
});

/* Profile form */
const profileForm = $('#profileForm');
$('#activitySelect').innerHTML = ACTIVITY.map((a) => `<option value="${a.v}">${a.label} (×${a.v})</option>`).join('');
profileForm.addEventListener('input', () => renderTdeeCard(readProfileForm(profileForm)));
profileForm.addEventListener('submit', (e) => {
  e.preventDefault();
  profile = readProfileForm(profileForm);
  store.set(KEYS.profile, profile);
  renderTdeeCard(profile);
  toast(`อัปเดตแล้ว TDEE = ${fmt(calcTDEE(profile))} kcal ✅`);
});

/* API form */
$('#toggleKey').addEventListener('click', (e) => {
  const inp = $('#apiKeyInput');
  inp.type = inp.type === 'password' ? 'text' : 'password';
  e.target.textContent = inp.type === 'password' ? 'แสดง' : 'ซ่อน';
});
$('#apiForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const key = $('#apiKeyInput').value.trim();
  const model = e.target.model.value.trim() || DEFAULT_MODEL;
  if (key) store.set(KEYS.apiKey, key); else store.del(KEYS.apiKey);
  store.set(KEYS.model, model);
  renderSettings();
  toast(key ? 'บันทึก API key แล้ว พร้อมถ่ายรูป 📸' : defaultKey() ? 'ใช้ key ค่าเริ่มต้นจาก config.js ✅' : 'ลบ API key แล้ว');
});

/* Data management */
$('#btnClearMeals').addEventListener('click', () => {
  if (!confirm('ลบประวัติอาหารทั้งหมด? กู้คืนไม่ได้นะ')) return;
  meals = [];
  store.set(KEYS.meals, meals);
  toast('ล้างประวัติแล้ว');
});
$('#btnReset').addEventListener('click', () => {
  if (!confirm('รีเซ็ตทุกอย่าง (โปรไฟล์ ประวัติ และ API key)? กู้คืนไม่ได้นะ')) return;
  Object.values(KEYS).forEach(store.del);
  location.reload();
});

/* Refresh when coming back (e.g. after midnight) */
document.addEventListener('visibilitychange', () => { if (!document.hidden) renderToday(); });

/* ================= Boot ================= */
renderToday();
if (!(profile.weight > 0 && profile.height > 0)) $('#onboard').hidden = false;
