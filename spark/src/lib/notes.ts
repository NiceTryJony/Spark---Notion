export interface Note {
  id: number;
  content: string;
  tags: string[];
  created_at: number;
  updated_at: number;
  pinned: boolean;
  sort_order: number;
  checked: boolean[];
}

// ---------------------------------------------------------------------------
// Fuzzy matching helpers
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j-1], dp[i-1][j], dp[i][j-1]);
  return dp[m][n];
}

function fuzzyMatch(text: string, keyword: string): boolean {
  if (text.includes(keyword)) return true;
  if (keyword.length < 5) return false;
  const maxDist = keyword.length >= 8 ? 2 : 1;
  return text
    .split(/[\s,.!?;:()\[\]{}"']+/)
    .some(word =>
      Math.abs(word.length - keyword.length) <= maxDist &&
      levenshtein(word, keyword) <= maxDist
    );
}

// ---------------------------------------------------------------------------
// Tag keyword dictionary  (EN · RU · PL · UA · DE)
// ---------------------------------------------------------------------------

export const TAG_KEYWORDS: Record<string, string[]> = {
  "#idea": [
    "idea","concept","thought","inspiration","brainstorm","insight",
    "идея","мысль","придумал","придумала","концепция","вдохновение","заметка","наблюдение",
    "pomysł","myśl","koncepcja","wymyśliłem","wymyśliłam","inspiracja","spostrzeżenie",
    "ідея","думка","придумав","концепція","натхнення","спостереження",
    "idee","gedanke","konzept","einfall","erkenntnis",
  ],
  "#todo": [
    "todo","to-do","to do","task","remind","reminder","need to","must","should","plan","checklist","don't forget","dont forget",
    "сделать","нужно","надо","задача","план","напомнить","напомни","не забыть","выполнить","проверить","список дел","запланировать","успеть",
    "zrobić","trzeba","należy","zadanie","przypomnienie","nie zapomnieć","lista zadań","zaplanować",
    "зробити","треба","потрібно","завдання","нагадати","не забути","запланувати","виконати",
    "machen","aufgabe","erledigen","merken","nicht vergessen","planen","erinnerung","vorhaben","müssen","sollen",
  ],
  "#buy": [
    "buy","order","purchase","shop","shopping","groceries","pick up","get some","wishlist","wish list",
    "купить","заказать","покупка","приобрести","магазин","список покупок","докупить","заказ","хочу купить",
    "kupić","zamówić","zakupy","nabyć","sklep","lista zakupów","zamówienie","chcę kupić",
    "купити","замовити","придбати","хочу купити",
    "kaufen","bestellen","einkaufen","besorgen","einkaufsliste","wunschliste","möchte kaufen",
  ],
  "#work": [
    "work","project","meeting","job","client","deadline","office","colleague","report","sprint","standup","review","interview",
    "работа","проект","задание","встреча","дедлайн","клиент","офис","коллега","отчёт","совещание","стендап","ревью","собеседование",
    "praca","projekt","spotkanie","zadanie","termin","klient","biuro","kolega","raport","rozmowa kwalifikacyjna",
    "робота","завдання","зустріч","клієнт","офіс","колега","звіт","нарада","співбесіда",
    "arbeit","büro","kollege","kunde","bericht","vorstellungsgespräch",
  ],
  "#link":    ["http://","https://","www."],
  "#read": [
    "read","article","book","blog","chapter","paper","research","newsletter","doc","documentation",
    "прочитать","статья","книга","глава","блог","прочесть","документация","исследование","почитать",
    "przeczytać","artykuł","książka","rozdział","dokumentacja","badanie",
    "прочитати","стаття","розділ","документація","дослідження","почитати",
    "lesen","artikel","buch","kapitel","dokumentation","recherche",
  ],
  "#watch": [
    "watch","video","film","movie","series","episode","youtube","netflix","stream",
    "посмотреть","видео","фильм","сериал","серия","ютуб","смотреть",
    "obejrzeć","wideo","serial","odcinek","oglądać",
    "подивитись","відео","серіал","серія","ютуб","дивитись",
    "ansehen","serie","folge","schauen",
  ],
  "#clip": [
    "screenshot","clip","image","photo","capture","snapshot",
    "скриншот","изображение","фото","снимок","снимок экрана",
    "zrzut ekranu","obraz","zdjęcie","klip",
    "скріншот","зображення","знімок",
    "bild","aufnahme","bildschirmfoto",
  ],
  "#finance": [
    "money","budget","expense","invoice","payment","salary","tax","bank","transfer","receipt","bill","cost","price",
    "деньги","бюджет","расход","счёт","оплата","зарплата","налог","банк","перевод","чек","стоимость","цена","финансы",
    "pieniądze","budżet","wydatek","faktura","płatność","wypłata","podatek","przelew","paragon","koszt","cena",
    "гроші","витрата","рахунок","зарплата","переказ","вартість","ціна",
    "geld","ausgabe","rechnung","zahlung","gehalt","steuer","überweisung","quittung","kosten","preis",
  ],
  "#health": [
    "health","doctor","medicine","symptom","appointment","workout","exercise","diet","sleep","hospital","pharmacy",
    "здоровье","врач","лекарство","симптом","приём","тренировка","упражнение","диета","сон","больница","аптека",
    "zdrowie","lekarz","lekarstwo","objaw","wizyta","trening","ćwiczenie","sen","szpital","apteka",
    "здоров'я","лікар","ліки","прийом","тренування","вправа","лікарня","аптека",
    "gesundheit","arzt","medizin","training","übung","diät","schlaf","krankenhaus","apotheke",
  ],
};

// ---------------------------------------------------------------------------
// Tag extraction
// ---------------------------------------------------------------------------

export function extractTags(text: string): string[] {
  const lower = text.toLowerCase();
  const explicit = (text.match(/#[\wа-яА-ЯёЁіІїЇєЄ]+/g) || []).map(t => t.toLowerCase());
  const implicit = Object.entries(TAG_KEYWORDS)
    .filter(([, kws]) => kws.some(kw => fuzzyMatch(lower, kw)))
    .map(([tag]) => tag);
  return [...new Set([...explicit, ...implicit])];
}

// ---------------------------------------------------------------------------
// Strip explicit #tags from display text (DB content never touched)
// ---------------------------------------------------------------------------

export function stripExplicitTags(text: string): string {
  return text
    .replace(/#[a-zA-Z0-9_а-яА-ЯёЁіІїЇєЄ]+/g, "")
    .split("\n")
    .map(line => line.replace(/  +/g, " ").trim())
    .join("\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Note aging — opacity by age (pinned notes never fade)
// ---------------------------------------------------------------------------

export function getNoteOpacity(createdAt: number, pinned: boolean): number {
  if (pinned) return 1;
  const days = (Date.now() - createdAt) / 86_400_000;
  if (days < 1)  return 1;
  if (days < 3)  return 0.92;
  if (days < 7)  return 0.78;
  if (days < 14) return 0.62;
  if (days < 30) return 0.48;
  return 0.35;
}

// ---------------------------------------------------------------------------
// Tag registry & colours
// ---------------------------------------------------------------------------

// export const ALL_TAGS = [
//   "#idea","#todo","#buy","#work","#link","#read",
//   "#watch","#clip","#finance","#health",
// ];

 // Порядок определяется здесь, производится из ключей TAG_KEYWORDS
 const TAG_ORDER = ["#idea","#todo","#buy","#work","#link",
                    "#read","#watch","#clip","#finance","#health"];
 export const ALL_TAGS = TAG_ORDER.filter(t => t in TAG_KEYWORDS);


export const TAG_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  "#idea":    { bg:"rgba(251,191,36,0.1)",  text:"#FBBF24", border:"rgba(251,191,36,0.25)" },
  "#todo":    { bg:"rgba(59,130,246,0.1)",  text:"#60A5FA", border:"rgba(59,130,246,0.25)" },
  "#buy":     { bg:"rgba(34,197,94,0.1)",   text:"#4ADE80", border:"rgba(34,197,94,0.25)"  },
  "#work":    { bg:"rgba(124,106,247,0.1)", text:"#9B8DFF", border:"rgba(124,106,247,0.25)"},
  "#link":    { bg:"rgba(6,182,212,0.1)",   text:"#22D3EE", border:"rgba(6,182,212,0.25)"  },
  "#read":    { bg:"rgba(249,115,22,0.1)",  text:"#FB923C", border:"rgba(249,115,22,0.25)" },
  "#watch":   { bg:"rgba(239,68,68,0.1)",   text:"#F87171", border:"rgba(239,68,68,0.25)"  },
  "#clip":    { bg:"rgba(16,185,129,0.1)",  text:"#34D399", border:"rgba(16,185,129,0.25)" },
  "#finance": { bg:"rgba(245,158,11,0.1)",  text:"#F59E0B", border:"rgba(245,158,11,0.25)" },
  "#health":  { bg:"rgba(236,72,153,0.1)",  text:"#F472B6", border:"rgba(236,72,153,0.25)" },
};

export function getTagStyle(tag: string) {
  return TAG_COLORS[tag] ?? { bg:"rgba(102,102,112,0.1)", text:"#999", border:"rgba(102,102,112,0.25)" };
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

export function formatDate(ms: number): string {
  const date = new Date(ms);
  const now  = new Date();
  const diff = now.getTime() - ms;
  if (diff < 60_000)    return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === now.toDateString())
    return date.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
  if (date.toDateString() === yesterday.toDateString())
    return `Yesterday ${date.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}`;
  return date.toLocaleDateString([], { day:"numeric", month:"short" });
}

// ---------------------------------------------------------------------------
// Note grouping
// ---------------------------------------------------------------------------

export function groupNotesByDay(notes: Note[]): Array<{ label: string; notes: Note[] }> {
  const pinned = notes.filter(n => n.pinned);
  const rest   = notes.filter(n => !n.pinned);
  const groups: Record<string, Note[]> = {};
  const now       = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  for (const note of rest) {
    const date = new Date(note.created_at);
    let label: string;
    if (date.toDateString() === now.toDateString())       label = "Today";
    else if (date.toDateString() === yesterday.toDateString()) label = "Yesterday";
    else label = date.toLocaleDateString([], { weekday:"long", day:"numeric", month:"long" });
    if (!groups[label]) groups[label] = [];
    groups[label].push(note);
  }

  const result: Array<{ label: string; notes: Note[] }> = [];
  if (pinned.length > 0) result.push({ label:"Pinned", notes:pinned });
  result.push(...Object.entries(groups).map(([label, notes]) => ({ label, notes })));
  return result;
}

// ---------------------------------------------------------------------------
// Markdown renderer (zero deps)
// ---------------------------------------------------------------------------

function escHtml(s: string): string {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function inlineMd(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g,  "<strong>$1</strong>")
    .replace(/~~(.+?)~~/g,      "<s>$1</s>")
    .replace(/\*(.+?)\*/g,      "<em>$1</em>")
    .replace(/`([^`]+)`/g,      "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

export function renderMarkdown(raw: string): string {
  const lines = raw.split("\n");
  const out: string[] = [];
  let inCode = false;
  let codeAcc: string[] = [];
  let inList = false;

  const flushList = () => { if (inList) { out.push("</ul>"); inList = false; } };

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        flushList();
        out.push(`<pre><code>${codeAcc.join("\n")}</code></pre>`);
        codeAcc = []; inCode = false;
      } else { flushList(); inCode = true; }
      continue;
    }
    if (inCode) { codeAcc.push(escHtml(line)); continue; }

    if (/^### /.test(line))      { flushList(); out.push(`<h3>${inlineMd(escHtml(line.slice(4)))}</h3>`); }
    else if (/^## /.test(line))  { flushList(); out.push(`<h2>${inlineMd(escHtml(line.slice(3)))}</h2>`); }
    else if (/^# /.test(line))   { flushList(); out.push(`<h1>${inlineMd(escHtml(line.slice(2)))}</h1>`); }
    else if (/^[-*] /.test(line)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inlineMd(escHtml(line.slice(2)))}</li>`);
    } else if (/^\d+\. /.test(line)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inlineMd(escHtml(line.replace(/^\d+\. /,"")))}</li>`);
    } else if (line.trim() === "") {
      flushList(); out.push("<br>");
    } else {
      flushList(); out.push(`<p>${inlineMd(escHtml(line))}</p>`);
    }
  }

  flushList();
  return out.join("");
}