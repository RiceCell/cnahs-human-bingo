ALTER TABLE public.claims
    ADD COLUMN status text NOT NULL DEFAULT 'approved'
    CHECK (status IN ('pending', 'approved'));

CREATE INDEX claims_pending_signer_id_idx
    ON public.claims (signer_id)
    WHERE status = 'pending';

CREATE VIEW public.approved_leaderboard AS
SELECT players.id, players.name, COUNT(claims.id)::integer AS filled
FROM public.players AS players
LEFT JOIN public.claims AS claims
    ON claims.player_id = players.id
    AND claims.status = 'approved'
GROUP BY players.id, players.name
HAVING COUNT(claims.id) > 0;

GRANT SELECT ON public.approved_leaderboard TO service_role;
