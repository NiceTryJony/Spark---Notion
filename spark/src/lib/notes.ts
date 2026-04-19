export interface Note {
  id: number;
  content: string;
  tags: string[];
  created_at: number;
  updated_at: number;
  pinned: boolean;
  sort_order: number;
  checked: boolean;
}

// ---------------------------------------------------------------------------
// Fuzzy matching helpers
// ---------------------------------------------------------------------------

/** Levenshtein distance between two strings */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
  return dp[m][n];
}

/**
 * Returns true if `text` contains `keyword` exactly,
 * OR if any word in `text` is within edit-distance 1 of `keyword`
 * (only for keywords with 5+ characters to avoid false positives).
 */
function fuzzyMatch(text: string, keyword: string): boolean {
  if (text.includes(keyword)) return true;
  // Short keywords / URL prefixes — exact only
  if (keyword.length < 5) return false;
  const maxDist = keyword.length >= 8 ? 2 : 1;
  return text
    .split(/[\s,.!?;:()\[\]{}"']+/)
    .some(
      (word) =>
        Math.abs(word.length - keyword.length) <= maxDist &&
        levenshtein(word, keyword) <= maxDist
    );
}

// ---------------------------------------------------------------------------
// Tag keyword dictionary  (EN · RU · PL · UA · DE)
// ---------------------------------------------------------------------------

/**
 * Each key is the canonical tag.
 * Values are keywords / phrases to match against the lowercased note text.
 * Fuzzy matching (1-2 edits) is applied automatically for words ≥ 5 chars,
 * so minor typos ("купить" vs "купит", "задача" vs "задечя") are caught.
 */
export const TAG_KEYWORDS: Record<string, string[]> = {
  // ── #idea ─────────────────────────────────────────────────────────────────
  "#idea": [
    // EN
    "idea", "concept", "thought", "inspiration", "brainstorm", "insight",
    // RU
    "идея", "мысль", "придумал", "придумала", "концепция", "вдохновение",
    "заметка", "наблюдение",
    // PL
    "pomysł", "myśl", "koncepcja", "wymyśliłem", "wymyśliłam", "inspiracja",
    "spostrzeżenie",
    // UA
    "ідея", "думка", "придумав", "придумала", "концепція", "натхнення",
    "спостереження",
    // DE
    "idee", "gedanke", "konzept", "einfall", "inspiration", "erkenntnis",
  ],

  // ── #todo ─────────────────────────────────────────────────────────────────
  "#todo": [
    // EN
    "todo", "to-do", "to do", "task", "remind", "reminder", "need to",
    "must", "should", "plan", "checklist", "don't forget", "dont forget",
    // RU
    "сделать", "нужно", "надо", "задача", "план", "напомнить", "напомни",
    "не забыть", "выполнить", "проверить", "список дел", "запланировать",
    "успеть",
    // PL
    "zrobić", "trzeba", "należy", "zadanie", "plan", "przypomnienie",
    "nie zapomnieć", "lista zadań", "zaplanować", "przypomni",
    // UA
    "зробити", "треба", "потрібно", "завдання", "нагадати", "не забути",
    "запланувати", "виконати",
    // DE
    "machen", "aufgabe", "erledigen", "merken", "nicht vergessen", "planen",
    "erinnerung", "vorhaben", "müssen", "sollen",
  ],

  // ── #buy ──────────────────────────────────────────────────────────────────
  "#buy": [
    // EN
    "buy", "order", "purchase", "shop", "shopping", "groceries", "pick up",
    "get some", "wishlist", "wish list",
    // RU
    "купить", "заказать", "покупка", "приобрести", "магазин",
    "список покупок", "докупить", "заказ", "хочу купить",
    // PL
    "kupić", "zamówić", "zakupy", "nabyć", "sklep", "lista zakupów",
    "zamówienie", "chcę kupić",
    // UA
    "купити", "замовити", "покупка", "придбати", "магазин",
    "список покупок", "хочу купити",
    // DE
    "kaufen", "bestellen", "einkaufen", "besorgen", "einkaufsliste",
    "wunschliste", "bestellung", "möchte kaufen",
  ],

  // ── #work ─────────────────────────────────────────────────────────────────
  "#work": [
    // EN
    "work", "project", "meeting", "job", "client", "deadline", "office",
    "colleague", "report", "sprint", "standup", "review", "interview",
    // RU
    "работа", "проект", "задание", "встреча", "дедлайн", "клиент",
    "офис", "коллега", "отчёт", "совещание", "стендап", "ревью",
    "собеседование",
    // PL
    "praca", "projekt", "spotkanie", "zadanie", "termin", "klient",
    "biuro", "kolega", "raport", "deadline", "rozmowa kwalifikacyjna",
    // UA
    "робота", "проект", "завдання", "зустріч", "дедлайн", "клієнт",
    "офіс", "колега", "звіт", "нарада", "співбесіда",
    // DE
    "arbeit", "projekt", "meeting", "termin", "büro", "kollege", "kunde",
    "bericht", "deadline", "standup", "vorstellungsgespräch", "sprint",
  ],

  // ── #link ─────────────────────────────────────────────────────────────────
  "#link": [
    // URL prefixes — always exact
    "http://", "https://", "www.",
  ],

  // ── #read ─────────────────────────────────────────────────────────────────
  "#read": [
    // EN
    "read", "article", "book", "blog", "chapter", "paper", "research",
    "newsletter", "doc", "documentation",
    // RU
    "прочитать", "статья", "книга", "глава", "блог", "прочесть",
    "документация", "исследование", "почитать",
    // PL
    "przeczytać", "artykuł", "książka", "blog", "rozdział",
    "dokumentacja", "badanie",
    // UA
    "прочитати", "стаття", "книга", "блог", "розділ", "документація",
    "дослідження", "почитати",
    // DE
    "lesen", "artikel", "buch", "kapitel", "blog", "dokumentation",
    "recherche", "newsletter",
  ],

  // ── #watch ────────────────────────────────────────────────────────────────
  "#watch": [
    // EN
    "watch", "video", "film", "movie", "series", "episode", "youtube",
    "netflix", "stream",
    // RU
    "посмотреть", "видео", "фильм", "сериал", "серия", "ютуб", "смотреть",
    // PL
    "obejrzeć", "wideo", "film", "serial", "odcinek", "youtube", "oglądać",
    // UA
    "подивитись", "відео", "фільм", "серіал", "серія", "ютуб", "дивитись",
    // DE
    "ansehen", "video", "film", "serie", "folge", "youtube", "schauen",
  ],

  // ── #clip ─────────────────────────────────────────────────────────────────
  "#clip": [
    // EN
    "screenshot", "clip", "image", "photo", "capture", "snapshot",
    // RU
    "скриншот", "изображение", "фото", "снимок", "снимок экрана",
    // PL
    "zrzut ekranu", "obraz", "zdjęcie", "klip",
    // UA
    "скріншот", "зображення", "фото", "знімок",
    // DE
    "screenshot", "bild", "foto", "aufnahme", "bildschirmfoto",
  ],

  // ── #finance ──────────────────────────────────────────────────────────────
  "#finance": [
    // EN
    "money", "budget", "expense", "invoice", "payment", "salary", "tax",
    "bank", "transfer", "receipt", "bill", "cost", "price",
    // RU
    "деньги", "бюджет", "расход", "счёт", "оплата", "зарплата", "налог",
    "банк", "перевод", "чек", "стоимость", "цена", "финансы",
    // PL
    "pieniądze", "budżet", "wydatek", "faktura", "płatność", "wypłata",
    "podatek", "bank", "przelew", "paragon", "koszt", "cena",
    // UA
    "гроші", "бюджет", "витрата", "рахунок", "оплата", "зарплата",
    "податок", "банк", "переказ", "чек", "вартість", "ціна",
    // DE
    "geld", "budget", "ausgabe", "rechnung", "zahlung", "gehalt",
    "steuer", "bank", "überweisung", "quittung", "kosten", "preis",
  ],

  // ── #health ───────────────────────────────────────────────────────────────
  "#health": [
    // EN
    "health", "doctor", "medicine", "symptom", "appointment", "workout",
    "exercise", "diet", "sleep", "hospital", "pharmacy",
    // RU
    "здоровье", "врач", "лекарство", "симптом", "приём", "тренировка",
    "упражнение", "диета", "сон", "больница", "аптека",
    // PL
    "zdrowie", "lekarz", "lekarstwo", "objaw", "wizyta", "trening",
    "ćwiczenie", "dieta", "sen", "szpital", "apteka",
    // UA
    "здоров'я", "лікар", "ліки", "симптом", "прийом", "тренування",
    "вправа", "дієта", "сон", "лікарня", "аптека",
    // DE
    "gesundheit", "arzt", "medizin", "symptom", "termin", "training",
    "übung", "diät", "schlaf", "krankenhaus", "apotheke",
  ],
};

// ---------------------------------------------------------------------------
// Tag extraction
// ---------------------------------------------------------------------------

export function extractTags(text: string): string[] {
  const lower = text.toLowerCase();

  // 1. Explicit hashtags typed by the user
  const explicit = (text.match(/#[\wа-яА-ЯёЁіІїЇєЄ]+/g) || []).map((t) =>
    t.toLowerCase()
  );

  // 2. Keyword-based implicit tags (with fuzzy matching)
  const implicit = Object.entries(TAG_KEYWORDS)
    .filter(([, keywords]) => keywords.some((kw) => fuzzyMatch(lower, kw)))
    .map(([tag]) => tag);

  return [...new Set([...explicit, ...implicit])];
}

// ---------------------------------------------------------------------------
// Tag registry & colours
// ---------------------------------------------------------------------------

export const ALL_TAGS = [
  "#idea", "#todo", "#buy", "#work", "#link", "#read",
  "#watch", "#clip", "#finance", "#health",
];

export const TAG_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  "#idea":    { bg: "rgba(251,191,36,0.1)",   text: "#FBBF24", border: "rgba(251,191,36,0.25)" },
  "#todo":    { bg: "rgba(59,130,246,0.1)",   text: "#60A5FA", border: "rgba(59,130,246,0.25)" },
  "#buy":     { bg: "rgba(34,197,94,0.1)",    text: "#4ADE80", border: "rgba(34,197,94,0.25)" },
  "#work":    { bg: "rgba(124,106,247,0.1)",  text: "#9B8DFF", border: "rgba(124,106,247,0.25)" },
  "#link":    { bg: "rgba(6,182,212,0.1)",    text: "#22D3EE", border: "rgba(6,182,212,0.25)" },
  "#read":    { bg: "rgba(249,115,22,0.1)",   text: "#FB923C", border: "rgba(249,115,22,0.25)" },
  "#watch":   { bg: "rgba(239,68,68,0.1)",    text: "#F87171", border: "rgba(239,68,68,0.25)" },
  "#clip":    { bg: "rgba(16,185,129,0.1)",   text: "#34D399", border: "rgba(16,185,129,0.25)" },
  "#finance": { bg: "rgba(245,158,11,0.1)",   text: "#F59E0B", border: "rgba(245,158,11,0.25)" },
  "#health":  { bg: "rgba(236,72,153,0.1)",   text: "#F472B6", border: "rgba(236,72,153,0.25)" },
};

export function getTagStyle(tag: string) {
  return (
    TAG_COLORS[tag] ?? {
      bg: "rgba(102,102,112,0.1)",
      text: "#999",
      border: "rgba(102,102,112,0.25)",
    }
  );
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

export function formatDate(ms: number): string {
  const date = new Date(ms);
  const now = new Date();
  const diff = now.getTime() - ms;
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === now.toDateString())
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === yesterday.toDateString())
    return `Yesterday ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return date.toLocaleDateString([], { day: "numeric", month: "short" });
}

// ---------------------------------------------------------------------------
// Note grouping
// ---------------------------------------------------------------------------

export function groupNotesByDay(
  notes: Note[]
): Array<{ label: string; notes: Note[] }> {
  const pinned = notes.filter((n) => n.pinned);
  const rest = notes.filter((n) => !n.pinned);

  const groups: Record<string, Note[]> = {};
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  for (const note of rest) {
    const date = new Date(note.created_at);
    let label: string;
    if (date.toDateString() === now.toDateString()) label = "Today";
    else if (date.toDateString() === yesterday.toDateString()) label = "Yesterday";
    else
      label = date.toLocaleDateString([], {
        weekday: "long",
        day: "numeric",
        month: "long",
      });
    if (!groups[label]) groups[label] = [];
    groups[label].push(note);
  }

  const result: Array<{ label: string; notes: Note[] }> = [];
  if (pinned.length > 0) result.push({ label: "Pinned", notes: pinned });
  result.push(
    ...Object.entries(groups).map(([label, notes]) => ({ label, notes }))
  );
  return result;
}