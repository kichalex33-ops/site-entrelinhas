-- Denuncias de avaliacoes chegam ao painel da moderacao. Antes, review_reports so era gravado: ninguem via.
-- status: 'aberta' | 'ocultada' (a avaliacao saiu do ar) | 'mantida' (sem problema). Denunciar de novo reabre.
ALTER TABLE review_reports ADD COLUMN status TEXT NOT NULL DEFAULT 'aberta';
ALTER TABLE review_reports ADD COLUMN decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE review_reports ADD COLUMN decided_at INTEGER;
CREATE INDEX idx_review_reports_status ON review_reports(status, created_at);
