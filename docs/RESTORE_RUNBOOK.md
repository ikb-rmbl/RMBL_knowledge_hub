# Disaster Recovery Runbook

This document describes how to recover the RMBL Knowledge Commons database when
something goes wrong. **Read this calmly before acting.** Most "disasters" are
recoverable without panic if you follow the right path.

## Quick Reference

| Symptom | Most likely fix | Severity |
|---|---|---|
| Accidental DROP TABLE / bad migration / wrong sync direction, caught within 7 days | Neon Point-in-Time Recovery | Low |
| Missing/wrong data discovered after >7 days | Restore from S3 backup | Medium |
| Neon project deleted / account compromised | Restore from S3 backup to a fresh Neon project | High |
| Local machine lost / replaced | Re-clone repo, run `npm run restore-from-s3` | Low |
| Restricted PDFs lost | Restore from `s3://rmbl-hub-pdfs-private/` | Medium |
| Both AWS and Neon compromised at the same time | Rebuild from pipeline (~$1000, ~1 week) | Catastrophic |

---

## Step 1: Don't make it worse

Before doing anything else:

1. **Stop the bleeding.** Cancel any running pipeline scripts. Take the dev
   server offline if you can. Don't run any sync commands.
2. **Take notes.** Open a text file and write down:
   - When you noticed the problem
   - What you were doing right before
   - What you saw (error message, missing data, etc.)
3. **Don't sync.** Do NOT run `npm run sync:push` or `npm run sync:pull` until
   you've identified what went wrong. A sync run might propagate corruption
   from one side to the other.
4. **Check the backup recency** to confirm you have something to restore from:
   ```bash
   AWS_PROFILE=rmbl-backup bash scripts/verify-backup-recency.sh
   ```

---

## Step 2: Triage

Answer these in order:

**Is the data still on Neon and just wrong, or is the entire Neon project gone?**
- Try to log into the Neon console
- If the project is intact, you have more options (PITR available)
- If the project is gone or you can't log in, skip to Option B below

**When did the problem start?**
- Within 7 days → Neon PITR (Option A) is the cleanest path
- More than 7 days ago → S3 backup (Option B) is required

**Is local also affected?**
- If you ran a destructive script locally, restore local from S3 too
- If only Neon is affected, you can restore from local instead via `npm run sync:full`

---

## Option A: Neon Point-in-Time Recovery

Best when: Neon account is intact, problem is < 7 days old.

Neon's Launch tier includes 7 days of PITR. The restore happens in the Neon
console.

### Steps

1. Log into the [Neon console](https://console.neon.tech)
2. Open your project → Branches
3. Click **Create branch**
4. For "Branch from a point in time," pick a timestamp **before** the incident
5. Name the branch `recovery-YYYYMMDD`
6. Wait for the branch to be ready (usually < 1 minute)
7. Test the branch: get its connection string from "Connection details" and
   run a query to confirm the data looks right
   ```bash
   psql "postgresql://<recovery-branch-url>" -c "SELECT count(*) FROM publications;"
   ```
8. Once you've confirmed the recovery branch is good:
   - **Either** promote the recovery branch to be the new main (Neon console)
   - **Or** export from the recovery branch and restore to main:
     ```bash
     pg_dump -Fc <recovery-branch-url> -f /tmp/recovery.dump
     # Then use restore-database.sh --target=neon to overwrite main
     ```
9. After restoring, run `npm run sync:pull` to bring local in sync

### What to verify after recovery

- Row counts match expectation: `npm run sync:verify`
- Recent papers are present (check the latest year you remember adding)
- Search works on the public site
- Restricted PDFs still appear in search results (they should — restriction
  metadata is in the database, not affected by reverting data)

---

## Option B: Restore from S3 backup

Best when: Neon is compromised, account is gone, or the issue is older than
7 days.

### Steps

1. **List available backups:**
   ```bash
   AWS_PROFILE=rmbl-backup bash scripts/restore-database.sh --list
   ```
   Choose a backup from before the incident. Each backup is timestamped in
   UTC: `rmbl-hub-2026-04-09T21-18-51Z.dump`

2. **Restore to local first** to verify the backup is good:
   ```bash
   AWS_PROFILE=rmbl-backup bash scripts/restore-database.sh \
     --backup=rmbl-hub-2026-04-09T21-18-51Z.dump
   ```
   This drops your local database and restores from the chosen backup.
   Confirms with row counts at the end.

3. **Verify locally:**
   - Visit http://localhost:3000 after `npm run dev`
   - Search for known papers
   - Spot-check some detail pages

4. **Push the restored state to Neon** (only if Neon is also affected):
   ```bash
   # Option B1: nuclear restore via the same script
   AWS_PROFILE=rmbl-backup bash scripts/restore-database.sh \
     --backup=rmbl-hub-2026-04-09T21-18-51Z.dump \
     --target=neon
   #   Requires double confirmation. Drops the public schema on Neon and
   #   restores from the dump file.

   # Option B2: sync from local (more incremental, preserves admin edits if any)
   npm run sync:push
   ```

### If Neon is completely gone

You'll need to create a new Neon project first:
1. Sign up for a new Neon project (or use a different region in the same account)
2. Create a database called `neondb`
3. Update `NEON_DIRECT_URL` and `NEON_DATABASE_URL` in `.env`
4. Update GitHub repo secrets
5. Update the Vercel environment variables (so the production site points at the new DB)
6. Run `restore-database.sh --target=neon` against the new project
7. Verify the production site loads after Vercel redeploys

---

## Step 3: Restoring restricted PDFs

The `pdf-staging/` directory is backed up separately to
`s3://rmbl-hub-pdfs-private/`.

### Steps

```bash
# 1. Restore the entire pdf-staging directory
AWS_PROFILE=rmbl-backup aws s3 sync \
  s3://rmbl-hub-pdfs-private/pdf-staging/ \
  scripts/output/pdf-staging/

# 2. Restore the manifest
AWS_PROFILE=rmbl-backup aws s3 cp \
  s3://rmbl-hub-pdfs-private/pdf-manifest.json \
  scripts/output/pdf-manifest.json
```

The full text content for restricted PDFs is in the database (`publications.full_text`),
so even if the PDF blob is missing, search and reading the full text still works.
The PDFs themselves only matter if a researcher requests one (which we shouldn't
serve anyway because they're restricted).

---

## Step 4: Post-restore checklist

After any restore, run through this list:

- [ ] `npm run sync:verify` — row counts match expected scale
- [ ] Visit http://localhost:3000 and search for "marmot" — results appear
- [ ] Open a publication detail page — abstract and references show
- [ ] Open a restricted publication — "Download PDF" button is hidden
- [ ] Run `npm run test` — all 214 tests pass
- [ ] Run a fresh backup right away to capture the recovered state:
      `AWS_PROFILE=rmbl-backup bash scripts/backup-database.sh`
- [ ] Document what happened in `docs/incident-log.md` (create if needed)
- [ ] Notify users if the production site was offline

---

## Step 5: After-action review

Once everything is back to normal, take an hour to:

1. Write a brief incident report in `docs/incident-log.md`:
   - What happened
   - How you noticed
   - Root cause
   - Steps taken to recover
   - How long it took
   - What could have prevented it
2. Update this runbook if you discovered something missing
3. Tighten any relevant safeguards (e.g., add a SQL guard, add a confirmation
   prompt to a destructive script, change a script from auto-run to manual)
4. Consider whether the backup cadence is sufficient

---

## Setup verification (one-time, not for an incident)

To confirm the backup system is working when there's no incident:

```bash
# 1. Check the latest backup is recent
AWS_PROFILE=rmbl-backup bash scripts/verify-backup-recency.sh

# 2. Run a full restore drill (downloads and restores to a throwaway DB)
AWS_PROFILE=rmbl-backup bash scripts/test-restore.sh
```

Run the restore drill **monthly** (set a calendar reminder). A backup you've
never restored from isn't a backup.

---

## Contacts

| Service | URL | Used for |
|---|---|---|
| Neon | https://console.neon.tech | DB hosting + PITR |
| AWS | https://console.aws.amazon.com | S3 backups |
| Vercel | https://vercel.com/dashboard | Frontend hosting |
| GitHub | https://github.com/ikb-rmbl/RMBL_knowledge_hub | Source + CI |

| Person | Role | Contact |
|---|---|---|
| Ian (developer) | Owns code, AWS, Neon | (your contact info) |
| RMBL admin | Owns site policy | (contact) |
