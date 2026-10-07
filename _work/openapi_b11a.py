# ---------------------------------------------------------------- B11a: encryption, keys, sealed bids, upload scanning, restricted projects, evidence
# SEC-D01 evidence, SEC-D02 keys with rotation, SEC-D03 sealed bids, SEC-D04 envelope encryption, SEC-AP04 malware scanning,
# FR-0865 restricted projects, NFR-R01 / SEC-D10 isolation check. Appended to openapi_ext.py (runs in gen_openapi.py's namespace).
schemas.update({n: OBJ for n in [
    "KeyList", "KeyView", "KeyRewrapResult", "BidBox", "QuarantineList", "QuarantineRescan", "SecurityEvidence",
    "IsolationCheck", "EncryptExistingResult", "RestrictRequest", "RestrictResult", "RestrictionView", "RestrictionDelegate",
    "RestrictedProjectList",
]})
KY = "Keys"; BB = "SealedBids"; QT = "Quarantine"; EV = "SecurityEvidence"; RP = "RestrictedProjects"
KEY_READ = ["ADMIN", "PROBITY", "EXEC"]
BOX = ["ADMIN", "PROCUREMENT", "PROBITY", "EXEC", "LEGAL"]
ep("GET", "/security/keys", "listKeys", KY, "Tenant key versions per purpose (DATA, BIDS, PROJECT) with state and how many objects each protects; key material is never returned. SIMULATED key service", KEY_READ, None, "KeyList")
ep("POST", "/security/keys/{purpose}/rotate", "rotateKey", KY, "Create a new key version for the purpose; the previous version is retired but still decrypts what it sealed", ["ADMIN"], None, "KeyView", 201)
ep("POST", "/security/keys/{purpose}/rewrap", "rewrapKey", KY, "Re-wrap every data key of the purpose to the newest key version without touching a ciphertext; versions that are disabled are skipped and reported", ["ADMIN"], None, "KeyRewrapResult")
ep("POST", "/security/keys/{id}/disable", "disableKey", KY, "Disable a key version: what it protects then fails to decrypt with 'key disabled'", ["ADMIN"], None, "KeyView", note="409 LAST_ACTIVE_KEY when it is the only active key for its purpose")
ep("POST", "/security/keys/{id}/enable", "enableKey", KY, "Enable a disabled key version again (it returns as RETIRED)", ["ADMIN"], None, "KeyView")
ep("GET", "/tenders/{id}/bid-box", "getBidBox", BB, "Sealed bids: metadata only (existence, size, time, hash) until the tender closes and, for a high-value tender, two witnesses have opened it", BOX, None, "BidBox")
ep("GET", "/tenders/{id}/bid-box/files/{fileId}", "downloadBidFile", BB, "Decrypt and download a bid file; every decryption is audited", BOX, None, None, note="423 BIDS_SEALED before close, 423 BIDS_NOT_OPENED before the witnesses open a high-value tender, 403 BID_READ_NOT_PERMITTED for a role not entitled to bid content")
ep("GET", "/security/quarantine", "listQuarantine", QT, "Uploads refused as infected (no content kept) and uploads held as PENDING_SCAN; the simulated scanner's state and test signatures", ["ADMIN", "PROBITY"], None, "QuarantineList")
ep("POST", "/security/quarantine/{id}/rescan", "rescanQuarantineItem", QT, "Rescan an upload held while the scanner was down; clean items are CLEARED, infected ones quarantined", ["ADMIN"], None, "QuarantineRescan", note="409 SCANNER_DOWN while the scanner is still down")
ep("GET", "/security/evidence", "getSecurityEvidence", EV, "Encryption in transit and at rest, measured: HSTS and cookie flags, registry of encrypted fields with encrypted and plaintext row counts, key versions in use, and what is not evidenced here", KEY_READ, None, "SecurityEvidence")
ep("POST", "/security/isolation-check", "runIsolationCheck", EV, "Live tenant-isolation check: tables with tenant_id, which have row level security, and that no foreign row is visible", ["ADMIN"], None, "IsolationCheck")
ep("POST", "/security/encrypt-existing", "encryptExisting", EV, "One-off, safe to repeat: encrypt older plaintext bids and bank details and move a legal platform secret out of the settings", ["ADMIN"], None, "EncryptExistingResult")
ep("POST", "/requests/{id}/restrict", "restrictRequest", RP, "Mark a procurement as a restricted project with a reason: its plan text, report narrative and documents are encrypted with a per-project key and it is invisible outside its sourcing group", ["PROCUREMENT", "EXEC"], "RestrictRequest", "RestrictResult", 201, note="409 when already restricted")
ep("GET", "/requests/{id}/restriction", "getRestriction", RP, "The restriction on a procurement; 404 for anyone outside its sourcing group, exactly as for an id that does not exist", "*", None, "RestrictionView")
ep("POST", "/requests/{id}/restriction/delegates", "addRestrictionDelegate", RP, "Name a delegate who joins the sourcing group of a restricted project", ["PROCUREMENT", "EXEC"], "RestrictionDelegate", None, 201)
ep("GET", "/security/restricted-projects", "listRestrictedProjects", RP, "The restricted projects the caller belongs to", ["ADMIN", "PROBITY", "EXEC", "PROCUREMENT"], None, "RestrictedProjectList")
