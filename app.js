import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendPasswordResetEmail, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, addDoc, deleteDoc, onSnapshot, query, where, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const CFG = window.APP_CONFIG;
const app = initializeApp(CFG.firebase);
const auth = getAuth(app);
const db = getFirestore(app);
let storageApi = null; // loaded only when storage is switched on

const EMOJIS = ["⛳", "🔥", "👏", "❤️"];
const CATS = ["Driving", "Irons", "Short game", "Putting", "Mindset"];
const TYPES = { available: "Available to play", tournament: "Tournament", busy: "Unavailable" };
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_L = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const S = { posts: {}, lessons: {}, events: {}, results: {}, reactions: {}, comments: {}, requests: {} };
let me = null, myName = "", isOwner = false, unsubs = [];
let tab = "feed", openThreads = {}, labCat = "All", expanded = {}, selDay = null;
let calMonth = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })();
let feedDraft = {}, labDraft = {};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => (n < 10 ? "0" : "") + n;
const iso = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const parseIso = (s) => { const p = String(s).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); };
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 3000); }
function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m ago"; if (s < 86400) return Math.floor(s / 3600) + "h ago";
  const d = new Date(ts); return d.getDate() + " " + MONTHS[d.getMonth()] + (d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : "");
}
function ytId(url) {
  const m = String(url || "").match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([\w-]{11})/);
  return m ? m[1] : null;
}
function sorted(obj, key, dir) {
  return Object.keys(obj).map((k) => Object.assign({ id: k }, obj[k]))
    .sort((a, b) => dir === "asc" ? (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) : (a[key] < b[key] ? 1 : a[key] > b[key] ? -1 : 0));
}

document.title = CFG.appName;
$("authTitle").textContent = CFG.appName;
$("brandName").innerHTML = esc(CFG.appName).replace(/ HQ$/, " <span>HQ</span>");

// ---------- auth screens ----------
function authErr(e) {
  const c = e && e.code || "";
  const map = {
    "auth/invalid-credential": "Email or password isn't right.",
    "auth/wrong-password": "Email or password isn't right.",
    "auth/user-not-found": "No account with that email. Create one below.",
    "auth/email-already-in-use": "There's already an account with that email. Sign in instead.",
    "auth/weak-password": "Use a password with at least 6 characters.",
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/too-many-requests": "Too many tries. Wait a few minutes and try again.",
    "auth/network-request-failed": "No connection. Check your signal and try again."
  };
  $("authErr").textContent = map[c] || "Something went wrong. Try again.";
}
function showAuth(mode) {
  $("authErr").textContent = "";
  let h = "";
  if (mode === "signup") {
    h = '<form id="af"><div><label for="a-name">Your name</label><input type="text" id="a-name" autocomplete="name" required></div>' +
      '<div><label for="a-email">Email</label><input type="text" inputmode="email" id="a-email" autocomplete="email" required></div>' +
      '<div><label for="a-pw">Choose a password</label><input type="password" id="a-pw" autocomplete="new-password" minlength="6" required></div>' +
      '<div><label for="a-code">Access code</label><input type="text" id="a-code" autocapitalize="off" autocomplete="off" required></div>' +
      '<button class="btn" type="submit">Create account</button></form><button class="switch" data-mode="signin">I already have an account</button>';
  } else if (mode === "reset") {
    h = '<form id="af"><div><label for="a-email">Email</label><input type="text" inputmode="email" id="a-email" autocomplete="email" required></div>' +
      '<button class="btn" type="submit">Email me a reset link</button></form><button class="switch" data-mode="signin">Back to sign in</button>';
  } else {
    h = '<form id="af"><div><label for="a-email">Email</label><input type="text" inputmode="email" id="a-email" autocomplete="email" required></div>' +
      '<div><label for="a-pw">Password</label><input type="password" id="a-pw" autocomplete="current-password" required></div>' +
      '<button class="btn" type="submit">Sign in</button></form><button class="switch" data-mode="signup">New here? Create an account</button><button class="switch" data-mode="reset">Forgot password</button>';
  }
  $("authForm").innerHTML = h;
  $("authForm").querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => showAuth(b.dataset.mode)));
  $("af").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("af").querySelector("button[type=submit]"); btn.disabled = true; $("authErr").textContent = "";
    const email = $("a-email").value.trim();
    try {
      if (mode === "signup") {
        if ($("a-code").value.trim() !== CFG.accessCode) { $("authErr").textContent = "That access code isn't right. Ask for the code."; btn.disabled = false; return; }
        const name = $("a-name").value.trim();
        const cred = await createUserWithEmailAndPassword(auth, email, $("a-pw").value);
        await updateProfile(cred.user, { displayName: name });
        await setDoc(doc(db, "users", cred.user.uid), { name, email: cred.user.email, joined: Date.now() });
        myName = name; start(cred.user);
      } else if (mode === "reset") {
        await sendPasswordResetEmail(auth, email);
        $("authErr").textContent = "Reset link sent. Check your email, including junk.";
      } else {
        await signInWithEmailAndPassword(auth, email, $("a-pw").value);
      }
    } catch (err) { authErr(err); }
    btn.disabled = false;
  });
}
$("signOut").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (u) => {
  if (u) { start(u); } else {
    unsubs.forEach((f) => f()); unsubs = []; me = null;
    $("auth").hidden = false; $("app").hidden = true; $("tabs").hidden = true; showAuth("signin");
  }
});

async function start(u) {
  if (me === u.uid) return;
  me = u.uid; myName = myName || u.displayName || (u.email || "").split("@")[0];
  isOwner = (u.email || "").toLowerCase() === CFG.ownerEmail.toLowerCase();
  $("auth").hidden = true; $("app").hidden = false; $("tabs").hidden = false; $("ownerChip").hidden = !isOwner;
  if (isOwner && CFG.storageEnabled && !storageApi) {
    try { storageApi = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js"); storageApi.instance = storageApi.getStorage(app); } catch (e) { storageApi = null; }
  }
  const sub = (name, q) => unsubs.push(onSnapshot(q, (snap) => {
    const o = {}; snap.forEach((d) => { o[d.id] = d.data(); }); S[name] = o; render();
  }, () => toast("Couldn't load " + name + ". Check your connection.")));
  sub("posts", query(collection(db, "posts"), orderBy("ts", "desc"), limit(150)));
  sub("lessons", query(collection(db, "lessons"), orderBy("ts", "desc"), limit(200)));
  sub("events", collection(db, "events"));
  sub("results", collection(db, "results"));
  sub("reactions", collection(db, "reactions"));
  sub("comments", query(collection(db, "comments"), orderBy("ts", "desc"), limit(1000)));
  sub("requests", isOwner ? collection(db, "requests") : query(collection(db, "requests"), where("uid", "==", me)));
  render();
}

// ---------- writes ----------
const newId = (col) => doc(collection(db, col)).id;
function save(col, id, obj) {
  S[col][id] = obj; render();
  return setDoc(doc(db, col, id), obj).catch(() => toast("That didn't save. Check your signal and try again."));
}
function del(col, id) {
  delete S[col][id]; render();
  deleteDoc(doc(db, col, id)).catch(() => toast("That didn't delete. Try again."));
}

// ---------- media ----------
function compressImage(file, max, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const cv = document.createElement("canvas"); cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
      cv.toBlob((b) => b ? resolve({ blob: b, dataUrl: () => cv.toDataURL("image/jpeg", quality) }) : reject(), "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(); };
    img.src = url;
  });
}
function uploadToStorage(blob, path, onPct) {
  const { ref, uploadBytesResumable, getDownloadURL, instance } = storageApi;
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(ref(instance, path), blob, { contentType: blob.type || "application/octet-stream" });
    task.on("state_changed", (s) => onPct(Math.round(s.bytesTransferred / s.totalBytes * 100)), reject,
      () => getDownloadURL(task.snapshot.ref).then((url) => resolve({ url, path })));
  });
}
async function handleFile(file, kind, prefix, store) {
  const st = $(prefix + "-status"), btn = $(prefix + "-submit");
  btn.disabled = true;
  const show = (pct, label) => { st.innerHTML = label + " " + pct + '%<div class="progress" style="flex:1"><i style="width:' + pct + '%"></i></div>'; };
  try {
    if (kind === "photo") {
      if (storageApi) {
        const c = await compressImage(file, 2000, 0.85);
        const r = await uploadToStorage(c.blob, "photos/" + Date.now() + ".jpg", (p) => show(p, "Uploading photo"));
        store.photoUrl = r.url; store.photoPath = r.path; delete store.photo;
      } else {
        // Free plan: keep a small copy inside the post itself.
        let c = await compressImage(file, 1200, 0.78), d = c.dataUrl();
        if (d.length > 700000) { c = await compressImage(file, 900, 0.7); d = c.dataUrl(); }
        store.photo = d; delete store.photoUrl;
      }
    } else {
      if (!storageApi) { toast("Video uploads switch on after the plan upgrade. Use a YouTube link for now."); return; }
      const r = await uploadToStorage(file, "videos/" + Date.now() + "-" + file.name.replace(/[^\w.-]/g, ""), (p) => show(p, "Uploading video"));
      store.videoUrl = r.url; store.videoPath = r.path;
    }
  } catch (e) { toast("Upload failed. Check your signal and try again."); }
  finally { btn.disabled = false; showPending(prefix, store); }
}
function mediaHtml(o) {
  let h = "";
  const photo = o.photoUrl || o.photo;
  if (photo) h += '<div class="media"><img src="' + esc(photo) + '" alt="" loading="lazy"></div>';
  if (o.videoUrl) h += '<div class="media"><video src="' + esc(o.videoUrl) + '" controls playsinline preload="metadata"></video></div>';
  const y = ytId(o.yt);
  if (y) h += '<div class="ytframe"><iframe src="https://www.youtube-nocookie.com/embed/' + y + '?rel=0&playsinline=1" title="Video" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe></div>';
  return h;
}
function mediaPicker(prefix, allowPhoto) {
  return '<div class="tools">' +
    (allowPhoto ? '<label class="attach">Photo<input type="file" accept="image/*" id="' + prefix + '-photo"></label>' : "") +
    (storageApi ? '<label class="attach">Video<input type="file" accept="video/*" id="' + prefix + '-video"></label>' : "") +
    '</div><div class="pending" id="' + prefix + '-status"></div>' +
    '<div class="field"><label for="' + prefix + '-yt">' + (storageApi ? "Or paste a YouTube link" : "Video: paste a YouTube link") + '</label><input type="url" id="' + prefix + '-yt" placeholder="https://youtu.be/…"></div>';
}
function wireMedia(prefix, store) {
  ["photo", "video"].forEach((k) => {
    const inp = $(prefix + "-" + k); if (!inp) return;
    inp.addEventListener("change", () => { const f = inp.files[0]; inp.value = ""; if (f) handleFile(f, k, prefix, store); });
  });
  showPending(prefix, store);
}
function showPending(prefix, store) {
  const st = $(prefix + "-status"); if (!st) return;
  const parts = [];
  if (store.photo || store.photoUrl) parts.push('Photo attached <button type="button" data-unp="photo">Remove</button>');
  if (store.videoUrl) parts.push('Video attached <button type="button" data-unp="video">Remove</button>');
  st.innerHTML = parts.join(" · ");
  st.querySelectorAll("[data-unp]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.unp === "photo") { delete store.photo; delete store.photoUrl; delete store.photoPath; } else { delete store.videoUrl; delete store.videoPath; }
    showPending(prefix, store);
  }));
}

// ---------- reactions & comments ----------
function itemComments(itemId) { return sorted(S.comments, "ts", "asc").filter((c) => c.itemId === itemId); }
function reactBar(itemId, delCol) {
  const counts = {}; let mine = null;
  Object.values(S.reactions).forEach((r) => { if (r.itemId !== itemId) return; counts[r.emoji] = (counts[r.emoji] || 0) + 1; if (r.uid === me) mine = r.emoji; });
  const cmts = itemComments(itemId);
  let h = '<div class="actions">';
  EMOJIS.forEach((e) => { h += '<button class="react' + (mine === e ? " on" : "") + '" data-react="' + itemId + '" data-e="' + e + '" aria-label="React ' + e + '">' + e + (counts[e] ? '<span class="n">' + counts[e] + '</span>' : "") + '</button>'; });
  h += '<span class="spacer"></span><button class="linkbtn" data-thread="' + itemId + '">' + (cmts.length ? cmts.length + " comment" + (cmts.length === 1 ? "" : "s") : "Comment") + '</button>';
  if (isOwner) h += '<button class="linkbtn del" data-del="' + delCol + '" data-id="' + itemId + '">Delete</button>';
  h += '</div>';
  if (openThreads[itemId]) {
    h += '<div class="comments">';
    cmts.forEach((c) => {
      const canX = isOwner || c.uid === me;
      h += '<div class="cmt">' + (canX ? '<button class="x" data-xc="' + c.id + '">Remove</button>' : "") +
        '<b>' + esc(c.uid === me ? "You" : c.name || "Sponsor") + '</b> <span class="note">' + ago(c.ts) + '</span><div class="t">' + esc(c.text) + '</div></div>';
    });
    h += '<form class="cform" data-cform="' + itemId + '"><input type="text" id="c-' + itemId + '" placeholder="Write a comment" maxlength="1000" aria-label="Comment"><button class="btn primary" type="submit">Send</button></form></div>';
  }
  return h;
}
function toggleReact(itemId, e) {
  const id = itemId + "_" + me, cur = S.reactions[id];
  if (cur && cur.emoji === e) { del("reactions", id); return; }
  save("reactions", id, { itemId, uid: me, emoji: e, ts: Date.now() });
}
function addComment(itemId, text) {
  if (!text) return;
  addDoc(collection(db, "comments"), { itemId, uid: me, name: myName, text, ts: Date.now() }).catch(() => toast("Comment didn't send. Try again."));
}

// ---------- pages ----------
const head = (title, sub) => '<div class="pagehead"><h2>' + title + '</h2>' + (sub ? '<p>' + sub + '</p>' : "") + '</div>';

function renderFeed() {
  let h = head("Feed", "Latest updates");
  if (isOwner) h += '<details class="card composer"><summary>Post an update</summary><form id="feedForm">' +
    '<textarea id="f-text" rows="3" placeholder="What\'s happening? Results, travel, practice, thanks to sponsors…"></textarea>' +
    mediaPicker("f", true) + '<button class="btn primary" id="f-submit" type="submit">Post</button></form></details>';
  const posts = sorted(S.posts, "ts");
  if (!posts.length) h += '<div class="empty"><b>No updates yet</b>' + (isOwner ? "Your first post will show here for sponsors." : "Updates will appear here as soon as they're posted.") + '</div>';
  const initials = CFG.appName.replace(/[^A-Z]/g, "").slice(0, 2) || "HQ";
  posts.forEach((p) => {
    h += '<article class="card"><div class="meta"><span class="avatar">' + esc(initials) + '</span><span><span class="who">' + esc(CFG.appName) + '</span><br>' + ago(p.ts) + '</span></div>' +
      (p.text ? '<p class="text">' + esc(p.text) + '</p>' : "") + mediaHtml(p) + reactBar(p.id, "posts") + '</article>';
  });
  return h;
}

function renderSchedule() {
  let h = head("Schedule", "Where I'm playing");
  const first = calMonth, startOffset = (first.getDay() + 6) % 7, start = new Date(first.getFullYear(), first.getMonth(), 1 - startOffset);
  const byDate = {};
  Object.keys(S.events).forEach((k) => { const e = S.events[k]; (byDate[e.date] = byDate[e.date] || []).push(Object.assign({ id: k }, e)); });
  const todayIso = iso(new Date());
  h += '<section class="card"><div class="cal-head"><button class="iconbtn" data-cal="-1" aria-label="Previous month">‹</button><b>' + MONTHS_L[first.getMonth()] + " " + first.getFullYear() + '</b><button class="iconbtn" data-cal="1" aria-label="Next month">›</button></div><div class="cal">';
  ["M","T","W","T","F","S","S"].forEach((d) => { h += '<div class="dow">' + d + '</div>'; });
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), k = iso(d);
    if (i >= 35 && d.getMonth() !== first.getMonth()) break;
    const evs = byDate[k] || [];
    h += '<button class="day' + (d.getMonth() !== first.getMonth() ? " out" : "") + (k === todayIso ? " today" : "") + (k === selDay ? " sel" : "") + '" data-day="' + k + '"><span>' + d.getDate() + '</span><span class="dots">' +
      evs.slice(0, 3).map((e) => '<span class="dot t-' + e.type + '"></span>').join("") + '</span></button>';
  }
  h += '</div><div class="legend"><span><i class="dot t-available"></i>Available to play</span><span><i class="dot t-tournament"></i>Tournament</span><span><i class="dot t-busy"></i>Unavailable</span></div></section>';
  if (isOwner) h += '<button class="btn primary" id="addEvent">+ Add to schedule</button>';

  const reqs = sorted(S.requests, "ts");
  if (reqs.length) {
    h += '<section class="card"><div class="lbl">' + (isOwner ? "Requests to play" : "Your requests") + '</div>';
    reqs.slice(0, 30).forEach((r) => {
      const dd = parseIso(r.date);
      h += '<div class="req"><b>' + esc(isOwner ? r.name : "You") + '</b>' + (isOwner && r.email ? ' · <span class="note">' + esc(r.email) + '</span>' : "") + '<div class="note">' + dd.getDate() + " " + MONTHS[dd.getMonth()] + (r.location ? " · " + esc(r.location) : "") + " · sent " + ago(r.ts) + '</div>' +
        '<div class="text">' + esc(r.msg) + '</div>' + (isOwner ? '<button class="linkbtn del" data-del="requests" data-id="' + r.id + '">Clear</button>' : "") + '</div>';
    });
    h += '</section>';
  }

  let list;
  if (selDay) {
    list = byDate[selDay] || [];
    const sd = parseIso(selDay);
    h += '<div class="pagehead"><p><b>' + sd.getDate() + " " + MONTHS_L[sd.getMonth()] + '</b> · <button class="linkbtn" id="clearDay">Show all upcoming</button></p></div>';
  } else {
    list = sorted(S.events, "date", "asc").filter((e) => e.date >= todayIso);
    h += '<div class="lbl">Upcoming</div>';
  }
  if (!list.length) h += '<div class="empty"><b>' + (selDay ? "Nothing on this day" : "Nothing scheduled yet") + '</b>' + (isOwner ? "Add days you're free to play and where you'll be." : "Check back soon for dates to play together.") + '</div>';
  list.forEach((e) => {
    const d = parseIso(e.date);
    h += '<article class="card"><div class="ev"><div class="datebox"><div class="m">' + MONTHS[d.getMonth()] + '</div><div class="d">' + d.getDate() + '</div></div><div>' +
      '<span class="tag ' + e.type + '">' + TYPES[e.type] + '</span><h3>' + esc(e.title || TYPES[e.type]) + '</h3>' +
      (e.location ? '<div class="loc">📍 ' + esc(e.location) + (e.time ? " · " + esc(e.time) : "") + '</div>' : (e.time ? '<div class="loc">' + esc(e.time) + '</div>' : "")) +
      (e.notes ? '<p class="text note">' + esc(e.notes) + '</p>' : "") + '</div></div>' +
      '<div class="tools">' + (e.type === "available" && !isOwner ? '<button class="btn gold" data-ask="' + e.id + '">Ask to play</button>' : "") +
      (isOwner ? '<button class="btn" data-editev="' + e.id + '">Edit</button><button class="btn del" data-del="events" data-id="' + e.id + '">Delete</button>' : "") + '</div></article>';
  });
  return h;
}

function renderLab() {
  let h = head("Swing Lab", "Drills and swing tips");
  if (isOwner) h += '<details class="card composer"><summary>Add a lesson</summary><form id="labForm">' +
    '<div class="field"><label for="l-title">Title</label><input type="text" id="l-title" placeholder="Fix your slice with the headcover drill" required></div>' +
    '<div class="field"><label for="l-cat">Category</label><select id="l-cat">' + CATS.map((c) => '<option>' + c + '</option>').join("") + '</select></div>' +
    '<div class="field"><label for="l-desc">The drill</label><textarea id="l-desc" rows="5" placeholder="Who it\'s for, how to set it up, what to feel, reps to do"></textarea></div>' +
    mediaPicker("l", false) + '<button class="btn primary" id="l-submit" type="submit">Publish lesson</button></form></details>';
  const all = sorted(S.lessons, "ts");
  const cats = ["All"].concat(CATS.filter((c) => all.some((l) => l.cat === c)));
  if (cats.length > 2) h += '<div class="chips">' + cats.map((c) => '<button class="chip' + (labCat === c ? " on" : "") + '" data-cat="' + c + '">' + c + '</button>').join("") + '</div>';
  const list = all.filter((l) => labCat === "All" || l.cat === labCat);
  if (!list.length) h += '<div class="empty"><b>No lessons yet</b>' + (isOwner ? "Film a tip, add the drill steps and publish it here." : "Swing tips and drills will appear here.") + '</div>';
  list.forEach((l) => {
    const long = (l.desc || "").length > 180;
    h += '<article class="card lesson"><span class="tag available">' + esc(l.cat || "Tip") + '</span><h3>' + esc(l.title) + '</h3>' + mediaHtml(l) +
      (l.desc ? '<p class="drill' + (long && !expanded[l.id] ? " clamp" : "") + '">' + esc(l.desc) + '</p>' + (long ? '<button class="linkbtn" data-more="' + l.id + '">' + (expanded[l.id] ? "Show less" : "Read the full drill") + '</button>' : "") : "") +
      reactBar(l.id, "lessons") + '</article>';
  });
  return h;
}

const fmtPar = (n) => { n = Math.round(n * 10) / 10; return n === 0 ? "E" : (n > 0 ? "+" : "") + n; };
function renderResults() {
  let h = head("Results", "Tournament record");
  const rs = sorted(S.results, "date");
  if (isOwner) h += '<button class="btn primary" id="addResult">+ Add a tournament result</button>';
  if (!rs.length) return h + '<div class="empty"><b>No results yet</b>' + (isOwner ? "After each tournament, add your score and stats. Averages work themselves out." : "Tournament results and stats will appear here.") + '</div>';
  let R = 0, sc = 0, fw = 0, fwp = 0, gir = 0, pt = 0;
  rs.forEach((r) => { const n = +r.rounds || 1; R += n; sc += +r.score || 0; fw += +r.fw || 0; fwp += (+r.fwPossible || 14) * n; gir += +r.gir || 0; pt += +r.putts || 0; });
  const avgSc = sc / R;
  h += '<div class="tiles">' +
    '<div class="tile"><div class="k">Scoring avg</div><div class="v' + (avgSc < 0 ? " under" : "") + '">' + fmtPar(avgSc) + '</div><div class="s">to par, per round</div></div>' +
    '<div class="tile"><div class="k">Fairways hit</div><div class="v">' + Math.round(fw / fwp * 100) + '%</div><div class="s">' + (fw / R).toFixed(1) + ' per round</div></div>' +
    '<div class="tile"><div class="k">Greens in reg</div><div class="v">' + Math.round(gir / (18 * R) * 100) + '%</div><div class="s">' + (gir / R).toFixed(1) + ' of 18 per round</div></div>' +
    '<div class="tile"><div class="k">Putts</div><div class="v">' + (pt / R).toFixed(1) + '</div><div class="s">per round</div></div></div>';
  h += '<p class="note">' + rs.length + (rs.length === 1 ? " tournament" : " tournaments") + ', ' + R + (R === 1 ? " round" : " rounds") + '.</p>';
  if (rs.length > 1) {
    const pts = rs.slice().reverse().slice(-12).map((r) => (+r.score || 0) / (+r.rounds || 1));
    const W = 320, H = 120, padL = 30, padR = 10, padT = 14, padB = 16;
    let lo = Math.min(...pts, 0), hi = Math.max(...pts, 0);
    if (hi - lo < 2) { hi += 1; lo -= 1; }
    const x = (i) => padL + i * (W - padL - padR) / (pts.length - 1);
    const y = (v) => padT + (v - lo) / (hi - lo) * (H - padT - padB);
    const path = pts.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" ");
    h += '<section class="card spark"><div class="lbl">Score to par per round, oldest to newest (higher on the chart is better)</div><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Score trend">' +
      '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="var(--line)" stroke-width="1.5" stroke-dasharray="4 4"/>' +
      '<text x="' + (padL - 6) + '" y="' + (y(0) + 4) + '" text-anchor="end" font-size="11" fill="var(--muted)">E</text>' +
      '<text x="' + (padL - 6) + '" y="' + (y(lo) + 4) + '" text-anchor="end" font-size="11" fill="var(--red)">' + fmtPar(lo) + '</text>' +
      '<text x="' + (padL - 6) + '" y="' + (y(hi) + 4) + '" text-anchor="end" font-size="11" fill="var(--muted)">' + fmtPar(hi) + '</text>' +
      '<path d="' + path + '" fill="none" stroke="var(--green-2)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>' +
      pts.map((v, i) => '<circle cx="' + x(i) + '" cy="' + y(v) + '" r="' + (i === pts.length - 1 ? 5 : 3) + '" fill="' + (v < 0 ? "var(--red)" : "var(--green-2)") + '" stroke="var(--card)" stroke-width="1.5"/>').join("") + '</svg></section>';
  }
  h += '<section class="card"><div class="lbl">Past results</div><div class="tbl-wrap"><table><thead><tr><th>Event</th><th class="num">Pos</th><th class="num">Score</th><th class="num">FW</th><th class="num">GIR</th><th class="num">Putts</th>' + (isOwner ? "<th></th>" : "") + '</tr></thead><tbody>';
  rs.forEach((r) => {
    const d = parseIso(r.date), n = +r.rounds || 1, s = +r.score || 0;
    h += '<tr><td class="ev-name"><b>' + esc(r.name) + '</b><div class="note">' + d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear() + (r.course ? " · " + esc(r.course) : "") + (n > 1 ? " · " + n + " rounds" : "") + '</div></td>' +
      '<td class="num">' + esc(r.pos || "–") + '</td><td class="num score' + (s < 0 ? " under" : "") + '">' + fmtPar(s) + '</td>' +
      '<td class="num">' + (+r.fw || 0) + '/' + ((+r.fwPossible || 14) * n) + '</td><td class="num">' + (+r.gir || 0) + '/' + (18 * n) + '</td><td class="num">' + (+r.putts || 0) + '</td>' +
      (isOwner ? '<td class="num"><button class="linkbtn" data-editres="' + r.id + '">Edit</button></td>' : "") + '</tr>';
  });
  return h + '</tbody></table></div></section>';
}

// ---------- render ----------
let pendingRender = false, keepDrafts = true;
// Hold off redrawing while someone is typing or watching a video, so nothing gets wiped or stopped.
const typing = () => {
  const a = document.activeElement;
  if (a && (/^(f-|l-|c-)/.test(a.id || "") || a.tagName === "IFRAME")) return true;
  return Array.from(document.querySelectorAll("#page video")).some((v) => !v.paused && !v.ended);
};
function render() {
  if (!me) return;
  if (typing()) { pendingRender = true; return; }
  const openComp = !!document.querySelector("details.composer[open]");
  const drafts = {};
  document.querySelectorAll("#page input, #page textarea, #page select").forEach((el) => { if (el.id && el.type !== "file" && /^(f-|l-)/.test(el.id)) drafts[el.id] = el.value; });
  const html = tab === "feed" ? renderFeed() : tab === "schedule" ? renderSchedule() : tab === "lab" ? renderLab() : renderResults();
  // Keep playing videos alive: only replace the page when something changed.
  if (render._last === html) return;
  render._last = html;
  $("page").innerHTML = '<div class="wrap" style="max-width:none">' + html + '</div>';
  if (openComp) { const dc = document.querySelector("details.composer"); if (dc) dc.open = true; }
  if (keepDrafts) Object.keys(drafts).forEach((k) => { if ($(k)) $(k).value = drafts[k]; });
  keepDrafts = true;
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  wirePage();
}
const flush = () => setTimeout(() => { if (pendingRender && !typing()) { pendingRender = false; render(); } }, 0);
document.addEventListener("focusout", flush);
document.addEventListener("pause", flush, true);
document.addEventListener("ended", flush, true);
window.addEventListener("focus", flush);

function wirePage() {
  if ($("feedForm")) {
    wireMedia("f", feedDraft);
    $("feedForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const text = $("f-text").value.trim(), yt = $("f-yt").value.trim();
      if (yt && !ytId(yt)) { toast("That doesn't look like a YouTube link."); return; }
      if (!text && !feedDraft.photo && !feedDraft.photoUrl && !feedDraft.videoUrl && !yt) { toast("Write something or add a photo or video first."); return; }
      const p = Object.assign({ text, ts: Date.now() }, feedDraft); if (yt) p.yt = yt;
      feedDraft = {}; $("f-text").value = ""; $("f-yt").value = ""; keepDrafts = false; $("f-text").blur();
      save("posts", newId("posts"), p).then(() => toast("Posted"));
    });
  }
  if ($("labForm")) {
    wireMedia("l", labDraft);
    $("labForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const title = $("l-title").value.trim(), yt = $("l-yt").value.trim();
      if (!title) { toast("Give the lesson a title."); return; }
      if (yt && !ytId(yt)) { toast("That doesn't look like a YouTube link."); return; }
      const l = Object.assign({ title, cat: $("l-cat").value, desc: $("l-desc").value.trim(), ts: Date.now() }, labDraft); if (yt) l.yt = yt;
      labDraft = {}; ["l-title", "l-desc", "l-yt"].forEach((k) => { $(k).value = ""; }); keepDrafts = false; document.activeElement && document.activeElement.blur();
      save("lessons", newId("lessons"), l).then(() => toast("Lesson published"));
    });
  }
  if ($("addEvent")) $("addEvent").addEventListener("click", () => eventForm(null, null));
  if ($("addResult")) $("addResult").addEventListener("click", () => resultForm(null, null));
  if ($("clearDay")) $("clearDay").addEventListener("click", () => { selDay = null; render(); });
}

$("page").addEventListener("click", (e) => {
  const t = e.target.closest("button"); if (!t) return;
  const d = t.dataset;
  if (d.react) return toggleReact(d.react, d.e);
  if (d.thread) { openThreads[d.thread] = !openThreads[d.thread]; render(); return; }
  if (d.xc) return del("comments", d.xc);
  if (d.del) {
    if (!t.classList.contains("armed")) { t.classList.add("armed"); t.textContent = "Tap again to delete"; return; }
    return del(d.del, d.id);
  }
  if (d.cal) { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + (+d.cal), 1); render(); return; }
  if (d.day) {
    selDay = selDay === d.day ? null : d.day;
    if (isOwner && selDay && !Object.values(S.events).some((ev) => ev.date === selDay)) eventForm({ date: selDay }, null);
    render(); return;
  }
  if (d.ask) return askForm(d.ask);
  if (d.editev) return eventForm(S.events[d.editev], d.editev);
  if (d.editres) return resultForm(S.results[d.editres], d.editres);
  if (d.cat) { labCat = d.cat; render(); return; }
  if (d.more) { expanded[d.more] = !expanded[d.more]; render(); return; }
});
$("page").addEventListener("submit", (e) => {
  const f = e.target.closest("[data-cform]"); if (!f) return;
  e.preventDefault();
  const id = f.dataset.cform, inp = $("c-" + id), v = inp.value.trim();
  inp.value = ""; inp.blur(); addComment(id, v);
});
$("tabs").addEventListener("click", (e) => {
  const b = e.target.closest(".tab"); if (!b) return;
  tab = b.dataset.tab; render._last = null; render(); window.scrollTo(0, 0);
  try { localStorage.setItem("hq-tab", tab); } catch (err) {}
});
try { const st = localStorage.getItem("hq-tab"); if (/^(feed|schedule|lab|results)$/.test(st || "")) tab = st; } catch (e) {}

// ---------- sheets ----------
function openSheet(html, after) { $("sheet").innerHTML = html; $("overlay").hidden = false; if (after) after(); }
function closeSheet() { $("overlay").hidden = true; $("sheet").innerHTML = ""; }
$("overlay").addEventListener("click", function (e) { if (e.target === this || e.target.closest("[data-close]")) closeSheet(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("overlay").hidden) closeSheet(); });
const closeRow = '<div class="tools" style="justify-content:flex-end"><button class="btn" type="button" data-close>Close</button></div>';

function eventForm(ev, id) {
  ev = Object.assign({ date: iso(new Date()), type: "available", title: "", location: "", time: "", notes: "" }, ev || {});
  openSheet('<h2>' + (id ? "Edit date" : "Add to schedule") + '</h2><form id="evForm" class="wrap" style="max-width:none">' +
    '<div class="row2"><div class="field"><label for="ev-date">Date</label><input type="date" id="ev-date" value="' + ev.date + '" required></div>' +
    '<div class="field"><label for="ev-type">Type</label><select id="ev-type">' + Object.keys(TYPES).map((k) => '<option value="' + k + '"' + (k === ev.type ? " selected" : "") + '>' + TYPES[k] + '</option>').join("") + '</select></div></div>' +
    '<div class="field"><label for="ev-title">Title (optional)</label><input type="text" id="ev-title" value="' + esc(ev.title) + '" placeholder="Free for a round"></div>' +
    '<div class="row2"><div class="field"><label for="ev-loc">Location</label><input type="text" id="ev-loc" value="' + esc(ev.location) + '" placeholder="Course or town"></div>' +
    '<div class="field"><label for="ev-time">Time (optional)</label><input type="text" id="ev-time" value="' + esc(ev.time) + '" placeholder="Morning, 10am…"></div></div>' +
    '<div class="field"><label for="ev-notes">Notes</label><textarea id="ev-notes" rows="2">' + esc(ev.notes) + '</textarea></div>' +
    '<button class="btn primary" type="submit">Save</button></form>' + closeRow, () => {
      $("evForm").addEventListener("submit", (e) => {
        e.preventDefault();
        const o = { date: $("ev-date").value, type: $("ev-type").value, title: $("ev-title").value.trim(), location: $("ev-loc").value.trim(), time: $("ev-time").value.trim(), notes: $("ev-notes").value.trim() };
        if (!o.date) { toast("Pick a date."); return; }
        save("events", id || newId("events"), o); closeSheet(); toast("Schedule updated");
        const d = parseIso(o.date); calMonth = new Date(d.getFullYear(), d.getMonth(), 1); selDay = null; render();
      });
    });
}

function askForm(evId) {
  const ev = S.events[evId]; if (!ev) return;
  const d = parseIso(ev.date);
  openSheet('<h2>Ask to play</h2><p class="note">' + d.getDate() + " " + MONTHS_L[d.getMonth()] + (ev.location ? " · " + esc(ev.location) : "") + '</p>' +
    '<form id="askForm" class="wrap" style="max-width:none"><div class="field"><label for="ask-msg">Your message</label><textarea id="ask-msg" rows="4" placeholder="I\'m nearby that day. Fancy a round at…" required></textarea></div>' +
    '<p class="note">Your name and email are sent with this so you can be contacted.</p><button class="btn gold" type="submit">Send request</button></form>' + closeRow, () => {
      $("askForm").addEventListener("submit", (e) => {
        e.preventDefault();
        const msg = $("ask-msg").value.trim(); if (!msg) { toast("Write a short message first."); return; }
        closeSheet();
        addDoc(collection(db, "requests"), { uid: me, name: myName, email: auth.currentUser.email, eventId: evId, date: ev.date, location: ev.location || "", msg, ts: Date.now() })
          .then(() => toast("Request sent")).catch(() => toast("Request didn't send. Try again."));
      });
    });
}

function resultForm(r, id) {
  r = Object.assign({ name: "", date: iso(new Date()), course: "", pos: "", rounds: 1, score: "", fw: "", fwPossible: 14, gir: "", putts: "" }, r || {});
  openSheet('<h2>' + (id ? "Edit result" : "Add result") + '</h2><form id="resForm" class="wrap" style="max-width:none">' +
    '<div class="field"><label for="r-name">Tournament</label><input type="text" id="r-name" value="' + esc(r.name) + '" required></div>' +
    '<div class="row2"><div class="field"><label for="r-date">Date</label><input type="date" id="r-date" value="' + r.date + '"></div>' +
    '<div class="field"><label for="r-course">Course</label><input type="text" id="r-course" value="' + esc(r.course) + '"></div></div>' +
    '<div class="row2"><div class="field"><label for="r-pos">Finish position</label><input type="text" id="r-pos" value="' + esc(r.pos) + '" placeholder="T5"></div>' +
    '<div class="field"><label for="r-rounds">Rounds played</label><input type="number" id="r-rounds" min="1" max="6" value="' + r.rounds + '"></div></div>' +
    '<p class="note">Enter totals for the whole tournament. Score is to par, e.g. -4 or 2.</p>' +
    '<div class="row4"><div class="field"><label for="r-score">Score</label><input type="number" id="r-score" step="1" value="' + r.score + '" required></div>' +
    '<div class="field"><label for="r-fw">Fairways</label><input type="number" id="r-fw" min="0" value="' + r.fw + '"></div>' +
    '<div class="field"><label for="r-gir">Greens</label><input type="number" id="r-gir" min="0" value="' + r.gir + '"></div>' +
    '<div class="field"><label for="r-putts">Putts</label><input type="number" id="r-putts" min="0" value="' + r.putts + '"></div></div>' +
    '<div class="field"><label for="r-fwp">Driving holes per round (for fairway %)</label><input type="number" id="r-fwp" min="1" max="18" value="' + r.fwPossible + '"></div>' +
    '<button class="btn primary" type="submit">Save result</button>' + (id ? '<button class="btn del" type="button" id="r-del">Delete result</button>' : "") + '</form>' + closeRow, () => {
      $("resForm").addEventListener("submit", (e) => {
        e.preventDefault();
        const o = { name: $("r-name").value.trim(), date: $("r-date").value || iso(new Date()), course: $("r-course").value.trim(), pos: $("r-pos").value.trim(),
          rounds: Math.max(1, +$("r-rounds").value || 1), score: +$("r-score").value || 0, fw: +$("r-fw").value || 0, gir: +$("r-gir").value || 0, putts: +$("r-putts").value || 0, fwPossible: +$("r-fwp").value || 14 };
        if (!o.name) { toast("Enter the tournament name."); return; }
        save("results", id || newId("results"), o); closeSheet(); toast("Result saved");
      });
      const rd = $("r-del"); if (rd) rd.addEventListener("click", () => {
        if (!rd.classList.contains("armed")) { rd.classList.add("armed"); rd.textContent = "Tap again to delete"; return; }
        del("results", id); closeSheet();
      });
    });
}
