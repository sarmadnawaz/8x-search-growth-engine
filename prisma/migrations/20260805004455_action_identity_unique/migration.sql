-- Action identity was enforced by a read-then-write in application code, which
-- two concurrent runs both pass — and each duplicate costs a paid generation
-- call. Remove any existing duplicates, then let the database enforce it.
DELETE FROM "Action" a USING "Action" b
WHERE a.ctid < b.ctid
  AND a.domain = b.domain AND a.kind = b.kind AND a.subject = b.subject;

CREATE UNIQUE INDEX "Action_domain_kind_subject_key" ON "Action"("domain","kind","subject");
