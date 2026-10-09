# ---------------------------------------------------------------- BCP cpocr: contract OCR and extraction (CP-07)
# Appended to openapi_ext.py (runs in gen_openapi.py's namespace). Uploads are JSON with base64 content like every other upload.
schemas.update({n: OBJ for n in [
    "IngestBatch", "IngestBatchList", "IngestDocument", "IngestSamples", "IngestCommitResult", "IngestClauseLibrary", "IngestConfig", "IngestReport",
]})
schemas.update({
    "IngestUpload": obj({"files": {"type": "array", "minItems": 1, "maxItems": 20, "items": obj({"name": S, "contentBase64": S}, ["name", "contentBase64"])}, "note": S}, ["files"]),
    "IngestSampleRequest": obj({"keys": arr(S)}, ["keys"]),
    "IngestReview": obj({"corrections": arr(obj({"key": S, "value": {}, "reason": S}, ["key"])), "accept": {"oneOf": [B, arr(S)]}}),
    "IngestCommit": obj({"mode": enum("AUTO", "CREATE", "LINK"), "contractId": UUID, "supplierId": UUID, "createSupplier": B, "allowDuplicate": B, "ownerId": UUID}),
    "IngestReject": obj({"reason": S}, ["reason"]),
    "IngestClauseLibraryUpdate": obj({"clauses": arr(OBJ)}, ["clauses"]),
    "IngestConfigUpdate": obj({"reviewThreshold": {"type": "number", "minimum": 0.5, "maximum": 0.99}}, ["reviewThreshold"]),
})
CI = "ContractIngest"
CI_WRITE = ["LEGAL", "CONTRACT_MGR", "PROCUREMENT"]
CI_READ = CI_WRITE + ["EXEC", "FINANCE", "PROBITY"]
CI_LIB = ["LEGAL", "CONTRACT_MGR"]
ep("POST", "/contract-ingest/uploads", "uploadIngestContracts", CI, "Upload contracts (PDF, PNG, JPG, TIFF, or a zip of them) as base64 JSON. Creates a batch and reads each document: PDF text layers are read for real, images and scanned PDFs by the SIMULATED recognition engine (synthetic fixtures only); then fields with confidence and source span, clauses against the library, and findings", CI_WRITE, "IngestUpload", "IngestBatch", 201, note="Every file, and every zip entry, goes through the malware scan (422 VIRUS_DETECTED). 422 ZIP_PATH_TRAVERSAL, ZIP_BOMB, ZIP_TOO_MANY_ENTRIES, ZIP_INVALID for an unsafe archive; 422 NO_DOCUMENTS when nothing readable is found")
ep("GET", "/contract-ingest/samples", "listIngestSamples", CI, "The built-in synthetic sample contracts (services agreement, SaaS subscription, office licence, a scanned image and a scanned PDF)", CI_READ, None, "IngestSamples")
ep("POST", "/contract-ingest/samples", "ingestSamples", CI, "Ingest built-in synthetic samples through the same pipeline (labelled SAMPLE)", CI_WRITE, "IngestSampleRequest", "IngestBatch", 201, note="404 for an unknown sample key")
ep("GET", "/contract-ingest/batches", "listIngestBatches", CI, "Ingest batches, newest first, with counts by document status", CI_READ, None, "IngestBatchList", query=["limit"])
ep("GET", "/contract-ingest/batches/{id}", "getIngestBatch", CI, "One batch with a summary of each document and what was skipped", CI_READ, None, "IngestBatch")
ep("GET", "/contract-ingest/documents/{id}", "getIngestDocument", CI, "A document: page text with confidence, extracted fields (confidence, rule confidence, source page and offsets, whether review is needed), clauses with similarity to the standard wording, findings, corrections, and the supplier and contract matches", CI_READ, None, "IngestDocument")
ep("POST", "/contract-ingest/documents/{id}/review", "reviewIngestDocument", CI, "Human review: correct fields (value validated, before and after kept and audited) and accept low-confidence values as read", CI_WRITE, "IngestReview", "IngestDocument", note="422 CORRECTION_INVALID; 422 CANNOT_ACCEPT_MISSING for a required field that was not found; 409 INVALID_STATE once committed or rejected")
ep("POST", "/contract-ingest/documents/{id}/commit", "commitIngestDocument", CI, "Commit a reviewed document: create the executed contract record (key dates, value, notice period, extension options, clauses) and its reminders through the contract alert engine, matching the supplier by ABN then name; or LINK it to an existing contract", CI_WRITE, "IngestCommit", "IngestCommitResult", note="409 REVIEW_REQUIRED while fields below the threshold, or required fields, are unreviewed; 409 DUPLICATE_FILE; 409 DUPLICATE_CONTRACT; 409 SUPPLIER_CONFIRM_NEEDED for a merely similar supplier name; 409 ALREADY_COMMITTED")
ep("POST", "/contract-ingest/documents/{id}/reject", "rejectIngestDocument", CI, "Reject a document that is not wanted, with a reason; it leaves the report", CI_WRITE, "IngestReject", "IngestDocument")
ep("GET", "/contract-ingest/clause-library", "getIngestClauseLibrary", CI, "The clause types used to read contracts: keywords, standard wording to compare against, mandatory flag and risk (built-in defaults until a manager replaces them)", CI_READ, None, "IngestClauseLibrary")
ep("PUT", "/contract-ingest/clause-library", "putIngestClauseLibrary", CI, "Replace the tenant's clause library (audited)", CI_LIB, "IngestClauseLibraryUpdate", "IngestClauseLibrary")
ep("GET", "/contract-ingest/config", "getIngestConfig", CI, "The review threshold (fields read with less confidence must be reviewed before commit)", CI_READ, None, "IngestConfig")
ep("PUT", "/contract-ingest/config", "putIngestConfig", CI, "Set the review threshold for documents uploaded from now on (audited)", CI_LIB, "IngestConfigUpdate", "IngestConfig")
ep("GET", "/contract-ingest/report", "getIngestReport", CI, "Reporting across ingested contracts: renewals due in N days, notice windows, liability caps, missing clauses and concentration by supplier", CI_READ, None, "IngestReport", query=["days", "scope"])
