# Batch BCP, historical import (CP-07): spreadsheet and CSV imports of contracts, suppliers, historical spend and catalogue prices
# with saved column mappings, a dry run, a commit and a per-batch rollback. Executed from openapi_ext.py inside gen_openapi.py's
# namespace. Roles match the guards in apps/api/src/modules/cphist/routes.ts exactly. The suggestion and the checks are rules-based
# (engine rules-simulated-v1). Files are sent as JSON with the content base64-encoded (contentBase64), like every other upload here.
HI = "HistoricalImport"
HI_PREP = ["ADMIN", "CONTRACT_MGR"]
HI_LOAD = ["ADMIN"]
HI_SPEND = ["ADMIN", "CONTRACT_MGR", "EXEC", "FINANCE", "PROCUREMENT"]
HI_ENT = enum("CONTRACTS", "SUPPLIERS", "SPEND", "CATALOGUE")
schemas.update({
    "HistImportUpload": obj({
        "entity": enum("CONTRACTS", "SUPPLIERS", "SPEND", "CATALOGUE", "CONTRACT_FILES"),
        "filename": {"type": "string", "minLength": 1, "maxLength": 200},
        "sourceSystem": {"type": "string", "minLength": 2, "maxLength": 60},
        "contentBase64": {"type": "string", "description": "The .xlsx or .csv (or, for CONTRACT_FILES, a zip of contract files), base64-encoded, at most 10 MB decoded"},
        "sheet": S,
    }, ["entity", "filename", "sourceSystem", "contentBase64"]),
    "HistImportMapping": obj({
        "mapping": {"type": "object", "additionalProperties": {"type": "string", "nullable": True}, "description": "Field key to the column header it is read from, or null"},
        "duplicateRule": enum("SKIP", "MERGE"),
        "saveForSource": B,
    }, ["mapping"]),
    "HistImportDryRun": obj({"duplicateRule": enum("SKIP", "MERGE")}),
    "HistImportCommit": obj({"confirm": {"type": "boolean", "enum": [True]}, "duplicateRule": enum("SKIP", "MERGE")}, ["confirm"]),
    "HistImportRollback": obj({"reason": {"type": "string", "minLength": 5, "maxLength": 500}}, ["reason"]),
    "HistImportBatch": OBJ,
    "HistImportBatchSummary": OBJ,
    "HistImportEntity": OBJ,
    "HistImportMappingSaved": OBJ,
    "HistImportSample": OBJ,
    "HistImportSpend": OBJ,
})
ep("GET", "/history-import/entities", "listHistImportEntities", HI, "The entities that can be imported and the fields of each: label, whether required, type and allowed values", HI_PREP, None, "HistImportEntity", arrayResp=True)
ep("GET", "/history-import/templates/{entity}", "downloadHistImportTemplate", HI, "A template file for an entity (header row of field names and one example row), as CSV or xlsx (?format=csv|xlsx)", HI_PREP, None, None, note="Returns the file; 422 for an unknown entity")
ep("GET", "/history-import/samples", "listHistImportSamples", HI, "The synthetic sample files (a 200-row legacy contract register, a supplier extract, a spend extract, catalogue prices) with the source system each stands for", HI_PREP, None, "HistImportSample", arrayResp=True)
ep("GET", "/history-import/samples/{file}", "downloadHistImportSample", HI, "Download one sample file (name.xlsx or name.csv). Invented data with planted defects, for trying the import", HI_PREP, None, None, note="Returns the file; 404 for an unknown sample")
ep("POST", "/history-import/uploads", "uploadHistImport", HI, "Upload an .xlsx or .csv for one entity (JSON with contentBase64; passes the malware upload gate). Reads values only: formulas are not calculated, macros are ignored, zip bombs and oversized files are refused. Returns the batch with a suggested column mapping (or the one saved for the source system). A zip of historical contract files (entity CONTRACT_FILES) is handed to POST /contract-ingest/uploads with the caller's session", HI_PREP, "HistImportUpload", "HistImportBatch", 201, note="422 FILE_TOO_LARGE, FILE_UNSAFE, FILE_TYPE_UNSUPPORTED, FILE_DAMAGED, TOO_MANY_ROWS, NO_DATA; 422 VIRUS_DETECTED from the upload gate; for CONTRACT_FILES the batch says 'OCR capability not available' when the contract ingestion module is not installed")
ep("GET", "/history-import/batches", "listHistImportBatches", HI, "Import batches, newest first, with status and how many rows were loaded", HI_PREP, None, "HistImportBatchSummary", arrayResp=True)
ep("GET", "/history-import/batches/{id}", "getHistImportBatch", HI, "One batch: mapping, suggestion, dry-run summary, commit and rollback summary, whether a rollback is still possible, and rows (?rows=none|problems|all&limit&offset). A batch of contract files shows the OCR module's current results", HI_PREP, None, "HistImportBatch", query=["rows", "limit", "offset"])
ep("GET", "/history-import/batches/{id}/errors.csv", "downloadHistImportErrors", HI, "The error report of a dry run as CSV: each error, duplicate and warning with its row, rule, field, value and the source values", HI_PREP, None, None, note="Returns CSV; audited")
ep("PUT", "/history-import/batches/{id}/mapping", "setHistImportMapping", HI, "Set (edit) the column mapping, the duplicate rule, and optionally save the mapping for this source system. A changed mapping clears the dry run", HI_PREP, "HistImportMapping", "HistImportBatch", note="409 BATCH_CLOSED once loaded; 422 for an unknown field, a missing column, a column used twice or a missing required field")
ep("GET", "/history-import/mappings", "listHistImportMappings", HI, "Saved column mappings per source system (?entity=)", HI_PREP, None, "HistImportMappingSaved", arrayResp=True, query=["entity"])
ep("DELETE", "/history-import/mappings/{id}", "deleteHistImportMapping", HI, "Delete a saved mapping", HI_PREP, None, None, 204)
ep("POST", "/history-import/batches/{id}/dry-run", "dryRunHistImport", HI, "Check every row (types, dates in several formats including DD/MM/YYYY, amounts, required fields, ABN check digits, allowed values) and duplicates against suppliers, contracts, catalogue and the file itself. Writes only the batch's own results; no contract, supplier, reminder, catalogue or spend row is created", HI_PREP, "HistImportDryRun", "HistImportBatch", note="409 BATCH_CLOSED once loaded; 422 when the mapping is incomplete")
ep("POST", "/history-import/batches/{id}/commit", "commitHistImport", HI, "Load the valid rows (skipping or merging duplicates by the chosen rule), create key-date reminders for imported contracts, add historical spend to the analytics store, and record what was created so a rollback can remove exactly that. Rows are checked again on the live data", HI_LOAD, "HistImportCommit", "HistImportBatch", note="409 DRY_RUN_REQUIRED, BATCH_CLOSED, NOTHING_TO_LOAD")
ep("POST", "/history-import/batches/{id}/rollback", "rollbackHistImport", HI, "Remove exactly what the batch created: suppliers and catalogue items deleted (a supplier a retained contract needs is kept), merges put back, spend lines deleted, imported contracts logically deleted (NFR-L04) with their reminders cancelled. Refused while any imported contract has been edited or used", HI_LOAD, "HistImportRollback", "HistImportBatch", note="409 ROLLBACK_BLOCKED with what was touched; 409 INVALID_STATE unless the batch is loaded")
ep("GET", "/history-import/spend", "getHistImportSpend", HI, "Historical spend as the analytics store holds it: totals by financial year, category, supplier and business unit", HI_SPEND, None, "HistImportSpend")
