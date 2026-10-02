-- Os autores cadastrados ate este momento passam a ser moderadores (is_admin = 1).
-- Quem se cadastrar depois continua como autor comum (is_admin = 0).
UPDATE users SET is_admin = 1;

-- Chat exclusivo dos moderadores.
CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
