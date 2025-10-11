#!/usr/bin/env bash
# fix-pr.sh — Safe create/update PR with proper auth & branch wiring

set -euo pipefail

# ---- SETTINGS YOU MAY TWEAK (sane defaults) ----
: "${FEATURE_BRANCH:=farmvista-template}"     # change if your working branch has a different name
: "${COMMIT_MSG:=Build mobile-first PWA template & navigation placeholders}"
: "${PR_TITLE:=Build mobile-first PWA template for FarmVista (light mode, global nav/layout)}"
: "${PR_BODY:=This PR adds a clean, mobile-first template with global header/sidebar/footer, \
light theme palette, service worker/manifest stubs, and placeholder menus for Application Records, \
Equipment, Grain, Setup, and Teams & Partners. Includes sidebar accordion behavior and stub pages.}"

# ---- GIT IDENTITY (no-ops if already set) ----
git config user.name  >/dev/null 2>&1 || git config user.name  "FarmVista Bot"
git config user.email >/dev/null 2>&1 || git config user.email "bot@farmvista.local"
git config push.default current

# ---- ENSURE REPO STATE ----
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not inside a git repo. Aborting." >&2
  exit 1
fi

# Determine default base branch (main > beta > master)
BASE_BRANCH=""
for b in main beta master; do
  if git show-ref --verify --quiet "refs/heads/$b" || git ls-remote --exit-code --heads origin "$b" >/dev/null 2>&1; then
    BASE_BRANCH="$b"
    break
  fi
done
if [[ -z "$BASE_BRANCH" ]]; then
  echo "No base branch (main/beta/master) found locally or on origin." >&2
  echo "Create one with: git checkout -b main && git push -u origin main" >&2
  exit 1
fi

# Make sure remotes are reachable
git remote -v | grep -q '^origin' || { echo "No 'origin' remote configured."; exit 1; }
git fetch origin --prune

# Create/switch to feature branch
if git rev-parse --verify --quiet "refs/heads/$FEATURE_BRANCH"; then
  git checkout "$FEATURE_BRANCH"
else
  git checkout -b "$FEATURE_BRANCH" "origin/$FEATURE_BRANCH" 2>/dev/null || git checkout -b "$FEATURE_BRANCH" "$BASE_BRANCH"
fi

# Stage & commit if there are changes
if ! git diff --quiet || ! git diff --cached --quiet; then
  git add -A
  if git diff --cached --quiet; then
    echo "No staged changes."
  else
    git commit -m "$COMMIT_MSG" || true
  fi
fi

# Push branch
git push -u origin "$FEATURE_BRANCH"

# ---- AUTH FOR GH CLI ----
# Prefer existing logged-in session; otherwise use token from env.
if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required. Install it in Codex environment and rerun." >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  # Use GH_TOKEN or GITHUB_TOKEN if present (typical in CI/Codex)
  if [[ -n "${GH_TOKEN:-}" ]]; then
    echo "$GH_TOKEN" | gh auth login --with-token
  elif [[ -n "${GITHUB_TOKEN:-}" ]]; then
    echo "$GITHUB_TOKEN" | gh auth login --with-token
  else
    echo "No GitHub auth. Set GH_TOKEN or GITHUB_TOKEN in Codex environment and rerun." >&2
    exit 1
  fi
fi

# Validate we can see the repo and have PR scope
gh repo view >/dev/null

# ---- CREATE OR UPDATE PR SAFELY ----
set +e
gh pr view "$FEATURE_BRANCH" --json number,state,headRefName,baseRefName >/dev/null 2>&1
PR_EXISTS=$?
set -e

if [[ "$PR_EXISTS" -eq 0 ]]; then
  echo "PR already exists for $FEATURE_BRANCH. Pushing updates and showing URL..."
  gh pr view --web
  exit 0
fi

# Try to create the PR. If 400 occurs (common when head==base or missing scopes), we print diagnostics.
set +e
OUTPUT=$(gh pr create \
  --title "$PR_TITLE" \
  --body "$PR_BODY" \
  --base "$BASE_BRANCH" \
  --head "$FEATURE_BRANCH" 2>&1)
STATUS=$?
set -e

if [[ $STATUS -ne 0 ]]; then
  echo "PR creation failed. Diagnostics:"
  echo "------------------------------------------------------------"
  echo "$OUTPUT"
  echo "------------------------------------------------------------"
  echo "Checks:"
  echo "1) Ensure FEATURE_BRANCH != BASE_BRANCH (current: $FEATURE_BRANCH vs $BASE_BRANCH)."
  echo "2) Ensure token has 'repo' scope (private) or is on the same owner for forks."
  echo "3) Ensure branch is pushed to origin and visible (we pushed above)."
  echo "4) If this is a fork, use: gh pr create --base OWNER:BRANCH --head YOURFORK:$FEATURE_BRANCH"
  exit 1
fi

# Open the created PR in browser (Codex UI usually captures the link as well)
gh pr view --web || true
echo "PR created successfully."
