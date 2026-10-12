// Українські назви клубів за короткою назвою (shortName) з football-data.org, у нижньому регістрі.
// Трилітерні коди не використовуємо: вони збігаються в різних клубів (FCB — і Баварія, і Барселона).
// Якщо назви немає в словнику — бот показує назву з API; адмін задає свою командою /team <id> <назва>.
export const TEAMS_UK_BY_NAME: Record<string, string> = {
  "bayern": "Баварія", "bayern münchen": "Баварія", "bayern munich": "Баварія",
  "barcelona": "Барселона", "barça": "Барселона",
  "sporting cp": "Спортінг", "club brugge": "Брюгге", "leverkusen": "Баєр",
  "dortmund": "Боруссія Д", "man city": "Ман Сіті", "man united": "Ман Юнайтед",
  "real madrid": "Реал Мадрид", "atleti": "Атлетіко", "inter": "Інтер", "milan": "Мілан",
  "paris sg": "ПСЖ", "psg": "ПСЖ", "shakhtar": "Шахтар", "dynamo kyiv": "Динамо Київ",
  "benfica": "Бенфіка", "porto": "Порту", "napoli": "Наполі", "juventus": "Ювентус",
  "arsenal": "Арсенал", "liverpool": "Ліверпуль", "chelsea": "Челсі", "tottenham": "Тоттенгем",
  "newcastle": "Ньюкасл", "aston villa": "Астон Вілла", "ajax": "Аякс", "psv": "ПСВ",
  "feyenoord": "Феєнорд", "celtic": "Селтік", "galatasaray": "Галатасарай",
  "olympiakos": "Олімпіакос", "olympiacos": "Олімпіакос", "marseille": "Марсель",
  "monaco": "Монако", "atalanta": "Аталанта", "roma": "Рома", "villarreal": "Вільярреал",
  "athletic": "Атлетік", "rb leipzig": "РБ Лейпциг", "frankfurt": "Айнтрахт", "stuttgart": "Штутгарт",
  "slavia praha": "Славія Прага", "sparta praha": "Спарта Прага", "københavn": "Копенгаген",
  "bodø/glimt": "Буде-Глімт", "qarabağ": "Карабах", "union sg": "Юніон СЖ", "lille": "Лілль",
  "lyon": "Ліон", "lens": "Ланс", "salzburg": "Зальцбург", "young boys": "Янг Бойз", "crvena zvezda": "Црвена Звезда", "dinamo zagreb": "Динамо Загреб",
  "fenerbahçe": "Фенербахче", "beşiktaş": "Бешикташ", "braga": "Брага", "girona": "Жирона",
  "bologna": "Болонья", "lazio": "Лаціо", "real sociedad": "Реал Сосьєдад", "real betis": "Бетіс",
  "pafos": "Пафос", "kairat": "Кайрат", "genk": "Генк", "rangers": "Рейнджерс",
};

export function ukName(shortName: string | null): string | null {
  return shortName ? TEAMS_UK_BY_NAME[shortName.trim().toLowerCase()] ?? null : null;
}
