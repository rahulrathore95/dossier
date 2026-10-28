-- What each job source did during a search (this fork): kept with the search.
ALTER TABLE "PostingSearch" ADD COLUMN "report" JSONB;
