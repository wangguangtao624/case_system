#!/bin/bash
set -Eeuo pipefail
hostname -I | tr ' ' '\n' | grep -qx '10.26.10.12' || exit 1
RELAY="$HOME/.local/share/case-system-git-relay.git"
if [[ ! -d "$RELAY" ]]; then
    git clone --bare git@github.com:wangguangtao624/case_system.git "$RELAY"
fi
chmod 700 "$RELAY"
git -C "$RELAY" config receive.denyNonFastForwards true
git -C "$RELAY" config receive.maxInputSize 104857600
cat > "$RELAY/hooks/pre-receive" <<'EOF'
#!/bin/bash
set -Eeuo pipefail
while read -r old new ref; do
    [[ "$ref" =~ ^refs/heads/(dev|feature|fix|ops)/[A-Za-z0-9._/-]+$ ]] || { echo 'Only dev/feature/fix/ops branches may be pushed through the relay' >&2; exit 1; }
    [[ ! "$new" =~ ^0+$ ]] || { echo 'Relay branch deletion is disabled' >&2; exit 1; }
done
EOF
cat > "$RELAY/hooks/post-receive" <<'EOF'
#!/bin/bash
set -Eeuo pipefail
refs=()
while read -r old new ref; do refs+=("$ref"); done
if (( ${#refs[@]} )); then
    git push origin "${refs[@]}" || { echo 'RELAY STORED THE BRANCH BUT GITHUB PUSH FAILED. Codex must reconcile before release.' >&2; exit 1; }
fi
EOF
chmod 700 "$RELAY/hooks/pre-receive" "$RELAY/hooks/post-receive"
install -m 700 "$(dirname "$0")/git-relay.py" "$HOME/.local/share/case-system-ops/git-relay.py"
echo 'Git relay ready; it does not modify the production checkout.'
