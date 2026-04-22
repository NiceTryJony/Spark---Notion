/// Unified tag extraction — single source of truth for all tag detection logic.
/// Replaces duplicate implementations in lib.rs (Rust) and notes.ts (TypeScript).

// use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Tag keyword dictionary (EN · RU · PL · UA · DE)
const TAG_KEYWORDS: &[(&str, &[&str])] = &[
    ("#idea", &[
        "idea","concept","thought","inspiration","brainstorm","insight",
        "идея","мысль","придумал","придумала","концепция","вдохновение","заметка","наблюдение",
        "pomysł","myśl","koncepcja","wymyśliłem","wymyśliłam","inspiracja","spostrzeżenie",
        "ідея","думка","придумав","концепція","натхнення","спостереження",
        "idee","gedanke","konzept","einfall","erkenntnis",
    ]),
    ("#todo", &[
        "todo","to-do","to do","task","remind","reminder","need to","must","should","plan",
        "checklist","don't forget","dont forget",
        "сделать","нужно","надо","задача","план","напомнить","напомни","не забыть",
        "выполнить","проверить","список дел","запланировать","успеть",
        "zrobić","trzeba","należy","zadanie","przypomnienie","nie zapomnieć",
        "lista zadań","zaplanować",
        "зробити","треба","потрібно","завдання","нагадати","не забути",
        "запланувати","виконати",
        "machen","aufgabe","erledigen","merken","nicht vergessen","planen",
        "erinnerung","vorhaben","müssen","sollen",
    ]),
    ("#buy", &[
        "buy","order","purchase","shop","shopping","groceries","pick up","get some",
        "wishlist","wish list",
        "купить","заказать","покупка","приобрести","магазин","список покупок",
        "докупить","заказ","хочу купить",
        "kupić","zamówić","zakupy","nabyć","sklep","lista zakupów","zamówienie","chcę kupić",
        "купити","замовити","придбати","хочу купити",
        "kaufen","bestellen","einkaufen","besorgen","einkaufsliste","wunschliste","möchte kaufen",
    ]),
    ("#work", &[
        "work","project","meeting","job","client","deadline","office","colleague","report",
        "sprint","standup","review","interview",
        "работа","проект","задание","встреча","дедлайн","клиент","офис","коллега",
        "отчёт","совещание","стендап","ревью","собеседование",
        "praca","projekt","spotkanie","zadanie","termin","klient","biuro","kolega",
        "raport","rozmowa kwalifikacyjna",
        "робота","завдання","зустріч","клієнт","офіс","колега","звіт","нарада","співбесіда",
        "arbeit","büro","kollege","kunde","bericht","vorstellungsgespräch",
    ]),
    ("#link", &["http://","https://","www."]),
    ("#read", &[
        "read","article","book","blog","chapter","paper","research","newsletter",
        "doc","documentation",
        "прочитать","статья","книга","глава","блог","прочесть","документация",
        "исследование","почитать",
        "przeczytać","artykuł","książka","rozdział","dokumentacja","badanie",
        "прочитати","стаття","розділ","документація","дослідження","почитати",
        "lesen","artikel","buch","kapitel","dokumentation","recherche",
    ]),
];

/// Extract tags from text content.
/// Returns sorted, deduplicated list of detected tags.
pub fn extract_tags(content: &str) -> Vec<String> {
    let lower = content.to_lowercase();
    let mut tags: HashSet<String> = HashSet::new();

    // 1. Explicit hashtags typed in the text
    let mut i = 0;
    let bytes = content.as_bytes();
    while i < bytes.len() {
        if bytes[i] == b'#' {
            let start = i + 1;
            let end = bytes[start..]
                .iter()
                .position(|&b| !b.is_ascii_alphanumeric() && b != b'_')
                .map(|p| start + p)
                .unwrap_or(bytes.len());
            if end > start {
                tags.insert(format!("#{}", &content[start..end].to_lowercase()));
            }
            i = end;
        } else {
            i += 1;
        }
    }

    // 2. Keyword-based auto-detection
    for (tag, keywords) in TAG_KEYWORDS {
        for kw in *keywords {
            if lower.contains(kw) {
                tags.insert(tag.to_string());
                break;
            }
        }
    }

    // 3. Sort and return
    let mut result: Vec<String> = tags.into_iter().collect();
    result.sort();
    result
}

/// Tauri command — extract tags from text (callable from frontend)
#[tauri::command]
pub fn extract_tags_cmd(content: String) -> Vec<String> {
    extract_tags(&content)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_explicit_tags() {
        let tags = extract_tags("Купить молоко #groceries #important");
        assert!(tags.contains(&"#groceries".to_string()));
        assert!(tags.contains(&"#important".to_string()));
        assert!(tags.contains(&"#buy".to_string())); // keyword "купить"
    }

    #[test]
    fn test_keywords() {
        assert_eq!(extract_tags("Нужно сделать отчёт"), vec!["#todo", "#work"]);
        assert_eq!(extract_tags("idea for new feature"), vec!["#idea"]);
        assert_eq!(extract_tags("https://example.com"), vec!["#link"]);
    }

    #[test]
    fn test_deduplication() {
        let tags = extract_tags("todo todo #todo task #todo");
        assert_eq!(tags, vec!["#todo"]);
    }
}