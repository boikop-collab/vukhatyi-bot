# Вухатий

Telegram-бот турніру прогнозів на Лігу чемпіонів 2026/27 для друзів. Некомерційний, без грошей і ставок.

Працює на Cloudflare Workers (безкоштовний тариф) з базою D1. Telegram викликає бота через вебхук, фонові задачі запускає cron кожні 2 хвилини. Матчі й результати беруться з football-data.org.

## Структура

```
src/index.ts      вхід: вебхук /tg, налаштування /setup, cron
src/handlers.ts   команди учасників, адміна та кнопки
src/views.ts      тексти екранів і клавіатури
src/jobs.ts       календар, результати, нагадування, підсумок вечора, черга повідомлень
src/scoring.ts    правила нарахування балів
src/football.ts   клієнт football-data.org і правило «рахунок за 90 хвилин»
src/teamsUk.ts    українські назви клубів
src/texts.ts      правила, політика даних, довідка
migrations/       схема бази
test/             тести балів, часу та екранів
assets/           логотип і аватарка
```

## Перший запуск

```bash
npm install
npx wrangler login
npx wrangler d1 create vukhatyi        # id бази вписати у wrangler.jsonc
npm run migrate
npx wrangler secret put BOT_TOKEN
npx wrangler secret put FOOTBALL_API_KEY
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put ADMIN_IDS
npm run deploy
```

Після деплою один раз увімкнути вебхук і меню команд:

```bash
curl -X POST https://<адреса-воркера>/setup -H "X-Setup-Secret: <WEBHOOK_SECRET>"
```

Потім у боті: `/start`, далі `/sync` — завантажить календар.

## Оновлення

```bash
npm test
npm run deploy
```

Якщо додано файл у `migrations/` — перед деплоєм `npm run migrate`.

## Команди адміна

Адміни задаються секретом `ADMIN_IDS` (Telegram ID через кому). Список команд — `/admin` у боті.

| Команда | Що робить |
|---|---|
| `/sync` | оновити календар з API |
| `/ids` | id матчів поточного туру |
| `/result <id> <г> <г>` | внести результат вручну; API його більше не змінить |
| `/team <id> <назва>` | українська назва команди |
| `/teams` | список команд з id |
| `/users` | учасники й кількість їхніх прогнозів |
| `/say <текст>` | розсилка всім |
| `/cron` | запустити фонові задачі зараз |
| `/here` | у груповому чаті: публікувати туди нагадування й таблицю |

## Чого ще немає

- Плей-оф (лютий 2027): двоматчеві пари й прогноз «хто пройде». Таблиці в базі вже є, екранів немає.
- Нарахування бонусу за чемпіона (потрібне після фіналу).
- Автоматичної резервної копії бази в Telegram. Поки що — `npx wrangler d1 export vukhatyi --remote --output backup.sql`.
