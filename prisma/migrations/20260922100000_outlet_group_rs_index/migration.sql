-- Gap Group sidebar tab (getStandarisasiGroupGapAction) is the first real
-- WHERE-clause query on Outlet.groupRS -- previously only used for
-- in-memory sorting. Outlet has 35k+ rows.
CREATE INDEX "Outlet_groupRS_idx" ON "Outlet"("groupRS");
