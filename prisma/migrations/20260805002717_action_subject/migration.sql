-- Actions are identified by what they are about, not by their title. Titles
-- embed current measurements ("0/3 samples"), which change between runs and
-- would spawn a duplicate action each time the number moved.
ALTER TABLE "Action" ADD COLUMN "subject" TEXT NOT NULL DEFAULT '';
CREATE INDEX "Action_domain_kind_subject_idx" ON "Action"("domain", "kind", "subject");
