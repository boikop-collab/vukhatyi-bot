-- Час усюди зберігається в UTC у форматі 2026-10-13T16:45:00Z (рядки порівнюються лексикографічно).

CREATE TABLE users (
  tg_id        INTEGER PRIMARY KEY,
  display_name TEXT NOT NULL,
  username     TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  joined_at    TEXT NOT NULL
);

CREATE TABLE teams (
  id      INTEGER PRIMARY KEY,   -- id команди у football-data.org
  name    TEXT NOT NULL,         -- коротка назва з API
  tla     TEXT,
  name_uk TEXT                   -- українська назва (якщо задана)
);

CREATE TABLE matches (
  id            INTEGER PRIMARY KEY,   -- id матчу у football-data.org
  stage         TEXT NOT NULL,         -- LEAGUE_STAGE / PLAYOFFS / LAST_16 / ...
  matchday      INTEGER,
  kickoff       TEXT NOT NULL,         -- UTC
  kyiv_date     TEXT NOT NULL,         -- дата початку за Києвом, YYYY-MM-DD
  home_id       INTEGER NOT NULL REFERENCES teams(id),
  away_id       INTEGER NOT NULL REFERENCES teams(id),
  status        TEXT NOT NULL DEFAULT 'SCHEDULED',
  home_score    INTEGER,               -- рахунок за основний час (90 хв)
  away_score    INTEGER,
  is_finished   INTEGER NOT NULL DEFAULT 0,
  result_source TEXT,                  -- 'auto' (API) / 'manual' (адмін, API не перезаписує)
  tie_id        INTEGER                -- двоматчева пара плей-оф
);
CREATE INDEX idx_matches_matchday ON matches(stage, matchday, kickoff);
CREATE INDEX idx_matches_kyiv_date ON matches(kyiv_date);
CREATE INDEX idx_matches_kickoff ON matches(kickoff);

CREATE TABLE predictions (
  user_id    INTEGER NOT NULL REFERENCES users(tg_id),
  match_id   INTEGER NOT NULL REFERENCES matches(id),
  home       INTEGER NOT NULL,
  away       INTEGER NOT NULL,
  points     INTEGER,      -- NULL, доки матч не зараховано
  hit        TEXT,         -- exact / diff / one / result / miss
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, match_id)
);
CREATE INDEX idx_predictions_match ON predictions(match_id);

-- Плей-оф (з лютого): пара з двох матчів і прогноз «хто пройде»
CREATE TABLE ties (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  stage     TEXT NOT NULL,
  home_id   INTEGER NOT NULL,
  away_id   INTEGER NOT NULL,
  winner_id INTEGER
);
CREATE TABLE tie_predictions (
  user_id    INTEGER NOT NULL,
  tie_id     INTEGER NOT NULL,
  team_id    INTEGER NOT NULL,
  max_points INTEGER NOT NULL,   -- 3 (до 1-го матчу) або 1 (до 2-го)
  points     INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, tie_id)
);

-- Бонус «чемпіон»
CREATE TABLE champion_picks (
  user_id    INTEGER PRIMARY KEY REFERENCES users(tg_id),
  team_id    INTEGER NOT NULL REFERENCES teams(id),
  points     INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- Черга вихідних повідомлень (ліміт Workers: до 50 зовнішніх запитів за запуск)
CREATE TABLE outbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id      INTEGER NOT NULL,
  text       TEXT NOT NULL,
  markup     TEXT,
  silent     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  sent_at    TEXT,
  attempts   INTEGER NOT NULL DEFAULT 0,
  error      TEXT
);
CREATE INDEX idx_outbox_pending ON outbox(sent_at, attempts);

CREATE TABLE audit_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       TEXT NOT NULL,
  admin_id INTEGER NOT NULL,
  action   TEXT NOT NULL,
  details  TEXT
);

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
